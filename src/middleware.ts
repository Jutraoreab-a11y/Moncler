import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Rafraîchit la session Supabase et protège les espaces par rôle.
 * Inactif en mode démo (pas de NEXT_PUBLIC_SUPABASE_URL).
 */
const GUARDS: [string, ("customer" | "florist" | "admin")[]][] = [
  ["/admin", ["admin"]],
  ["/pro/fiches", ["florist", "admin"]],
  ["/pro/boutique", ["florist", "admin"]],
  ["/compte", ["customer", "admin"]],
];

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || process.env.NEXT_PUBLIC_DEMO_MODE === "true") return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const sb = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        list.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await sb.auth.getUser();
  const path = req.nextUrl.pathname;
  const guard = GUARDS.find(([p]) => path.startsWith(p)) ?? (path === "/pro" ? ["/pro", ["florist", "admin"]] as const : null);
  if (!guard) return res;

  if (!data.user) {
    const to = req.nextUrl.clone();
    to.pathname = "/connexion";
    to.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(to);
  }
  const { data: profile } = await sb.from("users").select("role").eq("id", data.user.id).single();
  if (!profile || !(guard[1] as readonly string[]).includes(profile.role)) {
    const to = req.nextUrl.clone();
    to.pathname = profile?.role === "florist" ? "/pro" : "/compte";
    to.search = "";
    return NextResponse.redirect(to);
  }
  return res;
}

export const config = {
  matcher: ["/compte/:path*", "/pro", "/pro/fiches/:path*", "/pro/boutique/:path*", "/admin/:path*"],
};
