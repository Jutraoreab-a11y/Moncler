"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Bouquet } from "@/components/bloom";
import { BouquetChoice, ModelBouquet, SurpriseFan } from "@/components/bouquet-choice";
import { PetalRain } from "@/components/petals";
import { useToast } from "@/components/toast";
import { Button, Field, inputCls, LinkButton, Panel, StatusBadge } from "@/components/ui";
import { EVENT_LABELS, euros, getRecipe } from "@/lib/catalog";
import { addDays, daysBetween, frDateYear, frLong, frShort, iso, parseISO, relativeDay, startOfDay } from "@/lib/dates";
import { findModel, modelsOf } from "@/lib/models";
import {
  canRetract,
  carnetMonthlyCents,
  RETRACTATION_DAYS,
  subscriberPriceCents,
  subscriptionPriceCents,
  addonPriceCents,
  CARNET_EVENTS,
  CARNET_YEARLY_QUOTA,
  carnetIssues,
  monthlyOccasionIssues,
  MONTHS,
  commitmentEnd,
  creditsUsed,
  creditWindow,
  EXTRA_STEMS,
  findExtraStem,
  forecastMonths,
  orderKey,
  planOccurrences,
  PLAN_TYPES,
  upgradeOptions,
  type Occurrence,
} from "@/lib/pricing";
import { useStore } from "@/lib/store";
import type { EventType, Order, OrderStatus, PlanId, Schedule, SelectionMode, Subscription } from "@/lib/types";

/** Le nom d'un bouquet surprise reste secret jusqu'à ce qu'il soit prêt à partir. */
const REVEALED: OrderStatus[] = ["ready", "in_delivery", "delivered"];
const isSecret = (o: Order) => o.mode === "surprise" && !REVEALED.includes(o.status);
const short = (p: PlanId) => getRecipe(p).name.replace("Le ", "");

const TRACK: { s: OrderStatus; label: string }[] = [
  { s: "assigned", label: "Programmé" },
  { s: "preparing", label: "En préparation" },
  { s: "ready", label: "Prêt" },
  { s: "in_delivery", label: "En route" },
  { s: "delivered", label: "Livré" },
];

export default function ComptePage() {
  const { state, ready } = useStore();
  const toast = useToast();
  const mySubs = useMemo(() => state.subscriptions.filter((s) => s.customerId === "me"), [state.subscriptions]);
  const mySubIds = useMemo(() => new Set(mySubs.map((s) => s.id)), [mySubs]);
  const mine = useMemo(() => state.recipients.filter((r) => r.customerId === "me"), [state.recipients]);
  const mineIds = useMemo(() => new Set(mine.map((r) => r.id)), [mine]);
  const myOrders = useMemo(() => state.orders.filter((o) => mineIds.has(o.recipientId)), [state.orders, mineIds]);
  const delivered = myOrders.filter((o) => o.status === "delivered").sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));
  const live = myOrders.filter((o) => !["delivered", "cancelled"].includes(o.status)).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))[0];

  // Planning des 75 prochains jours, avec les règles de facturation appliquées
  const planning = useMemo(
    () => planOccurrences({ ...state, subscriptions: mySubs }, startOfDay(), addDays(startOfDay(), 75)),
    [state, mySubs],
  );
  const orderByKey = useMemo(() => new Map(myOrders.map((o) => [orderKey(o), o])), [myOrders]);
  const week = planning.filter((e) => e.status === "planned" && daysBetween(startOfDay(), parseISO(e.date)) <= 7);
  const upcoming = planning.slice(0, 12);

  // Pétales à la livraison
  const [celebrate, setCelebrate] = useState(0);
  const prevDelivered = useRef<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (prevDelivered.current !== null && delivered.length > prevDelivered.current) {
      setCelebrate((c) => c + 1);
      toast({ title: "Bouquet livré", body: `${state.recipients.find((r) => r.id === delivered[0].recipientId)?.firstName} vient de recevoir ses fleurs.`, tone: "success" });
    }
    prevDelivered.current = delivered.length;
  }, [delivered.length, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSubs = mySubs.filter((s) => s.status === "active");
  const monthlyTotal = activeSubs.reduce((s, x) => s + subscriptionPriceCents(x, state.catalog), 0);
  const thanks = myOrders.filter((o) => o.thanks).sort((a, b) => b.thanks!.at.localeCompare(a.thanks!.at));
  // Pétales quand un merci arrive (page destinataire ouverte dans un autre onglet)
  const prevThanks = useRef<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (prevThanks.current !== null && thanks.length > prevThanks.current) {
      setCelebrate((c) => c + 1);
      toast({ title: `${state.recipients.find((r) => r.id === thanks[0].recipientId)?.firstName} vous dit merci`, body: thanks[0].thanks!.text, tone: "success" });
    }
    prevThanks.current = thanks.length;
  }, [thanks.length, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const hour = new Date().getHours();

  return (
    <AppShell right={<LinkButton href="/abonnement" size="sm">Ajouter un proche</LinkButton>}>
      {celebrate > 0 && <PetalRain key={celebrate} />}
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="font-display text-5xl sm:text-6xl">{hour < 18 ? "Bonjour" : "Bonsoir"} {state.customer.firstName}.</h1>
            <p className="mt-2 text-lg text-ink-soft">
              {activeSubs.length ? `${activeSubs.length} abonnement${activeSubs.length > 1 ? "s" : ""} actif${activeSubs.length > 1 ? "s" : ""}, ${planning.filter((e) => e.status === "planned").length} bouquets prévus d'ici 75 jours.` : "Aucun abonnement actif."}
            </p>
          </div>
          <dl className="flex gap-8">
            <Stat v={String(delivered.length)} l="bouquets offerts" />
            <Stat v={euros(monthlyTotal, monthlyTotal % 100 !== 0)} l="par mois" />
          </dl>
        </div>

        {live && <LiveTracking order={live} />}

        {thanks.length > 0 && <ThanksWall orders={thanks.slice(0, 3)} />}

        {week.length > 0 && (
          <section aria-labelledby="semaine" className="mt-8">
            <h2 id="semaine" className="font-display text-3xl">Cette semaine</h2>
            <p className="text-sm text-ink-soft">Dernière chance pour relire le mot ou surclasser le bouquet : les suppléments sont prélevés 3 jours avant.</p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {week.map((e) => (
                <WeekCard key={e.key} occ={e} order={orderByKey.get(e.key)} />
              ))}
            </div>
          </section>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.35fr_1fr]">
          <Panel className="p-6">
            <h2 className="font-display text-3xl">Prochains envois</h2>
            <ul className="mt-5 divide-y divide-line">
              {upcoming.map((e) => (
                <UpcomingRow key={e.key} occ={e} order={orderByKey.get(e.key)} />
              ))}
              {!upcoming.length && <li className="py-6 text-ink-soft">Aucun envoi prévu. Ajoutez une date à l&apos;un de vos proches.</li>}
            </ul>
          </Panel>

          <div id="abonnements" className="scroll-mt-24 space-y-6">
            <ForecastPanel subs={mySubs} />
            <GrowthPanel />
            {mySubs.map((s) => (
              <SubscriptionCard key={s.id} sub={s} />
            ))}
            {!mySubIds.size && <LinkButton href="/abonnement" className="w-full">Choisir une formule</LinkButton>}
          </div>
        </div>

        <Panel className="mt-6 p-6">
          <h2 className="font-display text-3xl">Historique</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-ink-soft">
                <tr className="border-b border-line">
                  <th className="py-2.5 font-semibold">Date</th>
                  <th className="font-semibold">Pour</th>
                  <th className="font-semibold">Bouquet</th>
                  <th className="font-semibold">Supplément</th>
                  <th className="font-semibold">Fleuriste</th>
                  <th className="text-right font-semibold">Statut</th>
                </tr>
              </thead>
              <tbody>
                {delivered.slice(0, 12).map((o) => {
                  const r = state.recipients.find((x) => x.id === o.recipientId)!;
                  return (
                    <tr key={o.id} className="border-b border-line/60 last:border-0">
                      <td className="tabular py-3">{frShort(o.deliveryDate)}</td>
                      <td>{r.firstName}</td>
                      <td>
                        <span className="font-semibold">{findModel(o.modelId, state.models)?.name ?? "—"}</span>
                        <span className="text-ink-soft"> · {short(o.planId)}{o.mode === "surprise" ? " · surprise" : ""}</span>
                      </td>
                      <td className="tabular">{o.priceCents ? euros(o.priceCents, true) : <span className="text-ink-soft">Inclus</span>}</td>
                      <td className="text-ink-soft">{state.florists.find((f) => f.id === o.floristId)?.shopName}</td>
                      <td className="text-right">
                        <span className="inline-flex items-center gap-2">
                          {o.publicCode && (
                            <Link href={`/merci?code=${o.publicCode}`} className="text-xs font-semibold text-ink-soft underline hover:text-ink" title="Page vue par le destinataire">
                              {o.thanks ? "Merci reçu" : "Page de " + r.firstName}
                            </Link>
                          )}
                          <StatusBadge status={o.status} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </main>
    </AppShell>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return (
    <div>
      <dd className="font-display text-4xl leading-none">{v}</dd>
      <dt className="mt-1 text-sm text-ink-soft">{l}</dt>
    </div>
  );
}

/** Pastille de facturation d'une livraison. */
function PriceChip({ occ, order }: { occ: Occurrence; order?: Order }) {
  if (occ.status === "blocked") return <span className="rounded-full bg-[#fde2ea] px-2.5 py-1 text-xs font-semibold text-peony-deep">Non livré</span>;
  if (occ.status === "absorbed") return <span className="rounded-full bg-lilac px-2.5 py-1 text-xs font-semibold">Remplacé par l&apos;occasion</span>;
  if (!occ.priceCents) return <span className="rounded-full bg-stem-soft px-2.5 py-1 text-xs font-semibold text-stem">{occ.billing === "merged" ? "Spécial, inclus" : "Inclus"}</span>;
  const paid = order?.paymentStatus === "paid";
  return (
    <span className={clsx("tabular rounded-full px-2.5 py-1 text-xs font-semibold", paid ? "bg-stem-soft text-stem" : "bg-pollen-soft text-[#7a5300]")}>
      {paid ? "Payé" : "+"} {euros(occ.priceCents, true)}
    </span>
  );
}

function bouquetLabel(occ: Occurrence, schedule: Schedule, order: Order | undefined, models: ReturnType<typeof useStore>["state"]["models"]) {
  const m = order ? (isSecret(order) ? undefined : findModel(order.modelId, models)) : schedule.mode === "fixed" ? findModel(schedule.modelId, models) : undefined;
  const fixedOk = m && m.planId === occ.plan;
  return fixedOk ? m!.name : "Surprise";
}

function WeekCard({ occ, order }: { occ: Occurrence; order?: Order }) {
  const { state } = useStore();
  const r = state.recipients.find((x) => x.id === occ.recipientId)!;
  const schedule = state.schedules.find((s) => s.id === occ.scheduleId)!;
  const days = daysBetween(startOfDay(), parseISO(occ.date));
  const [open, setOpen] = useState(false);
  return (
    <Panel className={clsx("p-5", days <= 3 && "border-peony")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink-soft">{relativeDay(occ.date)} · {frLong(occ.date)}</p>
          <p className="mt-1 font-semibold">{r.firstName} <span className="font-normal text-ink-soft">· {occ.label}</span></p>
          <p className="text-sm">
            <span className="font-semibold">{bouquetLabel(occ, schedule, order, state.models)}</span> · {short(occ.plan)}
            {occ.upgradeFrom && <span className="text-peony-deep"> (surclassé)</span>}
            {occ.extraStemId && <span className="text-ink-soft"> + {findExtraStem(occ.extraStemId)?.label}</span>}
          </p>
          {order && order.status !== "cancelled" && (
            <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
              <span className={clsx("h-1.5 w-1.5 rounded-full", order.acceptedAt ? "bg-stem" : "bg-pollen")} />
              {order.acceptedAt ? `Confirmé par ${state.florists.find((f) => f.id === order.floristId)?.shopName ?? "votre atelier"}` : "Atelier en cours de confirmation"}
            </p>
          )}
        </div>
        <PriceChip occ={occ} order={order} />
      </div>
      {occ.priceCents > 0 && (
        <p className="mt-2 text-xs text-ink-soft">
          {order?.paymentStatus === "paid" ? "Prélevé" : `Prélèvement le ${frShort(occ.chargeDate)}`} : {occ.lines.map((l) => l.label).join(", ")}.
        </p>
      )}
      <Button variant="ghost" size="sm" className="mt-2 -ml-3" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Fermer" : "Modifier cet envoi"}
      </Button>
      {open && <OccurrenceEditor occ={occ} order={order} onDone={() => setOpen(false)} />}
    </Panel>
  );
}

function UpcomingRow({ occ, order }: { occ: Occurrence; order?: Order }) {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const schedule = state.schedules.find((s) => s.id === occ.scheduleId)!;
  const r = state.recipients.find((x) => x.id === occ.recipientId)!;
  const d = parseISO(occ.date);
  const started = order && !["assigned", "scheduled", "cancelled"].includes(order.status);

  return (
    <li className={clsx("py-4", occ.status !== "planned" && "opacity-70")}>
      <div className="flex items-center gap-4">
        <div className="w-12 shrink-0 text-center">
          <p className="font-display text-3xl leading-none">{d.getDate()}</p>
          <p className="text-xs text-ink-soft">{frShort(occ.date).split(" ")[1]}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{r.firstName} <span className="font-normal text-ink-soft">· {occ.label}</span></p>
          <p className="truncate text-sm text-ink-soft">
            {occ.status === "absorbed" ? (
              <>Remplacé par « {occ.near?.label} » le {frShort(occ.near!.date)}</>
            ) : occ.status === "blocked" ? (
              occ.blockReason
            ) : (
              <>
                <span className={clsx("font-semibold", bouquetLabel(occ, schedule, order, state.models) === "Surprise" ? "text-peony-deep" : "text-ink")}>{bouquetLabel(occ, schedule, order, state.models)}</span> · {short(occ.plan)}
                {occ.upgradeFrom && " ↑"} · {relativeDay(occ.date)}
              </>
            )}
          </p>
        </div>
        <PriceChip occ={occ} order={order} />
        <Button variant="ghost" size="sm" disabled={!!started} onClick={() => setOpen((o) => !o)} aria-expanded={open}>Modifier</Button>
      </div>
      {open && (
        <div className="sm:pl-16">
          <OccurrenceEditor occ={occ} order={order} onDone={() => setOpen(false)} />
        </div>
      )}
    </li>
  );
}

/** Tout ce qu'on peut changer sur un envoi : fusion, taille, extra, modèle, message. */
function OccurrenceEditor({ occ, order, onDone }: { occ: Occurrence; order?: Order; onDone: () => void }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const schedule = state.schedules.find((s) => s.id === occ.scheduleId)!;
  const sub = state.subscriptions.find((s) => s.id === occ.subscriptionId)!;
  const r = state.recipients.find((x) => x.id === occ.recipientId)!;
  const isEvent = occ.type !== "monthly";
  // La livraison qui porte le choix de fusion est toujours l'occasion
  const eventKey = isEvent ? occ.key : occ.near?.key;
  const eventOcc = eventKey === occ.key ? occ : undefined;

  const [upgrade, setUpgrade] = useState<PlanId | "">(occ.upgradeFrom ? occ.plan : "");
  const [always, setAlways] = useState(false);
  const [extra, setExtra] = useState(occ.extraStemId ?? "");
  const [pick, setPick] = useState<{ mode: SelectionMode; modelId?: string }>({ mode: schedule.mode, modelId: schedule.modelId });
  const [msg, setMsg] = useState(order?.message ?? schedule.message);
  const effectivePlan = (upgrade || occ.basePlan) as PlanId;

  function save() {
    if (isEvent) {
      if (always) {
        dispatch({ type: "editSchedule", id: schedule.id, patch: { upgradeTo: upgrade || undefined } });
        dispatch({ type: "override", key: occ.key, patch: { upgradeTo: undefined } });
      } else {
        dispatch({ type: "override", key: occ.key, patch: { upgradeTo: upgrade ? upgrade : schedule.upgradeTo ? null : undefined } });
      }
    }
    dispatch({ type: "override", key: occ.key, patch: { extraStemId: effectivePlan === "classique" ? extra || (schedule.extraStemId ? null : undefined) : undefined } });
    if (pick.mode !== schedule.mode || pick.modelId !== schedule.modelId) dispatch({ type: "editSchedule", id: schedule.id, patch: { mode: pick.mode, modelId: pick.mode === "fixed" ? pick.modelId : undefined } });
    if (msg !== schedule.message) dispatch({ type: "editSchedule", id: schedule.id, patch: { message: msg } });
    toast({ title: "Envoi mis à jour", body: `${occ.label} pour ${r.firstName}, le ${frShort(occ.date)}.`, tone: "success" });
    onDone();
  }

  const addon = addonPriceCents(sub.planId, state.catalog);
  const upOpts = upgradeOptions(occ.basePlan, state.catalog);

  return (
    <div className="pop mt-4 space-y-5 rounded-2xl bg-paper p-4">
      {isEvent && sub.planType === "MONTHLY_RECURRING" && occ.status === "planned" && (
        <p className="rounded-xl bg-lilac/70 px-3 py-2 text-sm">
          Le bouquet de {MONTHS[parseISO(occ.date).getMonth()]} est livré ce jour-là en Spécial événement, pour +{euros(addon, true)} (+30 % de la formule)
          {occ.near ? `, à la place de celui du ${frShort(occ.near.date)}` : ""}. 1 bouquet par mois, 12 par an.
        </p>
      )}

      {isEvent && occ.basePlan !== "prestige" && (eventOcc || isEvent) && (
        <fieldset>
          <legend className="text-sm font-semibold">Taille du bouquet</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            <Pill on={!upgrade} onClick={() => setUpgrade("")}>{short(occ.basePlan)} · taille de l&apos;abonnement</Pill>
            {upOpts.map((u) => (
              <Pill key={u.to} on={upgrade === u.to} onClick={() => setUpgrade(u.to)}>
                {short(u.to)} · +{euros(u.priceCents)} <s className="ml-1 opacity-50">+{euros(u.publicGapCents)}</s>
              </Pill>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} className="accent-[#e23f6b]" />
            Appliquer à chaque « {occ.label} »
          </label>
        </fieldset>
      )}

      {effectivePlan === "classique" && (
        <Field label="Extra tige noble">
          <select className={inputCls} value={extra} onChange={(e) => setExtra(e.target.value)}>
            <option value="">Sans extra</option>
            {EXTRA_STEMS.map((x) => (
              <option key={x.id} value={x.id}>{x.label} : +{euros(x.priceCents)}</option>
            ))}
          </select>
        </Field>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Bouquet (toutes les prochaines fois)</legend>
        <BouquetChoice dense planId={schedule.planId} mode={pick.mode} modelId={pick.modelId} models={state.models} onChange={setPick} />
      </fieldset>

      <Field label="Mot sur la carte" hint={`${msg.length} / 200`}>
        <input className={inputCls} value={msg} maxLength={200} onChange={(e) => setMsg(e.target.value)} />
      </Field>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Annuler</Button>
        <Button variant="ink" onClick={save}>Enregistrer</Button>
      </div>
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={clsx("rounded-full px-3 py-1.5 text-sm font-semibold", on ? "bg-ink text-paper" : "bg-card text-ink")}>
      {children}
    </button>
  );
}

function ForecastPanel({ subs }: { subs: Subscription[] }) {
  const { state } = useStore();
  const months = useMemo(() => forecastMonths({ ...state, subscriptions: subs }, 3), [state, subs]);
  const [i, setI] = useState(0);
  const m = months[i];
  return (
    <Panel className="p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-3xl">Prélèvements</h2>
        <div className="flex gap-1" role="tablist" aria-label="Mois">
          {months.map((x, k) => (
            <button key={x.month} role="tab" aria-selected={k === i} onClick={() => setI(k)} className={clsx("rounded-full px-2.5 py-1 text-xs font-semibold capitalize", k === i ? "bg-ink text-paper" : "text-ink-soft")}>
              {x.label.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {m.lines.map((l, k) => (
          <li key={k} className={clsx("flex justify-between gap-3", l.past && "text-ink-soft")}>
            <span className="min-w-0">
              <span className="tabular mr-2 text-ink-soft">{frShort(l.date)}</span>
              {l.label}
            </span>
            <span className="tabular shrink-0 font-semibold">{euros(l.amountCents, true)}</span>
          </li>
        ))}
        {!m.lines.length && <li className="text-ink-soft">Aucun prélèvement ce mois-ci.</li>}
      </ul>
      <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-ink-soft capitalize">Total {m.label}</span>
        <span className="tabular font-display text-3xl">{euros(m.totalCents, true)}</span>
      </div>
    </Panel>
  );
}

function SubscriptionCard({ sub }: { sub: Subscription }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [adding, setAdding] = useState(false);
  const carnet = sub.planType === "SPECIAL_EVENTS_CARNET";
  const schedules = state.schedules.filter((s) => s.subscriptionId === sub.id);
  const recipients = [...new Set(schedules.map((s) => s.recipientId))].map((id) => state.recipients.find((r) => r.id === id)!).filter(Boolean);
  const end = commitmentEnd(sub);
  const recipe = getRecipe(sub.planId, state.catalog);
  const price = subscriptionPriceCents(sub, state.catalog);
  const nextYear = carnet ? carnetMonthlyCents(schedules, state.catalog) : price;
  const retract = sub.status !== "cancelled" && canRetract(sub, state.orders);
  const afterCommitment = carnet && end && startOfDay() >= end;
  const used = carnet ? creditsUsed(sub, state.orders) : 0;
  const win = creditWindow(sub);
  const st = sub.status;

  return (
    <Panel className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm text-ink-soft">{PLAN_TYPES[sub.planType].name}</p>
          <h2 className="font-display text-3xl">
            {carnet ? `${schedules.filter((x) => x.active).length} dates` : recipe.name} · {euros(price, price % 100 !== 0)}
            <span className="text-lg text-ink-soft"> / mois</span>
          </h2>
        </div>
        <span className={clsx("rounded-full px-2.5 py-1 text-xs font-semibold", st === "active" ? (sub.cancelAtCommitmentEnd ? "bg-pollen-soft text-[#7a5300]" : "bg-stem-soft text-stem") : st === "paused" ? "bg-pollen-soft text-[#7a5300]" : "bg-paper-2 text-ink-soft")}>
          {st === "active" ? (sub.cancelAtCommitmentEnd ? "Résiliation programmée" : "Actif") : st === "paused" ? "En pause" : "Résilié"}
        </span>
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        Pour {recipients.map((r) => r.firstName).join(", ") || "—"} ·{" "}
        {carnet ? (end ? (afterCommitment ? `Sans engagement depuis le ${frDateYear(end)}` : `Engagement jusqu'au ${frDateYear(end)}, puis sans engagement`) : "") : "Sans engagement"}
        {sub.cancelAtCommitmentEnd && end ? `. Fin le ${frDateYear(end)}.` : ""}
      </p>

      {carnet && (
        <div className="mt-3 rounded-xl bg-paper p-3 text-sm">
          <p className="font-semibold">Comment est calculée votre mensualité</p>
          <ul className="mt-1 space-y-0.5 text-ink-soft">
            {schedules.filter((x) => x.active).map((x) => (
              <li key={x.id} className="flex justify-between gap-3">
                <span>{x.label} · {getRecipe(x.planId).name.replace("Le ", "")}</span>
                <span className="tabular">{euros(subscriberPriceCents(x.planId, state.catalog), true)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-soft">Total au prix abonné ÷ 12.{nextYear !== price ? ` Au renouvellement : ${euros(nextYear, true)} / mois.` : ""}</p>
        </div>
      )}
      {carnet && (
        <div className="mt-4">
          <div className="flex justify-between text-sm">
            <span>Bouquets utilisés cette année</span>
            <span className="tabular font-semibold">{used} / {CARNET_YEARLY_QUOTA}</span>
          </div>
          <div className="mt-1.5 flex gap-1" aria-hidden>
            {Array.from({ length: CARNET_YEARLY_QUOTA }, (_, i) => (
              <span key={i} className={clsx("h-2 flex-1 rounded-full", i < used ? "bg-peony" : "bg-line")} />
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-soft">Renouvelés le {frDateYear(win.to)}. 1 bouquet maximum par mois.</p>
        </div>
      )}

      <ul className="mt-4 flex flex-wrap gap-1.5">
        {schedules.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => {
                dispatch({ type: "toggleSchedule", id: s.id });
                toast({ title: s.active ? `${s.label} suspendu` : `${s.label} réactivé` });
              }}
              title={s.active ? "Suspendre cette date" : "Réactiver cette date"}
              className={clsx("rounded-full px-2.5 py-1 text-xs font-semibold", s.active ? "bg-ink text-paper" : "bg-paper-2 text-ink-soft line-through")}
            >
              {s.type === "monthly" ? `Le ${s.dayOfMonth} du mois` : s.label}
              {s.upgradeTo ? ` · ${short(s.upgradeTo)}` : ""}
              {!carnet && s.type !== "monthly" ? ` · +${euros(addonPriceCents(sub.planId, state.catalog), true)}` : ""}
            </button>
          </li>
        ))}
        {st === "active" && (
          <li>
            <button onClick={() => setAdding((a) => !a)} aria-expanded={adding} className="rounded-full border border-dashed border-ink/30 px-2.5 py-1 text-xs font-semibold text-ink-soft hover:text-ink">
              Ajouter une occasion
            </button>
          </li>
        )}
      </ul>
      {adding && <AddOccasion sub={sub} onDone={() => setAdding(false)} />}

      <div className="mt-5 flex flex-wrap gap-2">
        {st === "active" && !carnet && (
          <Button variant="outline" size="sm" onClick={() => (dispatch({ type: "subscription", id: sub.id, status: "paused" }), toast({ title: "Abonnement en pause", body: "Aucun bouquet ni prélèvement tant que vous n'aurez pas repris." }))}>
            Mettre en pause
          </Button>
        )}
        {(st === "paused" || sub.cancelAtCommitmentEnd) && (
          <Button variant="stem" size="sm" onClick={() => (dispatch({ type: "subscription", id: sub.id, status: "active" }), toast({ title: "C'est reparti", body: "Vos prochains bouquets sont reprogrammés.", tone: "success" }))}>
            {sub.cancelAtCommitmentEnd ? "Annuler la résiliation" : "Reprendre"}
          </Button>
        )}
        {st !== "cancelled" &&
          !sub.cancelAtCommitmentEnd &&
          (confirm ? (
            <span className="pop flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  dispatch({ type: "subscription", id: sub.id, status: "cancelled" });
                  setConfirm(false);
                  toast(
                    retract
                      ? { title: "Rétractation enregistrée", body: "Abonnement arrêté, remboursement intégral sous 5 jours. Un e-mail de confirmation vous a été envoyé." }
                      : carnet && end && startOfDay() < end
                        ? { title: "Résiliation enregistrée", body: `Vos dates restent livrées jusqu'au ${frDateYear(end)}, fin de l'engagement. Confirmation envoyée par e-mail.` }
                        : { title: "Abonnement résilié", body: "Aucun prélèvement à venir. Confirmation envoyée par e-mail." },
                  );
                }}
              >
                {retract ? "Confirmer la rétractation" : "Confirmer la résiliation"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Garder</Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>{retract ? "Se rétracter (remboursé)" : "Résilier"}</Button>
          ))}
      </div>
      {confirm && retract && <p className="mt-2 text-xs text-ink-soft">Vous êtes dans le délai de rétractation de {RETRACTATION_DAYS} jours et aucun bouquet n&apos;est parti : arrêt immédiat et remboursement intégral.</p>}
      {confirm && !retract && carnet && end && startOfDay() < end && (
        <p className="mt-2 text-xs text-ink-soft">Engagement de 12 mois : la résiliation prendra effet le {frDateYear(end)}. Les prélèvements continuent jusque-là.</p>
      )}
    </Panel>
  );
}

const OCCASION_TYPES: { id: Exclude<EventType, "monthly">; needsDate: boolean }[] = CARNET_EVENTS.map((t) => ({ id: t, needsDate: t === "birthday" || t === "custom" }));

function AddOccasion({ sub, onDone }: { sub: Subscription; onDone: () => void }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const carnet = sub.planType === "SPECIAL_EVENTS_CARNET";
  const existing = state.schedules.filter((s) => s.subscriptionId === sub.id);
  // Mensuel : l'occasion remplace le bouquet du mois de ce destinataire, elle est donc pour lui seul
  const recipients = carnet ? [...new Set([sub.recipientId, ...existing.map((s) => s.recipientId)].filter(Boolean) as string[])] : [sub.recipientId ?? existing[0]?.recipientId].filter(Boolean) as string[];
  const [recipientId, setRecipientId] = useState(recipients[0] ?? "");
  const [type, setType] = useState<Exclude<EventType, "monthly">>("birthday");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [size, setSize] = useState<PlanId>(sub.planId);
  const needsDate = OCCASION_TYPES.find((o) => o.id === type)!.needsDate;
  const r = state.recipients.find((x) => x.id === recipientId);
  const draft: Schedule = {
    id: `s_${Date.now().toString(36)}`,
    subscriptionId: sub.id,
    recipientId,
    planId: carnet ? size : sub.planId,
    addedAt: iso(startOfDay()),
    type,
    date: needsDate ? date.slice(5) || undefined : undefined,
    label: type === "birthday" ? `Anniversaire de ${r?.firstName ?? ""}` : type === "custom" ? label || "Date spéciale" : EVENT_LABELS[type],
    message: existing[0]?.message ?? "",
    active: true,
    mode: "surprise",
  };
  const issues = carnet ? carnetIssues([...existing, draft]) : monthlyOccasionIssues([...existing, draft]);
  const ok = recipientId && (!needsDate || date) && issues.length === 0;

  return (
    <div className="pop mt-4 space-y-3 rounded-2xl bg-paper p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pour">
          <select className={inputCls} value={recipientId} onChange={(e) => setRecipientId(e.target.value)}>
            {state.recipients.filter((x) => x.customerId === "me" && (carnet || recipients.includes(x.id))).map((x) => (
              <option key={x.id} value={x.id}>{x.firstName} {x.lastName}</option>
            ))}
          </select>
        </Field>
        <Field label="Occasion">
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as Exclude<EventType, "monthly">)}>
            {OCCASION_TYPES.map((o) => (
              <option key={o.id} value={o.id}>{EVENT_LABELS[o.id]}</option>
            ))}
          </select>
        </Field>
        {needsDate && <Field label="Date"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>}
        {carnet && (
          <Field label="Taille">
            <select className={inputCls} value={size} onChange={(e) => setSize(e.target.value as PlanId)}>
              {state.catalog.map((c) => (
                <option key={c.planId} value={c.planId}>{c.name.replace("Le ", "")} : {euros(subscriberPriceCents(c.planId, state.catalog), true)}</option>
              ))}
            </select>
          </Field>
        )}
        {type === "custom" && <Field label="Nom de l'occasion"><input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Anniversaire de mariage" /></Field>}
      </div>
      <p className="text-sm text-ink-soft">
        {carnet
          ? `Cette année : ${euros(subscriberPriceCents(size, state.catalog), true)} prélevés 3 jours avant l'envoi. Au renouvellement, la date est intégrée à votre mensualité.`
          : `Le bouquet du mois est livré ce jour-là en Spécial événement : +${euros(addonPriceCents(sub.planId, state.catalog), true)} (+30 %), prélevés 3 jours avant. 1 bouquet par mois, 12 par an. Pour une autre personne, créez un Carnet Occasions Clés.`}
      </p>
      {issues.map((x) => (
        <p key={x} role="alert" className="rounded-xl bg-[#fde2ea] px-3 py-2 text-sm text-peony-deep">{x}</p>
      ))}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>Annuler</Button>
        <Button
          size="sm"
          variant="ink"
          disabled={!ok}
          onClick={() => {
            dispatch({ type: "addOccasion", schedule: draft });
            toast({ title: "Occasion ajoutée", body: `${draft.label}, ${carnet ? "incluse dans le Carnet" : "en plus du bouquet du mois"}.`, tone: "success" });
            onDone();
          }}
        >
          Ajouter
        </Button>
      </div>
    </div>
  );
}

function LiveTracking({ order }: { order: Order }) {
  const { state } = useStore();
  const r = state.recipients.find((x) => x.id === order.recipientId)!;
  const f = state.florists.find((x) => x.id === order.floristId);
  const recipe = getRecipe(order.planId, state.catalog);
  const model = findModel(order.modelId, state.models);
  const secret = isSecret(order);
  const idx = Math.max(0, TRACK.findIndex((t) => t.s === order.status));
  const courier = order.courier === "own" ? "Livraison par l'atelier" : order.courier === "uber_direct" ? "Coursier Uber Direct" : "Coursier Stuart";

  return (
    <section aria-label="Suivi en direct" className="mt-10 overflow-hidden rounded-[28px] bg-ink text-paper">
      <div className="grid gap-6 p-6 sm:p-8 md:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm text-paper/70">
            <span className={clsx("h-2 w-2 rounded-full", order.status === "assigned" ? "bg-paper/50" : "ring-pulse bg-peony")} />
            {order.status === "assigned" ? "Prochain bouquet" : "Suivi en direct"}
          </p>
          <h2 className="mt-2 font-display text-4xl leading-tight sm:text-5xl">
            {secret ? `Un bouquet surprise pour ${r.firstName}` : `${model?.name ?? recipe.name} pour ${r.firstName}`}
          </h2>
          {order.mode === "surprise" && !secret && model && (
            <p className="pop mt-2 inline-block rounded-full bg-pollen px-3 py-1 text-sm font-semibold text-ink">Surprise révélée : {model.name}, {model.tagline.toLowerCase()}</p>
          )}
          <p className="mt-1 text-paper/70">
            {relativeDay(order.deliveryDate)}, {frLong(order.deliveryDate)} · {f ? `${f.shopName}, à ${String(order.distanceKm ?? "").replace(".", ",")} km` : "Attribution en cours"}
          </p>
          <ol className="mt-8 grid grid-cols-5 gap-2">
            {TRACK.map((t, i) => (
              <li key={t.s}>
                <span className={clsx("block h-1.5 rounded-full transition-colors duration-700", i <= idx ? "bg-peony" : "bg-paper/15")} />
                <span className={clsx("mt-2 block text-[11px] font-semibold sm:text-xs", i <= idx ? "text-paper" : "text-paper/45")}>{t.label}</span>
              </li>
            ))}
          </ol>
          {order.status === "in_delivery" && <p className="pop mt-5 text-sm text-pollen">{courier} en route vers {r.address}.</p>}
          {order.issue && <p className="mt-4 rounded-xl bg-pollen px-3 py-2 text-sm font-semibold text-ink">{order.issue}</p>}
          <p className="mt-6 max-w-lg rounded-2xl bg-paper/10 px-4 py-3 font-display text-xl italic">« {order.message} »</p>
          {order.photoUrl && (
            <figure className="pop mt-5 max-w-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={order.photoUrl} alt={`Bouquet préparé pour ${r.firstName}`} className="aspect-[4/5] w-full rounded-2xl object-cover" />
              <figcaption className="mt-1.5 text-xs text-paper/60">Photo prise par l&apos;atelier avant le départ</figcaption>
            </figure>
          )}
        </div>
        <div className="mx-auto w-40 md:w-48">
          <div className="sway">
            {secret ? (
              <div className="h-52"><SurpriseFan models={modelsOf(order.planId, state.models)} /></div>
            ) : model ? (
              <div key={model.id} className="pop"><ModelBouquet model={model} wrap="#f7e6ea" /></div>
            ) : (
              <Bouquet palette={recipe.palette} seed={order.id.length} count={order.planId === "prestige" ? 9 : order.planId === "signature" ? 7 : 5} wrap="#f7e6ea" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Les mercis des destinataires : la boucle émotionnelle du carnet. */
function ThanksWall({ orders }: { orders: Order[] }) {
  const { state } = useStore();
  return (
    <section aria-labelledby="mercis" className="mt-8">
      <h2 id="mercis" className="font-display text-3xl">Ils vous disent merci</h2>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {orders.map((o) => {
          const r = state.recipients.find((x) => x.id === o.recipientId)!;
          return (
            <figure key={o.id} className="pop rounded-[22px] bg-lilac/70 p-5">
              {o.thanks!.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.thanks!.photoUrl} alt={`Photo envoyée par ${r.firstName}`} className="mb-3 aspect-square w-full rounded-xl object-cover" />
              )}
              <blockquote className="font-display text-xl italic leading-snug">« {o.thanks!.text} »</blockquote>
              <figcaption className="mt-3 text-sm text-ink-soft">
                {r.firstName}, après son bouquet du {frShort(o.deliveryDate)}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

/** Parrainage + rappels gratuits. */
function GrowthPanel() {
  const { state } = useStore();
  const toast = useToast();
  const code = state.customer.referralCode ?? "";
  return (
    <Panel className="p-6">
      <h2 className="font-display text-3xl">Faites-le découvrir</h2>
      <p className="mt-2 text-sm text-ink-soft">Vos proches ont 10 € de remise sur leur premier mois avec votre code, et vous recevez 10 € de crédit.</p>
      <div className="mt-3 flex items-center gap-2">
        <code className="rounded-xl bg-paper px-3 py-2 font-semibold tracking-wider">{code}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              toast({ title: "Code copié" });
            } catch {
              toast({ title: `Votre code : ${code}` });
            }
          }}
        >
          Copier
        </Button>
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <p className="text-sm">
          <strong>{state.reminders.length} dates</strong> dans vos rappels gratuits.
        </p>
        <LinkButton href="/rappels" variant="ghost" size="sm" className="-ml-3 mt-1">Gérer mes rappels</LinkButton>
      </div>
    </Panel>
  );
}
