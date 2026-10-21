import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Garantie de livraison côté serveur : même logique que la démo (lib/guarantee),
 * appliquée à Supabase toutes les 15 minutes (/api/cron/guarantee) et à chaque réponse d'atelier.
 *
 * Concurrence : chaque écriture est conditionnelle (statut et acceptation inchangés depuis la lecture).
 * Si un atelier accepte pendant le passage du cron, l'écriture du cron est ignorée pour cette commande
 * et ses notifications ne partent pas ; le passage suivant repart de l'état réel.
 * Deux ateliers qui acceptent la même urgence : le premier gagne, le second reçoit une erreur 409.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { acceptOffer, addDaysISO, applyGuarantee, assignManually, declineOffer, parisDate, type GuaranteeEvent } from "@/lib/guarantee";
import { isLocked } from "@/lib/matching";
import type { Florist, Order } from "@/lib/types";
import { fail } from "./http";
import { guaranteeColumns, toFlorist, toOrder } from "./mappers";
import { notifyCustomer, notifyEmail, sendSms } from "./notify";
import { SITE_URL, stripe } from "./stripe";

type DB = SupabaseClient;

const OPEN = ["scheduled", "assigned", "preparing", "ready", "in_delivery"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Ctx {
  orders: Order[];
  florists: Florist[];
  recipients: { id: string; lat: number; lng: number; firstName: string }[];
}

/** Commandes ouvertes (3 jours en arrière pour les reports), ateliers, destinataires et historique (fidélité). */
export async function loadContext(db: DB): Promise<Ctx> {
  const from = addDaysISO(parisDate(), -3);
  const { data: open, error } = await db.from("orders").select("*").in("status", OPEN).gte("delivery_date", from).limit(5000);
  if (error) throw error;
  const ids = [...new Set((open ?? []).map((o) => o.recipient_id as string))];
  const [hist, fl, rec] = await Promise.all([
    ids.length ? db.from("orders").select("*").eq("status", "delivered").in("recipient_id", ids).gte("delivery_date", addDaysISO(from, -120)).limit(5000) : { data: [] as any[] },
    db.from("florists").select("*, closures:florist_closures(*), strikes:florist_strikes(*), debits:florist_debits(*)"),
    ids.length ? db.from("recipients").select("id, lat, lng, first_name").in("id", ids) : { data: [] as any[] },
  ]);
  return {
    orders: [...(open ?? []), ...(hist.data ?? [])].map(toOrder),
    florists: (fl.data ?? []).map(toFlorist),
    recipients: (rec.data ?? []).map((r: any) => ({ id: r.id, lat: r.lat ?? 0, lng: r.lng ?? 0, firstName: r.first_name })),
  };
}

/** Écrit les commandes modifiées (conditionnellement), les nouveaux manquements et les notifications. */
async function persist(db: DB, ctx: Ctx, orders: Order[], florists: Florist[], events: GuaranteeEvent[]) {
  const before = new Map(ctx.orders.map((o) => [o.id, o]));
  const lost = new Set<string>();
  let updated = 0;
  for (const o of orders) {
    const p = before.get(o.id);
    if (!p) continue;
    const cols = guaranteeColumns(o);
    if (JSON.stringify(guaranteeColumns(p)) === JSON.stringify(cols)) continue;
    let q = db.from("orders").update(cols).eq("id", o.id).eq("status", p.status);
    q = p.acceptedAt ? q.eq("accepted_at", p.acceptedAt) : q.is("accepted_at", null);
    const { data, error } = await q.select("id");
    if (error) throw error;
    if (data?.length) updated++;
    else lost.add(o.id); // modifiée entre-temps (acceptation, changement de statut) : le prochain passage s'en occupe
  }

  const prevStrikes = new Set(ctx.florists.flatMap((f) => (f.strikes ?? []).map((s) => s.id)));
  const strikes = florists.flatMap((f) =>
    (f.strikes ?? [])
      .filter((s) => !prevStrikes.has(s.id) && !lost.has(s.orderId))
      .map((s) => ({ key: s.id, florist_id: f.id, order_id: UUID.test(s.orderId) ? s.orderId : null, points: s.points, reason: s.reason })),
  );
  if (strikes.length) {
    const { error } = await db.from("florist_strikes").upsert(strikes, { onConflict: "key", ignoreDuplicates: true });
    if (error) throw error;
  }

  // Retenues : prime de secours (+20 %) imputée sur les prochains virements de l'atelier défaillant
  const prevDebits = new Set(ctx.florists.flatMap((f) => (f.debits ?? []).map((d) => d.id)));
  const debits = florists.flatMap((f) =>
    (f.debits ?? [])
      .filter((d) => !prevDebits.has(d.id) && !lost.has(d.orderId))
      .map((d) => ({ key: d.id, florist_id: f.id, order_id: UUID.test(d.orderId) ? d.orderId : null, amount_cents: d.amountCents, remaining_cents: d.remainingCents, reason: d.reason })),
  );
  if (debits.length) {
    const { error } = await db.from("florist_debits").upsert(debits, { onConflict: "key", ignoreDuplicates: true });
    if (error) throw error;
  }

  const kept = events.filter((e) => !lost.has(e.orderId));
  await recordEvents(db, kept);
  return { updated, skipped: lost.size, strikes: strikes.length, debits: debits.length, events: kept.length };
}

/** Passage périodique : rappels, bascules, règle de 11 h, fermetures, reports, alertes. */
export async function runGuarantee(db: DB, now: Date = new Date()) {
  const ctx = await loadContext(db);
  const g = applyGuarantee({ orders: ctx.orders, florists: ctx.florists, recipients: ctx.recipients, now });
  return persist(db, ctx, g.orders, g.florists, g.events);
}

/** Réponse d'un atelier à une proposition. L'acceptation est atomique : premier arrivé, premier servi. */
export async function respondToOffer(db: DB, a: { orderId: string; ownerId: string; accept: boolean; reason?: string }) {
  const ctx = await loadContext(db);
  const { data: fRow } = await db.from("florists").select("id, saas_plan, completed_orders").eq("owner_id", a.ownerId).single();
  if (!fRow) throw fail(403, "Aucun atelier associé à ce compte");
  if (a.accept && isLocked({ saasPlan: fRow.saas_plan, completedOrders: fRow.completed_orders })) throw fail(402, "Activez Moncleur Pro pour accepter de nouvelles commandes");
  const input = { orders: ctx.orders, florists: ctx.florists, recipients: ctx.recipients, orderId: a.orderId, floristId: fRow.id as string };
  const r = a.accept ? acceptOffer(input) : declineOffer({ ...input, reason: a.reason?.slice(0, 80) });
  if (r.error) throw fail(409, r.error);
  const next = r.orders.find((o) => o.id === a.orderId)!;
  const { data, error } = await db.from("orders").update(guaranteeColumns(next)).eq("id", a.orderId).is("accepted_at", null).contains("offered_to", [fRow.id]).select("id");
  if (error) throw error;
  if (!data?.length) throw fail(409, "Un autre atelier a déjà pris cette commande");
  await recordEvents(db, r.events);
  return { ok: true as const, accepted: !!next.acceptedAt && next.floristId === fRow.id };
}

/** Placement par l'équipe : confirmé d'office. */
export async function assignByOps(db: DB, orderId: string, floristId: string) {
  const ctx = await loadContext(db);
  const o = ctx.orders.find((x) => x.id === orderId);
  const f = ctx.florists.find((x) => x.id === floristId);
  if (!o || !f) throw fail(404, "Commande ou atelier introuvable");
  if (!["scheduled", "assigned"].includes(o.status)) throw fail(409, "Commande déjà en préparation");
  const next = assignManually(o, f, ctx.recipients.find((r) => r.id === o.recipientId));
  const { error } = await db.from("orders").update(guaranteeColumns(next)).eq("id", orderId).eq("status", o.status);
  if (error) throw error;
  await recordEvents(db, [{ kind: "accepted", orderId, floristIds: [f.id], audience: "florist", text: `L'équipe Moncleur vous a confié une commande du ${next.deliveryDate}. Elle est confirmée.`, at: new Date().toISOString() }]);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

const SUBJECT: Record<string, string> = {
  offer: "Nouvelle commande à confirmer",
  accepted: "Commande confirmée",
  remind: "Rappel : commande à confirmer",
  expired: "Commande confiée à un autre atelier",
  declined: "Proposition refusée",
  urgent: "Urgence près de chez vous",
  day_reminder: "Préparation du jour : avant 11 h",
  day_alert: "11 h : commande pas en préparation",
  critical_reassign: "Commande transférée à un atelier de secours",
  day_missed: "Commande du jour retirée",
  closure: "Fermeture prise en compte",
  locked: "Commande réattribuée",
  alert: "[Garantie] Commande à placer",
  rescue_late: "[Garantie] Reprise urgente en retard",
  customer_warning: "Nous cherchons l'atelier de votre bouquet",
  rollover: "Votre bouquet sera livré demain",
  refund: "Livraison annulée et remboursée",
};

/** Ces alertes partent aussi par SMS : elles demandent une action rapide de l'atelier. */
const SMS_KINDS = new Set(["offer", "remind", "urgent", "day_reminder", "day_alert", "critical_reassign", "day_missed", "expired"]);

export async function recordEvents(db: DB, events: GuaranteeEvent[]) {
  if (!events.length) return;
  const floristIds = [...new Set(events.flatMap((e) => (e.audience === "florist" ? e.floristIds : [])))];
  const orderIds = [...new Set(events.filter((e) => e.audience === "customer").map((e) => e.orderId))];
  const [fl, ord] = await Promise.all([
    floristIds.length ? db.from("florists").select("id, phone, owner:users(email)").in("id", floristIds) : { data: [] as any[] },
    orderIds.length ? db.from("orders").select("id, user:users(email)").in("id", orderIds) : { data: [] as any[] },
  ]);
  const florist = new Map((fl.data ?? []).map((f: any) => [f.id, { phone: f.phone as string | null, email: f.owner?.email as string | undefined }]));
  const customer = new Map((ord.data ?? []).map((o: any) => [o.id, o.user?.email as string | undefined]));
  const ops = process.env.MONCLEUR_OPS_EMAIL;

  for (const e of events) {
    const subject = SUBJECT[e.kind] ?? "Moncleur";
    if (e.audience === "florist") {
      for (const id of e.floristIds) {
        const f = florist.get(id);
        if (f?.email) await notifyEmail(f.email, subject, `${e.text}\n\nRépondre en 1 clic : ${SITE_URL}/pro`);
        if (SMS_KINDS.has(e.kind)) await sendSms(f?.phone, `Moncleur : ${e.text} ${SITE_URL}/pro`);
      }
    } else if (e.audience === "ops") {
      if (ops) await notifyEmail(ops, subject, `${e.text}\n\n${SITE_URL}/admin/garantie`);
      else console.warn("[garantie]", e.text);
    } else {
      const to = customer.get(e.orderId);
      if (to) await notifyCustomer(to, subject, `${e.text}\n\nVotre carnet : ${SITE_URL}/compte`);
    }
  }
  const rows = events.filter((e) => UUID.test(e.orderId)).map((e) => ({ order_id: e.orderId, kind: e.kind, audience: e.audience, florist_ids: e.floristIds, text: e.text, notified_at: new Date().toISOString() }));
  if (rows.length) {
    const { error } = await db.from("guarantee_events").insert(rows);
    if (error) console.error("[garantie] journal", error);
  }
}

// ---------------------------------------------------------------------------
// Remboursements : livraison annulée faute d'atelier après 3 essais
// ---------------------------------------------------------------------------

/**
 * Le supplément éventuel (facture J-3) est remboursé sur la carte ; la part incluse dans
 * l'abonnement est créditée sur le compte client Stripe (déduite de la prochaine mensualité).
 */
export async function processRefunds(db: DB) {
  const { data } = await db.from("orders").select("id, stripe_invoice_id, price_cents, revenue_cents, payment_status, user:users(email, stripe_customer_id)").eq("refund_due", true).limit(100);
  let done = 0;
  for (const o of data ?? []) {
    const user = o.user as unknown as { email: string; stripe_customer_id: string | null };
    try {
      if (o.stripe_invoice_id && o.payment_status === "paid") {
        const inv = (await stripe().invoices.retrieve(o.stripe_invoice_id, { expand: ["payments"] })) as unknown as { payments?: { data: { payment: { payment_intent?: string } }[] } };
        const pi = inv.payments?.data?.[0]?.payment?.payment_intent;
        if (pi) await stripe().refunds.create({ payment_intent: pi }, { idempotencyKey: `refund_extra_${o.id}` });
      }
      const included = Math.max(0, (o.revenue_cents ?? 0) - (o.price_cents ?? 0));
      if (included > 0 && user.stripe_customer_id) {
        await stripe().customers.createBalanceTransaction(
          user.stripe_customer_id,
          { amount: -included, currency: "eur", description: "Bouquet non livré : crédité sur la prochaine mensualité", metadata: { order_id: o.id } },
          { idempotencyKey: `refund_included_${o.id}` },
        );
      }
      await db.from("orders").update({ refund_due: false }).eq("id", o.id);
      await notifyCustomer(
        user.email,
        "Remboursement effectué",
        `Votre bouquet n'a pas pu être livré. ${o.price_cents ? `Le supplément de ${(o.price_cents / 100).toFixed(2).replace(".", ",")} € est remboursé sur votre carte. ` : ""}${included ? `${(included / 100).toFixed(2).replace(".", ",")} € sont déduits de votre prochaine mensualité.` : ""}`,
      );
      done++;
    } catch (e) {
      console.error("[garantie] remboursement", o.id, e);
    }
  }
  return { refunded: done };
}
