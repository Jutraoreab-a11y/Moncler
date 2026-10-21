"use client";

/**
 * Store applicatif. En mode démo (pas de clés Supabase), l'état vit dans le
 * navigateur (localStorage) et le moteur de commandes tourne côté client.
 * En production, les mêmes actions appellent les routes /api (voir lib/api-client.ts).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { getRecipe } from "./catalog";
import { syncOrders } from "./engine";
import { addDays, iso, startOfDay } from "./dates";
import { canRetract, CHARGE_LEAD_DAYS, commitmentEnd } from "./pricing";
import { acceptOffer, applyGuarantee, assignManually, declineOffer, parisAt, parisDate, settleDebits, type GuaranteeEvent } from "./guarantee";
import { buildSeed, STATE_VERSION, type AppState } from "./seed";
import type { Closure, Reminder, BouquetModel, OccurrenceOverride, Order, OrderStatus, PlanId, Recipe, Recipient, Schedule, Subscription } from "./types";
import { pickModel } from "./models";
import { api, isDemo } from "./api-client";

const KEY = "moncleur-demo";

type Action =
  | { type: "hydrate"; state: AppState }
  | { type: "addPlan"; recipient: Recipient; subscription: Subscription; schedules: Schedule[] }
  | { type: "addOccasion"; schedule: Schedule }
  | { type: "override"; key: string; patch: OccurrenceOverride }
  | { type: "status"; orderId: string; status: OrderStatus }
  | { type: "subscription"; id: string; status: Subscription["status"] }
  | { type: "toggleSchedule"; id: string }
  | { type: "editSchedule"; id: string; patch: Partial<Schedule> }
  | { type: "activatePro"; floristId: string }
  | { type: "recipe"; planId: PlanId; patch: Partial<Recipe> }
  | { type: "reassign"; orderId: string; floristId: string }
  | { type: "inject"; order: Order; recipient: Recipient }
  | { type: "florist"; id: string }
  | { type: "floristPatch"; id: string; patch: Partial<AppState["florists"][number]> }
  | { type: "dispatchAll" }
  | { type: "addFlorist"; florist: AppState["florists"][number] }
  | { type: "model"; id: string; patch: Partial<BouquetModel> }
  | { type: "addModel"; model: BouquetModel }
  | { type: "photo"; orderId: string; photoUrl: string }
  | { type: "absent"; orderId: string }
  | { type: "thanks"; code: string; text: string; photoUrl?: string }
  | { type: "addReminders"; reminders: Reminder[] }
  | { type: "removeReminder"; id: string }
  | { type: "waitlist"; email: string; postalCode: string }
  // Garantie de livraison
  | { type: "acceptOffer"; orderId: string; floristId: string }
  | { type: "declineOffer"; orderId: string; floristId: string; reason?: string }
  | { type: "addClosure"; floristId: string; closure: Closure }
  | { type: "removeClosure"; floristId: string; closureId: string }
  | { type: "clearStrikes"; floristId: string }
  | { type: "tick" }
  /** Démo : vieillit les propositions de N heures (rappel à 24 h, bascule à 48 h) */
  | { type: "timeTravel"; hours: number }
  /** Démo : applique la règle du jour J à l'heure donnée (11 h 01 alerte, 11 h 31 réattribution critique) */
  | { type: "simulateCutoff"; h?: number; m?: number }
  | { type: "reset" };

function runEngine(s: AppState, now: Date = new Date()): AppState {
  // En production, la génération des commandes, la garantie et les prélèvements sont faits par les crons serveur.
  if (!isDemo) return s;
  const events: GuaranteeEvent[] = [];
  let orders = syncOrders({
    schedules: s.schedules,
    recipients: s.recipients,
    florists: s.florists,
    orders: s.orders,
    models: s.models,
    subscriptions: s.subscriptions,
    catalog: s.catalog,
    overrides: s.overrides,
    now,
    onEvent: (e) => events.push(e),
  });
  // Démo : le prélèvement J-3 réussit immédiatement
  const chargeLimit = iso(addDays(startOfDay(), CHARGE_LEAD_DAYS));
  orders = orders.map((o) => (o.paymentStatus === "pending" && o.status !== "cancelled" && o.deliveryDate <= chargeLimit ? { ...o, paymentStatus: "paid" as const } : o));
  return withGuarantee({ ...s, orders }, now, events);
}

/** Garantie de livraison : rappels, bascules, règle de 11 h, fermetures (lib/guarantee). */
function withGuarantee(s: AppState, now: Date = new Date(), pre: GuaranteeEvent[] = []): AppState {
  if (!isDemo) return s;
  const g = applyGuarantee({ orders: s.orders, florists: s.florists, recipients: s.recipients, now });
  return log({ ...s, orders: g.orders, florists: g.florists }, [...pre, ...g.events]);
}

const log = (s: AppState, events: GuaranteeEvent[]): AppState => (events.length ? { ...s, guaranteeLog: [...events.reverse(), ...(s.guaranteeLog ?? [])].slice(0, 80) } : s);

/** Démo : décale dans le passé les horodatages des propositions en cours. */
function age(s: AppState, h: number): AppState {
  const back = (t?: string) => (t ? new Date(new Date(t).getTime() - h * 3600_000).toISOString() : t);
  return {
    ...s,
    orders: s.orders.map((o) =>
      o.offer || (o.floristId && !o.acceptedAt)
        ? { ...o, offer: o.offer && { ...o.offer, at: back(o.offer.at)!, remindAt: back(o.offer.remindAt)!, expiresAt: back(o.offer.expiresAt)!, remindedAt: back(o.offer.remindedAt) }, statusAt: { ...o.statusAt, assigned: back(o.statusAt.assigned) } }
        : o,
    ),
  };
}

function reducer(s: AppState, a: Action): AppState {
  const now = new Date().toISOString();
  switch (a.type) {
    case "hydrate":
      return runEngine(a.state);
    case "reset":
      return runEngine(buildSeed());
    case "addPlan":
      return runEngine({
        ...s,
        recipients: s.recipients.some((r) => r.id === a.recipient.id) ? s.recipients : [...s.recipients, a.recipient],
        subscriptions: [...s.subscriptions, a.subscription],
        schedules: [...s.schedules, ...a.schedules],
      });
    case "addOccasion":
      return runEngine({ ...s, schedules: [...s.schedules, a.schedule] });
    case "override": {
      const cur = s.overrides[a.key] ?? {};
      return runEngine({ ...s, overrides: { ...s.overrides, [a.key]: { ...cur, ...a.patch } } });
    }
    case "status": {
      const order = s.orders.find((o) => o.id === a.orderId);
      if (!order || order.status === a.status) return s;
      let florists = s.florists;
      let payouts = s.payouts;
      if (a.status === "delivered" && order.floristId) {
        // Retenues (prime de secours après un manquement du jour J) imputées sur ce virement
        const f0 = s.florists.find((f) => f.id === order.floristId);
        const gross = order.payoutCents ?? getRecipe(order.planId, s.catalog).floristPayoutCents;
        const settled = settleDebits(f0?.debits, gross);
        florists = s.florists.map((f) => (f.id === order.floristId ? { ...f, completedOrders: f.completedOrders + 1, debits: settled.debits } : f));
        payouts = [
          { id: `po_${order.id}`, floristId: order.floristId, orderId: order.id, amountCents: settled.netCents, withheldCents: settled.withheldCents || undefined, createdAt: now, status: "pending" },
          ...s.payouts,
        ];
      }
      return {
        ...s,
        florists,
        payouts,
        orders: s.orders.map((o) => (o.id === a.orderId ? { ...o, status: a.status, statusAt: { ...o.statusAt, [a.status]: now } } : o)),
      };
    }
    case "subscription": {
      const sub = s.subscriptions.find((x) => x.id === a.id);
      if (!sub) return s;
      let patch: Partial<Subscription> = { status: a.status };
      if (sub.planType === "SPECIAL_EVENTS_CARNET") {
        if (a.status === "paused") return s; // pas de pause pendant l'engagement
        const end = commitmentEnd(sub);
        // Résiliation pendant l'engagement : effective à la fin des 12 mois,
        // sauf rétractation (14 jours, aucun bouquet livré) : arrêt immédiat et remboursement
        if (a.status === "cancelled" && end && startOfDay() < end && !canRetract(sub, s.orders)) patch = { cancelAtCommitmentEnd: true };
        if (a.status === "active") patch = { status: "active", cancelAtCommitmentEnd: false };
      }
      const subscriptions = s.subscriptions.map((x) => (x.id === a.id ? { ...x, ...patch } : x));
      const next = { ...s, subscriptions };
      const live = subscriptions.find((x) => x.id === a.id)!;
      if (live.status === "active") return runEngine(next);
      // Pause / résiliation immédiate : annule les commandes non commencées de cet abonnement
      return {
        ...next,
        orders: s.orders.map((o) =>
          o.subscriptionId === a.id && (o.status === "assigned" || o.status === "scheduled")
            ? { ...o, status: "cancelled" as const, cancelReason: a.status === "paused" ? "Abonnement en pause" : "Abonnement résilié", statusAt: { ...o.statusAt, cancelled: now } }
            : o,
        ),
      };
    }
    case "toggleSchedule":
      return runEngine({ ...s, schedules: s.schedules.map((x) => (x.id === a.id ? { ...x, active: !x.active } : x)) });
    case "editSchedule": {
      const schedules = s.schedules.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x));
      const sch = schedules.find((x) => x.id === a.id)!;
      const bouquetChanged = a.patch.mode !== undefined || a.patch.modelId !== undefined || a.patch.planId !== undefined;
      // Les commandes pas encore commencées suivent le nouveau réglage
      const orders = s.orders.map((o) => {
        if (o.scheduleId !== a.id || !["assigned", "scheduled"].includes(o.status)) return o;
        let next = o;
        if (a.patch.message !== undefined) next = { ...next, message: a.patch.message };
        if (bouquetChanged) {
          const others = s.orders.filter((x) => x.id !== o.id);
          next = { ...next, planId: sch.planId, mode: sch.mode, modelId: pickModel(sch, s.models, others) };
        }
        return next;
      });
      return runEngine({ ...s, schedules, orders });
    }
    case "model":
      return { ...s, models: s.models.map((m) => (m.id === a.id ? { ...m, ...a.patch } : m)) };
    case "addModel":
      return { ...s, models: [...s.models, a.model] };
    case "activatePro":
      return runEngine({ ...s, florists: s.florists.map((f) => (f.id === a.floristId ? { ...f, saasPlan: "pro" } : f)) });
    case "recipe":
      return { ...s, catalog: s.catalog.map((r) => (r.planId === a.planId ? { ...r, ...a.patch } : r)) };
    case "reassign": {
      const order = s.orders.find((o) => o.id === a.orderId)!;
      const r = s.recipients.find((x) => x.id === order.recipientId);
      const f = s.florists.find((x) => x.id === a.floristId)!;
      return { ...s, orders: s.orders.map((o) => (o.id === a.orderId ? assignManually(o, f, r) : o)) };
    }
    case "dispatchAll":
      return withGuarantee(s);
    case "acceptOffer":
    case "declineOffer": {
      const input = { orders: s.orders, florists: s.florists, recipients: s.recipients, orderId: a.orderId, floristId: a.floristId };
      const g = a.type === "acceptOffer" ? acceptOffer(input) : declineOffer({ ...input, reason: a.reason });
      if (g.error) return s;
      return log({ ...s, orders: g.orders, florists: g.florists }, g.events);
    }
    case "addClosure":
      return withGuarantee({ ...s, florists: s.florists.map((f) => (f.id === a.floristId ? { ...f, closures: [...(f.closures ?? []), a.closure].sort((x, y) => x.from.localeCompare(y.from)) } : f)) });
    case "removeClosure":
      return withGuarantee({ ...s, florists: s.florists.map((f) => (f.id === a.floristId ? { ...f, closures: (f.closures ?? []).filter((c) => c.id !== a.closureId) } : f)) });
    case "clearStrikes":
      return withGuarantee({ ...s, florists: s.florists.map((f) => (f.id === a.floristId ? { ...f, strikesClearedAt: now } : f)) });
    case "tick": {
      const n = withGuarantee(s);
      return n.guaranteeLog === s.guaranteeLog ? s : n;
    }
    case "timeTravel":
      return withGuarantee(age(s, a.hours));
    case "simulateCutoff": {
      const cutoff = parisAt(parisDate(), a.h ?? 11, a.m ?? 1);
      return withGuarantee(s, new Date(Math.max(Date.now(), cutoff.getTime())));
    }
    case "inject":
      return { ...s, recipients: [...s.recipients, a.recipient], orders: [...s.orders, a.order] };
    case "florist":
      return { ...s, currentFloristId: a.id };
    case "photo":
      return { ...s, orders: s.orders.map((o) => (o.id === a.orderId ? { ...o, photoUrl: a.photoUrl } : o)) };
    case "absent": {
      // Destinataire absent : nouvelle tentative le lendemain, sans frais pour l'abonné
      return {
        ...s,
        orders: s.orders.map((o) => {
          if (o.id !== a.orderId) return o;
          const next = iso(addDays(new Date(o.deliveryDate + "T12:00:00"), 1));
          return {
            ...o,
            originalDate: o.originalDate ?? o.deliveryDate,
            deliveryDate: next,
            attempt: (o.attempt ?? 1) + 1,
            issue: `Destinataire absent le ${o.deliveryDate.split("-").reverse().slice(0, 2).join("/")} : nouvelle tentative`,
            status: "assigned",
            statusAt: { ...o.statusAt, assigned: now },
          };
        }),
      };
    }
    case "thanks":
      return { ...s, orders: s.orders.map((o) => (o.publicCode === a.code ? { ...o, thanks: { text: a.text, photoUrl: a.photoUrl, at: now } } : o)) };
    case "addReminders": {
      const known = new Set(s.reminders.map((r) => `${r.name}|${r.date}`));
      return { ...s, reminders: [...s.reminders, ...a.reminders.filter((r) => !known.has(`${r.name}|${r.date}`))] };
    }
    case "removeReminder":
      return { ...s, reminders: s.reminders.filter((r) => r.id !== a.id) };
    case "waitlist":
      return { ...s, waitlist: [...s.waitlist, { email: a.email, postalCode: a.postalCode, at: now }] };
    case "addFlorist":
      return runEngine({ ...s, florists: [...s.florists, a.florist], currentFloristId: a.florist.id });
    case "floristPatch":
      return withGuarantee({ ...s, florists: s.florists.map((f) => (f.id === a.id ? { ...f, ...a.patch } : f)) });
  }
}

interface Ctx {
  state: AppState;
  ready: boolean;
  dispatch: (a: Action, opts?: { local?: boolean }) => void;
  today: string;
}

const StoreCtx = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, undefined, () => buildSeed());
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  // Production : état chargé depuis Supabase + temps réel sur les commandes
  useEffect(() => {
    if (isDemo) return;
    let alive = true;
    // Espaces réservés : sans session, on renvoie vers la connexion. Ailleurs (accueil,
    // tunnel, page destinataire, rappels), on charge seulement les données publiques.
    const PROTECTED = ["/compte", "/pro", "/admin", "/rappels"];
    const isProtected = () => PROTECTED.some((p) => location.pathname.startsWith(p)) && !location.pathname.startsWith("/pro/rejoindre");
    const empty: Partial<AppState> = { recipients: [], subscriptions: [], schedules: [], orders: [], payouts: [], reminders: [], waitlist: [], overrides: {} };
    const load = () =>
      fetch("/api/state")
        .then((r) => (r.ok ? r.json() : Promise.reject(r)))
        .then((st: AppState) => alive && (rawDispatch({ type: "hydrate", state: st }), setReady(true)))
        .catch(async () => {
          if (!alive) return;
          if (isProtected()) {
            location.assign(`/connexion?next=${encodeURIComponent(location.pathname)}`);
            return;
          }
          const pub = await fetch("/api/public").then((r) => (r.ok ? r.json() : null)).catch(() => null);
          if (pub && alive) rawDispatch({ type: "hydrate", state: { ...buildSeed(), ...empty, ...pub, customer: { firstName: "", email: "", since: "" } } as AppState });
          setReady(true);
        });
    load();
    let cleanup = () => {};
    import("./supabase/browser").then(({ supabaseBrowser }) => {
      const sb = supabaseBrowser();
      const ch = sb.channel("orders").on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => load()).subscribe();
      cleanup = () => void sb.removeChannel(ch);
    });
    return () => {
      alive = false;
      cleanup();
    };
  }, []);

  // Démo : état dans localStorage, synchronisé entre onglets
  useEffect(() => {
    if (!isDemo) return;
    let initial: AppState | null = null;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppState;
        if (parsed.version === STATE_VERSION) initial = parsed;
      }
    } catch {}
    rawDispatch({ type: "hydrate", state: initial ?? buildSeed() });
    loaded.current = true;
    setReady(true);
    // Synchronisation temps réel entre onglets (ex. /pro et /compte ouverts côte à côte)
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY || !e.newValue) return;
      try {
        rawDispatch({ type: "hydrate", state: JSON.parse(e.newValue) });
      } catch {}
    };
    window.addEventListener("storage", onStorage);
    // Horloge de la garantie : rappels, bascules et règle de 11 h appliqués en direct
    const timer = setInterval(() => rawDispatch({ type: "tick" }), 30_000);
    return () => {
      window.removeEventListener("storage", onStorage);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!isDemo || !loaded.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  const dispatch = useCallback((a: Action, opts?: { local?: boolean }) => {
    rawDispatch(a);
    // En production, on réplique l'action côté serveur (optimistic UI), sauf si elle y est déjà passée.
    if (!isDemo && !opts?.local) void api.sync(a).catch(() => {});
  }, []);

  const value = useMemo(() => ({ state, ready, dispatch, today: iso(startOfDay()) }), [state, ready, dispatch]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("useStore hors StoreProvider");
  return c;
}

export type { Action };
