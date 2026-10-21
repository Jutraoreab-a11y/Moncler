import { FREE_ORDER_LIMIT } from "./catalog";
import type { Florist } from "./types";

const R = 6371; // rayon terrestre (km)
const rad = (d: number) => (d * Math.PI) / 180;

/** Distance à vol d'oiseau (formule de Haversine), en km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Un fleuriste gratuit ayant atteint 10 commandes ne reçoit plus de commandes. */
export const isLocked = (f: Pick<Florist, "saasPlan" | "completedOrders">) =>
  f.saasPlan === "free" && f.completedOrders >= FREE_ORDER_LIMIT;

// ---------------------------------------------------------------------------
// Disponibilité et fiabilité
// ---------------------------------------------------------------------------

/** Fenêtre de calcul de la fiabilité et seuil de suspension. */
export const STRIKE_WINDOW_DAYS = 30;
export const SUSPEND_AT_POINTS = 3;

/** Jour de semaine d'une date calendaire (0 = dimanche), indépendant du fuseau. */
export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Jours fériés en France métropolitaine (YYYY-MM-DD), y compris lundi de Pâques, Ascension et lundi de Pentecôte. */
export function frenchHolidays(year: number): Set<string> {
  // Dimanche de Pâques (algorithme de Meeus / Butcher, calendrier grégorien)
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = Date.UTC(year, month - 1, day);
  const plus = (n: number) => new Date(easter + n * 86400_000).toISOString().slice(0, 10);
  const fixed = ["01-01", "05-01", "05-08", "07-14", "08-15", "11-01", "11-11", "12-25"].map((x) => `${year}-${x}`);
  return new Set([...fixed, plus(1), plus(39), plus(50)]);
}
export const isFrenchHoliday = (date: string) => frenchHolidays(Number(date.slice(0, 4))).has(date);

/** Atelier fermé ce jour-là : jour de fermeture hebdomadaire, jour férié (s'il ferme ces jours-là) ou congés déclarés. */
export function closedOn(f: Pick<Florist, "closedWeekdays" | "closures" | "closedOnHolidays">, date: string) {
  if (f.closedWeekdays?.includes(weekdayOf(date))) return true;
  if (f.closedOnHolidays && isFrenchHoliday(date)) return true;
  return (f.closures ?? []).some((c) => c.from <= date && date <= c.to);
}

/** Points de manquement sur les 30 derniers jours (depuis la dernière levée de suspension). */
export function strikePoints(f: Pick<Florist, "strikes" | "strikesClearedAt">, now: Date = new Date()) {
  const since = new Date(now.getTime() - STRIKE_WINDOW_DAYS * 86400_000).toISOString();
  const floor = f.strikesClearedAt && f.strikesClearedAt > since ? f.strikesClearedAt : since;
  return (f.strikes ?? []).filter((s) => s.at > floor).reduce((n, s) => n + s.points, 0);
}

/** 3 points en 30 jours : plus aucune nouvelle proposition jusqu'à revue par l'équipe. */
export const isSuspended = (f: Pick<Florist, "strikes" | "strikesClearedAt">, now?: Date) => strikePoints(f, now) >= SUSPEND_AT_POINTS;

/** L'atelier peut recevoir une nouvelle proposition pour cette date. */
export function canTake(f: Florist, date: string | undefined, now?: Date) {
  return f.active && !isLocked(f) && !isSuspended(f, now) && !(date && closedOn(f, date));
}

export interface MatchResult {
  florist: Florist;
  distanceKm: number;
}

export interface MatchOptions {
  /** Jours de pic : priorité aux ateliers qui livrent eux-mêmes (coursiers saturés et majorés) */
  preferOwnDelivery?: boolean;
  /** Date de livraison : exclut les ateliers fermés ce jour-là */
  date?: string;
  /** Ateliers à ne plus solliciter pour cette commande (refus, silence, manquement) */
  exclude?: string[];
  now?: Date;
}

/**
 * Classement des ateliers candidats : actifs, hors paywall, non suspendus, ouverts ce jour-là,
 * sous leur capacité du jour, dont le rayon couvre le destinataire. Le plus proche d'abord ;
 * à distance quasi égale (< 0,5 km), le moins chargé.
 */
export function rankFlorists(florists: Florist[], point: { lat: number; lng: number }, loadToday: Record<string, number> = {}, opts: MatchOptions = {}): MatchResult[] {
  const exclude = new Set(opts.exclude ?? []);
  return florists
    .filter((f) => !exclude.has(f.id) && canTake(f, opts.date, opts.now) && (loadToday[f.id] ?? 0) < (f.dailyCapacity ?? Infinity))
    .map((f) => ({ florist: f, distanceKm: haversineKm(f, point) }))
    .filter((c) => c.distanceKm <= c.florist.radiusKm)
    .sort((a, b) => {
      if (opts.preferOwnDelivery) {
        const own = Number(b.florist.deliveryMode === "own") - Number(a.florist.deliveryMode === "own");
        if (own) return own;
      }
      const d = a.distanceKm - b.distanceKm;
      if (Math.abs(d) < 0.5) return (loadToday[a.florist.id] ?? 0) - (loadToday[b.florist.id] ?? 0);
      return d;
    });
}

/** Meilleur atelier pour une livraison (ou null si personne n'est disponible). */
export function matchFlorist(florists: Florist[], point: { lat: number; lng: number }, loadToday: Record<string, number> = {}, opts: MatchOptions = {}): MatchResult | null {
  return rankFlorists(florists, point, loadToday, opts)[0] ?? null;
}
