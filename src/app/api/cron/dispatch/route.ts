/**
 * GET /api/cron/dispatch — tâche planifiée quotidienne (Vercel Cron, voir vercel.json).
 *  J-7 : génère / met à jour les commandes (fusion, quotas Carnet, options) et les attribue.
 *  J-3 : prélève les suppléments et notifie l'abonné (modifier le message, surclasser).
 *  J-1 : confirme les commandes payées, annule celles dont le supplément a échoué.
 *  J-21 : jours de pic (Saint-Valentin, fêtes des mères et des pères) visibles 3 semaines avant.
 *  Les relais entre ateliers (rappels, 48 h, 11 h…) sont faits par /api/cron/guarantee (toutes les 15 min).
 *  + rappels gratuits à J-7, renouvellement annuel des Carnets (mensualité recalculée).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { chargeDue, confirmDue, dispatchDue, remindersDue, renewCarnets } from "@/lib/server/orders";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const dispatch = await dispatchDue(db);
  const charge = await chargeDue(db);
  const confirm = await confirmDue(db);
  const reminders = await remindersDue(db);
  const carnets = await renewCarnets(db);
  return NextResponse.json({ dispatch, charge, confirm, reminders, carnets, at: new Date().toISOString() });
}
