import "server-only";

/**
 * Notifications : e-mail via Resend, SMS via Twilio (facultatif).
 * Sans clé, le message est journalisé (utile en préproduction).
 */
export async function notifyCustomer(to: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.info(`[notify] ${to} · ${subject}\n${text}`);
    return { sent: false };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.MONCLEUR_FROM_EMAIL ?? "Moncleur <bonjour@moncleur.fr>", to, subject, text }),
  });
  if (!res.ok) console.error("[notify]", res.status, await res.text());
  return { sent: res.ok };
}

/** Même canal pour les ateliers et l'équipe. */
export const notifyEmail = notifyCustomer;

/** Numéro français → format international E.164 (06 12 34 56 78 → +33612345678). */
export function toE164(phone: string) {
  const d = phone.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("00")) return `+${d.slice(2)}`;
  if (d.startsWith("0")) return `+33${d.slice(1)}`;
  return d;
}

/** SMS (alertes atelier : proposition, rappel, urgence). Twilio si configuré. */
export async function sendSms(phone: string | null | undefined, text: string) {
  if (!phone) return { sent: false };
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) {
    console.info(`[sms] ${phone} · ${text}`);
    return { sent: false };
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: toE164(phone), From: from, Body: text.slice(0, 600) }),
  });
  if (!res.ok) console.error("[sms]", res.status, await res.text());
  return { sent: res.ok };
}
