"use client";

import Link from "next/link";
import { useState } from "react";
import { Bouquet } from "@/components/bloom";
import { Button, Field, inputCls, Logo } from "@/components/ui";
import { isDemo } from "@/lib/api-client";

export default function ConnexionPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { supabaseBrowser } = await import("@/lib/supabase/browser");
    const next = new URLSearchParams(location.search).get("next") ?? "/compte";
    const { error } = await supabaseBrowser().auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` } });
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm text-center">
        <Logo />
        <div className="mx-auto mt-8 w-28"><Bouquet palette={["#e23f6b", "#f4b73f", "#fbe3e8"]} seed={9} count={5} /></div>
        <h1 className="mt-4 font-display text-4xl">Se connecter</h1>
        {isDemo ? (
          <div className="mt-6 space-y-2">
            <p className="text-ink-soft">Mode démo : choisissez un espace.</p>
            {[["/compte", "Espace abonné"], ["/pro", "Espace fleuriste"], ["/admin", "Administration"]].map(([h, l]) => (
              <Link key={h} href={h} className="block rounded-2xl border border-line bg-card px-4 py-3 font-semibold hover:border-ink/40">{l}</Link>
            ))}
          </div>
        ) : sent ? (
          <p className="pop mt-6 rounded-2xl bg-stem-soft px-4 py-4 text-stem">Lien envoyé à {email}. Ouvrez-le depuis cet appareil.</p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4 text-left">
            <Field label="E-mail"><input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
            {error && <p role="alert" className="text-sm text-peony-deep">{error}</p>}
            <Button type="submit" className="w-full" size="lg">Recevoir mon lien de connexion</Button>
          </form>
        )}
      </div>
    </main>
  );
}
