/** POST /api/orders/:id/status — Bouton 1-clic du fleuriste (préparation → prêt → livré). */
import { requireUser, supabaseAdmin } from "@/lib/supabase/server";
import { fail, route } from "@/lib/server/http";
import { transitionOrder } from "@/lib/server/orders";
import type { OrderStatus } from "@/lib/types";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { status } = (await req.json()) as { status: OrderStatus };
  if (!status) throw fail(400, "Statut manquant");
  const { user, profile } = await requireUser();
  return transitionOrder(supabaseAdmin(), id, status, { floristOwnerId: user.id, admin: profile.role === "admin" });
});
