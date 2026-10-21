/**
 * Zones de livraison : centroïdes approximatifs par code postal (Paris + petite couronne).
 * Sert au test « Livrez-vous chez… ? » et de repli quand l'adresse n'a pas été géocodée.
 */
import { matchFlorist } from "./matching";
import type { Florist } from "./types";

export interface Zone {
  postalCode: string;
  name: string;
  slug: string;
  lat: number;
  lng: number;
}

const P = (n: number, lat: number, lng: number): Zone => {
  const code = `750${String(n).padStart(2, "0")}`;
  return { postalCode: code, name: n === 1 ? "Paris 1er" : `Paris ${n}e`, slug: `paris-${n}${n === 1 ? "er" : "e"}`, lat, lng };
};

export const ZONES: Zone[] = [
  P(1, 48.8625, 2.3364), P(2, 48.8683, 2.3428), P(3, 48.8630, 2.3601), P(4, 48.8543, 2.3576),
  P(5, 48.8445, 2.3497), P(6, 48.8491, 2.3326), P(7, 48.8562, 2.3122), P(8, 48.8727, 2.3125),
  P(9, 48.8770, 2.3375), P(10, 48.8761, 2.3608), P(11, 48.8590, 2.3800), P(12, 48.8350, 2.4213),
  P(13, 48.8283, 2.3622), P(14, 48.8292, 2.3266), P(15, 48.8401, 2.2930), P(16, 48.8603, 2.2620),
  P(17, 48.8873, 2.3067), P(18, 48.8925, 2.3484), P(19, 48.8871, 2.3848), P(20, 48.8634, 2.4013),
  { postalCode: "92100", name: "Boulogne-Billancourt", slug: "boulogne-billancourt", lat: 48.8353, lng: 2.2400 },
  { postalCode: "92200", name: "Neuilly-sur-Seine", slug: "neuilly-sur-seine", lat: 48.8846, lng: 2.2697 },
  { postalCode: "92300", name: "Levallois-Perret", slug: "levallois-perret", lat: 48.8950, lng: 2.2870 },
  { postalCode: "92130", name: "Issy-les-Moulineaux", slug: "issy-les-moulineaux", lat: 48.8245, lng: 2.2700 },
  { postalCode: "93100", name: "Montreuil", slug: "montreuil", lat: 48.8638, lng: 2.4485 },
  { postalCode: "93170", name: "Bagnolet", slug: "bagnolet", lat: 48.8693, lng: 2.4183 },
  { postalCode: "93310", name: "Le Pré-Saint-Gervais", slug: "le-pre-saint-gervais", lat: 48.8853, lng: 2.4045 },
  { postalCode: "94300", name: "Vincennes", slug: "vincennes", lat: 48.8474, lng: 2.4390 },
  { postalCode: "94160", name: "Saint-Mandé", slug: "saint-mande", lat: 48.8422, lng: 2.4187 },
  { postalCode: "94220", name: "Charenton-le-Pont", slug: "charenton-le-pont", lat: 48.8215, lng: 2.4116 },
];

export const zoneOf = (postalCode: string) => ZONES.find((z) => z.postalCode === postalCode.trim());
export const zoneBySlug = (slug: string) => ZONES.find((z) => z.slug === slug);

/** Un code postal est-il couvert par au moins un atelier actif ? */
export function coverage(postalCode: string, florists: Florist[]) {
  const z = zoneOf(postalCode);
  if (!z) return { zone: undefined, match: null };
  return { zone: z, match: matchFlorist(florists, z) };
}
