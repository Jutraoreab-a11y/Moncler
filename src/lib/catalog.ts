import type { PlanId, Recipe } from "./types";

export const FREE_ORDER_LIMIT = 10;
export const PRO_PRICE_CENTS = 2900;
/** Moncleur Pro est offert les mois où l'atelier livre moins de 5 bouquets. */
export const PRO_FREE_BELOW = 5;

export const CATALOG: Recipe[] = [
  {
    planId: "classique",
    name: "Le Classique",
    priceCents: 2900,
    floristPayoutCents: 1000,
    flowerBudgetCents: 700,
    stems: [
      { label: "Roses de saison", qty: 5 },
      { label: "Eucalyptus cinerea", qty: 3 },
      { label: "Gypsophile", qty: 2 },
    ],
    palette: ["#f2a7b8", "#ffffff", "#9fb8a3"],
    packaging: "Papier kraft, raphia naturel",
    size: "Ø 25 cm · hauteur 35 cm",
    notes: "Bouquet rond, tiges coupées en biais, sachet nourricier inclus.",
  },
  {
    planId: "signature",
    name: "Le Signature",
    priceCents: 4900,
    floristPayoutCents: 2000,
    flowerBudgetCents: 1400,
    stems: [
      { label: "Roses jardin", qty: 7 },
      { label: "Renoncules", qty: 5 },
      { label: "Lisianthus", qty: 3 },
      { label: "Feuillage saisonnier", qty: 5 },
    ],
    palette: ["#e23f6b", "#f4b73f", "#fbe3e8", "#7aa37f"],
    packaging: "Papier de soie poudré, ruban satin Moncleur",
    size: "Ø 35 cm · hauteur 45 cm",
    notes: "Composition déstructurée, mouvement asymétrique. Carte message manuscrite.",
  },
  {
    planId: "prestige",
    name: "Le Prestige",
    priceCents: 7900,
    floristPayoutCents: 3500,
    flowerBudgetCents: 2400,
    stems: [
      { label: "Pivoines ou roses David Austin", qty: 9 },
      { label: "Delphiniums", qty: 4 },
      { label: "Hortensia", qty: 2 },
      { label: "Branchages de saison", qty: 4 },
      { label: "Feuillage noble", qty: 6 },
    ],
    palette: ["#b82a53", "#e9ddf3", "#ffffff", "#2b1030", "#5c8a64"],
    packaging: "Boîte rigide aubergine + bulle d'eau",
    size: "Ø 50 cm · hauteur 60 cm",
    notes: "Grand format, livré en bulle d'eau. Photo du bouquet envoyée au client avant départ.",
  },
];

export const getRecipe = (id: PlanId, catalog: Recipe[] = CATALOG) =>
  catalog.find((r) => r.planId === id)!;

export const euros = (cents: number, decimals = false) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: decimals ? 2 : 0,
    minimumFractionDigits: decimals ? 2 : 0,
  }).format(cents / 100);

export const EVENT_LABELS: Record<string, string> = {
  monthly: "Chaque mois",
  birthday: "Anniversaire",
  valentine: "Saint-Valentin",
  mothers_day: "Fête des mères",
  fathers_day: "Fête des pères",
  custom: "Date spéciale",
};
