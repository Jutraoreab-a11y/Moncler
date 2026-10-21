/**
 * POST /api/checkout — Tunnel B2C → Stripe Checkout.
 *
 * Deux formules, deux abonnements Stripe distincts :
 *  - MONTHLY_RECURRING     : prix mensuel, sans engagement, 1 bouquet mensuel obligatoire
 *  - SPECIAL_EVENTS_CARNET : prix mensuel, engagement 12 mois (metadata + règle de résiliation),
 *                            dates clés uniquement, 1 par mois, 12 par an
 * Le contenu du tunnel est stocké dans checkout_drafts puis matérialisé par le webhook.
 */
import { supabaseAdmin } from "@/lib/supabase/server";
import { fail, route } from "@/lib/server/http";
import { carnetLineItem, referralCouponId, SITE_URL, stripe, subscriptionLineItem } from "@/lib/server/stripe";
import { toRecipe } from "@/lib/server/mappers";
import { carnetIssues, carnetMonthlyCents, CARNET_EVENTS, monthlyOccasionIssues, PLAN_ORDER } from "@/lib/pricing";
import type { EventType, PlanId, PlanType } from "@/lib/types";

interface Body {
  planType: PlanType;
  planId: PlanId;
  customer: { firstName: string; email: string };
  recipient: { firstName: string; lastName: string; relation?: string; address: string; postalCode: string; city: string; lat: number; lng: number; phone: string; accessNotes?: string };
  referral?: string;
  schedules: { planId: PlanId; type: EventType; dayOfMonth?: number; date?: string; label: string; message: string; mode: "fixed" | "surprise"; modelId?: string; upgradeTo?: PlanId; extraStemId?: string; active?: boolean }[];
}

export const POST = route(async (req: Request) => {
  const body = (await req.json()) as Body;
  const planType: PlanType = body.planType === "SPECIAL_EVENTS_CARNET" ? "SPECIAL_EVENTS_CARNET" : "MONTHLY_RECURRING";
  const carnet = planType === "SPECIAL_EVENTS_CARNET";
  if (!body?.customer?.email || !/\S+@\S+\.\S+/.test(body.customer.email)) throw fail(400, "E-mail invalide");
  if (!body.recipient?.address || !body.recipient.phone) throw fail(400, "Adresse et téléphone du destinataire requis");
  if (!body.schedules?.length) throw fail(400, "Choisissez au moins une date");
  if (body.schedules.some((s) => (s.message ?? "").length > 200)) throw fail(400, "Message trop long (200 caractères max)");
  // Mensuel : une seule gamme. Carnet : chaque date a sa propre taille.
  if (!carnet && body.schedules.some((s) => s.planId !== body.planId)) throw fail(400, "Toutes les dates suivent la gamme de l'abonnement");
  if (body.schedules.some((s) => s.upgradeTo && PLAN_ORDER.indexOf(s.upgradeTo) <= PLAN_ORDER.indexOf(s.planId))) throw fail(400, "Surclassement vers une gamme supérieure uniquement");

  // Règles de formule
  const monthlyCount = body.schedules.filter((s) => s.type === "monthly").length;
  if (carnet) {
    if (body.schedules.some((s) => !(CARNET_EVENTS as readonly string[]).includes(s.type))) throw fail(400, "Le Carnet ne contient que des dates clés");
    const issues = carnetIssues(body.schedules.map((s) => ({ ...s, active: true })));
    if (issues.length) throw fail(400, issues[0]);
  } else if (monthlyCount !== 1) {
    throw fail(400, "L'abonnement mensuel comprend exactement un bouquet mensuel");
  } else {
    // Une occasion remplace le bouquet de son mois : une seule par mois, 12 bouquets par an
    const issues = monthlyOccasionIssues(body.schedules.map((s) => ({ ...s, active: true })));
    if (issues.length) throw fail(400, issues[0]);
  }

  const db = supabaseAdmin();
  const { data: catalogRows } = await db.from("flower_catalog_recipes").select("*");
  const catalog = (catalogRows ?? []).map(toRecipe);
  const recipe = catalogRows?.find((c) => c.plan_id === body.planId);
  if (!recipe) throw fail(400, "Formule inconnue");
  // Montant mensuel : prix de la gamme (Mensuel) ou somme des dates au prix abonné ÷ 12 (Carnet)
  const monthlyCents = carnet ? carnetMonthlyCents(body.schedules.map((x) => ({ ...x, active: true })), catalog) : recipe.price_cents;

  // Parrainage : code d'un abonné existant → −10 € sur le premier mois
  let referrerId: string | null = null;
  if (body.referral) {
    const { data: ref } = await db.from("users").select("id, email").eq("referral_code", body.referral.toUpperCase()).maybeSingle();
    if (ref && ref.email !== body.customer.email.toLowerCase()) referrerId = ref.id;
  }

  // Mode fixe : le modèle doit exister, être actif et appartenir à la gamme livrée
  const fixed = body.schedules.filter((s) => s.mode === "fixed");
  if (fixed.some((s) => !s.modelId)) throw fail(400, "Choisissez un modèle ou passez en mode surprise");
  if (fixed.length) {
    const { data: ms } = await db.from("bouquet_models").select("id, plan_id, active").in("id", [...new Set(fixed.map((s) => s.modelId!))]);
    for (const s of fixed) {
      const m = ms?.find((x) => x.id === s.modelId);
      if (!m || !m.active || m.plan_id !== s.planId) throw fail(400, "Ce modèle n'est plus disponible dans cette gamme");
    }
  }

  const { data: draft, error } = await db.from("checkout_drafts").insert({ email: body.customer.email.toLowerCase(), payload: { ...body, planType, monthlyCents, referrerId } }).select("id").single();
  if (error) throw error;

  const { data: existing } = await db.from("users").select("stripe_customer_id").eq("email", body.customer.email.toLowerCase()).maybeSingle();
  const metadata = {
    kind: "b2c",
    draft_id: draft.id,
    plan_type: planType,
    plan_id: body.planId,
    commitment_period_months: carnet ? "12" : "0",
    monthly_cents: String(monthlyCents),
    ...(referrerId && { referrer_id: referrerId }),
  };
  const coupon = referrerId ? await referralCouponId() : null;

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    locale: "fr",
    line_items: [
      carnet
        ? await carnetLineItem(monthlyCents)
        : await subscriptionLineItem(planType, body.planId, recipe.name.replace("Le ", ""), recipe.price_cents),
    ],
    metadata,
    subscription_data: {
      metadata,
      description: carnet ? "Carnet Occasions Clés — engagement 12 mois" : "Abonnement mensuel sans engagement",
    },
    // La carte est conservée pour les suppléments prélevés à J-3
    payment_method_collection: "always",
    ...(coupon ? { discounts: [{ coupon }] } : { allow_promotion_codes: true }),
    // CGV acceptées dans le tunnel et rappelées ici (URL des CGV configurée dans le dashboard Stripe)
    consent_collection: { terms_of_service: "required" as const },
    custom_text: {
      terms_of_service_acceptance: {
        message: carnet
          ? `J'accepte un engagement de 12 mois (${((monthlyCents * 12) / 100).toFixed(2).replace(".", ",")} € au total), puis sans engagement. Rétractation possible 14 jours tant qu'aucun bouquet n'est parti.`
          : "Sans engagement. Rétractation possible 14 jours tant qu'aucun bouquet n'est parti.",
      },
    },
    success_url: `${SITE_URL}/compte?bienvenue=1`,
    cancel_url: `${SITE_URL}/abonnement?offre=${carnet ? "carnet" : "mensuel"}&formule=${body.planId}`,
    ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : { customer_email: body.customer.email }),
  });

  return { url: session.url };
});
