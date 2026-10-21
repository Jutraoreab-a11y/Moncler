/**
 * Client HTTP vers les routes /api. Le mode démo est actif tant que
 * NEXT_PUBLIC_SUPABASE_URL n'est pas renseignée (ou NEXT_PUBLIC_DEMO_MODE=true).
 */
export const isDemo =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !process.env.NEXT_PUBLIC_SUPABASE_URL;

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

export const api = {
  /** Réplique une action du store côté serveur (Supabase). */
  sync: (action: unknown) => post<{ ok: true }>("/api/actions", action),
  /** Crée la session Stripe Checkout de l'abonnement B2C. */
  checkout: (payload: unknown) => post<{ url: string }>("/api/checkout", payload),
  /** Crée la session Stripe Checkout de l'abonnement Moncleur Pro. */
  proSubscribe: (floristId: string) => post<{ url: string }>("/api/pro/subscribe", { floristId }),
  /** Liste d'attente d'une zone pas encore couverte. */
  waitlist: (email: string, postalCode: string) => post<{ ok: true }>("/api/waitlist", { email, postalCode }),
  /** Remerciement du destinataire (page /merci). */
  thanks: (code: string, text: string, photoUrl?: string) => post<{ ok: true }>(`/api/merci/${code}`, { text, photoUrl }),
  /** Photo du bouquet prise par le fleuriste. */
  orderPhoto: (orderId: string, photoUrl: string) => post<{ ok: true; url: string }>(`/api/orders/${orderId}/photo`, { photoUrl }),
  /** Lien d'onboarding Stripe Connect Express. */
  connectOnboard: (floristId: string) => post<{ url: string }>("/api/connect/onboard", { floristId }),
};
