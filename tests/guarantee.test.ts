import { describe, expect, it } from "vitest";
import { acceptBy, acceptOffer, addDaysISO, applyGuarantee, declineOffer, offerNew, parisAt, parisDate, settleDebits } from "@/lib/guarantee";
import { closedOn, frenchHolidays, isSuspended, rankFlorists } from "@/lib/matching";
import type { Florist, Order, Recipient } from "@/lib/types";

const H = 3600_000;
const point = { lat: 48.86, lng: 2.37 };
const recipient: Recipient = { id: "r1", customerId: "c", firstName: "Nina", lastName: "Roy", relation: "", address: "", postalCode: "75011", city: "Paris", phone: "", accessNotes: "", ...point };

const florist = (id: string, km: number, extra: Partial<Florist> = {}): Florist => ({
  id,
  shopName: id,
  ownerName: "",
  address: "",
  city: "",
  lat: point.lat + km / 111,
  lng: point.lng,
  radiusKm: 8,
  deliveryMode: "uber_direct",
  completedOrders: 50,
  saasPlan: "pro",
  dailyCapacity: 10,
  stripeConnected: true,
  active: true,
  ...extra,
});

const A = florist("A", 0.5);
const B = florist("B", 1.5);
const C = florist("C", 2.5);
const D = florist("D", 3.5);
const florists = [A, B, C, D];

// Lundi 2 novembre 2026, 9 h à Paris ; livraison le lundi suivant (J-7)
const now0 = parisAt("2026-11-02", 9);
const DATE = addDaysISO("2026-11-02", 7);

const draft = (over: Partial<Order> = {}): Order => ({
  id: "o1",
  scheduleId: "s1",
  recipientId: "r1",
  planId: "signature",
  payoutCents: 2000,
  deliveryDate: DATE,
  status: "scheduled",
  floristId: null,
  message: "",
  courier: "uber_direct",
  statusAt: {},
  ...over,
});

const first = (fl = florists, now = now0) => offerNew(draft(), { florists: fl, recipients: [recipient], orders: [], now }).order;
const tick = (orders: Order[], now: Date, fl = florists) => applyGuarantee({ orders, florists: fl, recipients: [recipient], now });

describe("heure de Paris", () => {
  it("convertit l'heure murale, été comme hiver", () => {
    expect(parisAt("2026-07-01", 11).toISOString()).toBe("2026-07-01T09:00:00.000Z");
    expect(parisAt("2026-12-01", 11).toISOString()).toBe("2026-12-01T10:00:00.000Z");
    expect(parisDate(new Date("2026-12-01T23:30:00Z"))).toBe("2026-12-02");
  });
});

describe("proposition J-7", () => {
  it("propose à l'atelier le plus proche avec 48 h pour répondre et un rappel à 24 h", () => {
    const o = first();
    expect(o.floristId).toBe("A");
    expect(o.acceptedAt).toBeUndefined();
    expect(new Date(o.offer!.remindAt).getTime() - now0.getTime()).toBe(24 * H);
    expect(new Date(o.offer!.expiresAt).getTime() - now0.getTime()).toBe(48 * H);
  });

  it("envoie un rappel à 24 h sans pénalité", () => {
    const r = tick([first()], new Date(now0.getTime() + 25 * H));
    expect(r.orders[0].offer!.remindedAt).toBeTruthy();
    expect(r.orders[0].floristId).toBe("A");
    expect(r.events.map((e) => e.kind)).toEqual(["remind"]);
    expect(r.florists.find((f) => f.id === "A")!.strikes ?? []).toHaveLength(0);
  });

  it("passe à l'atelier suivant à 48 h et compte un manquement", () => {
    const r = tick([first()], new Date(now0.getTime() + 49 * H));
    expect(r.orders[0].floristId).toBe("B");
    expect(r.orders[0].declinedBy).toEqual(["A"]);
    expect(r.orders[0].handoffs?.[0]).toMatchObject({ from: "A", to: "B" });
    expect(r.florists.find((f) => f.id === "A")!.strikes?.[0].points).toBe(1);
  });

  it("un refus passe tout de suite au suivant, sans pénalité", () => {
    const o = first();
    const r = declineOffer({ orders: [o], florists, recipients: [recipient], orderId: o.id, floristId: "A", now: new Date(now0.getTime() + H) });
    expect(r.orders[0].floristId).toBe("B");
    expect(r.florists.find((f) => f.id === "A")!.strikes ?? []).toHaveLength(0);
  });

  it("une acceptation confirme la commande", () => {
    const o = first();
    const r = acceptOffer({ orders: [o], florists, recipients: [recipient], orderId: o.id, floristId: "A", now: new Date(now0.getTime() + 2 * H) });
    expect(r.orders[0].acceptedAt).toBeTruthy();
    expect(r.orders[0].offer).toBeUndefined();
    // Plus rien ne bouge ensuite
    expect(tick(r.orders, new Date(now0.getTime() + 60 * H)).orders[0].floristId).toBe("A");
  });

  it("l'acceptation automatique prend la commande sans attendre", () => {
    const o = first([{ ...A, autoAccept: true }, B]);
    expect(o.acceptedAt).toBeTruthy();
  });

  it("ne dépasse jamais J-2 18 h, puis ouvre la commande à 3 ateliers", () => {
    const late = parisAt(addDaysISO(DATE, -3), 9);
    const o = first(florists, late);
    expect(new Date(o.offer!.expiresAt).getTime()).toBe(acceptBy(DATE).getTime());
    const r = tick([o], new Date(acceptBy(DATE).getTime() + 60_000));
    expect(r.orders[0].offer!.open).toBe(true);
    expect(r.orders[0].offer!.floristIds).toEqual(["B", "C", "D"]);
    // Le premier qui accepte la prend, les autres ne peuvent plus
    const won = acceptOffer({ orders: r.orders, florists, recipients: [recipient], orderId: "o1", floristId: "C", now: new Date(acceptBy(DATE).getTime() + 5 * 60_000) });
    expect(won.orders[0].floristId).toBe("C");
    expect(acceptOffer({ orders: won.orders, florists, recipients: [recipient], orderId: "o1", floristId: "B" }).error).toBeTruthy();
  });

  it("alerte l'équipe quand aucun atelier n'est disponible", () => {
    const o = first([{ ...A, active: false }]);
    expect(o.floristId).toBeNull();
    expect(o.alert).toMatch(/Aucun atelier/);
  });
});

describe("fermetures", () => {
  it("n'est jamais proposée un jour de fermeture ou de congés", () => {
    const wd = new Date(`${DATE}T12:00:00Z`).getUTCDay();
    expect(first([{ ...A, closedWeekdays: [wd] }, B]).floristId).toBe("B");
    expect(first([{ ...A, closures: [{ id: "c", from: DATE, to: DATE, declaredAt: now0.toISOString() }] }, B]).floristId).toBe("B");
    expect(closedOn({ closures: [{ id: "c", from: "2026-08-01", to: "2026-08-20", declaredAt: "" }] }, "2026-08-10")).toBe(true);
  });

  it("des congés déclarés après acceptation renvoient la commande chez un voisin", () => {
    const accepted = { ...first(), acceptedAt: now0.toISOString(), offer: undefined };
    const closedA = { ...A, closures: [{ id: "c", from: DATE, to: DATE, declaredAt: now0.toISOString() }] };
    const early = tick([accepted], new Date(now0.getTime() + 2 * H), [closedA, B, C, D]);
    expect(early.orders[0].floristId).toBe("B");
    expect(early.florists.find((f) => f.id === "A")!.strikes ?? []).toHaveLength(0);
    // Prévenu moins de 48 h avant : manquement
    const late = tick([accepted], parisAt(addDaysISO(DATE, -1), 9), [closedA, B, C, D]);
    expect(late.florists.find((f) => f.id === "A")!.strikes?.[0].points).toBe(1);
  });
});

describe("jour J", () => {
  const today = DATE;
  const accepted = (over: Partial<Order> = {}) => ({ ...first(), acceptedAt: now0.toISOString(), offer: undefined, ...over });

  it("rappelle à 9 h 30 si la préparation n'a pas commencé", () => {
    const r = tick([accepted()], parisAt(today, 9, 35));
    expect(r.events.map((e) => e.kind)).toContain("day_reminder");
    expect(r.orders[0].floristId).toBe("A");
  });

  it("11 h 00 : pas en préparation → alerte sonore + SMS, la commande reste à l'atelier", () => {
    const r = tick([accepted()], parisAt(today, 11, 1));
    expect(r.events.map((e) => e.kind)).toEqual(["day_alert"]);
    expect(r.orders[0].floristId).toBe("A");
    expect(r.orders[0].dayAlertedAt).toBeTruthy();
    expect(r.florists.find((f) => f.id === "A")!.strikes ?? []).toHaveLength(0);
    // L'alerte ne part qu'une fois
    expect(tick(r.orders, parisAt(today, 11, 15), r.florists).events).toHaveLength(0);
  });

  it("« En préparation » avant 11 h suffit, livreur maison compris", () => {
    expect(tick([accepted({ status: "preparing" })], parisAt(today, 11, 45)).orders[0].floristId).toBe("A");
    const own = { ...A, deliveryMode: "own" as const };
    expect(tick([{ ...accepted({ status: "preparing" }), courier: "own" as const }], parisAt(today, 11, 45), [own, B, C, D]).orders[0].floristId).toBe("A");
  });

  it("11 h 30 sans action : CRITICAL_REASSIGN, secours +20 % retenu sur les virements du défaillant", () => {
    const alerted = tick([accepted()], parisAt(today, 11, 1));
    const r = tick(alerted.orders, parisAt(today, 11, 31), alerted.florists);
    const o = r.orders[0];
    expect(o.floristId).toBeNull();
    expect(o.critical).toBe(true);
    expect(o.offer).toMatchObject({ open: true, floristIds: ["B", "C", "D"], bonusCents: 400 }); // 20 % de 20 €
    expect(r.events.map((e) => e.kind)).toContain("critical_reassign");
    const a = r.florists.find((f) => f.id === "A")!;
    expect(a.strikes?.[0].points).toBe(2);
    expect(a.debits?.[0]).toMatchObject({ amountCents: 400, remainingCents: 400 });
    const won = acceptOffer({ orders: r.orders, florists: r.florists, recipients: [recipient], orderId: o.id, floristId: "B", now: parisAt(today, 11, 35) });
    expect(won.orders[0].payoutCents).toBe(2400);
  });

  it("retenue imputée sur les prochains virements, les plus anciennes d'abord", () => {
    const debits = [
      { id: "d1", orderId: "x", amountCents: 400, remainingCents: 400, reason: "", at: "2026-11-01T10:00:00Z" },
      { id: "d2", orderId: "y", amountCents: 1000, remainingCents: 1000, reason: "", at: "2026-11-02T10:00:00Z" },
    ];
    const r = settleDebits(debits, 1000);
    expect(r.netCents).toBe(0);
    expect(r.withheldCents).toBe(1000);
    expect(r.debits.map((d) => d.remainingCents)).toEqual([0, 400]);
    expect(settleDebits(r.debits, 2000).netCents).toBe(1600);
  });

  it("un seul manquement par atelier et par jour, une retenue par commande", () => {
    const o1 = accepted({ id: "o1" });
    const o2 = accepted({ id: "o2", scheduleId: "s2" });
    const r = tick([o1, o2], parisAt(today, 11, 31));
    const a = r.florists.find((f) => f.id === "A")!;
    expect(a.strikes).toHaveLength(1);
    expect(a.debits).toHaveLength(2);
  });

  it("l'atelier de secours a 1 h pour lancer la préparation, sinon l'équipe est alertée", () => {
    const r = tick([accepted()], parisAt(today, 11, 31));
    const won = acceptOffer({ orders: r.orders, florists: r.florists, recipients: [recipient], orderId: "o1", floristId: "B", now: parisAt(today, 11, 40) });
    expect(tick(won.orders, parisAt(today, 12, 30), r.florists).orders[0].floristId).toBe("B");
    const late = tick(won.orders, parisAt(today, 12, 45), r.florists);
    expect(late.events.map((e) => e.kind)).toContain("rescue_late");
    expect(late.orders[0].floristId).toBe("B");
  });
});

describe("fiabilité", () => {
  it("suspend les nouvelles propositions à 3 points sur 30 jours", () => {
    const strikes = [
      { id: "1", at: new Date(now0.getTime() - 5 * 86400_000).toISOString(), orderId: "x", points: 2, reason: "" },
      { id: "2", at: new Date(now0.getTime() - 2 * 86400_000).toISOString(), orderId: "y", points: 1, reason: "" },
    ];
    const bad = { ...A, strikes };
    expect(isSuspended(bad, now0)).toBe(true);
    expect(rankFlorists([bad, B], point, {}, { now: now0 })[0].florist.id).toBe("B");
    // Levée par l'équipe
    expect(isSuspended({ ...bad, strikesClearedAt: now0.toISOString() }, now0)).toBe(false);
  });
});

describe("cas limites", () => {
  const today = DATE;
  const accepted = (over: Partial<Order> = {}) => ({ ...first(), acceptedAt: now0.toISOString(), offer: undefined, ...over });

  it("un supplément refusé ne déclenche pas la règle de 11 h", () => {
    const r = tick([accepted({ paymentStatus: "failed" })], parisAt(today, 11, 35));
    expect(r.orders[0].floristId).toBe("A");
    expect(r.florists.find((f) => f.id === "A")!.strikes ?? []).toHaveLength(0);
  });

  it("jours fériés : Pâques, Ascension, Pentecôte calculés, fermeture optionnelle", () => {
    const h = frenchHolidays(2027);
    expect(h.has("2027-03-29")).toBe(true); // lundi de Pâques 2027
    expect(h.has("2027-05-06")).toBe(true); // Ascension
    expect(h.has("2027-05-17")).toBe(true); // lundi de Pentecôte
    expect(closedOn({ closedOnHolidays: true }, "2026-11-11")).toBe(true);
    expect(closedOn({}, "2026-11-11")).toBe(false);
  });

  it("jour J 15 h sans atelier : report au lendemain, puis remboursement au 3e essai", () => {
    const lonely = [{ ...A, active: false }];
    const o = { ...draft(), deliveryDate: today };
    const r1 = tick([o], parisAt(today, 15, 1), lonely);
    expect(r1.orders[0].deliveryDate).toBe(addDaysISO(today, 1));
    expect(r1.orders[0].originalDate).toBe(today);
    expect(r1.orders[0].attempt).toBe(2);
    expect(r1.events.map((e) => e.kind)).toContain("rollover");
    const r2 = tick(r1.orders, parisAt(addDaysISO(today, 1), 15, 1), lonely);
    expect(r2.orders[0].attempt).toBe(3);
    const r3 = tick(r2.orders, parisAt(addDaysISO(today, 2), 15, 1), lonely);
    expect(r3.orders[0].status).toBe("cancelled");
    expect(r3.orders[0].refundDue).toBe(true);
    expect(r3.events.map((e) => e.kind)).toContain("refund");
  });

  it("un report retrouve un atelier le lendemain", () => {
    const nextDay = addDaysISO(today, 1);
    const wd = new Date(`${today}T12:00:00Z`).getUTCDay();
    const fl = [{ ...A, closedWeekdays: [wd] }];
    const r = tick([{ ...draft(), deliveryDate: today }], parisAt(today, 15, 1), fl);
    expect(r.orders[0].deliveryDate).toBe(nextDay);
    expect(r.orders[0].offer?.open).toBe(true);
    expect(r.orders[0].offer?.floristIds).toEqual(["A"]);
  });

  it("fidélité : l'atelier habituel du destinataire passe devant s'il est presque aussi proche", () => {
    const past: Order = { ...draft({ id: "old", deliveryDate: "2026-10-01", status: "delivered", floristId: "B" }) };
    const o = offerNew(draft(), { florists, recipients: [recipient], orders: [past], now: now0 }).order;
    expect(o.floristId).toBe("B");
    const far = offerNew(draft(), { florists, recipients: [recipient], orders: [{ ...past, floristId: "D" }], now: now0 }).order;
    expect(far.floristId).toBe("A");
  });
});
