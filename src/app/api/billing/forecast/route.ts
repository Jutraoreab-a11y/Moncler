/**
 * GET /api/billing/forecast?months=3 — Factures prévisionnelles de l'abonné connecté.
 * Abonnements (prélevés à la date anniversaire) + suppléments prélevés à J-3
 * (occasions +30 %, surclassements, extras), après fusion et quotas Carnet.
 * Même calcul que l'encart « Prélèvements » du carnet (lib/pricing > forecastMonths).
 */
import { requireUser, supabaseAdmin } from "@/lib/supabase/server";
import { route } from "@/lib/server/http";
import { loadPlanning } from "@/lib/server/mappers";
import { forecastMonths } from "@/lib/pricing";
import { addDays, iso, startOfDay } from "@/lib/dates";

export const GET = route(async (req: Request) => {
  const { user } = await requireUser();
  const months = Math.min(12, Math.max(1, Number(new URL(req.url).searchParams.get("months") ?? 3)));
  // Lecture limitée aux abonnements de l'utilisateur (filtre explicite sur user_id)
  const p = await loadPlanning(supabaseAdmin(), { userId: user.id, ordersSince: iso(addDays(startOfDay(), -400)) });
  const forecast = forecastMonths(p, months);
  return {
    currency: "eur",
    months: forecast.map((m) => ({
      month: m.month,
      label: m.label,
      totalCents: m.totalCents,
      lines: m.lines,
    })),
  };
});
