import { describe, expect, it } from "vitest";
import { CATALOG } from "@/lib/catalog";
import { addDays, iso, parseISO, startOfDay } from "@/lib/dates";
import { publicCode, syncOrders } from "@/lib/engine";
import { parseICS, parseVCard } from "@/lib/import-dates";
import { matchFlorist } from "@/lib/matching";
import {
  canRetract,
  carnetIssues,
  carnetMonthlyCents,
  isPeakDate,
  occasionSurchargeCents,
  orderKey,
  planOccurrences,
  subscriberPriceCents,
  unitEconomics,
} from "@/lib/pricing";
import { buildSeed } from "@/lib/seed";
import type { Schedule, Subscription } from "@/lib/types";

const today = startOfDay();
const mmdd = (d: Date) => iso(d).slice(5);

describe("prix abonné", () => {
  it("applique −15 % sur chaque gamme", () => {
    expect(CATALOG.map((r) => subscriberPriceCents(r.planId, CATALOG))).toEqual([2465, 4165, 6715]);
  });

  it("calcule la mensualité du Carnet sur les dates choisies", () => {
    const four = Array.from({ length: 4 }, () => ({ planId: "signature" as const, active: true, type: "birthday" as const }));
    expect(carnetMonthlyCents(four, CATALOG)).toBe(1389); // 4 × 41,65 € ÷ 12, arrondi au centime supérieur
  });
});

describe("économie unitaire", () => {
  it("garde une marge positive sur chaque bouquet, livraison et paiement compris", () => {
    for (const r of CATALOG) {
      for (const revenue of [r.priceCents, subscriberPriceCents(r.planId, CATALOG)]) {
        expect(unitEconomics({ revenueCents: revenue, payoutCents: r.floristPayoutCents, courier: "uber_direct" }).marginCents).toBeGreaterThan(0);
      }
    }
  });

  it("majore la livraison les jours de pic", () => {
    const normal = unitEconomics({ revenueCents: 4900, payoutCents: 2000, courier: "uber_direct", date: "2027-02-13" });
    const peak = unitEconomics({ revenueCents: 4900, payoutCents: 2000, courier: "uber_direct", date: "2027-02-14" });
    expect(peak.deliveryCents).toBeGreaterThan(normal.deliveryCents);
    expect(isPeakDate("2027-05-30")).toBe(true); // fête des mères 2027
    expect(isPeakDate("2027-06-20")).toBe(true); // fête des pères 2027
  });
});

describe("livraisons planifiées", () => {
  const s = buildSeed(today);

  const monthlySub: Subscription = { id: "sub_t", customerId: "me", planType: "MONTHLY_RECURRING", planId: "signature", commitmentMonths: 0, startedAt: iso(addDays(today, -40)), status: "active" };
  const sch = (over: Partial<Schedule>): Schedule => ({ id: "s_m", subscriptionId: "sub_t", recipientId: "r_t", planId: "signature", type: "monthly", dayOfMonth: 3, label: "Bouquet du mois", message: "", active: true, mode: "surprise", ...over });
  const plan = (schedules: Schedule[]) => planOccurrences({ subscriptions: [monthlySub], schedules, overrides: {}, orders: [], catalog: CATALOG }, today, addDays(today, 400));

  it("supplément occasion = +30 % de la formule : 8,70 / 14,70 / 23,70 €", () => {
    expect(CATALOG.map((r) => occasionSurchargeCents(r.planId, CATALOG))).toEqual([870, 1470, 2370]);
  });

  it("une occasion remplace le bouquet de son mois, même loin dans le mois, pour +30 %", () => {
    const occ = plan([sch({}), sch({ id: "s_v", type: "valentine", label: "Saint-Valentin" })]);
    const val = occ.find((e) => e.type === "valentine")!;
    const febMonthly = occ.find((e) => e.type === "monthly" && e.date.slice(0, 7) === val.date.slice(0, 7))!;
    expect(febMonthly.status).toBe("absorbed");
    expect(val.status).toBe("planned");
    expect(val.lines.map((l) => [l.kind, l.amountCents])).toEqual([["occasion", 1470]]);
    expect(val.revenueCents).toBe(4900 + 1470);
    // 12 bouquets sur 12 mois au total, occasion comprise
    const year = occ.filter((e) => e.status === "planned" && e.date < iso(addDays(today, 365)));
    const months = new Set(year.map((e) => e.date.slice(0, 7)));
    expect(year.length).toBe(months.size);
  });

  it("deux occasions le même mois : la seconde est refusée", () => {
    const occ = plan([sch({}), sch({ id: "s_v", type: "valentine", label: "Saint-Valentin" }), sch({ id: "s_b", type: "birthday", date: "02-20", label: "Anniversaire" })]);
    const b = occ.find((e) => e.scheduleId === "s_b")!;
    expect(b.status).toBe("blocked");
    expect(b.blockReason).toMatch(/Saint-Valentin/);
  });

  it("occasion d'un mois dont le bouquet est déjà parti : reportée à l'année suivante", () => {
    const ym = iso(today).slice(0, 7);
    const sent = { id: "o", scheduleId: "s_m", recipientId: "r_t", subscriptionId: "sub_t", planId: "signature" as const, deliveryDate: `${ym}-01`, status: "delivered" as const, floristId: "f", message: "", courier: "own" as const, statusAt: {} };
    const later = addDays(today, 3);
    const occ = planOccurrences({ subscriptions: [monthlySub], schedules: [sch({}), sch({ id: "s_c", type: "custom", date: mmdd(later), label: "Rencontre" })], overrides: {}, orders: [sent], catalog: CATALOG }, today, addDays(today, 400));
    const thisYear = occ.find((e) => e.scheduleId === "s_c" && e.date === iso(later))!;
    if (iso(later).slice(0, 7) === ym) expect(thisYear.status).toBe("blocked");
    expect(occ.filter((e) => e.scheduleId === "s_c" && e.status === "planned").length).toBeGreaterThan(0);
  });

  it("limite le Carnet à un bouquet par mois", () => {
    const extra: Schedule = { id: "s_x", subscriptionId: "sub_lea", recipientId: "r_lea", planId: "signature", type: "custom", date: "02-20", label: "Rencontre", message: "", active: true, mode: "surprise" };
    expect(carnetIssues([...s.schedules.filter((x) => x.subscriptionId === "sub_lea"), extra])).toHaveLength(1);
    const occ = planOccurrences({ ...s, schedules: [...s.schedules, extra] }, today, addDays(today, 365)).filter((e) => e.subscriptionId === "sub_lea");
    expect(occ.find((e) => e.label === "Rencontre")!.status).toBe("blocked");
  });

  it("prélève à part une date de Carnet ajoutée en cours d'année", () => {
    const added: Schedule = { id: "s_late", subscriptionId: "sub_lea", recipientId: "r_lea", planId: "classique", type: "custom", date: mmdd(addDays(today, 40)), label: "Ajoutée", message: "", active: true, mode: "surprise", addedAt: iso(today) };
    const e = planOccurrences({ ...s, schedules: [...s.schedules, added] }, today, addDays(today, 60)).find((x) => x.scheduleId === "s_late")!;
    expect(e.billing).toBe("carnet_added");
    expect(e.priceCents).toBe(2465);
  });

  it("attribue chaque date de Carnet à sa propre taille", () => {
    const lea = planOccurrences(s, today, addDays(today, 365)).filter((e) => e.subscriptionId === "sub_lea");
    expect(lea.find((e) => e.type === "birthday")!.plan).toBe("prestige");
    expect(lea.find((e) => e.type === "valentine")!.plan).toBe("signature");
  });
});

describe("opérations", () => {
  it("respecte la capacité journalière des ateliers", () => {
    const f = { ...buildSeed().florists[0], dailyCapacity: 2 };
    expect(matchFlorist([f], f, { [f.id]: 1 })).not.toBeNull();
    expect(matchFlorist([f], f, { [f.id]: 2 })).toBeNull();
  });

  it("garde la clé d'origine après une nouvelle tentative de livraison", () => {
    expect(orderKey({ scheduleId: "s1", deliveryDate: "2026-10-21", originalDate: "2026-10-20" })).toBe("s1@2026-10-20");
  });

  it("ne recrée pas de commande en double", () => {
    const s = buildSeed(today);
    const once = syncOrders(s);
    const twice = syncOrders({ ...s, orders: once });
    expect(twice).toHaveLength(once.length);
  });

  it("génère des codes de carte stables et lisibles", () => {
    expect(publicCode("ord_abc")).toBe(publicCode("ord_abc"));
    expect(publicCode("ord_abc")).toMatch(/^[A-Z2-9]{6}$/);
  });
});

describe("juridique", () => {
  const sub: Subscription = { id: "x", customerId: "me", planType: "SPECIAL_EVENTS_CARNET", planId: "signature", commitmentMonths: 12, startedAt: iso(addDays(today, -5)), status: "active" };
  it("autorise la rétractation dans les 14 jours sans livraison", () => {
    expect(canRetract(sub, [])).toBe(true);
    expect(canRetract(sub, [{ subscriptionId: "x", status: "delivered" }])).toBe(false);
    expect(canRetract({ ...sub, startedAt: iso(addDays(today, -20)) }, [])).toBe(false);
  });
});

describe("import de dates", () => {
  it("lit les anniversaires d'un fichier de contacts", () => {
    const vcf = "BEGIN:VCARD\nFN:Thomas Martin\nBDAY:1992-11-02\nEND:VCARD\nBEGIN:VCARD\nFN:Sans Date\nEND:VCARD";
    expect(parseVCard(vcf)).toEqual([{ name: "Thomas", date: "11-02", type: "birthday", label: "Anniversaire de Thomas Martin" }]);
  });
  it("lit les événements annuels d'un agenda", () => {
    const ics = "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Anniversaire de Sophie\nDTSTART;VALUE=DATE:19950308\nRRULE:FREQ=YEARLY\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Réunion\nDTSTART:20261014T090000\nEND:VEVENT\nEND:VCALENDAR";
    const r = parseICS(ics);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: "Sophie", date: "03-08", type: "birthday" });
  });
});

void parseISO;

describe("jours de pic", () => {
  it("donne la priorité aux ateliers qui livrent eux-mêmes", () => {
    const [a, , c] = buildSeed().florists;
    const near = { ...a, deliveryMode: "uber_direct" as const, lat: 48.86, lng: 2.35, radiusKm: 10 };
    const far = { ...c, deliveryMode: "own" as const, lat: 48.87, lng: 2.35, radiusKm: 10 };
    const point = { lat: 48.86, lng: 2.35 };
    expect(matchFlorist([near, far], point)!.florist.id).toBe(near.id);
    expect(matchFlorist([near, far], point, {}, { preferOwnDelivery: true })!.florist.id).toBe(far.id);
  });
});
