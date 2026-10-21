/** POST /api/waitlist — être prévenu quand une zone ouvre. */
import { supabaseAdmin } from "@/lib/supabase/server";
import { fail, route } from "@/lib/server/http";

export const POST = route(async (req: Request) => {
  const { email, postalCode } = (await req.json()) as { email?: string; postalCode?: string };
  if (!email || !/\S+@\S+\.\S+/.test(email)) throw fail(400, "E-mail invalide");
  if (!postalCode || !/^\d{5}$/.test(postalCode)) throw fail(400, "Code postal invalide");
  await supabaseAdmin().from("waitlist").upsert({ email: email.toLowerCase(), postal_code: postalCode }, { onConflict: "email,postal_code" });
  return { ok: true };
});
