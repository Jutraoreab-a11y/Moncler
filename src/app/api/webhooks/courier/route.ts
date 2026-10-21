/**
 * POST /api/webhooks/courier?provider=uber|stuart&token=…
 * Statuts coursier → statut commande (en route, livré).
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { rescheduleAbsent, transitionOrder } from "@/lib/server/orders";

const UBER: Record<string, "in_delivery" | "delivered" | "absent"> = { pickup_complete: "in_delivery", dropoff: "in_delivery", delivered: "delivered", returned: "absent", canceled: "absent" };
const STUART: Record<string, "in_delivery" | "delivered" | "absent"> = { picking: "in_delivery", delivering: "in_delivery", delivered: "delivered", returning: "absent", returned: "absent" };

export async function POST(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== process.env.COURIER_WEBHOOK_TOKEN) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const provider = url.searchParams.get("provider");
  const body = await req.json();

  const ref = provider === "uber" ? body.delivery_id ?? body.data?.id : String(body.data?.job?.id ?? body.data?.id ?? "");
  const raw = provider === "uber" ? body.status ?? body.data?.status : body.data?.status ?? body.event;
  const to = (provider === "uber" ? UBER : STUART)[raw];
  if (!ref || !to) return NextResponse.json({ ignored: true });

  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("id, status, delivery_date, original_date, attempt").eq("courier_ref", ref).maybeSingle();
  if (!o || o.status === to || o.status === "delivered") return NextResponse.json({ ignored: true });
  if (to === "absent") {
    // Destinataire absent : nouvelle tentative le lendemain, sans frais
    await rescheduleAbsent(db, o);
    return NextResponse.json({ ok: true, rescheduled: true });
  }
  await transitionOrder(db, o.id, to, { admin: true });
  return NextResponse.json({ ok: true });
}
