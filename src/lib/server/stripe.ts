import "server-only";
import Stripe from "stripe";
import { STRIPE_LOOKUP } from "@/lib/pricing";
import type { PlanId, PlanType } from "@/lib/types";

let _stripe: Stripe | null = null;
export function stripe() {
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  return _stripe;
}

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/**
 * Tous les prix Stripe sont retrouvés par leur `lookup_key` (créés par `npm run stripe:setup`).
 * Cache mémoire pour la durée de vie de l'instance serveur.
 */
const priceCache = new Map<string, string | null>();
export async function priceIdFor(lookupKey: string): Promise<string | null> {
  if (priceCache.has(lookupKey)) return priceCache.get(lookupKey)!;
  const { data } = await stripe().prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  const id = data[0]?.id ?? null;
  priceCache.set(lookupKey, id);
  return id;
}

/**
 * Ligne d'abonnement B2C (Mensuel ou Carnet). Si les prix n'ont pas encore été créés
 * dans Stripe, on bascule sur price_data pour ne jamais bloquer une souscription.
 */
export async function subscriptionLineItem(planType: PlanType, planId: PlanId, name: string, priceCents: number): Promise<Stripe.Checkout.SessionCreateParams.LineItem> {
  const price = await priceIdFor(STRIPE_LOOKUP.subscription(planType, planId));
  if (price) return { price, quantity: 1 };
  return {
    quantity: 1,
    price_data: {
      currency: "eur",
      unit_amount: priceCents,
      recurring: { interval: "month" },
      product_data: {
        name: planType === "MONTHLY_RECURRING" ? `Moncleur Mensuel — ${name}` : `Moncleur Carnet Occasions Clés — ${name} (12 mois)`,
        metadata: { plan_id: planId, plan_type: planType },
      },
    },
  };
}

export async function proLineItem(): Promise<Stripe.Checkout.SessionCreateParams.LineItem> {
  const price = await priceIdFor(STRIPE_LOOKUP.pro);
  if (price) return { price, quantity: 1 };
  return {
    quantity: 1,
    price_data: { currency: "eur", unit_amount: 2900, recurring: { interval: "month" }, product_data: { name: "Moncleur Pro — commandes illimitées" } },
  };
}

/** Produit Stripe unique du Carnet (créé par stripe:setup) : la mensualité varie selon les dates choisies. */
export const CARNET_PRODUCT_ID = "moncleur_carnet";
export const REFERRAL_COUPON_ID = "MONCLEUR_PARRAINAGE_10";

export async function carnetLineItem(monthlyCents: number): Promise<Stripe.Checkout.SessionCreateParams.LineItem> {
  let product: string | null = CARNET_PRODUCT_ID;
  try {
    await stripe().products.retrieve(CARNET_PRODUCT_ID);
  } catch {
    product = null;
  }
  return {
    quantity: 1,
    price_data: {
      currency: "eur",
      unit_amount: monthlyCents,
      recurring: { interval: "month" },
      ...(product ? { product } : { product_data: { name: "Moncleur Carnet Occasions Clés", metadata: { plan_type: "SPECIAL_EVENTS_CARNET" } } }),
    },
  };
}

/** Coupon de parrainage −10 € sur la première facture (créé par stripe:setup, sinon ici). */
export async function referralCouponId() {
  try {
    await stripe().coupons.retrieve(REFERRAL_COUPON_ID);
  } catch {
    await stripe().coupons.create({ id: REFERRAL_COUPON_ID, amount_off: 1000, currency: "eur", duration: "once", name: "Parrainage Moncleur" });
  }
  return REFERRAL_COUPON_ID;
}
