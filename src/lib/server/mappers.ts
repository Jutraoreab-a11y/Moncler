import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Conversion lignes Supabase ⇄ objets applicatifs (mêmes types que la démo),
 * pour faire tourner côté serveur exactement la même logique (lib/pricing, lib/engine).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GuaranteeEvent } from "@/lib/guarantee";
import { occurrenceKey } from "@/lib/pricing";
import type { BouquetModel, Florist, OccurrenceOverride, Order, Payout, Recipe, Recipient, Reminder, Schedule, Subscription } from "@/lib/types";

export const toReminder = (r: any): Reminder => ({ id: r.id, name: r.name, date: r.event_date, type: r.type, label: r.label });

export const toRecipe = (r: any): Recipe => ({
  planId: r.plan_id,
  name: r.name,
  priceCents: r.price_cents,
  floristPayoutCents: r.florist_payout_cents,
  flowerBudgetCents: r.flower_budget_cents,
  stems: r.stems,
  palette: r.palette,
  packaging: r.packaging,
  size: r.size,
  notes: r.notes,
});

export const toModel = (m: any): BouquetModel => ({ id: m.id, planId: m.plan_id, name: m.name, tagline: m.tagline, stems: m.stems, palette: m.palette, packaging: m.packaging, notes: m.notes, active: m.active });

export const toRecipient = (r: any, me?: string): Recipient => ({
  id: r.id,
  customerId: me && r.user_id === me ? "me" : r.user_id,
  firstName: r.first_name,
  lastName: r.last_name,
  relation: r.relation ?? "",
  address: r.address,
  postalCode: r.postal_code,
  city: r.city,
  lat: r.lat ?? 0,
  lng: r.lng ?? 0,
  phone: r.phone,
  accessNotes: r.access_notes ?? "",
});

export const toSubscription = (s: any, me?: string): Subscription => ({
  id: s.id,
  customerId: me && s.user_id === me ? "me" : s.user_id,
  planType: s.plan_type,
  planId: s.plan_id,
  commitmentMonths: s.commitment_period_months,
  recipientId: s.recipient_id ?? undefined,
  startedAt: s.started_at,
  status: s.status === "paused" ? "paused" : s.status === "cancelled" ? "cancelled" : s.status === "active" || s.status === "past_due" ? "active" : "cancelled",
  cancelAtCommitmentEnd: s.cancel_at_commitment_end,
  priceCents: s.price_cents || undefined,
});

export const toSchedule = (s: any): Schedule => ({
  id: s.id,
  subscriptionId: s.subscription_id,
  recipientId: s.recipient_id,
  planId: s.plan_id,
  type: s.type,
  dayOfMonth: s.day_of_month ?? undefined,
  date: s.event_date ?? undefined,
  label: s.label,
  message: s.message,
  active: s.active,
  mode: s.selection_mode,
  modelId: s.model_id ?? undefined,
  upgradeTo: s.upgrade_to ?? undefined,
  extraStemId: s.extra_stem ?? undefined,
  addedAt: s.added_at ?? undefined,
});

export function toOverrides(rows: any[]): Record<string, OccurrenceOverride> {
  const out: Record<string, OccurrenceOverride> = {};
  for (const r of rows) {
    out[occurrenceKey(r.schedule_id, r.occurrence_date)] = {
      upgradeTo: r.clear_upgrade ? null : r.upgrade_to ?? undefined,
      extraStemId: r.clear_extra ? null : r.extra_stem ?? undefined,
      keepSeparate: r.keep_separate,
    };
  }
  return out;
}

export const toOrder = (o: any): Order => ({
  id: o.id,
  scheduleId: o.schedule_id,
  recipientId: o.recipient_id,
  subscriptionId: o.subscription_id ?? undefined,
  planId: o.plan_id,
  upgradeFrom: o.upgrade_from ?? undefined,
  extraStemId: o.extra_stem ?? undefined,
  billing: o.billing,
  priceCents: o.price_cents,
  lines: o.lines ?? [],
  payoutCents: o.payout_cents,
  paymentStatus: o.payment_status,
  cancelReason: o.cancel_reason ?? undefined,
  modelId: o.model_id ?? undefined,
  mode: o.selection_mode,
  deliveryDate: o.delivery_date,
  status: o.status,
  floristId: o.florist_id,
  message: o.message,
  courier: o.courier,
  distanceKm: o.distance_km ? Number(o.distance_km) : undefined,
  priority: o.priority,
  statusAt: o.status_at ?? {},
  revenueCents: o.revenue_cents,
  publicCode: o.public_code ?? undefined,
  photoUrl: o.photo_url ?? undefined,
  thanks: o.thanks ?? undefined,
  attempt: o.attempt,
  originalDate: o.original_date ?? undefined,
  issue: o.issue ?? undefined,
  acceptedAt: o.accepted_at ?? undefined,
  offer: o.offer ?? undefined,
  declinedBy: o.declined_by ?? [],
  handoffs: o.handoffs ?? [],
  alert: o.alert ?? undefined,
  bonusCents: o.bonus_cents || undefined,
  rescue: o.rescue ?? false,
  dayRemindedAt: o.day_reminded_at ?? undefined,
  customerWarnedAt: o.customer_warned_at ?? undefined,
  refundDue: o.refund_due ?? false,
  dayAlertedAt: o.day_alerted_at ?? undefined,
  critical: o.critical ?? false,
});

/** Colonnes de garantie d'une commande (cron /api/cron/guarantee, actions accepter / refuser). */
export const guaranteeColumns = (o: Order) => ({
  status: o.status,
  florist_id: o.floristId,
  courier: o.courier,
  distance_km: o.distanceKm ?? null,
  payout_cents: o.payoutCents ?? 0,
  accepted_at: o.acceptedAt ?? null,
  offer: o.offer ?? null,
  offered_to: o.offer?.floristIds ?? [],
  declined_by: o.declinedBy ?? [],
  handoffs: o.handoffs ?? [],
  alert: o.alert ?? null,
  bonus_cents: o.bonusCents ?? 0,
  rescue: !!o.rescue,
  day_reminded_at: o.dayRemindedAt ?? null,
  customer_warned_at: o.customerWarnedAt ?? null,
  photo_url: o.photoUrl ?? null,
  // Report faute d'atelier (jour J 15 h) ou annulation remboursée
  delivery_date: o.deliveryDate,
  original_date: o.originalDate ?? null,
  attempt: o.attempt ?? 1,
  issue: o.issue ?? null,
  cancel_reason: o.cancelReason ?? null,
  refund_due: !!o.refundDue,
  day_alerted_at: o.dayAlertedAt ?? null,
  critical: !!o.critical,
});

export const toGuaranteeEvent = (e: any): GuaranteeEvent => ({
  kind: e.kind,
  orderId: e.order_id,
  floristIds: e.florist_ids ?? [],
  audience: e.audience,
  text: e.text,
  at: e.created_at,
});

/** Champs d'une commande applicative → colonnes SQL (hors id, horodatage géré par trigger). */
export const fromOrder = (o: Order, userId: string) => ({
  schedule_id: o.scheduleId,
  recipient_id: o.recipientId,
  user_id: userId,
  subscription_id: o.subscriptionId ?? null,
  florist_id: o.floristId,
  plan_id: o.planId,
  upgrade_from: o.upgradeFrom ?? null,
  extra_stem: o.extraStemId ?? null,
  billing: o.billing ?? "included",
  model_id: o.modelId ?? null,
  selection_mode: o.mode ?? "surprise",
  delivery_date: o.deliveryDate,
  status: o.status,
  message: o.message,
  courier: o.courier,
  distance_km: o.distanceKm ?? null,
  priority: !!o.priority,
  price_cents: o.priceCents ?? 0,
  lines: o.lines ?? [],
  payout_cents: o.payoutCents ?? 0,
  payment_status: o.paymentStatus ?? "included",
  cancel_reason: o.cancelReason ?? null,
  revenue_cents: o.revenueCents ?? 0,
  public_code: o.publicCode ?? null,
  attempt: o.attempt ?? 1,
  original_date: o.originalDate ?? null,
  issue: o.issue ?? null,
  accepted_at: o.acceptedAt ?? null,
  offer: o.offer ?? null,
  offered_to: o.offer?.floristIds ?? [],
  declined_by: o.declinedBy ?? [],
  handoffs: o.handoffs ?? [],
  alert: o.alert ?? null,
  bonus_cents: o.bonusCents ?? 0,
  rescue: !!o.rescue,
});

export const toFlorist = (f: any): Florist => ({
  id: f.id,
  shopName: f.shop_name,
  ownerName: "",
  address: f.address,
  city: `${f.postal_code} ${f.city}`,
  lat: f.lat,
  lng: f.lng,
  radiusKm: Number(f.radius_km),
  deliveryMode: f.delivery_mode,
  completedOrders: f.completed_orders,
  saasPlan: f.saas_plan,
  dailyCapacity: f.daily_capacity,
  stripeConnected: f.payouts_enabled,
  active: f.active,
  closedWeekdays: f.closed_weekdays ?? [],
  closedOnHolidays: f.closed_on_holidays ?? false,
  phone: f.phone ?? undefined,
  autoAccept: f.auto_accept ?? false,
  strikesClearedAt: f.strikes_cleared_at ?? undefined,
  closures: (f.closures ?? []).map((c: any) => ({ id: c.id, from: c.starts_on, to: c.ends_on, reason: c.reason ?? undefined, declaredAt: c.declared_at })),
  strikes: (f.strikes ?? []).map((s: any) => ({ id: s.key, at: s.created_at, orderId: s.order_id, points: s.points, reason: s.reason })),
  debits: (f.debits ?? []).map((d: any) => ({ id: d.key, at: d.created_at, orderId: d.order_id, amountCents: d.amount_cents, remainingCents: d.remaining_cents, reason: d.reason })),
});

export const toPayout = (p: any): Payout => ({ id: p.id, floristId: p.florist_id, orderId: p.order_id, amountCents: p.amount_cents, withheldCents: p.withheld_cents || undefined, createdAt: p.created_at, status: p.status === "paid" ? "paid" : "pending" });

/**
 * Charge tout ce qu'il faut pour planifier (moteur de commandes, prévisionnel).
 * `userId` limite aux abonnements d'un client ; sans lui, tous les abonnements actifs (cron).
 */
export async function loadPlanning(db: SupabaseClient, opts: { userId?: string; ordersSince?: string } = {}) {
  let subsQ = db.from("subscriptions").select("*").in("status", ["active", "past_due", "paused"]);
  if (opts.userId) subsQ = subsQ.eq("user_id", opts.userId);
  const { data: subRows, error } = await subsQ;
  if (error) throw error;
  const subIds = (subRows ?? []).map((s) => s.id);
  const none = ["00000000-0000-0000-0000-000000000000"];

  const [schedules, catalog, models, florists] = await Promise.all([
    db.from("schedules").select("*").in("subscription_id", subIds.length ? subIds : none),
    db.from("flower_catalog_recipes").select("*"),
    db.from("bouquet_models").select("*").order("sort"),
    db.from("florists").select("*, closures:florist_closures(*), strikes:florist_strikes(*), debits:florist_debits(*)"),
  ]);
  const scheduleIds = (schedules.data ?? []).map((s) => s.id);
  const recipientIds = [...new Set((schedules.data ?? []).map((s) => s.recipient_id))];
  const [overrides, recipients, orders] = await Promise.all([
    db.from("occurrence_overrides").select("*").in("schedule_id", scheduleIds.length ? scheduleIds : none),
    db.from("recipients").select("*").in("id", recipientIds.length ? recipientIds : none),
    db.from("orders").select("*").in("subscription_id", subIds.length ? subIds : none).gte("delivery_date", opts.ordersSince ?? "1970-01-01"),
  ]);

  return {
    subscriptionRows: subRows ?? [],
    subscriptions: (subRows ?? []).map((s) => toSubscription(s, opts.userId)),
    schedules: (schedules.data ?? []).map(toSchedule),
    overrides: toOverrides(overrides.data ?? []),
    recipients: (recipients.data ?? []).map((r) => toRecipient(r, opts.userId)),
    orders: (orders.data ?? []).map(toOrder),
    catalog: (catalog.data ?? []).map(toRecipe),
    models: (models.data ?? []).map(toModel),
    florists: (florists.data ?? []).map(toFlorist),
  };
}
