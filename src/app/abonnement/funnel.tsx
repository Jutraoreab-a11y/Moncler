"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AddressInput } from "@/components/address-input";
import { Bouquet } from "@/components/bloom";
import { BouquetChoice, ModelBouquet, SurpriseFan } from "@/components/bouquet-choice";
import { PetalRain } from "@/components/petals";
import { Button, Field, inputCls, LinkButton, Logo } from "@/components/ui";
import { api, isDemo } from "@/lib/api-client";
import { CATALOG, euros, getRecipe } from "@/lib/catalog";
import { addDays, fathersDay, frLong, frShort, iso, mothersDay, parseISO, startOfDay } from "@/lib/dates";
import { matchFlorist } from "@/lib/matching";
import { findModel, modelsOf } from "@/lib/models";
import {
  CARNET_YEARLY_QUOTA,
  carnetIssues,
  carnetMonthlyCents,
  EXTRA_STEMS,
  planOccurrences,
  PLAN_TYPES,
  RETRACTATION_DAYS,
  subscriberPriceCents,
  occasionSurchargeCents,
  MONTHS,
  SUBSCRIBER_DISCOUNT,
  upgradeOptions,
} from "@/lib/pricing";
import { zoneOf } from "@/lib/zones";
import { useStore } from "@/lib/store";
import type { EventType, PlanId, PlanType, Schedule, SelectionMode, Subscription } from "@/lib/types";

const STEPS = ["Formule", "Bouquet", "Destinataire", "Dates", "Message", "Paiement"];

const nextYear = new Date().getFullYear() + 1;
const dayMonth = (d: Date) => frLong(d).split(" ").slice(1).join(" ");

const EVENTS: { id: Exclude<EventType, "monthly">; label: string; hint: string; needsDate: boolean }[] = [
  { id: "birthday", label: "Son anniversaire", hint: "Une fois par an", needsDate: true },
  { id: "valentine", label: "Saint-Valentin", hint: "14 février", needsDate: false },
  { id: "mothers_day", label: "Fête des mères", hint: `Le ${dayMonth(mothersDay(nextYear))}`, needsDate: false },
  { id: "fathers_day", label: "Fête des pères", hint: `Le ${dayMonth(fathersDay(nextYear))}`, needsDate: false },
  { id: "custom", label: "Autre date", hint: "Mariage, rencontre…", needsDate: true },
];

const SHORT_MONTH = new Intl.DateTimeFormat("fr-FR", { month: "short" });

const MESSAGES = [
  "Je pense à toi, aujourd'hui comme les autres jours.",
  "Rien de spécial, juste parce que je t'aime.",
  "Joyeux anniversaire ! Que cette année fleurisse.",
  "Merci d'être là, toujours.",
];

interface EventDraft {
  date: string; // YYYY-MM-DD saisi (anniversaire, autre)
  label: string;
  /** Mensuel : surclassement ponctuel ; Carnet : taille de ce bouquet */
  upgradeTo?: PlanId;
  plan?: PlanId;
}

const REFERRAL_CENTS = 1000;
const pct = Math.round(SUBSCRIBER_DISCOUNT * 100);

export function Funnel() {
  const params = useSearchParams();
  const router = useRouter();
  const { state, dispatch } = useStore();
  const initialPlan = (params.get("formule") as PlanId) ?? "signature";
  const [planType, setPlanType] = useState<PlanType>(params.get("offre") === "carnet" ? "SPECIAL_EVENTS_CARNET" : "MONTHLY_RECURRING");
  const [step, setStep] = useState(params.get("formule") ? 1 : 0);
  const [plan, setPlan] = useState<PlanId>(CATALOG.some((c) => c.planId === initialPlan) ? initialPlan : "signature");
  // Préremplissage depuis un rappel (/rappels) : prénom + date
  const prefillName = params.get("prenom") ?? "";
  const prefillBday = params.get("anniversaire");
  const prefillDate = params.get("date");
  const [r, setR] = useState({ firstName: prefillName, lastName: "", relation: "", address: "", postalCode: "", city: "Paris", phone: "", accessNotes: "", lat: 0, lng: 0 });
  const [dayOfMonth, setDayOfMonth] = useState(15);
  const [events, setEvents] = useState<Partial<Record<Exclude<EventType, "monthly">, EventDraft>>>(() =>
    prefillBday
      ? { birthday: { date: `2000-${prefillBday}`, label: "" } }
      : prefillDate
        ? { custom: { date: `2000-${prefillDate}`, label: params.get("libelle") ?? "" } }
        : {},
  );
  const [extraStemId, setExtraStemId] = useState<string>("");
  const [message, setMessage] = useState("");
  const [buyer, setBuyer] = useState({ firstName: state.customer.firstName, email: state.customer.email });
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<null | { date?: string; florist?: string }>(null);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<{ mode: SelectionMode; modelId?: string }>({ mode: "surprise" });
  const [cgv, setCgv] = useState(false);
  const [waitEmail, setWaitEmail] = useState("");
  const [waitDone, setWaitDone] = useState(false);
  const referral = (params.get("ref") ?? "").toUpperCase().slice(0, 16);

  const carnet = planType === "SPECIAL_EVENTS_CARNET";
  const recipe = getRecipe(plan);
  const pool = modelsOf(plan, state.models);
  const chosen = selection.mode === "fixed" ? findModel(selection.modelId, pool) : undefined;
  const firstName = r.firstName || "votre proche";

  // Plannings en préparation
  const drafts: Omit<Schedule, "id" | "recipientId" | "subscriptionId">[] = useMemo(() => {
    const base = { planId: plan, message, active: true, mode: selection.mode, modelId: selection.mode === "fixed" ? selection.modelId : undefined, extraStemId: plan === "classique" && extraStemId ? extraStemId : undefined };
    const list: Omit<Schedule, "id" | "recipientId" | "subscriptionId">[] = [];
    if (!carnet) list.push({ ...base, type: "monthly", dayOfMonth, label: "Bouquet du mois" });
    for (const ev of EVENTS) {
      const d = events[ev.id];
      if (!d) continue;
      list.push({
        ...base,
        planId: carnet ? d.plan ?? plan : plan,
        type: ev.id,
        date: ev.needsDate ? d.date.slice(5) || undefined : undefined,
        label: ev.id === "birthday" ? `Anniversaire de ${r.firstName || "…"}` : ev.id === "custom" ? d.label || "Date spéciale" : ev.label,
        upgradeTo: carnet ? undefined : d.upgradeTo,
        addedAt: iso(startOfDay()),
      });
    }
    return list;
  }, [carnet, plan, message, selection, extraStemId, dayOfMonth, events, r.firstName]);

  // Aperçu : les mêmes règles que le moteur (fusion, quotas, prix)
  const preview = useMemo(() => {
    const schedules = drafts
      .filter((d) => d.type === "monthly" || !EVENTS.find((e) => e.id === d.type)?.needsDate || d.date)
      .map((d, i) => ({ ...d, id: `d${i}`, recipientId: "draft", subscriptionId: "draft" }));
    const monthly = carnet ? carnetMonthlyCents(schedules, state.catalog) : recipe.priceCents;
    const sub: Subscription = { id: "draft", customerId: "me", planType, planId: plan, commitmentMonths: carnet ? 12 : 0, startedAt: iso(startOfDay()), status: "active", priceCents: monthly };
    const occ = planOccurrences({ subscriptions: [sub], schedules, overrides: {}, orders: [], catalog: state.catalog }, startOfDay(), addDays(startOfDay(), 365));
    return { occ, issues: carnet ? carnetIssues(schedules) : [], monthly, yearly: carnet ? schedules.reduce((x, d) => x + subscriberPriceCents(d.planId, state.catalog), 0) : recipe.priceCents * 12 };
  }, [drafts, planType, plan, carnet, state.catalog, recipe.priceCents]);
  const monthlyPrice = preview.monthly;
  const firstCharge = Math.max(0, monthlyPrice - (referral ? REFERRAL_CENTS : 0));
  // Zone couverte ? (adresse géocodée, sinon centroïde du code postal)
  const zone = zoneOf(r.postalCode);
  const point = r.lat ? { lat: r.lat, lng: r.lng } : zone ? { lat: zone.lat, lng: zone.lng } : null;
  const covered = point ? !!matchFlorist(state.florists, point) : null;

  const firstDelivery = preview.occ.find((e) => e.status === "planned");
  const eventsChosen = Object.keys(events).length;
  const match = useMemo(() => (point ? matchFlorist(state.florists, point) : null), [point?.lat, point?.lng, state.florists]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mensuel : 1 bouquet par mois et par destinataire, 12 par an occasions comprises
  const yearEnd = iso(addDays(startOfDay(), 365));
  const monthClash = carnet ? [] : preview.occ.filter((e) => e.type !== "monthly" && e.status === "blocked" && e.date < yearEnd && /Un seul bouquet par mois/.test(e.blockReason ?? ""));
  const occasionsThisYear = carnet ? 0 : preview.occ.filter((e) => e.type !== "monthly" && e.status === "planned" && e.date < yearEnd).length;
  const datesValid =
    (carnet ? eventsChosen > 0 && preview.issues.length === 0 : monthClash.length === 0) &&
    EVENTS.every((ev) => !events[ev.id] || !ev.needsDate || !!events[ev.id]!.date);

  const valid = [
    true,
    selection.mode === "surprise" || !!chosen,
    r.firstName && r.lastName && r.address && /^\d{5}$/.test(r.postalCode) && r.phone.length >= 10 && covered === true,
    datesValid,
    message.trim().length > 2,
    buyer.firstName && /\S+@\S+\.\S+/.test(buyer.email) && cgv,
  ][step];

  function toggleEvent(id: Exclude<EventType, "monthly">) {
    setEvents((x) => {
      const n = { ...x };
      if (n[id]) delete n[id];
      else n[id] = { date: "", label: "" };
      return n;
    });
  }
  const setEvent = (id: Exclude<EventType, "monthly">, patch: Partial<EventDraft>) => setEvents((x) => ({ ...x, [id]: { ...x[id]!, ...patch } }));

  async function pay() {
    setPaying(true);
    setError("");
    const rid = `r_${Date.now().toString(36)}`;
    const coords = point ?? { lat: 48.8606, lng: 2.3522 };
    const recipient = { id: rid, customerId: "me", ...r, ...coords, relation: r.relation || "Proche" };
    const subId = `sub_${rid}`;
    const subscription: Subscription = {
      id: subId,
      customerId: "me",
      planType,
      planId: plan,
      commitmentMonths: carnet ? 12 : 0,
      recipientId: carnet ? undefined : rid,
      startedAt: iso(startOfDay()),
      status: "active",
      priceCents: monthlyPrice,
    };
    const schedules = drafts.map((d, i) => ({ ...d, id: `s_${rid}_${i}`, recipientId: rid, subscriptionId: subId }));
    try {
      if (!isDemo) {
        const { url } = await api.checkout({ planType, planId: plan, recipient, schedules, customer: buyer, referral: referral || undefined });
        window.location.href = url;
        return;
      }
      await new Promise((res) => setTimeout(res, 1100));
      dispatch({ type: "addPlan", recipient, subscription, schedules });
      setDone({ date: firstDelivery?.date, florist: match?.florist.shopName });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Le paiement n'a pas abouti. Réessayez.");
    } finally {
      setPaying(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-dvh">
        <PetalRain />
        <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center">
          <Logo />
          <div className="pop mt-10 w-56">
            {chosen ? <ModelBouquet model={chosen} /> : <Bouquet palette={recipe.palette} seed={11} count={plan === "prestige" ? 9 : plan === "signature" ? 7 : 5} />}
          </div>
          <h1 className="mt-6 font-display text-5xl leading-tight">C&apos;est programmé.</h1>
          <p className="mt-4 text-lg text-ink-soft">
            {PLAN_TYPES[planType].name} {recipe.name.replace("Le ", "")} activé.{" "}
            {done.date && (
              <>
                Premier bouquet pour {r.firstName} le <strong className="text-ink">{frLong(done.date)}</strong>
                {done.florist ? <>, composé par {done.florist}.</> : "."}
              </>
            )}
          </p>
          <p className="mt-2 text-ink-soft">Trois jours avant chaque envoi, vous recevez un rappel pour relire le message ou surclasser le bouquet.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Button size="lg" onClick={() => router.push("/compte")}>Ouvrir mon carnet</Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => {
                setR({ firstName: "", lastName: "", relation: "", address: "", postalCode: "", city: "Paris", phone: "", accessNotes: "", lat: 0, lng: 0 });
                setMessage("");
                setEvents({});
                setDone(null);
                setStep(0);
                window.scrollTo(0, 0);
              }}
            >
              Ajouter un autre proche
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-paper">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <Link href="/" className="text-sm text-ink-soft hover:text-ink">Quitter</Link>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 md:py-12">
        <ol className="flex gap-1.5" aria-label="Étapes">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1">
              <button disabled={i > step} onClick={() => setStep(i)} className="group block w-full text-left disabled:cursor-default" aria-current={i === step ? "step" : undefined}>
                <span className={clsx("block h-1.5 rounded-full transition-colors", i <= step ? "bg-peony" : "bg-line")} />
                <span className={clsx("mt-2 hidden text-xs font-semibold sm:block", i === step ? "text-ink" : "text-ink-soft")}>{s}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_380px]">
          <div key={step} className="rise min-w-0">
            {step === 0 && (
              <>
                <H>Quelle formule ?</H>
                <div role="radiogroup" aria-label="Type d'abonnement" className="mt-8 grid gap-3 md:grid-cols-2">
                  {(["MONTHLY_RECURRING", "SPECIAL_EVENTS_CARNET"] as const).map((t) => {
                    const on = planType === t;
                    const pt = PLAN_TYPES[t];
                    return (
                      <button
                        key={t}
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          setPlanType(t);
                          if (t === "SPECIAL_EVENTS_CARNET" && !eventsChosen) setEvents({ birthday: { date: "", label: "" } });
                        }}
                        className={clsx("rounded-[22px] border-2 p-5 text-left transition", on ? (t === "MONTHLY_RECURRING" ? "border-peony bg-card" : "border-ink bg-ink text-paper") : "border-line bg-card hover:border-ink/30")}
                      >
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-display text-3xl">{pt.name}</span>
                          <span className={clsx("rounded-full px-2.5 py-1 text-xs font-bold", t === "MONTHLY_RECURRING" ? "bg-stem-soft text-stem" : "bg-pollen text-ink")}>
                            {t === "MONTHLY_RECURRING" ? "Sans engagement" : "Engagement 12 mois"}
                          </span>
                        </span>
                        <span className={clsx("mt-2 block text-sm", on && t !== "MONTHLY_RECURRING" ? "text-paper/75" : "text-ink-soft")}>{pt.pitch}</span>
                        <ul className={clsx("mt-3 space-y-1 text-sm", on && t !== "MONTHLY_RECURRING" ? "text-paper/90" : "text-ink")}>
                          {t === "MONTHLY_RECURRING" ? (
                            <>
                              <li>1 bouquet par mois, le jour de votre choix</li>
                              <li>Occasions : le bouquet du mois livré ce jour-là pour +30 % ({euros(occasionSurchargeCents(plan, state.catalog), true)} en {recipe.name.replace("Le ", "")})</li>
                            </>
                          ) : (
                            <>
                              <li>Vous payez seulement vos dates, au prix abonné (−{pct} %), lissées sur 12 mois</li>
                              <li>Exemple : 4 dates en Signature = {euros(Math.ceil((4 * subscriberPriceCents("signature", state.catalog)) / 12), true)} par mois</li>
                              <li>Engagement 12 mois, puis sans engagement</li>
                            </>
                          )}
                        </ul>
                      </button>
                    );
                  })}
                </div>

                <h2 className="mt-10 font-semibold">{carnet ? "Taille par défaut (modifiable date par date)" : "Taille du bouquet"}</h2>
                <div role="radiogroup" aria-label="Gamme" className="mt-3 grid gap-4 sm:grid-cols-3">
                  {CATALOG.map((c, i) => (
                    <button
                      key={c.planId}
                      role="radio"
                      aria-checked={plan === c.planId}
                      onClick={() => {
                        setPlan(c.planId);
                        if (selection.mode === "fixed") setSelection({ mode: "fixed", modelId: modelsOf(c.planId, state.models)[0]?.id });
                        setEvents((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, { ...v!, upgradeTo: undefined }])));
                        if (c.planId !== "classique") setExtraStemId("");
                      }}
                      className={clsx("rounded-[22px] border-2 bg-card p-5 text-left transition", plan === c.planId ? "border-peony shadow-[0_18px_40px_-24px_rgba(226,63,107,0.9)]" : "border-transparent hover:border-line")}
                    >
                      <div className="mx-auto w-24"><Bouquet palette={c.palette} seed={i * 5 + 2} count={5 + i * 2} /></div>
                      <p className="mt-2 font-display text-2xl">{c.name}</p>
                      <p className="text-sm text-ink-soft">{c.size}</p>
                      <p className="mt-3 font-semibold">
                        {carnet ? (
                          <>
                            {euros(subscriberPriceCents(c.planId, state.catalog), true)} <span className="font-normal text-ink-soft">la date · <s>{euros(c.priceCents)}</s></span>
                          </>
                        ) : (
                          <>
                            {euros(c.priceCents)} <span className="font-normal text-ink-soft">/ mois</span>
                          </>
                        )}
                      </p>
                    </button>
                  ))}
                </div>
                {carnet && (
                  <p className="mt-5 rounded-2xl bg-pollen-soft px-4 py-3 text-sm text-[#7a5300]">
                    Engagement de 12 mois sur la mensualité calculée à partir de vos dates, puis sans engagement. Rétractation possible pendant {RETRACTATION_DAYS} jours tant qu&apos;aucun bouquet n&apos;est parti.
                  </p>
                )}
              </>
            )}

            {step === 1 && (
              <>
                <H>Un modèle précis, ou la surprise ?</H>
                <p className="mt-2 text-ink-soft">Dans la gamme {recipe.name.replace("Le ", "")}, choisissez un bouquet précis ou laissez-nous en changer à chaque envoi. Vous pourrez ajuster date par date depuis votre carnet.</p>
                <div className="mt-8">
                  <BouquetChoice planId={plan} mode={selection.mode} modelId={selection.modelId} models={state.models} onChange={setSelection} />
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <H>À qui offrez-vous ces fleurs ?</H>
                <div className="mt-8 grid gap-5 sm:grid-cols-2">
                  <Field label="Prénom"><input className={inputCls} value={r.firstName} onChange={(e) => setR({ ...r, firstName: e.target.value })} placeholder="Hélène" autoFocus /></Field>
                  <Field label="Nom"><input className={inputCls} value={r.lastName} onChange={(e) => setR({ ...r, lastName: e.target.value })} placeholder="Martin" /></Field>
                  <Field label="Qui est-ce pour vous ?" className="sm:col-span-2">
                    <div className="flex flex-wrap gap-2">
                      {["Maman", "Papa", "Mon amour", "Mamie", "Une amie", "Un client"].map((x) => (
                        <button type="button" key={x} onClick={() => setR({ ...r, relation: x })} className={clsx("rounded-full border px-3.5 py-1.5 text-sm", r.relation === x ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-ink/40")}>
                          {x}
                        </button>
                      ))}
                    </div>
                  </Field>
                  <Field label="Adresse de livraison" className="sm:col-span-2" hint={r.lat ? "Adresse vérifiée." : "Commencez à taper, puis choisissez dans la liste."}>
                    <AddressInput
                      value={r.address}
                      onChange={(v) => setR((x) => ({ ...x, address: v, lat: 0, lng: 0 }))}
                      onPick={(h) => setR((x) => ({ ...x, address: h.street, postalCode: h.postalCode, city: h.city, lat: h.lat, lng: h.lng }))}
                    />
                  </Field>
                  <Field label="Code postal"><input className={inputCls} value={r.postalCode} inputMode="numeric" onChange={(e) => setR({ ...r, postalCode: e.target.value })} placeholder="75011" /></Field>
                  <Field label="Ville"><input className={inputCls} value={r.city} onChange={(e) => setR({ ...r, city: e.target.value })} /></Field>
                  <Field label="Téléphone du destinataire" hint="Uniquement pour le livreur."><input className={inputCls} type="tel" value={r.phone} onChange={(e) => setR({ ...r, phone: e.target.value })} placeholder="06 12 34 56 78" /></Field>
                  <Field label="Notes d'accès"><input className={inputCls} value={r.accessNotes} onChange={(e) => setR({ ...r, accessNotes: e.target.value })} placeholder="Code 4B21, 3e gauche" /></Field>
                </div>
                {covered === true && match && (
                  <p className="pop mt-6 rounded-2xl bg-stem-soft px-4 py-3 text-sm text-stem">
                    {match.florist.shopName} est à {match.distanceKm.toFixed(1).replace(".", ",")} km. C&apos;est cet atelier qui composera ses bouquets.
                  </p>
                )}
                {/^\d{5}$/.test(r.postalCode) && covered !== true && (
                  <div className="pop mt-6 rounded-2xl bg-pollen-soft p-4 text-sm text-[#7a5300]">
                    <p className="font-semibold">Nous ne livrons pas encore le {r.postalCode}.</p>
                    <p className="mt-1">Paris et la petite couronne pour l&apos;instant. Laissez votre e-mail : on vous écrit le jour où un atelier ouvre près de chez {r.firstName || "votre proche"}.</p>
                    {waitDone ? (
                      <p className="mt-3 font-semibold text-stem">C&apos;est noté, on vous prévient.</p>
                    ) : (
                      <form
                        className="mt-3 flex flex-col gap-2 sm:flex-row"
                        onSubmit={(e) => {
                          e.preventDefault();
                          dispatch({ type: "waitlist", email: waitEmail, postalCode: r.postalCode });
                          if (!isDemo) void api.waitlist(waitEmail, r.postalCode).catch(() => {});
                          setWaitDone(true);
                        }}
                      >
                        <input type="email" required aria-label="Votre e-mail" className={inputCls} value={waitEmail} onChange={(e) => setWaitEmail(e.target.value)} placeholder="vous@exemple.fr" />
                        <Button type="submit" variant="ink">Me prévenir</Button>
                      </form>
                    )}
                  </div>
                )}
              </>
            )}

            {step === 3 && (
              <>
                <H>{carnet ? `Les dates clés de ${firstName}` : `Quand ${firstName} reçoit ses fleurs`}</H>
                {!carnet && (
                  <div className="mt-8 rounded-[22px] border-2 border-peony bg-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-semibold">Bouquet du mois <span className="font-normal text-ink-soft">· inclus dans les {euros(recipe.priceCents)}</span></p>
                      <select aria-label="Jour de livraison mensuelle" className={clsx(inputCls, "w-auto")} value={dayOfMonth} onChange={(e) => setDayOfMonth(+e.target.value)}>
                        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                          <option key={d} value={d}>Le {d} de chaque mois</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                <h2 className="mt-8 font-semibold">
                  {carnet ? "Choisissez ses occasions" : "Des occasions en plus ?"}
                  <span className="ml-2 font-normal text-ink-soft">
                    {carnet ? `Au prix abonné, 1 bouquet maximum par mois` : `+${euros(occasionSurchargeCents(plan, state.catalog), true)} chacune au prix abonné`}
                  </span>
                </h2>
                {!carnet && (
                  <p className="mt-1 text-sm text-ink-soft">
                    Le bouquet du mois est livré le jour de l&apos;occasion, en version Spécial événement (+30 % de la formule, prélevés 3 jours avant). 1 bouquet maximum par mois : 12 par an au total.
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  {EVENTS.map((ev) => {
                    const d = events[ev.id];
                    const on = !!d;
                    const occ = preview.occ.find((e) => e.type === ev.id);
                    return (
                      <div key={ev.id} className={clsx("rounded-2xl border-2 bg-card p-4 transition", on ? "border-peony" : "border-transparent")}>
                        <button type="button" aria-pressed={on} onClick={() => toggleEvent(ev.id)} className="flex w-full items-start gap-3 text-left">
                          <span className={clsx("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border-2 text-[11px] text-white", on ? "border-peony bg-peony" : "border-line")}>{on && "✓"}</span>
                          <span className="flex-1">
                            <span className="block font-semibold">{ev.label}</span>
                            <span className="text-sm text-ink-soft">{ev.hint}</span>
                          </span>
                          {on && occ && occ.status === "planned" && (
                            <span className="text-sm font-semibold">
                              {carnet ? `${euros(subscriberPriceCents(occ.basePlan, state.catalog), true)}` : occ.priceCents ? `+${euros(occ.priceCents, true)}` : "Inclus"}
                            </span>
                          )}
                        </button>
                        {on && (
                          <div className="pop mt-3 grid gap-3 pl-8 sm:grid-cols-2">
                            {ev.needsDate && (
                              <Field label={ev.id === "birthday" ? "Date d'anniversaire" : "Date"}>
                                <input type="date" className={inputCls} value={d.date} onChange={(e) => setEvent(ev.id, { date: e.target.value })} />
                              </Field>
                            )}
                            {ev.id === "custom" && (
                              <Field label="Occasion"><input className={inputCls} value={d.label} onChange={(e) => setEvent(ev.id, { label: e.target.value })} placeholder="Anniversaire de mariage" /></Field>
                            )}
                            {carnet && (
                              <Field label="Taille de ce bouquet">
                                <select className={inputCls} value={d.plan ?? plan} onChange={(e) => setEvent(ev.id, { plan: e.target.value as PlanId })}>
                                  {CATALOG.map((c) => (
                                    <option key={c.planId} value={c.planId}>
                                      {c.name.replace("Le ", "")} : {euros(subscriberPriceCents(c.planId, state.catalog), true)} (au lieu de {euros(c.priceCents)})
                                    </option>
                                  ))}
                                </select>
                              </Field>
                            )}
                            {!carnet && plan !== "prestige" && (
                              <Field label="Taille pour cette occasion" hint="Tarif abonné, moins cher que l'écart public.">
                                <select className={inputCls} value={d.upgradeTo ?? ""} onChange={(e) => setEvent(ev.id, { upgradeTo: (e.target.value || undefined) as PlanId | undefined })}>
                                  <option value="">{recipe.name.replace("Le ", "")} (taille de l&apos;abonnement)</option>
                                  {upgradeOptions(plan, state.catalog).map((u) => (
                                    <option key={u.to} value={u.to}>
                                      {getRecipe(u.to).name.replace("Le ", "")} : +{euros(u.priceCents)} au lieu de +{euros(u.publicGapCents)}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                            )}
                            {!carnet && occ?.status === "planned" && (
                              <p className="rounded-xl bg-lilac/70 px-3 py-2 text-sm sm:col-span-2">
                                Le bouquet de {MONTHS[parseISO(occ.date).getMonth()]} sera livré le {frShort(occ.date)} en Spécial événement{occ.near ? `, à la place de celui du ${frShort(occ.near.date)}` : ""}.
                              </p>
                            )}
                            {!carnet && (() => {
                              const clash = preview.occ.find((e) => e.type === ev.id && e.status === "blocked" && e.date < yearEnd);
                              return clash ? <p role="alert" className="rounded-xl bg-peony/10 px-3 py-2 text-sm font-semibold text-peony-deep sm:col-span-2">{clash.blockReason}</p> : null;
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {plan === "classique" && !carnet && (
                  <Field label="Extra tige noble à chaque envoi" className="mt-6" hint="Ajouté au bouquet par le fleuriste, prélevé 3 jours avant chaque envoi.">
                    <select className={inputCls} value={extraStemId} onChange={(e) => setExtraStemId(e.target.value)}>
                      <option value="">Sans extra</option>
                      {EXTRA_STEMS.map((x) => (
                        <option key={x.id} value={x.id}>{x.label} : +{euros(x.priceCents)}</option>
                      ))}
                    </select>
                  </Field>
                )}

                {!carnet && (
                  <p className={clsx("mt-4 rounded-2xl px-4 py-3 text-sm", monthClash.length ? "bg-peony/10 font-semibold text-peony-deep" : "bg-paper-2 text-ink-soft")}>
                    {monthClash.length
                      ? "Deux occasions tombent le même mois : gardez-en une seule (1 bouquet par mois)."
                      : `12 bouquets sur l'année : ${occasionsThisYear} Spécial événement${occasionsThisYear > 1 ? "s" : ""} + ${12 - occasionsThisYear} bouquet${12 - occasionsThisYear > 1 ? "s" : ""} du mois.`}
                  </p>
                )}

                {carnet && <CarnetYear occ={preview.occ} issues={preview.issues} />}
              </>
            )}

            {step === 4 && (
              <>
                <H>Le mot sur la carte</H>
                <p className="mt-2 text-ink-soft">Il sera écrit à la main par le fleuriste. Vous pourrez le changer avant chaque envoi.</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {MESSAGES.map((m) => (
                    <button key={m} type="button" onClick={() => setMessage(m)} className="rounded-full border border-line bg-card px-3.5 py-1.5 text-sm hover:border-ink/40">
                      {m}
                    </button>
                  ))}
                </div>
                <div className="mt-6 grid gap-6 md:grid-cols-2">
                  <Field label="Votre message" hint={`${message.length} / 200`}>
                    <textarea className={clsx(inputCls, "min-h-40 resize-none")} maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Écrivez quelques mots…" />
                  </Field>
                  <div className="rotate-[-1.5deg] self-start rounded-md bg-[#fffdf8] p-6 shadow-[0_20px_40px_-20px_rgba(43,16,48,0.4)]">
                    <p className="text-sm text-ink-soft">Pour {r.firstName || "…"}</p>
                    <p className="mt-3 min-h-20 font-display text-2xl italic leading-snug">{message || "Votre message apparaîtra ici."}</p>
                    <p className="mt-4 text-right text-sm text-ink-soft">— {buyer.firstName || "Vous"}</p>
                  </div>
                </div>
              </>
            )}

            {step === 5 && (
              <>
                <H>Dernière étape</H>
                <div className="mt-8 grid gap-5 sm:grid-cols-2">
                  <Field label="Votre prénom"><input className={inputCls} value={buyer.firstName} onChange={(e) => setBuyer({ ...buyer, firstName: e.target.value })} /></Field>
                  <Field label="Votre e-mail" hint="Pour les rappels et les photos de livraison."><input type="email" className={inputCls} value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} /></Field>
                </div>
                <div className="mt-8 rounded-2xl border border-line bg-card p-5 text-sm">
                  <p className="font-semibold">Ce que vous acceptez</p>
                  <ul className="mt-2 space-y-1 text-ink-soft">
                    <li>
                      {euros(firstCharge, true)} prélevés aujourd&apos;hui{referral ? ` (code ${referral} : −${euros(REFERRAL_CENTS)})` : ""}, puis {euros(monthlyPrice, true)} chaque mois à la même date.
                    </li>
                    {carnet ? (
                      <li>Engagement de 12 mois ({euros(monthlyPrice * 12, true)} au total), puis sans engagement. Résiliation à tout moment, effective à la fin des 12 mois.</li>
                    ) : (
                      <li>Sans engagement : pause ou arrêt en un clic depuis votre carnet.</li>
                    )}
                    <li>Rétractation pendant {RETRACTATION_DAYS} jours, remboursement intégral tant qu&apos;aucun bouquet n&apos;est parti.</li>
                    {preview.occ.some((e) => e.priceCents > 0) && <li>Les suppléments (occasions en plus, surclassements, extras) sont prélevés 3 jours avant chaque envoi.</li>}
                  </ul>
                  <p className="mt-3 text-ink-soft">
                    {isDemo ? "Mode démonstration : aucune carte n'est demandée et rien n'est prélevé." : "Paiement sécurisé par Stripe. Carte, Apple Pay et Google Pay acceptés."}
                  </p>
                </div>
                <label className="mt-4 flex items-start gap-3 text-sm">
                  <input type="checkbox" checked={cgv} onChange={(e) => setCgv(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#e23f6b]" />
                  <span>
                    J&apos;ai lu et j&apos;accepte les <Link href="/cgv" className="font-semibold underline">conditions générales de vente</Link>
                    {carnet ? ", y compris l'engagement de 12 mois" : ""}.
                  </span>
                </label>
                {error && <p role="alert" className="mt-4 rounded-xl bg-[#fde2ea] px-4 py-3 text-sm text-peony-deep">{error}</p>}
              </>
            )}

            <div className="mt-10 flex items-center justify-between gap-3">
              {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}>Retour</Button> : <span />}
              {step < 5 ? (
                <Button size="lg" disabled={!valid} onClick={() => setStep(step + 1)}>Continuer</Button>
              ) : (
                <Button size="lg" disabled={!valid || paying} onClick={pay}>
                  {paying ? "Confirmation…" : `Confirmer et payer ${euros(firstCharge, true)}`}
                </Button>
              )}
            </div>
          </div>

          {/* Récapitulatif */}
          <aside className="lg:sticky lg:top-8 lg:self-start">
            <div className="rounded-[26px] bg-ink p-6 text-paper">
              <div className="mx-auto w-36">
                {chosen ? (
                  <ModelBouquet key={chosen.id} model={chosen} wrap="#f7e6ea" />
                ) : step >= 1 ? (
                  <div className="h-40"><SurpriseFan key={plan} models={pool} /></div>
                ) : (
                  <Bouquet key={plan} palette={recipe.palette} seed={CATALOG.findIndex((c) => c.planId === plan) * 5 + 2} count={plan === "prestige" ? 9 : plan === "signature" ? 7 : 5} wrap="#f7e6ea" />
                )}
              </div>
              <p className="mt-3 text-sm text-paper/60">{PLAN_TYPES[planType].name}</p>
              <p className="font-display text-3xl">{carnet ? `${drafts.length} date${drafts.length > 1 ? "s" : ""} clé${drafts.length > 1 ? "s" : ""}` : recipe.name}</p>
              <dl className="mt-5 space-y-3 text-sm">
                <Row k="Engagement" v={carnet ? "12 mois" : "Aucun"} />
                <Row k="Bouquet" v={step < 1 ? "—" : chosen ? chosen.name : "Surprise, en rotation"} />
                <Row k="Pour" v={r.firstName ? `${r.firstName} ${r.lastName}`.trim() : "—"} />
                <Row k="Dates" v={drafts.length ? drafts.map((d) => d.label).join(", ") : "—"} />
                <Row k="Premier envoi" v={firstDelivery ? frLong(firstDelivery.date) : "—"} />
              </dl>
              <div className="mt-6 border-t border-paper/15 pt-5">
                <div className="flex items-baseline justify-between">
                  <span className="text-paper/70">Par mois</span>
                  <span className="font-display text-4xl">{euros(monthlyPrice, monthlyPrice % 100 !== 0)}</span>
                </div>
                <Extras occ={preview.occ} />
              </div>
              {referral && <p className="mt-2 rounded-xl bg-pollen px-3 py-2 text-xs font-semibold text-ink">Code {referral} : −{euros(REFERRAL_CENTS)} sur le premier mois</p>}
              <p className="mt-3 text-xs text-paper/60">
                Livraison incluse. {carnet ? `${preview.occ.filter((e) => e.status === "planned").length ? "" : ""}Engagement 12 mois (${euros(monthlyPrice * 12, true)} au total), puis sans engagement.` : "Sans engagement."}
              </p>
            </div>
            <LinkButton href="/compte" variant="ghost" size="sm" className="mt-3 w-full">Déjà abonné ? Ouvrir mon carnet</LinkButton>
          </aside>
        </div>
      </div>
    </div>
  );
}

/** Suppléments sur les 12 prochains mois (une ligne par occasion). */
function Extras({ occ }: { occ: ReturnType<typeof planOccurrences> }) {
  const first = new Map<string, (typeof occ)[number]>();
  for (const e of occ) if (e.priceCents > 0 && !first.has(e.scheduleId)) first.set(e.scheduleId, e);
  if (!first.size) return null;
  return (
    <ul className="mt-3 space-y-1.5 text-sm">
      {[...first.values()].map((e) => (
        <li key={e.key} className="flex justify-between gap-3">
          <span className="text-paper/70">{e.label}</span>
          <span className="font-semibold">+{euros(e.priceCents, true)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Carnet : les 12 prochains mois, un bouquet maximum par mois. */
function CarnetYear({ occ, issues }: { occ: ReturnType<typeof planOccurrences>; issues: string[] }) {
  const start = startOfDay();
  const months = Array.from({ length: 12 }, (_, i) => new Date(start.getFullYear(), start.getMonth() + i, 1));
  const used = occ.filter((e) => e.status === "planned").length;
  return (
    <section aria-label="Votre année" className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Votre année</h2>
        <p className="tabular text-sm text-ink-soft">{Math.min(used, CARNET_YEARLY_QUOTA)} / {CARNET_YEARLY_QUOTA} bouquets</p>
      </div>
      <ol className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {months.map((m) => {
          const ym = iso(m).slice(0, 7);
          const inMonth = occ.filter((e) => e.date.slice(0, 7) === ym);
          const blocked = inMonth.some((e) => e.status === "blocked");
          return (
            <li key={ym} className={clsx("min-h-20 rounded-xl p-2 text-xs", blocked ? "bg-[#fde2ea] text-peony-deep" : inMonth.length ? "bg-ink text-paper" : "bg-card text-ink-soft")}>
              <span className="block font-semibold capitalize">{SHORT_MONTH.format(m)}</span>
              {inMonth.map((e) => (
                <span key={e.key} className={clsx("mt-1 block leading-tight", e.status === "blocked" && "line-through")}>
                  {e.label} · {parseISO(e.date).getDate()}
                </span>
              ))}
            </li>
          );
        })}
      </ol>
      {issues.map((x) => (
        <p key={x} role="alert" className="mt-3 rounded-xl bg-[#fde2ea] px-4 py-2.5 text-sm text-peony-deep">{x} Retirez ou déplacez une date pour continuer.</p>
      ))}
    </section>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h1 className="font-display text-4xl leading-tight sm:text-5xl">{children}</h1>;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-paper/60">{k}</dt>
      <dd className="text-right font-semibold">{v}</dd>
    </div>
  );
}
