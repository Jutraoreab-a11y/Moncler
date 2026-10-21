/**
 * POST /api/stripe/webhook
 *
 * B2C
 *  - checkout.session.completed (kind=b2c)  → crée compte, proche, abonnement, plannings, puis commandes J+7
 *  - customer.subscription.updated/deleted  → synchronise le statut (actif, pause, impayé, résilié)
 *  - invoice.payment_failed                 → past_due (abonnement) ou supplément J-3 refusé
 *  - invoice.paid (kind=b2c_extra)          → supplément J-3 payé
 * B2B (fleuristes)
 *  - checkout.session.completed (kind=florist_pro) → bascule Freemium → Pro, débloque les commandes
 *  - customer.subscription.deleted (Pro)           → retour en offre gratuite (paywall réactivé)
 *  - account.updated (Connect)                     → payouts_enabled
 *
 * Endpoint à déclarer dans Stripe avec "Listen to events on Connected accounts" pour account.updated.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/server";
import { dispatchDue } from "@/lib/server/orders";
import { stripe } from "@/lib/server/stripe";
import { notifyCustomer } from "@/lib/server/notify";
import { PRO_FREE_BELOW } from "@/lib/catalog";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, sig!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (e) {
    return NextResponse.json({ error: `Signature invalide: ${(e as Error).message}` }, { status: 400 });
  }

  const db = supabaseAdmin();
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        if (s.metadata?.kind === "b2c") await onB2CCheckout(db, s);
        if (s.metadata?.kind === "florist_pro") await onProCheckout(db, s);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await syncSubscription(db, sub, event.type === "customer.subscription.deleted");
        break;
      }
      case "invoice.created": {
        // Moncleur Pro offert les mois où l'atelier livre moins de 5 bouquets
        const inv = event.data.object as Stripe.Invoice & { parent?: { subscription_details?: { metadata?: Record<string, string> } } };
        const meta = inv.parent?.subscription_details?.metadata;
        if (meta?.kind === "florist_pro" && meta.florist_id && inv.status === "draft" && inv.billing_reason === "subscription_cycle") {
          const since = new Date(inv.period_start * 1000).toISOString().slice(0, 10);
          const until = new Date(inv.period_end * 1000).toISOString().slice(0, 10);
          const { count } = await db.from("orders").select("id", { count: "exact", head: true }).eq("florist_id", meta.florist_id).eq("status", "delivered").gte("delivery_date", since).lt("delivery_date", until);
          if ((count ?? 0) < PRO_FREE_BELOW) {
            await stripe().invoiceItems.create(
              { customer: inv.customer as string, invoice: inv.id!, amount: -inv.subtotal, currency: "eur", description: `Moncleur Pro offert : ${count ?? 0} livraison(s) ce mois-ci (moins de ${PRO_FREE_BELOW})` },
              { idempotencyKey: `pro_free_${inv.id}` },
            );
          }
        }
        break;
      }
      case "invoice.paid": {
        const inv = event.data.object;
        if (inv.metadata?.kind === "b2c_extra" && inv.metadata.order_id) {
          await db.from("orders").update({ payment_status: "paid", stripe_invoice_id: inv.id }).eq("id", inv.metadata.order_id);
        }
        break;
      }
      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice & { subscription?: string; parent?: { subscription_details?: { subscription?: string } } };
        if (inv.metadata?.kind === "b2c_extra" && inv.metadata.order_id) {
          await db.from("orders").update({ payment_status: "failed" }).eq("id", inv.metadata.order_id);
          break;
        }
        const subId = inv.parent?.subscription_details?.subscription ?? inv.subscription;
        if (subId) await db.from("subscriptions").update({ status: "past_due", updated_at: new Date().toISOString() }).eq("stripe_subscription_id", subId);
        break;
      }
      case "account.updated": {
        const acct = event.data.object;
        await db.from("florists").update({ payouts_enabled: acct.payouts_enabled }).eq("stripe_account_id", acct.id);
        break;
      }
    }
  } catch (e) {
    console.error("[stripe webhook]", event.type, e);
    return NextResponse.json({ error: "Traitement échoué" }, { status: 500 }); // Stripe réessaiera
  }
  return NextResponse.json({ received: true });
}

type DB = ReturnType<typeof supabaseAdmin>;

async function onB2CCheckout(db: DB, s: Stripe.Checkout.Session) {
  const { data: draft } = await db.from("checkout_drafts").select("*").eq("id", s.metadata!.draft_id).single();
  if (!draft || draft.consumed_at) return; // idempotence
  const p = draft.payload as {
    customer: { firstName: string; email: string };
    recipient: Record<string, string | number>;
    planType: "MONTHLY_RECURRING" | "SPECIAL_EVENTS_CARNET";
    planId: string;
    monthlyCents?: number;
    referrerId?: string | null;
    schedules: { planId: string; type: string; dayOfMonth?: number; date?: string; label: string; message: string; mode?: "fixed" | "surprise"; modelId?: string; upgradeTo?: string; extraStemId?: string }[];
  };

  // 1. Compte utilisateur (créé si besoin, lien magique envoyé par Supabase)
  const email = draft.email as string;
  let { data: user } = await db.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) {
    const { data: created, error } = await db.auth.admin.inviteUserByEmail(email, {
      data: { first_name: p.customer.firstName, role: "customer" },
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/compte`,
    });
    if (error) throw error;
    user = { id: created.user.id };
  }
  const customerId = typeof s.customer === "string" ? s.customer : s.customer?.id;
  await db.from("users").update({ stripe_customer_id: customerId, first_name: p.customer.firstName }).eq("id", user.id);

  // 2. Proche
  const r = p.recipient;
  const { data: rec, error: rErr } = await db
    .from("recipients")
    .insert({
      user_id: user.id,
      first_name: r.firstName,
      last_name: r.lastName,
      relation: r.relation,
      address: r.address,
      postal_code: r.postalCode,
      city: r.city,
      lat: r.lat,
      lng: r.lng,
      phone: r.phone,
      access_notes: r.accessNotes,
    })
    .select("id")
    .single();
  if (rErr) throw rErr;

  // 3. Abonnement : une ligne par formule souscrite (Mensuel ou Carnet 12 mois)
  const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id ?? null;
  const carnet = p.planType === "SPECIAL_EVENTS_CARNET";
  const { data: sub, error: sErr } = await db
    .from("subscriptions")
    .insert({
      user_id: user.id,
      plan_type: carnet ? "SPECIAL_EVENTS_CARNET" : "MONTHLY_RECURRING",
      plan_id: p.planId,
      commitment_period_months: carnet ? 12 : 0,
      recipient_id: carnet ? null : rec.id,
      stripe_subscription_id: subId,
      status: "active",
      price_cents: p.monthlyCents ?? 0,
    })
    .select("id")
    .single();
  if (sErr) throw sErr;

  // 4. Plannings
  const { error: schErr } = await db.from("schedules").insert(
    p.schedules.map((x) => ({
      subscription_id: sub!.id,
      recipient_id: rec.id,
      plan_id: x.planId,
      type: x.type,
      day_of_month: x.type === "monthly" ? x.dayOfMonth : null,
      event_date: x.type === "birthday" || x.type === "custom" ? x.date : null,
      label: x.label,
      message: x.message,
      selection_mode: x.mode ?? "surprise",
      model_id: x.mode === "fixed" ? x.modelId : null,
      upgrade_to: x.type === "monthly" ? null : x.upgradeTo ?? null,
      extra_stem: x.extraStemId ?? null,
    })),
  );
  if (schErr) throw schErr;

  await db.from("checkout_drafts").update({ consumed_at: new Date().toISOString() }).eq("id", draft.id);

  // Parrainage : 10 € de crédit pour le parrain (solde client Stripe), une seule fois par filleul
  if (p.referrerId && p.referrerId !== user.id) {
    const { error: refErr } = await db.from("referral_rewards").insert({ referrer_id: p.referrerId, referee_id: user.id, amount_cents: 1000 });
    if (!refErr) {
      await db.from("users").update({ referred_by: p.referrerId }).eq("id", user.id);
      const { data: referrer } = await db.from("users").select("stripe_customer_id, email").eq("id", p.referrerId).single();
      if (referrer?.stripe_customer_id) {
        await stripe().customers.createBalanceTransaction(referrer.stripe_customer_id, { amount: -1000, currency: "eur", description: `Parrainage de ${p.customer.firstName}` }, { idempotencyKey: `referral_${user.id}` });
        await notifyCustomer(referrer.email, "10 € de crédit pour vous", `${p.customer.firstName} s'est abonné(e) grâce à vous : 10 € seront déduits de votre prochain prélèvement.`);
      }
    }
  }

  // 5. Commandes immédiates si une date tombe dans les 7 jours
  await dispatchDue(db, { userId: user.id });
}

async function onProCheckout(db: DB, s: Stripe.Checkout.Session) {
  const floristId = s.metadata!.florist_id;
  await db
    .from("florists")
    .update({
      saas_plan: "pro",
      stripe_customer_id: typeof s.customer === "string" ? s.customer : s.customer?.id,
      stripe_subscription_id: typeof s.subscription === "string" ? s.subscription : s.subscription?.id,
    })
    .eq("id", floristId);
  // Les commandes "assigned" de l'atelier redeviennent traitables automatiquement
  // (florist_is_locked() renvoie false dès que saas_plan = 'pro').
}

async function syncSubscription(db: DB, sub: Stripe.Subscription, deleted: boolean) {
  if (sub.metadata?.kind === "florist_pro") {
    if (deleted || sub.status === "canceled" || sub.status === "unpaid") {
      await db.from("florists").update({ saas_plan: "free", stripe_subscription_id: null }).eq("stripe_subscription_id", sub.id);
    }
    return;
  }
  const status = deleted || sub.status === "canceled"
    ? "cancelled"
    : sub.pause_collection
      ? "paused"
      : sub.status === "past_due" || sub.status === "unpaid"
        ? "past_due"
        : sub.status === "active" || sub.status === "trialing"
          ? "active"
          : "incomplete";
  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  await db
    .from("subscriptions")
    .update({
      status,
      cancel_at_period_end: sub.cancel_at_period_end,
      // Carnet résilié pendant l'engagement : Stripe porte cancel_at = fin des 12 mois
      cancel_at_commitment_end: sub.metadata?.plan_type === "SPECIAL_EVENTS_CARNET" && !!sub.cancel_at && status !== "cancelled",
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", sub.id);

  if (status === "cancelled" || status === "paused") {
    // Annule les commandes futures non commencées
    const { data: s } = await db.from("subscriptions").select("id").eq("stripe_subscription_id", sub.id).single();
    if (s) await db.from("orders").update({ status: "cancelled", cancel_reason: status === "paused" ? "Abonnement en pause" : "Abonnement résilié" }).eq("subscription_id", s.id).in("status", ["scheduled", "assigned"]);
  }
}
