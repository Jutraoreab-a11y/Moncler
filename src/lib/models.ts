/**
 * Modèles de bouquets par gamme + règles de choix (fixe / surprise).
 * Logique pure, partagée entre la démo et le serveur.
 */
import type { BouquetModel, Order, PlanId, Recipe, Schedule } from "./types";

export const MODELS: BouquetModel[] = [
  // ── Le Classique ────────────────────────────────────────────
  {
    id: "m_rose_poudre",
    planId: "classique",
    name: "Rose Poudre",
    tagline: "Tendre et rond, tout en roses",
    stems: [
      { label: "Roses de saison rose poudré", qty: 5 },
      { label: "Eucalyptus cinerea", qty: 3 },
      { label: "Gypsophile", qty: 2 },
    ],
    palette: ["#f2a7b8", "#fbe3e8", "#9fb8a3"],
    packaging: "Papier kraft, raphia naturel",
    notes: "Bouquet rond, roses à demi-ouvertes. Sachet nourricier inclus.",
    active: true,
  },
  {
    id: "m_prairie",
    planId: "classique",
    name: "Prairie",
    tagline: "Un champ en été, jaune et bleu",
    stems: [
      { label: "Matricaires", qty: 5 },
      { label: "Craspédias", qty: 3 },
      { label: "Bleuets ou scabieuses", qty: 3 },
      { label: "Graminées", qty: 3 },
    ],
    palette: ["#f4b73f", "#ffffff", "#6b8fd6", "#9fb8a3"],
    packaging: "Papier kraft, raphia naturel",
    notes: "Esprit cueilli, tiges de hauteurs inégales. Aucun feuillage dense.",
    active: true,
  },
  {
    id: "m_blanc_coton",
    planId: "classique",
    name: "Blanc Coton",
    tagline: "Blanc et vert, d'une grande douceur",
    stems: [
      { label: "Roses blanches", qty: 4 },
      { label: "Lisianthus blanc", qty: 2 },
      { label: "Coton ou gypsophile", qty: 2 },
      { label: "Pittosporum", qty: 3 },
    ],
    palette: ["#ffffff", "#f3efe6", "#7aa37f"],
    packaging: "Papier kraft, raphia naturel",
    notes: "Monochrome blanc, feuillage argenté. Idéal pour un remerciement.",
    active: true,
  },
  // ── Le Signature ────────────────────────────────────────────
  {
    id: "m_jardin_ete",
    planId: "signature",
    name: "Jardin d'Été",
    tagline: "Pivoine, jaune soleil et rose vif",
    stems: [
      { label: "Roses jardin", qty: 7 },
      { label: "Renoncules", qty: 5 },
      { label: "Lisianthus", qty: 3 },
      { label: "Feuillage saisonnier", qty: 5 },
    ],
    palette: ["#e23f6b", "#f4b73f", "#fbe3e8", "#7aa37f"],
    packaging: "Papier de soie poudré, ruban satin Moncleur",
    notes: "Composition déstructurée, mouvement asymétrique. Carte manuscrite.",
    active: true,
  },
  {
    id: "m_corail",
    planId: "signature",
    name: "Corail",
    tagline: "Pêche, abricot et corail",
    stems: [
      { label: "Roses pêche", qty: 6 },
      { label: "Œillets corail", qty: 5 },
      { label: "Alstroemerias abricot", qty: 4 },
      { label: "Ruscus", qty: 5 },
    ],
    palette: ["#f28c6a", "#f9c19b", "#fde2d4", "#8aa57a"],
    packaging: "Papier de soie pêche, ruban satin Moncleur",
    notes: "Dégradé du plus soutenu au plus pâle, du centre vers l'extérieur.",
    active: true,
  },
  {
    id: "m_nuit_violette",
    planId: "signature",
    name: "Nuit Violette",
    tagline: "Lilas, prune et violet profond",
    stems: [
      { label: "Roses mauves", qty: 6 },
      { label: "Statices", qty: 4 },
      { label: "Lisianthus violet", qty: 4 },
      { label: "Eucalyptus populus", qty: 5 },
    ],
    palette: ["#8b6bb0", "#e9ddf3", "#4b2a5c", "#9fb8a3"],
    packaging: "Papier de soie lilas, ruban satin Moncleur",
    notes: "Contrastes de violets, quelques touches claires pour la lumière.",
    active: true,
  },
  // ── Le Prestige ─────────────────────────────────────────────
  {
    id: "m_grand_siecle",
    planId: "prestige",
    name: "Grand Siècle",
    tagline: "Généreux, profond, spectaculaire",
    stems: [
      { label: "Pivoines ou roses David Austin", qty: 9 },
      { label: "Delphiniums", qty: 4 },
      { label: "Hortensia", qty: 2 },
      { label: "Branchages de saison", qty: 4 },
      { label: "Feuillage noble", qty: 6 },
    ],
    palette: ["#b82a53", "#e9ddf3", "#ffffff", "#2b1030", "#5c8a64"],
    packaging: "Boîte rigide aubergine + bulle d'eau",
    notes: "Grand format, livré en bulle d'eau. Photo envoyée au client avant départ.",
    active: true,
  },
  {
    id: "m_pivoine_reine",
    planId: "prestige",
    name: "Pivoine Reine",
    tagline: "Toutes les nuances de rose",
    stems: [
      { label: "Pivoines (ou roses Ohara hors saison)", qty: 10 },
      { label: "Roses spray", qty: 6 },
      { label: "Astilbes", qty: 4 },
      { label: "Feuillage noble", qty: 6 },
    ],
    palette: ["#f2a7b8", "#e23f6b", "#fbe3e8", "#ffffff", "#7aa37f"],
    packaging: "Boîte rigide aubergine + bulle d'eau",
    notes: "Bouquet bombé très serré, aucune tige visible sous les têtes.",
    active: true,
  },
  {
    id: "m_cocon_hiver",
    planId: "prestige",
    name: "Cocon d'Hiver",
    tagline: "Blanc, bordeaux et branchages",
    stems: [
      { label: "Roses blanches grosses têtes", qty: 8 },
      { label: "Amaryllis ou renoncules bordeaux", qty: 4 },
      { label: "Branches de baies", qty: 3 },
      { label: "Pin ou cèdre", qty: 4 },
      { label: "Eucalyptus", qty: 5 },
    ],
    palette: ["#ffffff", "#7a1f35", "#b82a53", "#3f5f45"],
    packaging: "Boîte rigide aubergine + bulle d'eau",
    notes: "Esprit forêt en hiver, branchages qui dépassent de 15 cm.",
    active: true,
  },
];

export const modelsOf = (planId: PlanId, models: BouquetModel[], includeInactive = false) =>
  models.filter((m) => m.planId === planId && (includeInactive || m.active));

export const findModel = (id: string | undefined, models: BouquetModel[]) =>
  id ? models.find((m) => m.id === id) : undefined;

/**
 * Choisit le modèle d'une nouvelle commande.
 *
 * - Mode fixe : le modèle choisi par le client (s'il est retiré du catalogue,
 *   on bascule sur la rotation pour ne jamais bloquer un envoi).
 * - Mode surprise : rotation par destinataire. On prend le modèle de la gamme
 *   que cette personne a reçu il y a le plus longtemps (jamais reçu = prioritaire).
 *   Résultat : on parcourt toute la gamme avant de répéter un bouquet, et un
 *   nouveau modèle ajouté au catalogue est servi en premier.
 */
export function pickModel(
  schedule: Pick<Schedule, "planId" | "mode" | "modelId" | "recipientId">,
  models: BouquetModel[],
  history: Pick<Order, "recipientId" | "modelId" | "deliveryDate" | "status">[],
): string | undefined {
  const pool = modelsOf(schedule.planId, models);
  if (!pool.length) return undefined;
  if (schedule.mode === "fixed" && schedule.modelId && pool.some((m) => m.id === schedule.modelId)) return schedule.modelId;

  const lastSeen = new Map<string, string>();
  for (const o of history) {
    if (o.recipientId !== schedule.recipientId || !o.modelId || o.status === "cancelled") continue;
    const prev = lastSeen.get(o.modelId);
    if (!prev || o.deliveryDate > prev) lastSeen.set(o.modelId, o.deliveryDate);
  }
  return [...pool].sort((a, b) => (lastSeen.get(a.id) ?? "").localeCompare(lastSeen.get(b.id) ?? ""))[0].id;
}

/** Fiche technique complète : gamme (prix, format, rémunération) + modèle (tiges, palette…). */
export function sheetFor(recipe: Recipe, model?: BouquetModel): Recipe & { modelName?: string } {
  if (!model) return recipe;
  return {
    ...recipe,
    modelName: model.name,
    stems: model.stems,
    palette: model.palette,
    packaging: model.packaging,
    notes: model.notes,
  };
}
