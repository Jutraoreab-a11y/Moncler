/**
 * Moteur "Set & Forget" — logique pure partagée entre la démo (navigateur)
 * et le cron serveur (/api/cron/dispatch).
 *
 * 1. Calcule les livraisons des 7 prochains jours (lib/pricing > planOccurrences) :
 *    fusion occasion + bouquet du mois, quotas du Carnet, surclassements, extras, prix.
 * 2. Crée les commandes manquantes, met à jour celles pas encore commencées,
 *    annule le bouquet du mois absorbé par une occasion proche.
 * 3. Résout le bouquet : modèle fixe, ou rotation surprise dans la gamme livrée.
 * 4. Propose la commande à l'atelier le plus proche disponible (lib/guarantee : 48 h pour accepter).
 */
import { addDays, startOfDay } from "./dates";
import { offerNew, type GuaranteeEvent } from "./guarantee";
import { pickModel } from "./models";
import { iso } from "./dates";
import { OWN_DELIVERY_FEE_CENTS, orderKey, PEAK_HORIZON_DAYS, planOccurrences, type Occurrence } from "./pricing";
import type { BouquetModel, Florist, OccurrenceOverride, Order, Recipe, Recipient, Schedule, Subscription } from "./types";

export const HORIZON_DAYS = 7;

const OPEN: Order["status"][] = ["scheduled", "assigned"];

export interface EngineInput {
  schedules: Schedule[];
  recipients: Recipient[];
  florists: Florist[];
  orders: Order[];
  models: BouquetModel[];
  subscriptions: Subscription[];
  catalog: Recipe[];
  overrides?: Record<string, OccurrenceOverride>;
  today?: Date;
  horizon?: number;
  /** Instant de référence (propositions, délais) */
  now?: Date;
  /** Reçoit les notifications de garantie (nouvelle proposition, acceptation automatique…) */
  onEvent?: (e: GuaranteeEvent) => void;
}

/** Champs de prix / options d'une commande, dérivés de la livraison planifiée. */
export function pricingFields(e: Occurrence): Pick<Order, "planId" | "upgradeFrom" | "extraStemId" | "billing" | "priceCents" | "lines" | "payoutCents" | "paymentStatus" | "revenueCents"> {
  return {
    revenueCents: e.revenueCents,
    planId: e.plan,
    upgradeFrom: e.upgradeFrom,
    extraStemId: e.extraStemId,
    billing: e.billing,
    priceCents: e.priceCents,
    lines: e.lines,
    payoutCents: e.payoutCents,
    paymentStatus: e.priceCents > 0 ? "pending" : "included",
  };
}

/**
 * Synchronise les commandes avec le planning. Renvoie la liste complète des commandes
 * (existantes mises à jour + nouvelles).
 */
export function syncOrders(input: EngineInput): Order[] {
  const today = input.today ?? startOfDay();
  const horizon = input.horizon ?? HORIZON_DAYS;
  const near = iso(addDays(today, horizon));
  // Jours de pic : commandes visibles 3 semaines avant
  const to = addDays(today, Math.max(horizon, PEAK_HORIZON_DAYS));
  const occAll = planOccurrences({ subscriptions: input.subscriptions, schedules: input.schedules, overrides: input.overrides ?? {}, orders: input.orders, catalog: input.catalog }, today, to);
  const occ = occAll.filter((e) => e.date <= near || e.isPeak);
  const byKey = new Map(occ.map((e) => [e.key, e]));
  const nowDate = input.now ?? new Date();
  const now = nowDate.toISOString();

  // Commandes existantes pas encore commencées : suivent le planning
  let orders = input.orders.map((o) => {
    if (!OPEN.includes(o.status)) return o;
    const e = byKey.get(orderKey(o));
    if (!e) return o;
    if (e.status !== "planned") {
      return { ...o, status: "cancelled" as const, cancelReason: e.status === "absorbed" ? `Fusionné avec ${e.near?.label ?? "une occasion"}` : e.blockReason, statusAt: { ...o.statusAt, cancelled: now } };
    }
    const base = withDeliveryFee(pricingFields(e), o.courier);
    // La prime de reprise urgente reste acquise à l'atelier qui a repris la commande
    const priced = { ...base, payoutCents: (base.payoutCents ?? 0) + (o.bonusCents ?? 0) };
    const planChanged = priced.planId !== o.planId;
    const s = input.schedules.find((x) => x.id === o.scheduleId);
    return {
      ...o,
      ...priced,
      paymentStatus: o.paymentStatus === "paid" && priced.priceCents === (o.priceCents ?? 0) ? "paid" : priced.paymentStatus,
      modelId: planChanged && s ? pickModel({ ...s, planId: priced.planId }, input.models, input.orders.filter((x) => x.id !== o.id)) : o.modelId,
    };
  });

  // Réactivation : une commande annulée par fusion redevient active si on garde les deux
  orders = orders.map((o) => {
    if (o.status !== "cancelled" || !o.cancelReason?.startsWith("Fusionné")) return o;
    const e = byKey.get(orderKey(o));
    if (!e || e.status !== "planned") return o;
    return { ...o, ...withDeliveryFee(pricingFields(e), o.courier), status: o.floristId ? "assigned" : "scheduled", cancelReason: undefined };
  });

  // Nouvelles commandes : créées sans atelier, puis proposées (garantie de livraison)
  const existing = new Set(orders.map(orderKey));
  for (const e of occ) {
    if (e.status !== "planned" || existing.has(e.key)) continue;
    const s = input.schedules.find((x) => x.id === e.scheduleId)!;
    const r = input.recipients.find((x) => x.id === e.recipientId);
    if (!r) continue;
    const id = `ord_${s.id}_${e.date.replaceAll("-", "")}`;
    const draft: Order = {
      id,
      publicCode: publicCode(id),
      attempt: 1,
      scheduleId: s.id,
      recipientId: r.id,
      subscriptionId: e.subscriptionId,
      ...withDeliveryFee(pricingFields(e), "uber_direct"),
      modelId: pickModel({ ...s, planId: e.plan }, input.models, orders),
      mode: s.mode,
      deliveryDate: e.date,
      status: "scheduled",
      floristId: null,
      message: s.message,
      courier: "uber_direct",
      statusAt: { scheduled: now },
    };
    const { order, events } = offerNew(draft, { florists: input.florists, recipients: input.recipients, orders, now: nowDate });
    events.forEach((ev) => input.onEvent?.(ev));
    orders.push(order.floristId ? { ...order, statusAt: { ...order.statusAt, assigned: now } } : order);
  }
  return orders;
}

/** L'atelier qui livre lui-même reçoit un forfait livraison en plus. */
function withDeliveryFee<T extends { payoutCents?: number }>(f: T, courier: Order["courier"]): T {
  return courier === "own" && (f.payoutCents ?? 0) > 0 ? { ...f, payoutCents: (f.payoutCents ?? 0) + OWN_DELIVERY_FEE_CENTS } : f;
}

/** Code court et lisible imprimé sur la carte (moncleur.fr/m/XXXXXX). */
export function publicCode(seed: string) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[h % alphabet.length];
    h = Math.imul(h ^ (h >>> 13), 2654435761) >>> 0;
  }
  return out;
}

/** Compatibilité : uniquement les nouvelles commandes. */
export function generateOrders(input: EngineInput): Order[] {
  const before = new Set(input.orders.map((o) => o.id));
  return syncOrders(input).filter((o) => !before.has(o.id));
}
