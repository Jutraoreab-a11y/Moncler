import "server-only";
import { NextResponse } from "next/server";

/** Enveloppe une route : erreurs → JSON { error } avec le bon code HTTP. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<unknown>) {
  return async (...args: A) => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      return NextResponse.json({ error: "Mode démo : configurez Supabase et Stripe (voir README)." }, { status: 503 });
    }
    try {
      const out = await fn(...args);
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      const message = e instanceof Error ? e.message : "Erreur inattendue";
      if (status >= 500) console.error(e);
      return NextResponse.json({ error: message }, { status });
    }
  };
}

export const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
