/**
 * Garantie de livraison — chaque bouquet part, quels que soient le mois et les disponibilités.
 * Logique pure, partagée entre la démo (navigateur) et le cron serveur (/api/cron/guarantee, toutes les 15 min).
 *
 *  J-7     La commande est proposée à l'atelier le plus proche disponible (ouvert ce jour-là, sous sa capacité,
 *          non suspendu). Il a 48 h pour l'accepter. Les ateliers en acceptation automatique la prennent tout de suite.
 *  +24 h   Sans réponse : rappel.
 *  +48 h   Toujours sans réponse : 1 point de manquement, la commande passe à l'atelier suivant (même règle).
 *  Refus   Pas de pénalité : la commande passe immédiatement à l'atelier suivant.
 *  J-2 18h Date limite pour accepter. Passé ce délai, la commande est ouverte aux 3 ateliers les plus proches,
 *          le premier qui accepte la prend (tour de 2 h, puis les 3 suivants). Personne : alerte équipe Moncleur.
 *  Congés  Un atelier fermé ce jour-là (jour de fermeture ou congés déclarés) ne reçoit pas la proposition.
 *          S'il déclare une fermeture après avoir accepté, la commande repart tout de suite chez un voisin ;
 *          moins de 48 h avant la livraison, cela compte comme un manquement.
 *  Jour J  9 h 30 : rappel si la préparation n'a pas commencé.
 *          11 h 00 : la commande doit être « En préparation » ou « Prête ». Sinon alerte sonore + SMS à l'atelier.
 *          11 h 30 : toujours rien → CRITICAL_REASSIGN : la commande est retirée (2 points, une fois par jour)
 *          et transférée en urgence à un atelier de secours, avec une prime de préparation majorée de 20 %,
 *          retenue sur les prochains virements de l'atelier défaillant.
 *          La reprise doit être en préparation 1 h après acceptation, sinon l'équipe est alertée.
 *  J-1 18h Commande toujours sans atelier : l'abonné est prévenu (report ou remboursement).
 *  Jour J 15h Toujours personne : livraison reportée au lendemain (même chaîne, en urgence).
 *          Au 3e essai sans atelier, la livraison est annulée et remboursée, l'équipe est alertée.
 *  Paiement Un supplément refusé à J-3 bloque la préparation : la règle de 11 h ne s'applique pas.
 *  Fidélité Le destinataire garde son atelier habituel s'il est disponible et à moins de 2 km du plus proche.
 *  Fiabilité : 3 points sur 30 jours suspendent les nouvelles propositions jusqu'à revue par l'équipe.
 */
import { frShort } from "./dates";
import { canTake, closedOn, haversineKm, isSuspended, rankFlorists } from "./matching";
import { isPeakDate, OWN_DELIVERY_FEE_CENTS } from "./pricing";
import type { Debit, Florist, Offer, Order, Recipient, Strike } from "./types";

export const GUARANTEE = {
  remindAfterH: 24,
  expireAfterH: 48,
  /** Date limite d'acceptation : J-2 à 18 h */
  acceptByDaysBefore: 2,
  acceptByHour: 18,
  /** Proposition urgente : ouverte à 3 ateliers pendant 2 h */
  openOfferSize: 3,
  openOfferH: 2,
  dayReminder: { h: 9, m: 30 },
  /** Jour J 11 h 00 : statut « En préparation » ou « Prête » requis, sinon alerte sonore + SMS */
  dayCutoffHour: 11,
  dayAlert: { h: 11, m: 0 },
  /** Jour J 11 h 30 : sans action après l'alerte, réattribution critique */
  criticalAt: { h: 11, m: 30 },
  /** Reprise urgente : en préparation au plus tard 1 h après acceptation */
  rescueStartH: 1,
  /** Prime de préparation majorée de 20 % pour l'atelier de secours */
  rescueBonusRate: 0.2,
  /** Fermeture déclarée moins de 48 h avant une livraison acceptée : manquement */
  lateClosureH: 48,
  /** Atelier au paywall : 24 h pour activer Pro avant que ses commandes partent ailleurs */
  lockedGraceH: 24,
  /** Abonné prévenu à J-1 18 h si la commande n'a toujours pas d'atelier */
  customerWarning: { daysBefore: 1, h: 18 },
  /** Jour J, 15 h : sans atelier, la livraison est reportée au lendemain */
  rolloverHour: 15,
  /** Au-delà de 3 essais sans atelier : annulation et remboursement */
  maxAttempts: 3,
  /** Fidélité : l'atelier habituel du destinataire passe devant s'il est à moins de 2 km du plus proche */
  affinityKm: 2,
} as const;

export const STRIKE_POINTS = { noAnswer: 1, lateClosure: 1, dayMissed: 2 } as const;

const OPEN_STATUSES: Order["status"][] = ["scheduled", "assigned", "preparing", "ready", "in_delivery"];

export type GuaranteeEventKind = "offer" | "accepted" | "remind" | "expired" | "declined" | "urgent" | "day_reminder" | "day_missed" | "closure" | "locked" | "alert" | "rescue_late" | "customer_warning" | "rollover" | "refund" | "day_alert" | "critical_reassign";

export interface GuaranteeEvent {
  kind: GuaranteeEventKind;
  orderId: string;
  /** Ateliers concernés (destinataires de la notification) */
  floristIds: string[];
  audience: "florist" | "ops" | "customer";
  text: string;
  at: string;
}

export interface GuaranteeInput {
  orders: Order[];
  florists: Florist[];
  recipients: Pick<Recipient, "id" | "lat" | "lng" | "firstName">[];
  now?: Date;
}

export interface GuaranteeResult {
  orders: Order[];
  florists: Florist[];
  events: GuaranteeEvent[];
}

// ---------------------------------------------------------------------------
// Heure de Paris (le serveur tourne en UTC, la démo dans le fuseau du navigateur)
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

function parisOffsetMin(d: Date) {
  const tz = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = tz.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!m) return 60;
  const h = Number(m[1]);
  return h * 60 + Math.sign(h) * Number(m[2] ?? 0);
}

/** Instant correspondant à une heure murale à Paris, ce jour-là. */
export function parisAt(date: string, hour: number, minute = 0) {
  const wall = new Date(`${date}T${pad(hour)}:${pad(minute)}:00Z`);
  const first = new Date(wall.getTime() - parisOffsetMin(wall) * 60_000);
  // Recalcul avec le décalage de l'instant obtenu (changement d'heure)
  return new Date(wall.getTime() - parisOffsetMin(first) * 60_000);
}

/** Date du jour à Paris (YYYY-MM-DD). */
export const parisDate = (now: Date = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export const addDaysISO = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Date limite pour accepter une commande : J-2 18 h. */
export const acceptBy = (date: string) => parisAt(addDaysISO(date, -GUARANTEE.acceptByDaysBefore), GUARANTEE.acceptByHour);

/** Heure limite du jour J : 11 h 00 (alerte), ou 1 h après acceptation pour une reprise urgente. */
export function readyDeadline(o: Pick<Order, "deliveryDate" | "rescue" | "acceptedAt">) {
  const base = parisAt(o.deliveryDate, GUARANTEE.dayAlert.h, GUARANTEE.dayAlert.m);
  if (!o.rescue || !o.acceptedAt) return base;
  return new Date(Math.max(base.getTime(), new Date(o.acceptedAt).getTime() + GUARANTEE.rescueStartH * 3600_000));
}
/** Jour J 11 h 30 : réattribution critique. */
export const criticalDeadline = (date: string) => parisAt(date, GUARANTEE.criticalAt.h, GUARANTEE.criticalAt.m);

/** L'atelier a fait sa part du jour J : commande « En préparation » ou plus loin. */
export const floristStepDone = (o: Pick<Order, "status">) => ["preparing", "ready", "in_delivery", "delivered"].includes(o.status);

/** Rémunération de préparation (hors forfait livraison et primes) d'une commande. */
export const basePayoutCents = (o: Pick<Order, "payoutCents" | "courier" | "bonusCents">) => Math.max(0, (o.payoutCents ?? 0) - (o.courier === "own" ? OWN_DELIVERY_FEE_CENTS : 0) - (o.bonusCents ?? 0));
/** Prime de l'atelier de secours : +20 % de la prime de préparation. */
export const rescueBonusCents = (o: Pick<Order, "payoutCents" | "courier" | "bonusCents">) => Math.round(basePayoutCents(o) * GUARANTEE.rescueBonusRate);

/** Proposition en attente de réponse de cet atelier (ou ouverte à lui en urgence). */
export const isOfferedTo = (o: Order, floristId: string) =>
  !o.acceptedAt && ["scheduled", "assigned"].includes(o.status) && ((o.floristId === floristId && !!o.offer && !o.offer.open) || (!!o.offer?.open && o.offer.floristIds.includes(floristId)));

// ---------------------------------------------------------------------------
// Contexte d'un passage
// ---------------------------------------------------------------------------

class Run {
  events: GuaranteeEvent[] = [];
  strikes = new Map<string, Strike[]>();
  debits = new Map<string, Debit[]>();
  load = new Map<string, Record<string, number>>();
  /** Dernier atelier ayant livré chaque destinataire (fidélité) */
  usual = new Map<string, string>();
  readonly at: string;
  constructor(
    public florists: Florist[],
    public recipients: GuaranteeInput["recipients"],
    public now: Date,
    orders: Order[],
  ) {
    this.at = now.toISOString();
    for (const o of orders) if (o.floristId && o.status !== "cancelled") this.bump(o.deliveryDate, o.floristId, 1);
    for (const o of [...orders].filter((x) => x.status === "delivered" && x.floristId).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))) this.usual.set(o.recipientId, o.floristId!);
  }
  florist = (id: string | null | undefined) => (id ? this.florists.find((f) => f.id === id) : undefined);
  name = (id: string | null | undefined) => this.florist(id)?.shopName ?? "un atelier";
  loadOf(date: string) {
    if (!this.load.has(date)) this.load.set(date, {});
    return this.load.get(date)!;
  }
  bump(date: string, fid: string, n: number) {
    const l = this.loadOf(date);
    l[fid] = Math.max(0, (l[fid] ?? 0) + n);
  }
  emit(kind: GuaranteeEventKind, o: Order, floristIds: string[], audience: GuaranteeEvent["audience"], text: string) {
    this.events.push({ kind, orderId: o.id, floristIds, audience, text, at: this.at });
  }
  strike(fid: string, s: Omit<Strike, "at">) {
    const f = this.florist(fid);
    if (!f) return;
    const known = [...(f.strikes ?? []), ...(this.strikes.get(fid) ?? [])];
    if (known.some((x) => x.id === s.id)) return; // une seule fois (ex. un manquement par jour)
    this.strikes.set(fid, [...(this.strikes.get(fid) ?? []), { ...s, at: this.at }]);
  }
  /** Retenue sur les prochains virements (prime versée à l'atelier de secours). Une fois par commande. */
  debit(fid: string, d: Omit<Debit, "at" | "remainingCents">) {
    const f = this.florist(fid);
    if (!f || d.amountCents <= 0) return;
    if ([...(f.debits ?? []), ...(this.debits.get(fid) ?? [])].some((x) => x.id === d.id)) return;
    this.debits.set(fid, [...(this.debits.get(fid) ?? []), { ...d, remainingCents: d.amountCents, at: this.at }]);
  }
  floristsOut(): Florist[] {
    return this.florists.map((f) => {
      let out = f;
      if (this.strikes.has(f.id)) out = { ...out, strikes: [...(f.strikes ?? []), ...this.strikes.get(f.id)!] };
      if (this.debits.has(f.id)) out = { ...out, debits: [...(f.debits ?? []), ...this.debits.get(f.id)!] };
      return out;
    });
  }
  /** Fiabilité à jour pendant le passage (les manquements du passage comptent). */
  live(f: Florist): Florist {
    return this.strikes.has(f.id) ? { ...f, strikes: [...(f.strikes ?? []), ...this.strikes.get(f.id)!] } : f;
  }
}

const hours = (h: number) => h * 3600_000;
const eur = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} €`;
const label = (o: Order, ctx: Run) => {
  const r = ctx.recipients.find((x) => x.id === o.recipientId);
  return `${r ? `bouquet pour ${r.firstName}` : "bouquet"} du ${frShort(o.deliveryDate)}`;
};

/** Rémunération recalculée pour un nouvel atelier (forfait livraison maison, prime de reprise). */
function repriced(o: Order, f: Florist, bonusCents = o.bonusCents ?? 0): Pick<Order, "payoutCents" | "courier" | "bonusCents"> {
  const base = basePayoutCents(o);
  return { courier: f.deliveryMode, bonusCents: bonusCents || undefined, payoutCents: base + (f.deliveryMode === "own" ? OWN_DELIVERY_FEE_CENTS : 0) + bonusCents };
}

/** Retire la commande à son atelier : il ne sera plus sollicité pour elle. */
function release(o: Order, ctx: Run, reason: string): Order {
  if (o.floristId) ctx.bump(o.deliveryDate, o.floristId, -1);
  const declined = o.floristId && !(o.declinedBy ?? []).includes(o.floristId) ? [...(o.declinedBy ?? []), o.floristId] : o.declinedBy;
  return {
    ...o,
    status: "scheduled",
    floristId: null,
    acceptedAt: undefined,
    offer: undefined,
    declinedBy: declined,
    handoffs: [...(o.handoffs ?? []), { from: o.floristId, to: null, at: ctx.at, reason }],
  };
}

/**
 * Propose la commande : à l'atelier le mieux placé (48 h pour répondre, plafonné à J-2 18 h),
 * ou, s'il est trop tard ou en urgence, aux 3 ateliers les plus proches à la fois.
 */
function offer(o: Order, ctx: Run, opts: { urgent?: boolean; bonusCents?: number } = {}): Order {
  const r = ctx.recipients.find((x) => x.id === o.recipientId);
  if (!r) return o;
  const deadline = acceptBy(o.deliveryDate);
  const open = !!opts.urgent || ctx.now >= deadline;
  const ranked = rankFlorists(ctx.florists.map((f) => ctx.live(f)), r, ctx.loadOf(o.deliveryDate), {
    date: o.deliveryDate,
    exclude: o.declinedBy,
    now: ctx.now,
    preferOwnDelivery: isPeakDate(o.deliveryDate),
  });
  // Fidélité : l'atelier habituel du destinataire d'abord, s'il est presque aussi proche
  const usual = ctx.usual.get(o.recipientId);
  const ui = ranked.findIndex((x) => x.florist.id === usual);
  if (ui > 0 && ranked[ui].distanceKm - ranked[0].distanceKm <= GUARANTEE.affinityKm) ranked.unshift(...ranked.splice(ui, 1));
  const round = (o.offer?.round ?? (o.handoffs?.length ?? 0)) + 1;

  if (!ranked.length) {
    const alert = "Aucun atelier disponible dans la zone : à placer par l'équipe";
    if (o.alert !== alert) ctx.emit("alert", o, [], "ops", `${label(o, ctx)} (${r.firstName}) : aucun atelier disponible. À placer à la main.`);
    return { ...o, status: "scheduled", floristId: null, offer: undefined, acceptedAt: undefined, alert };
  }

  const take = (f: Florist, distanceKm: number, extra: Partial<Order>): Order => {
    ctx.bump(o.deliveryDate, f.id, 1);
    const handoffs = o.handoffs?.length && o.handoffs.at(-1)!.to === null ? [...o.handoffs.slice(0, -1), { ...o.handoffs.at(-1)!, to: f.id }] : o.handoffs;
    return { ...o, ...repriced(o, f, extra.bonusCents ?? o.bonusCents ?? 0), ...extra, handoffs, floristId: f.id, status: "assigned", distanceKm: Math.round(distanceKm * 10) / 10, alert: undefined };
  };

  if (!open) {
    const { florist: f, distanceKm } = ranked[0];
    if (f.autoAccept) {
      ctx.emit("accepted", o, [f.id], "florist", `${label(o, ctx)} acceptée automatiquement par ${f.shopName}.`);
      return take(f, distanceKm, { acceptedAt: ctx.at, offer: undefined });
    }
    const expires = Math.min(ctx.now.getTime() + hours(GUARANTEE.expireAfterH), deadline.getTime());
    const remind = ctx.now.getTime() + Math.min(hours(GUARANTEE.remindAfterH), (expires - ctx.now.getTime()) / 2);
    const of: Offer = { floristIds: [f.id], at: ctx.at, remindAt: new Date(remind).toISOString(), expiresAt: new Date(expires).toISOString(), open: false, round };
    ctx.emit("offer", o, [f.id], "florist", `Nouvelle commande : ${label(o, ctx)}. Acceptez-la avant le ${fmtWhen(of.expiresAt)}.`);
    return take(f, distanceKm, { offer: of, acceptedAt: undefined });
  }

  // Urgence : ouverte aux 3 plus proches, le premier qui accepte la prend
  const picks = ranked.slice(0, GUARANTEE.openOfferSize);
  const bonus = opts.bonusCents ?? o.offer?.bonusCents;
  const auto = picks.find((p) => p.florist.autoAccept);
  if (auto) {
    ctx.emit("accepted", o, [auto.florist.id], "florist", `${label(o, ctx)} reprise automatiquement par ${auto.florist.shopName}${bonus ? ` (prime de secours ${eur(bonus)})` : ""}.`);
    return take(auto.florist, auto.distanceKm, { acceptedAt: ctx.at, offer: undefined, bonusCents: bonus ?? o.bonusCents });
  }
  const of: Offer = {
    floristIds: picks.map((p) => p.florist.id),
    at: ctx.at,
    remindAt: new Date(ctx.now.getTime() + hours(GUARANTEE.openOfferH / 2)).toISOString(),
    expiresAt: new Date(ctx.now.getTime() + hours(GUARANTEE.openOfferH)).toISOString(),
    open: true,
    round,
    bonusCents: bonus,
  };
  ctx.emit("urgent", o, of.floristIds, "florist", `Urgent : ${label(o, ctx)} à reprendre${bonus ? `, prime de secours ${eur(bonus)} (+20 %)` : ""}. Le premier atelier qui accepte la prend.`);
  return { ...o, status: "scheduled", floristId: null, acceptedAt: undefined, offer: of, alert: undefined };
}

const fmtWhen = (isoTs: string) =>
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(isoTs));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Première proposition d'une commande qui vient d'être créée (appelée par le moteur J-7). */
export function offerNew(o: Order, ctx: { florists: Florist[]; recipients: GuaranteeInput["recipients"]; orders: Order[]; now?: Date }): { order: Order; events: GuaranteeEvent[] } {
  const run = new Run(ctx.florists, ctx.recipients, ctx.now ?? new Date(), ctx.orders);
  const order = offer(o, run);
  return { order, events: run.events };
}

/** Passage périodique : rappels, bascules, règle de 11 h, fermetures, alertes. */
export function applyGuarantee(input: GuaranteeInput): GuaranteeResult {
  const now = input.now ?? new Date();
  const ctx = new Run(input.florists, input.recipients, now, input.orders);
  const today = parisDate(now);
  const t = now.getTime();

  const orders = input.orders.map((o0) => {
    if (!OPEN_STATUSES.includes(o0.status)) return o0;
    // Supplément refusé à J-3 : rien à préparer (la commande est annulée à J-1 si rien ne change)
    if (o0.paymentStatus === "failed") return o0;
    // Jour J 15 h (ou jour passé) sans atelier : report au lendemain, puis remboursement au 3e essai
    const unplaced = !o0.acceptedAt && ["scheduled", "assigned"].includes(o0.status);
    if (unplaced && (o0.deliveryDate < today || (o0.deliveryDate === today && t >= parisAt(today, GUARANTEE.rolloverHour).getTime()))) return rollover(o0, ctx, today);
    if (o0.deliveryDate < today) return o0;
    let o = o0;
    const f = ctx.florist(o.floristId);

    // 1. Atelier attitré qui n'est plus en mesure de livrer (commande pas encore commencée)
    if (f && o.status === "assigned") {
      if (closedOn(f, o.deliveryDate)) {
        const late = o.acceptedAt && t >= parisAt(o.deliveryDate, 8).getTime() - hours(GUARANTEE.lateClosureH);
        if (late) ctx.strike(f.id, { id: `cl_${o.id}_${f.id}`, orderId: o.id, points: STRIKE_POINTS.lateClosure, reason: `Fermeture déclarée moins de 48 h avant le ${frShort(o.deliveryDate)}` });
        ctx.emit("closure", o, [f.id], "florist", `${f.shopName} est fermé le ${frShort(o.deliveryDate)} : ${label(o, ctx)} confiée à un atelier voisin.`);
        o = offer(release(o, ctx, "Atelier fermé ce jour-là"), ctx);
      } else if (!o.acceptedAt && (!f.active || isSuspended(ctx.live(f), now))) {
        o = offer(release(o, ctx, f.active ? "Atelier suspendu" : "Atelier en pause"), ctx);
      } else if (f.saasPlan === "free" && f.completedOrders >= 10 && t - new Date(o.offer?.at ?? o.statusAt.assigned ?? ctx.at).getTime() >= hours(GUARANTEE.lockedGraceH)) {
        ctx.emit("locked", o, [f.id], "florist", `${label(o, ctx)} confiée à un autre atelier : Moncleur Pro n'a pas été activé sous 24 h.`);
        o = offer(release(o, ctx, "Offre découverte terminée, Pro non activé"), ctx);
      }
    }

    // 2. Proposition à un atelier : rappel à 24 h, bascule à 48 h (ou à J-2 18 h)
    if (o.offer && !o.offer.open && !o.acceptedAt && o.floristId) {
      if (t >= new Date(o.offer.expiresAt).getTime()) {
        const fid = o.floristId;
        ctx.strike(fid, { id: `na_${o.id}_${fid}`, orderId: o.id, points: STRIKE_POINTS.noAnswer, reason: `Sans réponse à la proposition du ${frShort(o.deliveryDate)}` });
        ctx.emit("expired", o, [fid], "florist", `Sans réponse de votre part, ${label(o, ctx)} a été confiée à un autre atelier.`);
        o = offer(release(o, ctx, "Sans réponse dans les délais"), ctx);
      } else if (!o.offer.remindedAt && t >= new Date(o.offer.remindAt).getTime()) {
        ctx.emit("remind", o, [o.floristId], "florist", `Rappel : ${label(o, ctx)} attend votre confirmation. Sans réponse avant le ${fmtWhen(o.offer.expiresAt)}, elle sera proposée à un autre atelier.`);
        o = { ...o, offer: { ...o.offer, remindedAt: ctx.at } };
      }
    }

    // 3. Proposition urgente ouverte : au bout de 2 h, on élargit aux ateliers suivants
    if (o.offer?.open && !o.acceptedAt && t >= new Date(o.offer.expiresAt).getTime()) {
      const tried = o.offer.floristIds;
      o = offer({ ...o, declinedBy: [...new Set([...(o.declinedBy ?? []), ...tried])], offer: { ...o.offer } }, ctx, { urgent: true, bonusCents: o.offer.bonusCents });
    }

    // 4. Commande sans atelier ni proposition (nouvel atelier ouvert, capacité libérée…) : on réessaie
    if (!o.floristId && !o.offer && o.status === "scheduled") o = offer(o, ctx, { urgent: o.rescue });

    // 5. Jour J : « En préparation » ou « Prête » avant 11 h 00, alerte, puis réattribution critique à 11 h 30
    if (o.deliveryDate === today && o.floristId && o.acceptedAt && !floristStepDone(o)) {
      const fid = o.floristId;
      if (o.rescue) {
        // Atelier de secours : 1 h pour lancer la préparation, sinon l'équipe appelle
        const alert = "Reprise urgente pas encore en préparation : appeler l'atelier et prévenir l'abonné";
        if (t >= readyDeadline(o).getTime() && o.alert !== alert) {
          ctx.emit("rescue_late", o, [fid], "ops", `${label(o, ctx)} reprise par ${ctx.name(fid)} mais toujours pas en préparation. Appeler l'atelier.`);
          o = { ...o, alert };
        }
      } else if (t >= criticalDeadline(today).getTime()) {
        // CRITICAL_REASSIGN : transfert immédiat à un atelier de secours, prime +20 % retenue à l'atelier défaillant
        const bonus = rescueBonusCents(o);
        ctx.strike(fid, { id: `day_${fid}_${o.deliveryDate}`, orderId: o.id, points: STRIKE_POINTS.dayMissed, reason: `Commande du ${frShort(o.deliveryDate)} pas en préparation à 11 h 30` });
        ctx.debit(fid, { id: `rescue_${o.id}`, orderId: o.id, amountCents: bonus, reason: `Prime de secours (+20 %) pour le ${label(o, ctx)}` });
        ctx.emit("critical_reassign", o, [fid], "florist", `${label(o, ctx)} : aucune action à 11 h 30, commande transférée à un atelier de secours. La prime de secours (${eur(bonus)}) sera retenue sur vos prochains virements.`);
        ctx.emit("critical_reassign", o, [], "ops", `CRITICAL_REASSIGN : ${label(o, ctx)} retirée à ${ctx.name(fid)} (pas en préparation à 11 h 30).`);
        o = offer({ ...release(o, ctx, "CRITICAL_REASSIGN : pas en préparation à 11 h 30"), rescue: true, critical: true, photoUrl: undefined }, ctx, { urgent: true, bonusCents: bonus });
      } else if (!o.dayAlertedAt && t >= readyDeadline(o).getTime()) {
        ctx.emit("day_alert", o, [fid], "florist", `11 h : ${label(o, ctx)} n'est pas en préparation. Passez-la en préparation avant 11 h 30, sinon elle sera transférée à un atelier de secours.`);
        o = { ...o, dayAlertedAt: ctx.at };
      } else if (!o.dayRemindedAt && o.status === "assigned" && t >= parisAt(today, GUARANTEE.dayReminder.h, GUARANTEE.dayReminder.m).getTime() && t < readyDeadline(o).getTime()) {
        ctx.emit("day_reminder", o, [fid], "florist", `${label(o, ctx)} : préparation pas encore commencée. Elle doit être en préparation avant 11 h.`);
        o = { ...o, dayRemindedAt: ctx.at };
      }
    }

    // 6. Toujours pas d'atelier la veille au soir : l'abonné est prévenu
    const warnAt = parisAt(addDaysISO(o.deliveryDate, -GUARANTEE.customerWarning.daysBefore), GUARANTEE.customerWarning.h).getTime();
    if (!o.acceptedAt && !o.customerWarnedAt && ["scheduled", "assigned"].includes(o.status) && t >= warnAt) {
      ctx.emit("customer_warning", o, [], "customer", `Nous cherchons encore l'atelier qui composera votre ${label(o, ctx)}. Si personne n'est disponible, vous choisirez entre un report et un remboursement intégral.`);
      o = { ...o, customerWarnedAt: ctx.at };
    }
    return o;
  });

  return { orders, florists: ctx.floristsOut(), events: ctx.events };
}

/** Personne n'a pu prendre la livraison : report au lendemain, ou annulation remboursée au 3e essai. */
function rollover(o: Order, ctx: Run, today: string): Order {
  if (o.floristId) ctx.bump(o.deliveryDate, o.floristId, -1);
  const attempt = (o.attempt ?? 1) + 1;
  const original = o.originalDate ?? o.deliveryDate;
  if (attempt > GUARANTEE.maxAttempts) {
    ctx.emit("refund", o, [], "customer", `Aucun atelier n'a pu composer votre ${label(o, ctx)}, malgré trois tentatives. La livraison est annulée et remboursée intégralement. Toutes nos excuses.`);
    ctx.emit("alert", o, [], "ops", `${label(o, ctx)} annulée et remboursée : aucun atelier en ${GUARANTEE.maxAttempts} jours. Recruter dans la zone.`);
    return { ...o, status: "cancelled", floristId: null, offer: undefined, cancelReason: "Aucun atelier disponible : remboursé", refundDue: true, alert: undefined, statusAt: { ...o.statusAt, cancelled: ctx.at } };
  }
  const next = addDaysISO(today > o.deliveryDate ? today : o.deliveryDate, 1);
  const moved: Order = {
    ...o,
    status: "scheduled",
    floristId: null,
    offer: undefined,
    acceptedAt: undefined,
    deliveryDate: next,
    originalDate: original,
    attempt,
    // Le lendemain, tout le monde peut de nouveau être sollicité
    declinedBy: [],
    dayRemindedAt: undefined,
    issue: `Aucun atelier disponible le ${frShort(o.deliveryDate)} : livraison le ${frShort(next)}`,
    handoffs: [...(o.handoffs ?? []), { from: o.floristId, to: null, at: ctx.at, reason: `Reportée au ${frShort(next)}` }],
  };
  ctx.emit("rollover", o, [], "customer", `Aucun atelier n'a pu composer votre ${label(o, ctx)} aujourd'hui. Il sera livré demain, ${frShort(next)}, sans frais. Vous préférez un remboursement ? Un clic depuis votre carnet.`);
  // Prime de secours financée par Moncleur (aucun atelier défaillant à qui la retenir)
  return offer(moved, ctx, { urgent: true, bonusCents: rescueBonusCents(moved) });
}

export interface ResponseInput {
  orders: Order[];
  florists: Florist[];
  recipients: GuaranteeInput["recipients"];
  orderId: string;
  floristId: string;
  now?: Date;
}

/** L'atelier accepte une proposition (la sienne, ou une urgence ouverte : premier arrivé). */
export function acceptOffer(i: ResponseInput): GuaranteeResult & { error?: string } {
  const ctx = new Run(i.florists, i.recipients, i.now ?? new Date(), i.orders);
  const o = i.orders.find((x) => x.id === i.orderId);
  const f = ctx.florist(i.floristId);
  if (!o || !f) return { orders: i.orders, florists: i.florists, events: [], error: "Commande introuvable" };
  if (!isOfferedTo(o, f.id)) return { orders: i.orders, florists: i.florists, events: [], error: o.acceptedAt ? "Un autre atelier a déjà pris cette commande" : "Cette proposition n'est plus valable" };
  if (!canTake(f, o.deliveryDate, ctx.now) && o.floristId !== f.id) return { orders: i.orders, florists: i.florists, events: [], error: "Votre atelier n'est pas disponible ce jour-là" };
  const r = ctx.recipients.find((x) => x.id === o.recipientId);
  let next: Order;
  if (o.offer?.open) {
    if ((ctx.loadOf(o.deliveryDate)[f.id] ?? 0) >= (f.dailyCapacity ?? Infinity)) return { orders: i.orders, florists: i.florists, events: [], error: "Capacité du jour atteinte : augmentez-la dans Ma boutique" };
    ctx.bump(o.deliveryDate, f.id, 1);
    const handoffs = o.handoffs?.length && o.handoffs.at(-1)!.to === null ? [...o.handoffs.slice(0, -1), { ...o.handoffs.at(-1)!, to: f.id }] : o.handoffs;
    const bonus = o.offer.bonusCents ?? 0;
    next = {
      ...o,
      ...repriced(o, f, (o.bonusCents ?? 0) + bonus),
      floristId: f.id,
      status: "assigned",
      distanceKm: r ? Math.round(haversineKm(f, r) * 10) / 10 : o.distanceKm,
      acceptedAt: ctx.at,
      offer: undefined,
      alert: undefined,
      handoffs,
      statusAt: { ...o.statusAt, assigned: ctx.at },
    };
  } else {
    next = { ...o, acceptedAt: ctx.at, offer: undefined, alert: undefined };
  }
  ctx.emit("accepted", next, [f.id], "florist", `${f.shopName} a accepté le ${label(next, ctx)}.`);
  return { orders: i.orders.map((x) => (x.id === o.id ? next : x)), florists: i.florists, events: ctx.events };
}

/** L'atelier refuse : aucune pénalité, la commande passe tout de suite à l'atelier suivant. */
export function declineOffer(i: ResponseInput & { reason?: string }): GuaranteeResult & { error?: string } {
  const ctx = new Run(i.florists, i.recipients, i.now ?? new Date(), i.orders);
  const o = i.orders.find((x) => x.id === i.orderId);
  if (!o || !isOfferedTo(o, i.floristId)) return { orders: i.orders, florists: i.florists, events: [], error: "Cette proposition n'est plus valable" };
  let next: Order;
  if (o.offer?.open) {
    const left = o.offer.floristIds.filter((x) => x !== i.floristId);
    const declinedBy = [...new Set([...(o.declinedBy ?? []), i.floristId])];
    next = left.length ? { ...o, declinedBy, offer: { ...o.offer, floristIds: left } } : offer({ ...o, declinedBy }, ctx, { urgent: true, bonusCents: o.offer.bonusCents });
  } else {
    next = offer(release(o, ctx, i.reason ? `Refusée : ${i.reason}` : "Refusée par l'atelier"), ctx);
  }
  ctx.emit("declined", o, [i.floristId], "florist", `${ctx.name(i.floristId)} a refusé le ${label(o, ctx)}${i.reason ? ` (${i.reason})` : ""}.`);
  return { orders: i.orders.map((x) => (x.id === o.id ? next : x)), florists: i.florists, events: ctx.events };
}

/** Résumé de l'état de garantie d'une commande, pour l'affichage. */
export function guaranteeState(o: Order): "accepted" | "offered" | "reminded" | "urgent" | "alert" | "none" {
  if (o.alert) return "alert";
  if (o.acceptedAt) return "accepted";
  if (o.offer?.open) return "urgent";
  if (o.offer?.remindedAt) return "reminded";
  if (o.offer) return "offered";
  return "none";
}

/** Placement manuel par l'équipe (après un appel à l'atelier) : la commande est confirmée d'office. */
export function assignManually(o: Order, f: Florist, r: { lat: number; lng: number } | undefined, now: Date = new Date()): Order {
  const at = now.toISOString();
  const handoffs = o.floristId === f.id ? o.handoffs : [...(o.handoffs ?? []), { from: o.floristId, to: f.id, at, reason: "Placée par l'équipe Moncleur" }];
  return {
    ...o,
    ...repriced(o, f),
    floristId: f.id,
    status: "assigned",
    distanceKm: r ? Math.round(haversineKm(f, r) * 10) / 10 : o.distanceKm,
    acceptedAt: at,
    offer: undefined,
    alert: undefined,
    handoffs,
    statusAt: { ...o.statusAt, assigned: at },
  };
}

/**
 * Impute les retenues d'un atelier sur un virement (les plus anciennes d'abord).
 * Renvoie le montant net à verser et les retenues mises à jour.
 */
export function settleDebits(debits: Debit[] = [], payoutCents: number): { netCents: number; withheldCents: number; debits: Debit[] } {
  let left = payoutCents;
  const out = [...debits]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((d) => {
      const take = Math.min(d.remainingCents, left);
      left -= take;
      return take ? { ...d, remainingCents: d.remainingCents - take } : d;
    });
  return { netCents: left, withheldCents: payoutCents - left, debits: out };
}

/** Total restant à retenir sur les prochains virements. */
export const outstandingDebitCents = (f: Pick<Florist, "debits">) => (f.debits ?? []).reduce((s, d) => s + d.remainingCents, 0);
