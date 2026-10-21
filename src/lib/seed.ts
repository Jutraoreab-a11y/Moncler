import { CATALOG, getRecipe } from "./catalog";
import { addDays, iso, parseISO, startOfDay } from "./dates";
import { haversineKm } from "./matching";
import { MODELS, pickModel } from "./models";
import { EXTRA_STEMS } from "./pricing";
import { publicCode } from "./engine";
import { carnetMonthlyCents } from "./pricing";
import type { GuaranteeEvent } from "./guarantee";
import type { Reminder, BouquetModel, Customer, Florist, OccurrenceOverride, Order, OrderStatus, Payout, Recipe, Recipient, Schedule, Subscription } from "./types";

export interface AppState {
  version: number;
  customer: Customer;
  recipients: Recipient[];
  subscriptions: Subscription[];
  schedules: Schedule[];
  /** Réglages ponctuels par livraison (surclassement, extra, garder deux livraisons) */
  overrides: Record<string, OccurrenceOverride>;
  orders: Order[];
  florists: Florist[];
  payouts: Payout[];
  catalog: Recipe[];
  models: BouquetModel[];
  /** Rappels gratuits (sans abonnement) */
  reminders: Reminder[];
  /** Liste d'attente des zones pas encore couvertes */
  waitlist: { email: string; postalCode: string; at: string }[];
  /** Journal de la garantie de livraison (propositions, rappels, bascules) */
  guaranteeLog: GuaranteeEvent[];
  currentFloristId: string;
}

export const STATE_VERSION = 8;

export const FLORISTS: Florist[] = [
  {
    id: "f_petale",
    dailyCapacity: 8,
    shopName: "Atelier Pétale",
    ownerName: "Inès Ferrand",
    address: "112 rue Oberkampf",
    city: "75011 Paris",
    lat: 48.8655,
    lng: 2.378,
    radiusKm: 6,
    deliveryMode: "uber_direct",
    completedOrders: 7,
    saasPlan: "free",
    stripeConnected: true,
    active: true,
  },
  {
    id: "f_lierre",
    dailyCapacity: 15,
    shopName: "Maison Lierre",
    ownerName: "Paul Garnier",
    address: "41 rue Cler",
    city: "75007 Paris",
    lat: 48.8566,
    lng: 2.306,
    radiusKm: 5,
    deliveryMode: "stuart",
    autoAccept: true,
    closedWeekdays: [0],
    completedOrders: 46,
    saasPlan: "pro",
    stripeConnected: true,
    active: true,
  },
  {
    id: "f_montmartre",
    dailyCapacity: 20,
    shopName: "Les Jardins d'Abbesses",
    ownerName: "Sofia Benali",
    address: "18 rue des Abbesses",
    city: "75018 Paris",
    lat: 48.8846,
    lng: 2.3384,
    radiusKm: 7,
    deliveryMode: "own",
    autoAccept: true,
    closedWeekdays: [1],
    completedOrders: 112,
    saasPlan: "pro",
    stripeConnected: true,
    active: true,
  },
  {
    id: "f_auteuil",
    dailyCapacity: 6,
    shopName: "Fleurs d'Auteuil",
    ownerName: "Marc Olivier",
    address: "9 rue d'Auteuil",
    city: "75016 Paris",
    lat: 48.8477,
    lng: 2.2681,
    radiusKm: 5,
    deliveryMode: "uber_direct",
    completedOrders: 10,
    saasPlan: "free",
    stripeConnected: false,
    active: true,
  },
];

const R = (
  id: string,
  customerId: string,
  firstName: string,
  lastName: string,
  relation: string,
  address: string,
  postalCode: string,
  lat: number,
  lng: number,
  accessNotes = "",
): Recipient => ({
  id,
  customerId,
  firstName,
  lastName,
  relation,
  address,
  postalCode,
  city: "Paris",
  lat,
  lng,
  phone: "06 12 34 56 78",
  accessNotes,
});

export function buildSeed(today = startOfDay()): AppState {
  const t = (n: number) => addDays(today, n);
  const mmdd = (d: Date) => iso(d).slice(5);

  const recipients: Recipient[] = [
    R("r_maman", "me", "Hélène", "Martin", "Maman", "22 rue de la Roquette", "75011", 48.8553, 2.3728, "Code 4B21, 3e étage gauche"),
    R("r_lea", "me", "Léa", "Dubois", "Mon amour", "14 rue des Martyrs", "75009", 48.8782, 2.3397, "Interphone « Dubois »"),
    R("r_jeanne", "me", "Jeanne", "Martin", "Mamie", "5 rue Saint-Dominique", "75007", 48.8592, 2.3138, "Gardienne au RDC si absente"),
    // Destinataires d'autres abonnés (vue fleuriste)
    R("r_x1", "c_2", "Nora", "Haddad", "Amie", "7 rue de Charonne", "75011", 48.8531, 2.3779),
    R("r_x2", "c_3", "Claire", "Lemoine", "Sœur", "31 avenue Parmentier", "75011", 48.8627, 2.3726, "Digicode 1987"),
    R("r_x3", "c_4", "Agathe", "Roux", "Maman", "3 rue Saint-Maur", "75011", 48.8618, 2.3822),
    R("r_x4", "c_5", "Julien", "Petit", "Client", "60 boulevard Voltaire", "75011", 48.8608, 2.3727),
    R("r_x5", "c_6", "Emma", "Leroy", "Amie", "12 rue Oberkampf", "75011", 48.8649, 2.3684),
  ];

  const ago = (n: number) => iso(addDays(today, -n));
  const subscriptions: Subscription[] = [
    // Camille : deux mensuels et un carnet
    { id: "sub_maman", customerId: "me", planType: "MONTHLY_RECURRING", planId: "signature", commitmentMonths: 0, recipientId: "r_maman", startedAt: ago(160), status: "active" },
    { id: "sub_jeanne", customerId: "me", planType: "MONTHLY_RECURRING", planId: "classique", commitmentMonths: 0, recipientId: "r_jeanne", startedAt: ago(150), status: "active" },
    { id: "sub_lea", customerId: "me", planType: "SPECIAL_EVENTS_CARNET", planId: "signature", commitmentMonths: 12, startedAt: ago(100), status: "active" },
    // Autres abonnés (vue fleuriste)
    { id: "sub_x1", customerId: "c_2", planType: "MONTHLY_RECURRING", planId: "classique", commitmentMonths: 0, recipientId: "r_x1", startedAt: ago(90), status: "active" },
    { id: "sub_x2", customerId: "c_3", planType: "SPECIAL_EVENTS_CARNET", planId: "signature", commitmentMonths: 12, startedAt: ago(200), status: "active" },
    { id: "sub_x3", customerId: "c_4", planType: "MONTHLY_RECURRING", planId: "prestige", commitmentMonths: 0, recipientId: "r_x3", startedAt: ago(60), status: "active" },
    { id: "sub_x4", customerId: "c_5", planType: "MONTHLY_RECURRING", planId: "classique", commitmentMonths: 0, recipientId: "r_x4", startedAt: ago(40), status: "active" },
    { id: "sub_x5", customerId: "c_6", planType: "SPECIAL_EVENTS_CARNET", planId: "signature", commitmentMonths: 12, startedAt: ago(20), status: "active" },
  ];

  const schedules: Schedule[] = [
    // Mensuel Signature pour Hélène + fête des mères surclassée en Prestige (occasion +30 %)
    { id: "s_maman_m", subscriptionId: "sub_maman", recipientId: "r_maman", planId: "signature", type: "monthly", dayOfMonth: t(1).getDate(), label: "Bouquet du mois", message: "Une pensée pour toi, comme chaque mois. Je t'embrasse — Camille", active: true, mode: "surprise" },
    { id: "s_maman_fdm", subscriptionId: "sub_maman", recipientId: "r_maman", planId: "signature", type: "mothers_day", label: "Fête des mères", message: "Bonne fête Maman ❤", active: true, mode: "fixed", modelId: "m_grand_siecle", upgradeTo: "prestige" },
    // Mensuel Classique pour Jeanne + anniversaire 2 jours après le mensuel → fusion
    { id: "s_jeanne_m", subscriptionId: "sub_jeanne", recipientId: "r_jeanne", planId: "classique", type: "monthly", dayOfMonth: t(9).getDate(), label: "Petit bonjour mensuel", message: "Pour ma Mamie préférée.", active: true, mode: "fixed", modelId: "m_rose_poudre" },
    { id: "s_jeanne_bday", subscriptionId: "sub_jeanne", recipientId: "r_jeanne", planId: "classique", type: "birthday", date: mmdd(t(11)), label: "Anniversaire de Mamie", message: "Joyeux anniversaire Mamie, 90 ans ça se fête !", active: true, mode: "fixed", modelId: "m_rose_poudre", extraStemId: "david_austin" },
    // Carnet de Léa : anniversaire en Prestige, Saint-Valentin en Signature
    { id: "s_lea_bday", subscriptionId: "sub_lea", recipientId: "r_lea", planId: "prestige", type: "birthday", date: mmdd(t(4)), label: "Anniversaire de Léa", message: "Joyeux anniversaire mon cœur. Tout ce qui fleurit me fait penser à toi.", active: true, mode: "fixed", modelId: "m_pivoine_reine" },
    { id: "s_lea_val", subscriptionId: "sub_lea", recipientId: "r_lea", planId: "signature", type: "valentine", label: "Saint-Valentin", message: "Toujours toi.", active: true, mode: "fixed", modelId: "m_jardin_ete" },
    // Autres abonnés
    { id: "s_x1", subscriptionId: "sub_x1", recipientId: "r_x1", planId: "classique", type: "monthly", dayOfMonth: today.getDate(), label: "Mensuel", message: "Belle journée Nora !", active: true, mode: "surprise" },
    { id: "s_x2", subscriptionId: "sub_x2", recipientId: "r_x2", planId: "signature", type: "birthday", date: mmdd(today), label: "Anniversaire", message: "Joyeux anniversaire petite sœur 🎉", active: true, mode: "fixed", modelId: "m_corail" },
    { id: "s_x3", subscriptionId: "sub_x3", recipientId: "r_x3", planId: "prestige", type: "monthly", dayOfMonth: t(1).getDate(), label: "Mensuel", message: "Je t'aime Maman.", active: true, mode: "surprise" },
    { id: "s_x4", subscriptionId: "sub_x4", recipientId: "r_x4", planId: "classique", type: "monthly", dayOfMonth: t(3).getDate(), label: "Mensuel", message: "Merci pour tout.", active: true, mode: "fixed", modelId: "m_blanc_coton", extraStemId: "pivoines" },
    { id: "s_x5", subscriptionId: "sub_x5", recipientId: "r_x5", planId: "signature", type: "custom", date: mmdd(t(6)), label: "Crémaillère", message: "Bienvenue chez toi !", active: true, mode: "surprise" },
  ];
  void EXTRA_STEMS;
  // Montant prélevé chaque mois : prix de la gamme (Mensuel) ou mensualité calculée (Carnet)
  for (const sub of subscriptions) {
    sub.priceCents =
      sub.planType === "SPECIAL_EVENTS_CARNET"
        ? carnetMonthlyCents(schedules.filter((x) => x.subscriptionId === sub.id), CATALOG)
        : getRecipe(sub.planId).priceCents;
  }

  const orders: Order[] = [];
  const payouts: Payout[] = [];
  const stamp = (d: Date, h: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 12).toISOString();

  // Historique client : 5 mois de bouquets livrés
  const history: [string, string, number][] = [
    ["s_maman_m", "r_maman", 1],
    ["s_jeanne_m", "r_jeanne", 9],
  ];
  for (let m = 5; m >= 1; m--) {
    for (const [sid, rid, offset] of history) {
      const d = addDays(today, offset - 30 * m);
      const s = schedules.find((x) => x.id === sid)!;
      const rec = recipients.find((x) => x.id === rid)!;
      const fid = rid === "r_jeanne" ? "f_lierre" : "f_petale";
      const f = FLORISTS.find((x) => x.id === fid)!;
      const id = `ord_${sid}_${iso(d).replaceAll("-", "")}`;
      orders.push({
        id,
        scheduleId: sid,
        recipientId: rid,
        planId: s.planId,
        subscriptionId: s.subscriptionId,
        billing: "included",
        priceCents: 0,
        revenueCents: getRecipe(s.planId).priceCents,
        payoutCents: getRecipe(s.planId).floristPayoutCents,
        paymentStatus: "included",
        publicCode: publicCode(id),
        attempt: 1,
        modelId: pickModel(s, MODELS, orders),
        mode: s.mode,
        deliveryDate: iso(d),
        status: "delivered",
        floristId: fid,
        message: s.message,
        courier: f.deliveryMode,
        distanceKm: Math.round(haversineKm(f, rec) * 10) / 10,
        statusAt: { assigned: stamp(addDays(d, -7), 9), preparing: stamp(d, 8), ready: stamp(d, 10), delivered: stamp(d, 11) },
      });
      payouts.push({
        id: `po_${id}`,
        floristId: fid,
        orderId: id,
        amountCents: getRecipe(s.planId).floristPayoutCents,
        createdAt: stamp(d, 12),
        status: "paid",
      });
    }
  }

  // Le dernier bouquet d'Hélène a reçu un merci (boucle émotionnelle du carnet)
  const lastMaman = [...orders].reverse().find((o) => o.recipientId === "r_maman");
  if (lastMaman) lastMaman.thanks = { text: "Il est sublime, il illumine tout le salon. Merci ma chérie ❤", at: stamp(addDays(parseISO(lastMaman.deliveryDate), 0), 19) };

  // Commandes du jour côté fleuriste (Atelier Pétale), à différents stades.
  // Après 10 h 30, elles sont déjà parties : la règle de 11 h ne s'applique qu'aux oublis réels.
  const late = new Date().getHours() * 60 + new Date().getMinutes() >= 10 * 60 + 30;
  const today_orders: [string, string, OrderStatus][] = [
    ["s_x1", "r_x1", late ? "in_delivery" : "preparing"],
    ["s_x2", "r_x2", late ? "in_delivery" : "assigned"],
  ];
  for (const [sid, rid, status] of today_orders) {
    const s = schedules.find((x) => x.id === sid)!;
    const rec = recipients.find((x) => x.id === rid)!;
    const f = FLORISTS[0];
    orders.push({
      id: `ord_${sid}_${iso(today).replaceAll("-", "")}`,
      scheduleId: sid,
      recipientId: rid,
      planId: s.planId,
      subscriptionId: s.subscriptionId,
      billing: "included",
      priceCents: 0,
      revenueCents: getRecipe(s.planId).priceCents,
      payoutCents: getRecipe(s.planId).floristPayoutCents,
      paymentStatus: "included",
      publicCode: publicCode(`ord_${sid}`),
      attempt: 1,
      modelId: pickModel(s, MODELS, orders),
      mode: s.mode,
      deliveryDate: iso(today),
      status,
      floristId: f.id,
      message: s.message,
      courier: f.deliveryMode,
      distanceKm: Math.round(haversineKm(f, rec) * 10) / 10,
      priority: sid === "s_x2",
      acceptedAt: stamp(addDays(today, -6), 10),
      statusAt: { assigned: stamp(addDays(today, -6), 9), ...(status !== "assigned" ? { preparing: new Date().toISOString() } : {}) },
    });
  }

  // Proposition envoyée il y a 30 h à Atelier Pétale, toujours sans réponse : le rappel part au chargement
  {
    const s = schedules.find((x) => x.id === "s_x4")!;
    const rec = recipients.find((x) => x.id === "r_x4")!;
    const f = FLORISTS[0];
    const d = iso(t(3));
    const id = `ord_s_x4_${d.replaceAll("-", "")}`;
    const h = (n: number) => new Date(Date.now() + n * 3600_000).toISOString();
    orders.push({
      id,
      scheduleId: s.id,
      recipientId: rec.id,
      planId: s.planId,
      subscriptionId: s.subscriptionId,
      payoutCents: getRecipe(s.planId).floristPayoutCents,
      publicCode: publicCode(id),
      attempt: 1,
      modelId: pickModel(s, MODELS, orders),
      mode: s.mode,
      deliveryDate: d,
      status: "assigned",
      floristId: f.id,
      message: s.message,
      courier: f.deliveryMode,
      distanceKm: Math.round(haversineKm(f, rec) * 10) / 10,
      offer: { floristIds: [f.id], at: h(-30), remindAt: h(-6), expiresAt: h(18), open: false, round: 1 },
      statusAt: { scheduled: h(-30), assigned: h(-30) },
    });
  }

  // Revenus fleuristes Pro (historique pour l'admin)
  const extra: [string, number][] = [
    ["f_lierre", 38],
    ["f_montmartre", 104],
    ["f_auteuil", 10],
  ];
  for (const [fid, n] of extra) {
    for (let i = 0; i < n; i++) {
      const plan = CATALOG[i % 3].planId;
      const d = addDays(today, -1 - Math.floor((i * 150) / n));
      payouts.push({
        id: `po_${fid}_${i}`,
        floristId: fid,
        orderId: `hist_${fid}_${i}`,
        amountCents: getRecipe(plan).floristPayoutCents,
        createdAt: stamp(d, 12),
        status: "paid",
      });
    }
  }

  return {
    version: STATE_VERSION,
    customer: { firstName: "Camille", email: "camille@exemple.fr", since: iso(addDays(today, -160)), referralCode: "CAMILLE10", referralCreditCents: 0 },
    reminders: [
      { id: "rem_thomas", name: "Thomas", date: mmdd(t(19)), type: "birthday", label: "Anniversaire de Thomas (mon frère)" },
      { id: "rem_sophie", name: "Sophie", date: "03-08", type: "birthday", label: "Anniversaire de Sophie" },
      { id: "rem_noces", name: "Parents", date: mmdd(t(45)), type: "custom", label: "Noces de corail des parents" },
    ],
    waitlist: [],
    recipients,
    subscriptions,
    schedules,
    overrides: {},
    orders,
    florists: FLORISTS.map((f) => ({
      ...f,
      // Un oubli de réponse il y a 12 jours : 1 point sur 3
      ...(f.id === "f_petale" && { strikes: [{ id: "na_hist_petale", at: stamp(addDays(today, -12), 9), orderId: "hist", points: 1, reason: "Sans réponse à une proposition" }] }),
      ...(f.id === "f_auteuil" && { closures: [{ id: "cl_auteuil", from: iso(t(2)), to: iso(t(5)), reason: "Congés", declaredAt: stamp(addDays(today, -20), 9) }] }),
    })),
    guaranteeLog: [],
    payouts,
    catalog: CATALOG.map((r) => ({ ...r, stems: r.stems.map((s) => ({ ...s })), palette: [...r.palette] })),
    models: MODELS.map((m) => ({ ...m, stems: m.stems.map((x) => ({ ...x })), palette: [...m.palette] })),
    currentFloristId: "f_petale",
  };
}
