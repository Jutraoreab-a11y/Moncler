import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Retour du lien magique Supabase : échange du code contre une session. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/compte";
  if (code) await (await supabaseServer()).auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/compte", url.origin));
}
