import type { Schedule } from "./types";

export const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const parseISO = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export const daysBetween = (a: Date, b: Date) =>
  Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);

/** Fête des mères en France : dernier dimanche de mai (ou 1er dimanche de juin si Pentecôte). */
export function mothersDay(year: number) {
  const d = new Date(year, 4, 31);
  while (d.getDay() !== 0) d.setDate(d.getDate() - 1);
  return d;
}

/** Fête des pères en France : troisième dimanche de juin. */
export function fathersDay(year: number) {
  const d = new Date(year, 5, 1);
  while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + 14);
  return d;
}

/** Ajoute n mois (fin de mois bornée). */
export function addMonths(d: Date, n: number) {
  const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
  x.setDate(Math.min(d.getDate(), new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));
  return x;
}

/** Prochaine date de livraison d'un planning, à partir de `from` (inclus). */
export function nextOccurrence(s: Schedule, from = startOfDay()): Date {
  const y = from.getFullYear();
  if (s.type === "monthly") {
    const day = s.dayOfMonth ?? 1;
    const clamp = (yy: number, mm: number) =>
      new Date(yy, mm, Math.min(day, new Date(yy, mm + 1, 0).getDate()));
    let d = clamp(y, from.getMonth());
    if (d < from) d = clamp(y, from.getMonth() + 1);
    return d;
  }
  if (s.type === "mothers_day") {
    const d = mothersDay(y);
    return d < from ? mothersDay(y + 1) : d;
  }
  if (s.type === "fathers_day") {
    const d = fathersDay(y);
    return d < from ? fathersDay(y + 1) : d;
  }
  const [mm, dd] = (s.type === "valentine" ? "02-14" : s.date ?? "01-01").split("-").map(Number);
  const d = new Date(y, mm - 1, dd);
  return d < from ? new Date(y + 1, mm - 1, dd) : d;
}

const fmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
export const frLong = (d: Date | string) => fmt.format(typeof d === "string" ? parseISO(d) : d);
const fmtYear = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });
export const frDateYear = (d: Date | string) => fmtYear.format(typeof d === "string" ? parseISO(d) : d);
export const frShort = (d: Date | string) =>
  fmtShort.format(typeof d === "string" ? parseISO(d) : d).replace(".", "");

export function relativeDay(dateISO: string, today = startOfDay()) {
  const n = daysBetween(today, parseISO(dateISO));
  if (n === 0) return "Aujourd'hui";
  if (n === 1) return "Demain";
  if (n === -1) return "Hier";
  if (n > 1) return `Dans ${n} jours`;
  return `Il y a ${-n} jours`;
}
