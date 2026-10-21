/**
 * GET /api/health — état de la configuration pour la recette (aucune valeur secrète renvoyée).
 * Protégé par CRON_SECRET (en-tête Authorization: Bearer …).
 */
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const env = (k: string) => !!process.env[k];
  const checks: Record<string, boolean | string> = {
    supabase_url: env("NEXT_PUBLIC_SUPABASE_URL"),
    supabase_service_role: env("SUPABASE_SERVICE_ROLE_KEY"),
    stripe_secret: env("STRIPE_SECRET_KEY"),
    stripe_webhook_secret: env("STRIPE_WEBHOOK_SECRET"),
    resend: env("RESEND_API_KEY"),
    uber_direct: env("UBER_CLIENT_ID") && env("UBER_CUSTOMER_ID"),
    stuart: env("STUART_CLIENT_ID"),
  };
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/server");
    const { error } = await supabaseAdmin().from("flower_catalog_recipes").select("plan_id").limit(1);
    checks.supabase_query = error ? error.message : true;
  } catch (e) {
    checks.supabase_query = (e as Error).message;
  }
  try {
    const { stripe, priceIdFor } = await import("@/lib/server/stripe");
    await stripe().balance.retrieve();
    checks.stripe_api = true;
    checks.stripe_prices = !!(await priceIdFor("moncleur_monthly_signature"));
  } catch (e) {
    checks.stripe_api = (e as Error).message;
  }
  const ok = Object.values(checks).every((v) => v === true);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
