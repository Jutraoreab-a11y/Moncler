/** POST /api/pro/subscribe — Bascule Freemium → Moncleur Pro (29 €/mois) via Stripe Checkout. */
import { requireUser } from "@/lib/supabase/server";
import { fail, route } from "@/lib/server/http";
import { proLineItem, SITE_URL, stripe } from "@/lib/server/stripe";

export const POST = route(async () => {
  const { sb, user } = await requireUser();
  const { data: f } = await sb.from("florists").select("id, saas_plan, stripe_customer_id").eq("owner_id", user.id).single();
  if (!f) throw fail(404, "Aucun atelier associé à ce compte");
  if (f.saas_plan === "pro") throw fail(409, "Moncleur Pro est déjà actif");

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    locale: "fr",
    line_items: [await proLineItem()],
    ...(f.stripe_customer_id ? { customer: f.stripe_customer_id } : { customer_email: user.email }),
    metadata: { kind: "florist_pro", florist_id: f.id },
    subscription_data: { metadata: { kind: "florist_pro", florist_id: f.id } },
    success_url: `${SITE_URL}/pro?pro=1`,
    cancel_url: `${SITE_URL}/pro`,
  });
  return { url: session.url };
});
