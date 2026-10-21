/** POST /api/connect/onboard — Crée (si besoin) le compte Stripe Connect Express et renvoie le lien d'onboarding. */
import { requireUser, supabaseAdmin } from "@/lib/supabase/server";
import { fail, route } from "@/lib/server/http";
import { SITE_URL, stripe } from "@/lib/server/stripe";

export const POST = route(async () => {
  const { sb, user } = await requireUser();
  const { data: f } = await sb.from("florists").select("id, shop_name, stripe_account_id").eq("owner_id", user.id).single();
  if (!f) throw fail(404, "Aucun atelier associé à ce compte");

  let accountId = f.stripe_account_id as string | null;
  if (!accountId) {
    const acct = await stripe().accounts.create({
      type: "express",
      country: "FR",
      email: user.email,
      business_type: "company",
      business_profile: { name: f.shop_name, mcc: "5992" }, // 5992 = fleuristes
      capabilities: { transfers: { requested: true } },
      metadata: { florist_id: f.id },
    });
    accountId = acct.id;
    await supabaseAdmin().from("florists").update({ stripe_account_id: accountId }).eq("id", f.id);
  }

  const link = await stripe().accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${SITE_URL}/pro/boutique`,
    return_url: `${SITE_URL}/pro/boutique?connect=1`,
  });
  return { url: link.url };
});
