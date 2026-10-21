/** POST /api/orders/:id/photo — photo du bouquet prise par l'atelier avant le départ. */
import { requireUser, supabaseAdmin } from "@/lib/supabase/server";
import { fail, route } from "@/lib/server/http";
import { uploadDataUrl } from "@/lib/server/storage";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { user, profile } = await requireUser();
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("id, status, florist:florists(owner_id)").eq("id", id).single();
  if (!o) throw fail(404, "Commande introuvable");
  const owner = (o.florist as unknown as { owner_id: string } | null)?.owner_id;
  if (profile.role !== "admin" && owner !== user.id) throw fail(403, "Cette commande ne vous est pas attribuée");
  if (!["preparing", "ready"].includes(o.status)) throw fail(409, "La photo se prend pendant la préparation");
  const { photoUrl } = (await req.json()) as { photoUrl: string };
  const url = await uploadDataUrl(db, `orders/${id}.jpg`, photoUrl);
  await db.from("orders").update({ photo_url: url }).eq("id", id);
  return { ok: true, url };
});
