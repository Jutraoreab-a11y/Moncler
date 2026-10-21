/**
 * GET /api/cron/guarantee — garantie de livraison, toutes les 15 minutes (vercel.json).
 *  Rappel à 24 h, relais à 48 h, ouverture aux voisins à J-2 18 h, rappel 9 h 30,
 *  contrôle de 11 h, report à 15 h, fermetures déclarées, alertes équipe, remboursements.
 * Idempotent : un passage supplémentaire ne renvoie ni rappel ni manquement déjà comptés.
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { processRefunds, runGuarantee } from "@/lib/server/guarantee";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const guarantee = await runGuarantee(db);
  const refunds = await processRefunds(db);
  return NextResponse.json({ guarantee, refunds, at: new Date().toISOString() });
}
