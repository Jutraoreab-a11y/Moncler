import { NextResponse } from "next/server";

/** Lien court imprimé sur la carte : moncleur.fr/m/XXXXXX → page destinataire. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  return NextResponse.redirect(new URL(`/merci?code=${encodeURIComponent(code.toUpperCase())}`, req.url));
}
