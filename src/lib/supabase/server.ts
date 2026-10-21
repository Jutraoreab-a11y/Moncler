import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** Client lié à la session de l'utilisateur (RLS appliquée). */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(URL, ANON, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // appelé depuis un Server Component : le middleware rafraîchit la session
        }
      },
    },
  });
}

/** Client service role — contourne la RLS. Uniquement côté serveur (webhooks, cron). */
export function supabaseAdmin() {
  return createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireUser() {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new HttpError(401, "Connexion requise");
  const { data: profile } = await sb.from("users").select("*").eq("id", data.user.id).single();
  return { sb, user: data.user, profile: profile as { id: string; role: "customer" | "florist" | "admin"; email: string; stripe_customer_id: string | null } };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
