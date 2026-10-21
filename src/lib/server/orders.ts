import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, frLong, iso, startOfDay } from "@/lib/dates";
import { HORIZON_DAYS, syncOrders } from "@/lib/engine";
import { carnetMonthlyCents, CHARGE_LEAD_DAYS, CONFIRM_LEAD_DAYS, type ChargeLine } from "@/lib/pricing";
import type { OrderStatus } from "@/lib/types";
import { requestCourier } from "./courier";
import { fromOrder, loadPlanning, toRecipe, toSchedule } from "./mappers";
import { notifyCustomer } from "./notify";
import { recordEvents } from "./guarantee";
import { settleDebits, type GuaranteeEvent } from "@/lib/guarantee";
import { CARNET_PRODUCT_ID, priceIdFor, SITE_URL, stripe } from "./stripe";

type DB = SupabaseClient;

/** Transitions autorisées côté fleuriste. */
export const FLORIST_TRANSITIONS: Record<string, OrderStatus[]> = {
  assigned: ["preparing"],
  preparing: ["ready"],
  ready: ["in_delivery"],
  in_delivery: ["delivered"],
};

/**
 * J-7 : génère et met à jour les commandes des 7 prochains jours avec la même
 * logique que la démo (lib/engine > syncOrders) : fusion occasion + mensuel,
 * quotas du Carnet, surclassements, extras, modèle, puis proposition à l'atelier
 * le mieux placé (garantie de livraison : 48 h pour accepter, voir lib/guarantee).
 * Idempotent : (schedule_id, delivery_date) est unique.
 */
export async function dispatchDue(db: DB, opts: { userId?: string } = {}) {
  const today = startOfDay();
  const p = await loadPlanning(db, { userId: opts.userId, ordersSince: iso(addDays(today, -400)) });
  const ownerOf = new Map(p.subscriptionRows.map((s) => [s.id as string, s.user_id as string]));
  const events: GuaranteeEvent[] = [];
  const next = syncOrders({ ...p, today, horizon: HORIZON_DAYS, now: new Date(), onEvent: (e) => events.push(e) });
  const before = new Map(p.orders.map((o) => [o.id, o]));

  let created = 0;
  let updated = 0;
  const createdIds = new Map<string, string>();
  for (const o of next) {
    const userId = ownerOf.get(o.subscriptionId ?? "");
    if (!userId) continue;
    const prev = before.get(o.id);
    const row = fromOrder(o, userId);
    if (!prev) {
      // Les ids de la démo (ord_…) ne sont pas des uuid : la base attribue l'id, on garde la correspondance
      const { data: ins, error } = await db.from("orders").insert(row).select("id").single();
      if (error?.code === "23505") continue; // créée en parallèle
      if (error) throw error;
      createdIds.set(o.id, ins.id);
      created++;
    } else if (JSON.stringify(fromOrder(prev, userId)) !== JSON.stringify(row)) {
      const { error } = await db.from("orders").update(row).eq("id", o.id);
      if (error) throw error;
      updated++;
    }
  }
  // Propositions des nouvelles commandes : e-mail et SMS à l'atelier, journal
  await recordEvents(db, events.flatMap((e) => (createdIds.has(e.orderId) ? [{ ...e, orderId: createdIds.get(e.orderId)! }] : [])));
  return { created, updated, offered: events.filter((e) => createdIds.has(e.orderId)).length };
}

/**
 * J-3 : prélève les suppléments (occasion +30 %, surclassement, extra tige) sur une
 * facture Stripe dédiée, puis prévient l'abonné avec un lien pour modifier l'envoi.
 */
export async function chargeDue(db: DB) {
  const today = startOfDay();
  const until = iso(addDays(today, CHARGE_LEAD_DAYS));
  const { data: due } = await db
    .from("orders")
    .select("*, user:users(email, first_name, stripe_customer_id), recipient:recipients(first_name), schedule:schedules(label)")
    .eq("payment_status", "pending")
    .neq("status", "cancelled")
    .gte("delivery_date", iso(today))
    .lte("delivery_date", until);

  let charged = 0;
  let failed = 0;
  for (const o of due ?? []) {
    const user = o.user as { email: string; first_name: string | null; stripe_customer_id: string | null };
    const lines = (o.lines ?? []) as ChargeLine[];
    const who = (o.recipient as { first_name: string }).first_name;
    const label = (o.schedule as { label: string }).label;
    try {
      if (!user.stripe_customer_id) throw new Error("Client Stripe manquant");
      const invoice = await stripe().invoices.create(
        {
          customer: user.stripe_customer_id,
          collection_method: "charge_automatically",
          auto_advance: false,
          description: `${label} pour ${who}, livré le ${frLong(o.delivery_date)}`,
          metadata: { kind: "b2c_extra", order_id: o.id },
        },
        { idempotencyKey: `extra_invoice_${o.id}` },
      );
      for (const l of lines) {
        const price = await priceIdFor(l.lookupKey);
        await stripe().invoiceItems.create(
          price
            ? { customer: user.stripe_customer_id, invoice: invoice.id, pricing: { price }, metadata: { order_id: o.id, kind: l.kind } }
            : { customer: user.stripe_customer_id, invoice: invoice.id, amount: l.amountCents, currency: "eur", description: l.label, metadata: { order_id: o.id, kind: l.kind } },
          { idempotencyKey: `extra_item_${o.id}_${l.kind}` },
        );
      }
      await stripe().invoices.finalizeInvoice(invoice.id!);
      const paid = await stripe().invoices.pay(invoice.id!);
      await db.from("orders").update({ payment_status: paid.status === "paid" ? "paid" : "pending", stripe_invoice_id: invoice.id }).eq("id", o.id);
      charged++;
      await notifyCustomer(
        user.email,
        `${label} pour ${who} : livraison le ${frLong(o.delivery_date)}`,
        `Bonjour ${user.first_name ?? ""},\n\nVotre bouquet « ${label} » pour ${who} sera livré le ${frLong(o.delivery_date)}.\n` +
          `Supplément prélevé : ${(o.price_cents / 100).toFixed(2).replace(".", ",")} € (${lines.map((l) => l.label).join(", ")}).\n\n` +
          `Modifier le message ou surclasser le bouquet en 1 clic : ${SITE_URL}/compte\n`,
      );
    } catch (e) {
      console.error("[chargeDue]", o.id, e);
      await db.from("orders").update({ payment_status: "failed" }).eq("id", o.id);
      failed++;
      await notifyCustomer(user.email, `Paiement à mettre à jour pour ${label}`, `Le supplément pour « ${label} » (${who}) n'a pas pu être prélevé. Mettez à jour votre carte avant demain soir pour que le bouquet parte : ${SITE_URL}/compte`);
    }
  }

  // Rappel J-3 aussi pour les livraisons sans supplément
  const { data: included } = await db
    .from("orders")
    .select("delivery_date, user:users(email, first_name), recipient:recipients(first_name), schedule:schedules(label)")
    .eq("payment_status", "included")
    .neq("status", "cancelled")
    .eq("delivery_date", until);
  for (const o of included ?? []) {
    const user = o.user as unknown as { email: string; first_name: string | null };
    const who = (o.recipient as unknown as { first_name: string }).first_name;
    const label = (o.schedule as unknown as { label: string }).label;
    await notifyCustomer(
      user.email,
      `${label} pour ${who} : livraison le ${frLong(o.delivery_date)}`,
      `Votre bouquet « ${label} » pour ${who} sera livré le ${frLong(o.delivery_date)}. Modifier le message ou surclasser le bouquet en 1 clic : ${SITE_URL}/compte`,
    );
  }
  return { charged, failed, reminded: included?.length ?? 0 };
}

/**
 * J-1 : seules les commandes payées (ou sans supplément) partent chez le fleuriste.
 * Un supplément impayé annule la livraison et prévient l'abonné.
 */
export async function confirmDue(db: DB) {
  const tomorrow = iso(addDays(startOfDay(), CONFIRM_LEAD_DAYS));
  const { data } = await db
    .from("orders")
    .select("id, payment_status, status_at, user:users(email), schedule:schedules(label)")
    .eq("delivery_date", tomorrow)
    .in("status", ["scheduled", "assigned"]);
  let confirmed = 0;
  let cancelled = 0;
  for (const o of data ?? []) {
    if (o.payment_status === "paid" || o.payment_status === "included") {
      await db.from("orders").update({ status_at: { ...(o.status_at as object), confirmed: new Date().toISOString() } }).eq("id", o.id);
      confirmed++;
    } else {
      await db.from("orders").update({ status: "cancelled", cancel_reason: "Supplément non payé à J-1" }).eq("id", o.id);
      cancelled++;
      const user = o.user as unknown as { email: string };
      await notifyCustomer(user.email, "Livraison annulée", `Le supplément de « ${(o.schedule as unknown as { label: string }).label} » n'a pas pu être prélevé : la livraison de demain est annulée. Rien ne vous a été facturé pour ce bouquet.`);
    }
  }
  return { confirmed, cancelled };
}

/** J-7 : rappels gratuits (« L'anniversaire de Thomas est dans 7 jours »). */
export async function remindersDue(db: DB) {
  const target = iso(addDays(startOfDay(), 7)).slice(5);
  const { data } = await db.from("reminders").select("id, name, label, event_date, type, last_notified_at, user:users(email, first_name)").eq("event_date", target);
  let sent = 0;
  const today = iso(startOfDay());
  for (const r of data ?? []) {
    if (r.last_notified_at === today) continue;
    const u = r.user as unknown as { email: string; first_name: string | null };
    const link = `${SITE_URL}/abonnement?offre=carnet&prenom=${encodeURIComponent(r.name)}&${r.type === "birthday" ? "anniversaire" : "date"}=${r.event_date}&libelle=${encodeURIComponent(r.label)}`;
    await notifyCustomer(u.email, `${r.label} dans 7 jours`, `Bonjour ${u.first_name ?? ""},\n\n${r.label} tombe dans une semaine. Un bouquet livré le jour J, composé par un atelier de son quartier ?\n\nProgrammer en 2 minutes : ${link}\n`);
    await db.from("reminders").update({ last_notified_at: today }).eq("id", r.id);
    sent++;
  }
  return { sent };
}

/**
 * Renouvellement annuel du Carnet : la mensualité est recalculée à partir des dates actives
 * (les dates ajoutées en cours d'année y entrent), sans prorata. Après 12 mois, sans engagement.
 */
export async function renewCarnets(db: DB) {
  const today = startOfDay();
  const { data: subs } = await db.from("subscriptions").select("id, started_at, price_cents, stripe_subscription_id, user:users(email)").eq("plan_type", "SPECIAL_EVENTS_CARNET").eq("status", "active");
  const { data: catalogRows } = await db.from("flower_catalog_recipes").select("*");
  const catalog = (catalogRows ?? []).map(toRecipe);
  let renewed = 0;
  for (const sub of subs ?? []) {
    const start = new Date(sub.started_at + "T12:00:00");
    const anniversary = start.getMonth() === today.getMonth() && start.getDate() === today.getDate() && start.getFullYear() < today.getFullYear();
    if (!anniversary) continue;
    const { data: sch } = await db.from("schedules").select("*").eq("subscription_id", sub.id);
    const next = carnetMonthlyCents((sch ?? []).map(toSchedule), catalog);
    if (next === sub.price_cents || !sub.stripe_subscription_id) continue;
    const stripeSub = await stripe().subscriptions.retrieve(sub.stripe_subscription_id);
    await stripe().subscriptions.update(sub.stripe_subscription_id, {
      items: [{ id: stripeSub.items.data[0].id, price_data: { currency: "eur", product: CARNET_PRODUCT_ID, unit_amount: next, recurring: { interval: "month" } } }],
      proration_behavior: "none",
    });
    await db.from("subscriptions").update({ price_cents: next }).eq("id", sub.id);
    const email = (sub.user as unknown as { email: string }).email;
    await notifyCustomer(email, "Votre Carnet est renouvelé", `Nouvelle mensualité : ${(next / 100).toFixed(2).replace(".", ",")} €, calculée sur vos dates actuelles. Votre Carnet est désormais sans engagement.`);
    renewed++;
  }
  return { renewed };
}

/** Destinataire absent : nouvelle tentative le lendemain, sans frais, et l'abonné est prévenu. */
export async function rescheduleAbsent(db: DB, o: { id: string; delivery_date: string; original_date: string | null; attempt: number }) {
  const next = iso(addDays(new Date(o.delivery_date + "T12:00:00"), 1));
  await db
    .from("orders")
    .update({
      status: "assigned",
      delivery_date: next,
      original_date: o.original_date ?? o.delivery_date,
      attempt: (o.attempt ?? 1) + 1,
      issue: `Destinataire absent le ${o.delivery_date} : nouvelle tentative le ${next}`,
    })
    .eq("id", o.id);
  const { data: u } = await db.from("orders").select("user:users(email), recipient:recipients(first_name)").eq("id", o.id).single();
  const email = (u?.user as unknown as { email: string } | null)?.email;
  const who = (u?.recipient as unknown as { first_name: string } | null)?.first_name;
  if (email) await notifyCustomer(email, `${who} était absent(e)`, `Le bouquet n'a pas pu être remis aujourd'hui. Nouvelle tentative demain (${frLong(next)}), sans frais. Vous pouvez ajouter un code ou un voisin dans les notes d'accès depuis votre carnet.`);
}

/**
 * Change le statut d'une commande et déclenche les effets :
 *  - ready      → coursier Uber Direct / Stuart si l'atelier ne livre pas lui-même
 *  - delivered  → virement Stripe Connect vers l'atelier + ligne payouts
 * Le compteur freemium est incrémenté par un trigger SQL.
 */
export async function transitionOrder(db: DB, orderId: string, to: OrderStatus, actor: { floristOwnerId?: string; admin?: boolean }) {
  const { data: o, error } = await db
    .from("orders")
    .select("*, florist:florists(*), recipient:recipients(*)")
    .eq("id", orderId)
    .single();
  if (error || !o) throw Object.assign(new Error("Commande introuvable"), { status: 404 });
  const f = o.florist;

  if (!actor.admin) {
    if (!f || f.owner_id !== actor.floristOwnerId) throw Object.assign(new Error("Cette commande ne vous est pas attribuée"), { status: 403 });
    if (f.saas_plan === "free" && f.completed_orders >= 10 && o.status === "assigned")
      throw Object.assign(new Error("Activez Moncleur Pro pour traiter cette commande"), { status: 402 });
    if (o.status === "assigned" && !o.accepted_at) throw Object.assign(new Error("Acceptez d'abord la commande"), { status: 409 });
    if (!FLORIST_TRANSITIONS[o.status]?.includes(to)) throw Object.assign(new Error(`Transition ${o.status} → ${to} impossible`), { status: 409 });
    if (to === "preparing" && (o.payment_status === "pending" || o.payment_status === "failed"))
      throw Object.assign(new Error("Paiement du client pas encore confirmé : attendez la confirmation J-1"), { status: 409 });
  }

  const patch: Record<string, unknown> = { status: to };

  if (to === "ready" && o.courier !== "own") {
    const r = o.recipient;
    const job = await requestCourier(o.courier, {
      orderId: o.id,
      shopName: f.shop_name,
      shopAddress: `${f.address}, ${f.postal_code} ${f.city}`,
      dropoffName: `${r.first_name} ${r.last_name}`,
      dropoffAddress: `${r.address}, ${r.postal_code} ${r.city}`,
      dropoffPhone: r.phone,
      dropoffNotes: r.access_notes ?? undefined,
    });
    patch.courier_ref = job.ref;
    patch.tracking_url = job.trackingUrl;
  }

  const { error: upErr } = await db.from("orders").update(patch).eq("id", o.id);
  if (upErr) throw upErr;

  const { data: paidAlready } = to === "delivered" ? await db.from("payouts").select("id").eq("order_id", o.id).maybeSingle() : { data: null };
  if (to === "delivered" && f && !paidAlready) {
    // Retenues en cours (prime de secours après une réattribution critique) : imputées sur ce virement
    const { data: open } = await db.from("florist_debits").select("*").eq("florist_id", f.id).gt("remaining_cents", 0).order("created_at");
    const settled = settleDebits(
      (open ?? []).map((d) => ({ id: d.id, orderId: d.order_id, amountCents: d.amount_cents, remainingCents: d.remaining_cents, reason: d.reason, at: d.created_at })),
      o.payout_cents,
    );
    let transferId: string | null = null;
    if (f.stripe_account_id && f.payouts_enabled && settled.netCents > 0) {
      const t = await stripe().transfers.create(
        { amount: settled.netCents, currency: "eur", destination: f.stripe_account_id, transfer_group: o.id, metadata: { order_id: o.id, withheld_cents: String(settled.withheldCents) } },
        { idempotencyKey: `payout_${o.id}` },
      );
      transferId = t.id;
    }
    const { error: poErr } = await db.from("payouts").upsert(
      { florist_id: f.id, order_id: o.id, amount_cents: settled.netCents, withheld_cents: settled.withheldCents, stripe_transfer_id: transferId, status: transferId || settled.netCents === 0 ? "paid" : "pending" },
      { onConflict: "order_id", ignoreDuplicates: true },
    );
    if (poErr) throw poErr;
    for (const d of settled.debits) {
      const before = open?.find((x) => x.id === d.id);
      if (before && before.remaining_cents !== d.remainingCents) await db.from("florist_debits").update({ remaining_cents: d.remainingCents }).eq("id", d.id).eq("remaining_cents", before.remaining_cents);
    }
  }
  return { ok: true as const };
}
