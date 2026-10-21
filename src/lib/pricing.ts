/**
 * Architecture tarifaire Moncleur — logique pure partagée démo / serveur.
 *
 * OFFRES
 *  - Mensuel sans engagement (MONTHLY_RECURRING) : 29 / 49 / 79 € par mois, 1 bouquet par mois.
 *    Occasion (anniversaire, Saint-Valentin, fête des mères, fête des pères, autre date) :
 *    le bouquet du mois est livré à la date de l'occasion, en version « Spécial événement »,
 *    pour +30 % du prix de la formule (+8,70 / +14,70 / +23,70 €), prélevé à J-3.
 *    1 bouquet maximum par mois et par destinataire : 12 par an au total, occasions comprises.
 *  - Carnet Occasions Clés (SPECIAL_EVENTS_CARNET) : on choisit ses dates et la taille de chaque bouquet ;
 *    mensualité = somme des bouquets au prix abonné ÷ 12. Engagement 12 mois, puis sans engagement.
 *    12 bouquets max par an, 1 max par mois. Une date ajoutée en cours d'année est prélevée à J-3
 *    au prix abonné, puis intégrée à la mensualité au renouvellement.
 *
 * OPTIONS (tous abonnés)
 *  - Surclassement d'une occasion : Classique → Signature +15 €, Classique → Prestige +40 €,
 *    Signature → Prestige +25 €.
 *  - Extra tige noble sur un bouquet Classique : +8 à +12 €, +6 € de budget fleurs pour l'atelier.
 *
 * UN BOUQUET PAR MOIS
 *  - Mensuel : une occasion remplace toujours le bouquet du mois civil où elle tombe.
 *    Deux occasions le même mois : la seconde est refusée (le mois est déjà pris).
 *    Si le bouquet du mois est déjà parti, l'occasion de ce mois est reportée à l'année suivante.
 *
 * CALENDRIER
 *  - J-21 (jours de pic) / J-7 : commande visible chez le fleuriste.
 *  - J-3 : prélèvement des suppléments et rappel à l'abonné.
 *  - J-1 : paiement validé → commande confirmée.
 *
 * ÉCONOMIE UNITAIRE
 *  - Coût de livraison estimé (coursier, ou forfait versé à l'atelier qui livre lui-même),
 *    majoré les jours de pic ; frais de paiement Stripe. Voir unitEconomics().
 */
import { addDays, addMonths, daysBetween, fathersDay, iso, mothersDay, nextOccurrence, parseISO, startOfDay } from "./dates";
import type { BillingKind, DeliveryMode, EventType, Order, OccurrenceOverride, PlanId, PlanType, Recipe, Schedule, Subscription } from "./types";

/** Remise abonné : dates du Carnet (prix abonné = prix public −15 %). */
export const SUBSCRIBER_DISCOUNT = 0.15;
/** Mensuel : supplément d'une occasion, en % du prix de la formule choisie. */
export const OCCASION_SURCHARGE_RATE = 0.3;
/** @deprecated alias de OCCASION_SURCHARGE_RATE */
export const ADDON_RATE = OCCASION_SURCHARGE_RATE;
/** Mensuel : 1 bouquet maximum par mois et par destinataire, soit 12 par an. */
export const MONTHLY_MAX_PER_MONTH = 1;
export const CARNET_COMMITMENT_MONTHS = 12;
export const CARNET_YEARLY_QUOTA = 12;
export const CARNET_MAX_PER_MONTH = 1;
/** @deprecated : l'occasion remplace désormais le bouquet de son mois, quel que soit l'écart */
export const MERGE_WINDOW_DAYS = 5;
export const CHARGE_LEAD_DAYS = 3;
export const CONFIRM_LEAD_DAYS = 1;
/** Jours de pic : commandes visibles 3 semaines avant pour préparer stock et équipes. */
export const PEAK_HORIZON_DAYS = 21;
/** Droit de rétractation : remboursement intégral tant qu'aucun bouquet n'est parti. */
export const RETRACTATION_DAYS = 14;

/** Coût de livraison estimé par course (à remplacer par vos tarifs négociés). */
export const DELIVERY_COST_CENTS: Record<DeliveryMode, number> = {
  uber_direct: 950,
  stuart: 900,
  // L'atelier qui livre lui-même reçoit ce forfait en plus de sa rémunération
  own: 600,
};
/** Majoration des coursiers les jours de pic (Saint-Valentin, fêtes des mères et des pères). */
export const PEAK_DELIVERY_MULTIPLIER = 1.5;
export const OWN_DELIVERY_FEE_CENTS = DELIVERY_COST_CENTS.own;
/** Frais Stripe estimés (cartes européennes). */
export const paymentFeeCents = (amountCents: number) => (amountCents > 0 ? Math.round(amountCents * 0.015 + 25) : 0);

export const PLAN_TYPES: Record<PlanType, { name: string; short: string; commitment: 0 | 12; pitch: string }> = {
  MONTHLY_RECURRING: {
    name: "Abonnement mensuel",
    short: "Mensuel",
    commitment: 0,
    pitch: "Un bouquet chaque mois à la même personne. Sans engagement, pause ou arrêt en un clic.",
  },
  SPECIAL_EVENTS_CARNET: {
    name: "Carnet Occasions Clés",
    short: "Carnet",
    commitment: 12,
    pitch: "Vous choisissez vos dates clés et la taille de chaque bouquet. Vous payez seulement ces bouquets, au prix abonné, lissés sur 12 mois.",
  },
};

/** Événements autorisés dans un carnet (le mensuel n'en fait pas partie). */
export const CARNET_EVENTS = ["birthday", "valentine", "mothers_day", "fathers_day", "custom"] as const;

export const PLAN_ORDER: PlanId[] = ["classique", "signature", "prestige"];

/** Suppléments de surclassement à tarif abonné (au lieu de l'écart de prix public). */
export const UPGRADE_PRICES: Record<string, number> = {
  "classique>signature": 1500,
  "classique>prestige": 4000,
  "signature>prestige": 2500,
};

export interface ExtraStem {
  id: string;
  label: string;
  priceCents: number;
  /** Budget fleurs ajouté à la rémunération du fleuriste */
  budgetCents: number;
}

/** Extras « tige noble » proposés sur les bouquets Classique. */
export const EXTRA_STEMS: ExtraStem[] = [
  { id: "renoncules", label: "5 renoncules nobles", priceCents: 800, budgetCents: 600 },
  { id: "david_austin", label: "3 roses de jardin David Austin", priceCents: 1000, budgetCents: 600 },
  { id: "pivoines", label: "2 pivoines hors saison", priceCents: 1200, budgetCents: 600 },
];

/** Clés Stripe (lookup_key) des prix : créés par `npm run stripe:setup`. */
export const STRIPE_LOOKUP = {
  subscription: (t: PlanType, p: PlanId) => `moncleur_${t === "MONTHLY_RECURRING" ? "monthly" : "carnet"}_${p}`,
  /** Bouquet au tarif abonné (−15 %) : date de Carnet ajoutée en cours d'année */
  addon: (p: PlanId) => `moncleur_subscriber_bouquet_${p}`,
  /** Mensuel : supplément occasion +30 % (« Boost Event ») */
  occasion: (p: PlanId) => `moncleur_occasion_boost_${p}`,
  upgrade: (from: PlanId, to: PlanId) => `moncleur_upgrade_${from}_${to}`,
  extraStem: (id: string) => `moncleur_extra_stem_${id}`,
  pro: "moncleur_pro",
};

export interface ChargeLine {
  kind: "occasion" | "addon" | "carnet_date" | "upgrade" | "extra_stem";
  label: string;
  amountCents: number;
  /** lookup_key du prix Stripe correspondant */
  lookupKey: string;
}

export const findExtraStem = (id?: string | null) => (id ? EXTRA_STEMS.find((x) => x.id === id) : undefined);

const recipeOf = (planId: PlanId, catalog: Recipe[]) => catalog.find((r) => r.planId === planId)!;
const priceOf = (planId: PlanId, catalog: Recipe[]) => recipeOf(planId, catalog).priceCents;
const short = (planId: PlanId, catalog: Recipe[]) => recipeOf(planId, catalog).name.replace("Le ", "");

/** Prix abonné d'un bouquet : prix public −15 %. */
export const subscriberPriceCents = (planId: PlanId, catalog: Recipe[]) => Math.round(priceOf(planId, catalog) * (1 - SUBSCRIBER_DISCOUNT));
/** Mensuel : supplément d'une occasion = +30 % du prix de la formule (870 / 1470 / 2370 centimes). */
export const occasionSurchargeCents = (planId: PlanId, catalog: Recipe[]) => Math.round(priceOf(planId, catalog) * OCCASION_SURCHARGE_RATE);
/** @deprecated alias de occasionSurchargeCents */
export const addonPriceCents = occasionSurchargeCents;

/** Mensualité du Carnet : somme des bouquets au prix abonné ÷ 12, arrondie au centime supérieur. */
export function carnetMonthlyCents(schedules: Pick<Schedule, "planId" | "active" | "type">[], catalog: Recipe[]) {
  const total = schedules.filter((s) => s.active && s.type !== "monthly").reduce((sum, s) => sum + subscriberPriceCents(s.planId, catalog), 0);
  return Math.ceil(total / 12);
}

/** Prix mensuel prélevé pour un abonnement (Mensuel : prix public de la gamme ; Carnet : mensualité). */
export function subscriptionPriceCents(sub: Pick<Subscription, "planType" | "planId" | "priceCents">, catalog: Recipe[]) {
  return sub.priceCents ?? priceOf(sub.planId, catalog);
}

/** Jours de forte demande : Saint-Valentin, fête des mères, fête des pères. */
export function isPeakDate(date: string) {
  const d = parseISO(date);
  if (date.slice(5) === "02-14") return true;
  return iso(mothersDay(d.getFullYear())) === date || iso(fathersDay(d.getFullYear())) === date;
}

export interface Economics {
  revenueCents: number;
  floristCents: number;
  deliveryCents: number;
  paymentCents: number;
  marginCents: number;
}

/**
 * Marge d'une livraison. `payoutCents` inclut déjà le forfait de l'atelier qui livre lui-même.
 * `chargedCents` = montants réellement prélevés pour cette livraison (frais de paiement).
 */
export function unitEconomics(x: { revenueCents: number; payoutCents: number; courier: DeliveryMode; date?: string; chargedCents?: number }): Economics {
  const peak = x.date ? isPeakDate(x.date) : false;
  const deliveryCents = x.courier === "own" ? 0 : Math.round(DELIVERY_COST_CENTS[x.courier] * (peak ? PEAK_DELIVERY_MULTIPLIER : 1));
  const paymentCents = paymentFeeCents(x.chargedCents ?? x.revenueCents);
  return {
    revenueCents: x.revenueCents,
    floristCents: x.payoutCents,
    deliveryCents,
    paymentCents,
    marginCents: x.revenueCents - x.payoutCents - deliveryCents - paymentCents,
  };
}

/** Gammes vers lesquelles on peut surclasser, avec prix abonné et écart public. */
export function upgradeOptions(from: PlanId, catalog: Recipe[]) {
  return PLAN_ORDER.slice(PLAN_ORDER.indexOf(from) + 1).map((to) => ({
    to,
    priceCents: UPGRADE_PRICES[`${from}>${to}`],
    publicGapCents: priceOf(to, catalog) - priceOf(from, catalog),
  }));
}

/** Facturation simple d'une livraison selon l'abonnement (sans options ni fusion). */
export function billingFor(schedule: Pick<Schedule, "type">, sub: Pick<Subscription, "planType" | "planId">, catalog: Recipe[]): { billing: BillingKind; priceCents: number } {
  if (sub.planType === "SPECIAL_EVENTS_CARNET" || schedule.type === "monthly") return { billing: "included", priceCents: 0 };
  return { billing: "merged", priceCents: occasionSurchargeCents(sub.planId, catalog) };
}

/** Fin de l'engagement (carnet) : après, le Carnet continue sans engagement. */
export const commitmentEnd = (sub: Pick<Subscription, "startedAt" | "commitmentMonths">) =>
  sub.commitmentMonths ? addMonths(parseISO(sub.startedAt), sub.commitmentMonths) : null;

/** Fenêtre annuelle de crédits contenant `at` : [début, fin[ (renouvelée à chaque anniversaire d'abonnement). */
export function creditWindow(sub: Pick<Subscription, "startedAt">, at = startOfDay()) {
  const start = parseISO(sub.startedAt);
  let k = 0;
  while (addMonths(start, 12 * (k + 1)) <= at) k++;
  return { from: addMonths(start, 12 * k), to: addMonths(start, 12 * (k + 1)) };
}

/** Crédits carnet consommés dans la fenêtre annuelle (commandes non annulées). */
export function creditsUsed(sub: Subscription, orders: Pick<Order, "subscriptionId" | "deliveryDate" | "status">[], at = startOfDay()) {
  const { from, to } = creditWindow(sub, at);
  return orders.filter((o) => o.subscriptionId === sub.id && o.status !== "cancelled" && o.deliveryDate >= iso(from) && o.deliveryDate < iso(to)).length;
}

/** Mois (1-12) où tombe une date clé ; null pour le mensuel. */
export function eventMonth(s: Pick<Schedule, "type" | "date">): number | null {
  switch (s.type) {
    case "monthly":
      return null;
    case "valentine":
      return 2;
    case "mothers_day":
      return 5;
    case "fathers_day":
      return 6;
    default:
      return s.date ? Number(s.date.slice(0, 2)) : null;
  }
}

export const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/**
 * Règles du carnet : pas de mensuel, 1 bouquet max par mois, 12 dates max.
 * Renvoie la liste des problèmes (vide = valide).
 */
export function carnetIssues(schedules: Pick<Schedule, "type" | "date" | "label" | "active">[]): string[] {
  const issues: string[] = [];
  const active = schedules.filter((s) => s.active);
  if (active.some((s) => s.type === "monthly")) issues.push("Le carnet ne contient que des dates clés, pas d'envoi mensuel.");
  if (active.length > CARNET_YEARLY_QUOTA) issues.push(`${CARNET_YEARLY_QUOTA} dates maximum par an.`);
  const byMonth = new Map<number, string[]>();
  for (const s of active) {
    const m = eventMonth(s);
    if (m) byMonth.set(m, [...(byMonth.get(m) ?? []), s.label]);
  }
  for (const [m, labels] of byMonth) {
    if (labels.length > CARNET_MAX_PER_MONTH) issues.push(`Un seul bouquet par mois : ${labels.join(" et ")} tombent en ${MONTHS[m - 1]}.`);
  }
  return issues;
}

/**
 * Mensuel : chaque occasion remplace le bouquet de son mois, donc une seule occasion par mois
 * (12 bouquets par an au total). Renvoie la liste des problèmes (vide = valide).
 */
export function monthlyOccasionIssues(schedules: Pick<Schedule, "type" | "date" | "label" | "active">[]): string[] {
  const byMonth = new Map<number, string[]>();
  for (const s of schedules) {
    if (!s.active || s.type === "monthly") continue;
    const m = eventMonth(s);
    if (m) byMonth.set(m, [...(byMonth.get(m) ?? []), s.label]);
  }
  return [...byMonth].filter(([, l]) => l.length > MONTHLY_MAX_PER_MONTH).map(([m, l]) => `Un seul bouquet par mois : ${l.join(" et ")} tombent en ${MONTHS[m - 1]}.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Livraisons planifiées : fusion, quotas, options, prix
// ─────────────────────────────────────────────────────────────────────────────

export const occurrenceKey = (scheduleId: string, date: string) => `${scheduleId}@${date}`;
/** Une nouvelle tentative de livraison garde la date d'origine comme clé. */
export const orderKey = (o: Pick<Order, "scheduleId" | "deliveryDate" | "originalDate">) => occurrenceKey(o.scheduleId, o.originalDate ?? o.deliveryDate);

/** Rétractation : 14 jours après la souscription, tant qu'aucun bouquet n'est livré. */
export function canRetract(sub: Pick<Subscription, "id" | "startedAt">, orders: Pick<Order, "subscriptionId" | "status">[], today = startOfDay()) {
  return daysBetween(parseISO(sub.startedAt), today) <= RETRACTATION_DAYS && !orders.some((o) => o.subscriptionId === sub.id && o.status === "delivered");
}

export interface Occurrence {
  key: string;
  scheduleId: string;
  subscriptionId: string;
  recipientId: string;
  date: string;
  type: EventType;
  label: string;
  /** Gamme de l'abonnement */
  basePlan: PlanId;
  /** Gamme livrée (après surclassement) */
  plan: PlanId;
  upgradeFrom?: PlanId;
  extraStemId?: string;
  /**
   * planned : livrée
   * absorbed : bouquet du mois remplacé par l'occasion du même mois
   * blocked : mois déjà pris (1 bouquet par mois) ou quota annuel du Carnet atteint
   */
  status: "planned" | "absorbed" | "blocked";
  billing: BillingKind;
  blockReason?: string;
  /** Livraison voisine (fusion possible ou effectuée) */
  near?: { key: string; date: string; label: string };
  keepSeparate?: boolean;
  lines: ChargeLine[];
  /** Chiffre d'affaires de cette livraison (part d'abonnement + suppléments) */
  revenueCents: number;
  isPeak: boolean;
  /** Supplément prélevé à J-3 */
  priceCents: number;
  payoutCents: number;
  chargeDate: string;
}

export interface PlanningInput {
  subscriptions: Subscription[];
  schedules: Schedule[];
  overrides: Record<string, OccurrenceOverride>;
  orders: Order[];
  catalog: Recipe[];
}

const isUpgrade = (from: PlanId, to?: PlanId | null): to is PlanId => !!to && PLAN_ORDER.indexOf(to) > PLAN_ORDER.indexOf(from);
const STARTED: Order["status"][] = ["preparing", "ready", "in_delivery", "delivered"];

/** Un abonnement livre-t-il encore à cette date ? */
export function subLiveOn(sub: Subscription, date: string) {
  if (sub.status !== "active" || date < sub.startedAt) return false;
  const end = commitmentEnd(sub);
  if (sub.cancelAtCommitmentEnd && end && date >= iso(end)) return false;
  return true;
}

/**
 * Toutes les livraisons entre `from` et `to` (inclus), avec leurs règles appliquées.
 * Utilisé par le moteur de commandes, le carnet abonné et la facture prévisionnelle.
 */
export function planOccurrences(input: PlanningInput, from = startOfDay(), to = addDays(startOfDay(), 90)): Occurrence[] {
  const { subscriptions, schedules, overrides, orders, catalog } = input;
  const byKey = new Map(orders.map((o) => [orderKey(o), o]));
  const occ: Occurrence[] = [];

  // 1. Dates brutes
  for (const s of schedules) {
    if (!s.active) continue;
    const sub = subscriptions.find((x) => x.id === s.subscriptionId);
    if (!sub) continue;
    let cursor = from;
    for (let guard = 0; guard < 60; guard++) {
      const d = nextOccurrence(s, cursor);
      if (d > to) break;
      cursor = addDays(d, 1);
      const date = iso(d);
      if (!subLiveOn(sub, date)) continue;
      const key = occurrenceKey(s.id, date);
      const ov = overrides[key] ?? {};
      // Mensuel : gamme de l'abonnement. Carnet : chaque date a sa propre taille.
      const base = sub.planType === "SPECIAL_EVENTS_CARNET" ? s.planId : sub.planId;
      // Carnet : date ajoutée après le début de l'année d'abonnement → prélevée à part cette année-là
      const addedThisYear = sub.planType === "SPECIAL_EVENTS_CARNET" && !!s.addedAt && s.addedAt > iso(creditWindow(sub, d).from);
      const upgradeTo = s.type === "monthly" ? undefined : ov.upgradeTo === null ? undefined : ov.upgradeTo ?? s.upgradeTo;
      const plan = isUpgrade(base, upgradeTo) ? upgradeTo : base;
      const extra = ov.extraStemId === null ? undefined : ov.extraStemId ?? s.extraStemId;
      occ.push({
        key,
        scheduleId: s.id,
        subscriptionId: sub.id,
        recipientId: s.recipientId,
        date,
        type: s.type,
        label: s.label,
        basePlan: base,
        plan,
        upgradeFrom: plan !== base ? base : undefined,
        extraStemId: plan === "classique" && findExtraStem(extra) ? extra : undefined,
        status: "planned",
        billing: s.type === "monthly" ? "included" : sub.planType === "SPECIAL_EVENTS_CARNET" ? (addedThisYear ? "carnet_added" : "included") : "addon",
        keepSeparate: ov.keepSeparate,
        lines: [],
        revenueCents: 0,
        isPeak: isPeakDate(date),
        priceCents: 0,
        payoutCents: 0,
        chargeDate: iso(addDays(d, -CHARGE_LEAD_DAYS)),
      });
    }
  }
  occ.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));

  // 2. Mensuel : l'occasion remplace le bouquet de son mois civil (1 bouquet par mois et par destinataire)
  const monthTaken = new Map<string, Occurrence>(); // sub|YYYY-MM → occasion qui a pris le mois
  for (const e of occ) {
    const sub = subscriptions.find((x) => x.id === e.subscriptionId)!;
    if (e.type === "monthly" || sub.planType !== "MONTHLY_RECURRING") continue;
    const ym = e.date.slice(0, 7);
    const mk = `${sub.id}|${ym}`;
    const monthName = MONTHS[parseISO(e.date).getMonth()];
    const prev = monthTaken.get(mk);
    if (prev) {
      e.status = "blocked";
      e.blockReason = `Un seul bouquet par mois : ${prev.label} tombe déjà en ${monthName}.`;
      continue;
    }
    // Bouquet du mois déjà parti (ou passé) ce mois-ci : l'occasion ne peut pas s'ajouter
    const gone = orders.find((o) => o.subscriptionId === sub.id && o.status !== "cancelled" && (o.originalDate ?? o.deliveryDate).slice(0, 7) === ym && o.scheduleId !== e.scheduleId && (STARTED.includes(o.status) || o.deliveryDate < iso(from)));
    if (gone) {
      e.status = "blocked";
      e.blockReason = `Le bouquet de ${monthName} est déjà parti : cette occasion sera livrée l'an prochain.`;
      continue;
    }
    monthTaken.set(mk, e);
    const m = occ.find((x) => x.type === "monthly" && x.subscriptionId === sub.id && x.date.slice(0, 7) === ym);
    if (m) {
      m.status = "absorbed";
      m.near = { key: e.key, date: e.date, label: e.label };
      e.near = { key: m.key, date: m.date, label: m.label };
    }
    // Sans bouquet du mois actif (mensuel désactivé), l'occasion reste le seul bouquet du mois : même tarif
    e.billing = "merged";
  }

  // 3. Carnet : 1 bouquet max par mois, 12 par an
  const taken = new Set<string>();
  for (const o of orders) {
    if (o.status !== "cancelled" && o.subscriptionId) taken.add(`${o.subscriptionId}|${o.deliveryDate.slice(0, 7)}`);
  }
  const extraCredits = new Map<string, number>();
  for (const e of occ) {
    const sub = subscriptions.find((x) => x.id === e.subscriptionId)!;
    if (sub.planType !== "SPECIAL_EVENTS_CARNET") continue;
    const own = byKey.get(e.key);
    if (own && own.status !== "cancelled") continue; // déjà commandée : comptée
    const month = `${sub.id}|${e.date.slice(0, 7)}`;
    const win = creditWindow(sub, parseISO(e.date));
    const winKey = `${sub.id}|${iso(win.from)}`;
    const used = creditsUsed(sub, orders, parseISO(e.date)) + (extraCredits.get(winKey) ?? 0);
    if (taken.has(month)) {
      e.status = "blocked";
      e.blockReason = `Un seul bouquet par mois avec le Carnet : ${MONTHS[parseISO(e.date).getMonth()]} est déjà pris.`;
    } else if (used >= CARNET_YEARLY_QUOTA) {
      e.status = "blocked";
      e.blockReason = `Les ${CARNET_YEARLY_QUOTA} bouquets de l'année sont utilisés. Ils se renouvellent le ${iso(win.to).split("-").reverse().join("/")}.`;
    } else {
      taken.add(month);
      extraCredits.set(winKey, (extraCredits.get(winKey) ?? 0) + 1);
    }
  }

  // 4. Prix et rémunération
  for (const e of occ) {
    const lines: ChargeLine[] = [];
    if (e.status === "planned") {
      if (e.billing === "merged") lines.push({ kind: "occasion", label: `${e.label} : bouquet du mois en Spécial événement (+30 %)`, amountCents: occasionSurchargeCents(e.basePlan, catalog), lookupKey: STRIPE_LOOKUP.occasion(e.basePlan) });
      if (e.billing === "carnet_added") lines.push({ kind: "carnet_date", label: `Date ajoutée cette année (${short(e.basePlan, catalog)} au prix abonné)`, amountCents: subscriberPriceCents(e.basePlan, catalog), lookupKey: STRIPE_LOOKUP.addon(e.basePlan) });
      if (e.upgradeFrom) lines.push({ kind: "upgrade", label: `Surclassement ${short(e.upgradeFrom, catalog)} → ${short(e.plan, catalog)}`, amountCents: UPGRADE_PRICES[`${e.upgradeFrom}>${e.plan}`], lookupKey: STRIPE_LOOKUP.upgrade(e.upgradeFrom, e.plan) });
      const x = findExtraStem(e.extraStemId);
      if (x) lines.push({ kind: "extra_stem", label: `Extra : ${x.label}`, amountCents: x.priceCents, lookupKey: STRIPE_LOOKUP.extraStem(x.id) });
    }
    e.lines = lines;
    e.priceCents = lines.reduce((s, l) => s + l.amountCents, 0);
    e.payoutCents = e.status === "planned" ? recipeOf(e.plan, catalog).floristPayoutCents + (findExtraStem(e.extraStemId)?.budgetCents ?? 0) : 0;
    // Part d'abonnement attribuée à cette livraison
    const sub = subscriptions.find((x) => x.id === e.subscriptionId)!;
    let included = 0;
    if (e.status === "planned") {
      if (e.type === "monthly" || e.billing === "merged") included = subscriptionPriceCents(sub, catalog);
      else if (e.billing === "included" && sub.planType === "SPECIAL_EVENTS_CARNET") included = subscriberPriceCents(e.basePlan, catalog);
    }
    e.revenueCents = included + e.priceCents;
  }
  return occ;
}

// ─────────────────────────────────────────────────────────────────────────────
// Facture prévisionnelle
// ─────────────────────────────────────────────────────────────────────────────

export interface ForecastLine {
  date: string;
  label: string;
  amountCents: number;
  kind: "subscription" | "addon";
  /** Déjà prélevé */
  past: boolean;
}
export interface ForecastMonth {
  month: string; // YYYY-MM
  label: string;
  lines: ForecastLine[];
  totalCents: number;
}

/** Prélèvements des prochains mois : abonnements (date anniversaire) + suppléments à J-3. */
export function forecastMonths(input: PlanningInput & { customerSubs?: (s: Subscription) => boolean }, months = 3, today = startOfDay()): ForecastMonth[] {
  const subs = input.subscriptions.filter((s) => (input.customerSubs ? input.customerSubs(s) : true));
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + months, 0);
  const occ = planOccurrences({ ...input, subscriptions: subs }, first, addDays(last, CHARGE_LEAD_DAYS));
  const out: ForecastMonth[] = [];
  for (let i = 0; i < months; i++) {
    const m0 = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const ym = iso(m0).slice(0, 7);
    const lines: ForecastLine[] = [];
    for (const sub of subs) {
      const anchor = parseISO(sub.startedAt).getDate();
      const d = new Date(m0.getFullYear(), m0.getMonth(), Math.min(anchor, new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate()));
      if (!subLiveOn(sub, iso(d))) continue;
      lines.push({
        date: iso(d),
        label: sub.planType === "MONTHLY_RECURRING" ? `Mensuel ${short(sub.planId, input.catalog)}` : "Carnet Occasions Clés",
        amountCents: subscriptionPriceCents(sub, input.catalog),
        kind: "subscription",
        past: d < today,
      });
    }
    for (const e of occ) {
      if (e.priceCents <= 0 || e.chargeDate.slice(0, 7) !== ym) continue;
      lines.push({ date: e.chargeDate, label: e.lines.map((l) => l.label).join(" + "), amountCents: e.priceCents, kind: "addon", past: parseISO(e.chargeDate) < today });
    }
    lines.sort((a, b) => a.date.localeCompare(b.date));
    out.push({ month: ym, label: `${MONTHS[m0.getMonth()]} ${m0.getFullYear()}`, lines, totalCents: lines.reduce((s, l) => s + l.amountCents, 0) });
  }
  return out;
}

/** Compatibilité : prochains prélèvements sur `days` jours. */
export function forecast(subs: Subscription[], schedules: Schedule[], catalog: Recipe[], days = 31, today = startOfDay()) {
  const months = forecastMonths({ subscriptions: subs, schedules, overrides: {}, orders: [], catalog }, 2, today);
  const end = iso(addDays(today, days));
  return months.flatMap((m) => m.lines).filter((l) => !l.past && l.date <= end);
}
