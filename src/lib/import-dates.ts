/**
 * Import de dates depuis un carnet d'adresses (.vcf, champ BDAY) ou un agenda (.ics,
 * événements annuels). Tout est lu dans le navigateur : rien n'est envoyé tant que
 * l'utilisateur n'a pas validé la liste.
 */
import type { Reminder } from "./types";

const unfold = (text: string) => text.replace(/\r?\n[ \t]/g, "");

/** BDAY:1990-03-14, BDAY:19900314, BDAY;VALUE=date:--0314 → "03-14" */
function mmdd(raw: string): string | null {
  const v = raw.trim();
  let m = v.match(/^(?:\d{4}|--)-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  m = v.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[2]}-${m[3]}`;
  return null;
}

export function parseVCard(text: string): Omit<Reminder, "id">[] {
  const out: Omit<Reminder, "id">[] = [];
  for (const card of unfold(text).split(/BEGIN:VCARD/i).slice(1)) {
    const fn = card.match(/^FN[^:]*:(.+)$/im)?.[1]?.trim();
    const bday = card.match(/^BDAY[^:]*:(.+)$/im)?.[1];
    const date = bday ? mmdd(bday) : null;
    if (fn && date) out.push({ name: fn.split(" ")[0], date, type: "birthday", label: `Anniversaire de ${fn}` });
  }
  return out;
}

export function parseICS(text: string): Omit<Reminder, "id">[] {
  const out: Omit<Reminder, "id">[] = [];
  for (const ev of unfold(text).split(/BEGIN:VEVENT/i).slice(1)) {
    const summary = ev.match(/^SUMMARY[^:]*:(.+)$/im)?.[1]?.trim();
    const start = ev.match(/^DTSTART[^:]*:(.+)$/im)?.[1];
    const yearly = /RRULE:[^\n]*FREQ=YEARLY/i.test(ev) || /anniv|birthday/i.test(summary ?? "");
    const date = start ? mmdd(start) : null;
    if (!summary || !date || !yearly) continue;
    const birthday = /anniv|birthday/i.test(summary);
    const name = summary.replace(/^(anniversaire|anniv\.?|birthday)\s*(de|d'|of)?\s*/i, "").trim() || summary;
    out.push({ name: name.split(" ")[0], date, type: birthday ? "birthday" : "custom", label: summary });
  }
  return out;
}

export function parseDatesFile(name: string, text: string) {
  return /\.ics$/i.test(name) || /BEGIN:VCALENDAR/i.test(text) ? parseICS(text) : parseVCard(text);
}
