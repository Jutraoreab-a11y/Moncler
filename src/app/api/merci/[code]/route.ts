/**
 * Page destinataire (code imprimé sur la carte).
 *  GET  /api/merci/:code → qui offre, le bouquet, le mot (aucune donnée personnelle de l'abonné hors prénom)
 *  POST /api/merci/:code → le destinataire envoie son merci (une fois), l'abonné est prévenu par e-mail
 */
import { supabaseAdmin } from "@/lib/supabase/server";
import { fail, route } from "@/lib/server/http";
import { notifyCustomer } from "@/lib/server/notify";
import { SITE_URL } from "@/lib/server/stripe";
import { uploadDataUrl } from "@/lib/server/storage";

const CODE = /^[A-Z2-9]{6}$/;

async function load(code: string) {
  if (!CODE.test(code)) throw fail(404, "Code inconnu");
  const { data: o } = await supabaseAdmin()
    .from("orders")
    .select("id, delivery_date, status, message, plan_id, model_id, photo_url, thanks, recipient:recipients(first_name), user:users(first_name, email, referral_code), florist:florists(shop_name)")
    .eq("public_code", code)
    .maybeSingle();
  if (!o) throw fail(404, "Code inconnu");
  return o as unknown as {
    id: string; delivery_date: string; status: string; message: string; plan_id: string; model_id: string | null; photo_url: string | null; thanks: unknown;
    recipient: { first_name: string }; user: { first_name: string | null; email: string; referral_code: string }; florist: { shop_name: string } | null;
  };
}

export const GET = route(async (_req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const o = await load((await ctx.params).code.toUpperCase());
  return {
    recipientFirstName: o.recipient.first_name,
    senderFirstName: o.user.first_name,
    deliveryDate: o.delivery_date,
    message: o.message,
    planId: o.plan_id,
    modelId: o.model_id,
    photoUrl: o.photo_url,
    florist: o.florist?.shop_name ?? null,
    alreadyThanked: !!o.thanks,
    referralCode: o.user.referral_code,
  };
});

export const POST = route(async (req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const code = (await ctx.params).code.toUpperCase();
  const o = await load(code);
  if (o.thanks) throw fail(409, "Un merci a déjà été envoyé pour ce bouquet");
  if (o.status !== "delivered" && o.status !== "in_delivery") throw fail(409, "Le bouquet n'est pas encore livré");
  const { text, photoUrl } = (await req.json()) as { text?: string; photoUrl?: string };
  const clean = (text ?? "").trim().slice(0, 280);
  if (clean.length < 2) throw fail(400, "Écrivez quelques mots");
  const db = supabaseAdmin();
  const stored = photoUrl ? await uploadDataUrl(db, `thanks/${o.id}.jpg`, photoUrl) : undefined;
  await db.from("orders").update({ thanks: { text: clean, photoUrl: stored, at: new Date().toISOString() } }).eq("id", o.id);
  await notifyCustomer(
    o.user.email,
    `${o.recipient.first_name} vous dit merci`,
    `« ${clean} »\n\n— ${o.recipient.first_name}, à propos du bouquet livré le ${o.delivery_date}.\n\nVoir dans votre carnet : ${SITE_URL}/compte`,
  );
  return { ok: true };
});
