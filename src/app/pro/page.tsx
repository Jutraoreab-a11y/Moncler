"use client";

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { RecipeSheet } from "@/components/pro/recipe-sheet";
import { CardCode } from "@/components/pro/card-code";
import { DayCutoffBanner, fmtAt, fmtLeft, GuaranteeRules, OfferActions, PendingOffers, ReliabilityPanel, useNow } from "@/components/pro/guarantee-ui";
import { GUARANTEE, parisDate } from "@/lib/guarantee";
import { compressImage } from "@/lib/image";
import { isPeakDate } from "@/lib/pricing";
import { publicCode } from "@/lib/engine";
import { PRO_TABS } from "@/components/pro/tabs";
import { useToast } from "@/components/toast";
import { Button, LinkButton, Panel, StatusBadge } from "@/components/ui";
import { api, isDemo } from "@/lib/api-client";
import { euros, FREE_ORDER_LIMIT, getRecipe, PRO_FREE_BELOW, PRO_PRICE_CENTS } from "@/lib/catalog";
import { chime } from "@/lib/chime";
import { addDays, daysBetween, frShort, iso, parseISO, startOfDay } from "@/lib/dates";
import { haversineKm, isLocked } from "@/lib/matching";
import { useStore } from "@/lib/store";
import { findModel, pickModel } from "@/lib/models";
import type { Order, OrderStatus } from "@/lib/types";


const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  assigned: { to: "preparing", label: "Commencer la préparation" },
  preparing: { to: "ready", label: "Prêt à être récupéré" },
};

const DAY = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });

export default function ProPage() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const florist = state.florists.find((f) => f.id === state.currentFloristId)!;
  const locked = isLocked(florist);
  const today = startOfDay();
  const [day, setDay] = useState<string>(iso(today));
  const [fresh, setFresh] = useState<string | null>(null);

  const orders = useMemo(
    () => state.orders.filter((o) => o.floristId === florist.id && o.status !== "cancelled" && o.deliveryDate >= iso(today)),
    [state.orders, florist.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // 8 prochains jours + jours de pic plus lointains déjà visibles
  const days = [...new Set([...Array.from({ length: 8 }, (_, i) => iso(addDays(today, i))), ...orders.filter((o) => isPeakDate(o.deliveryDate)).map((o) => o.deliveryDate)])].sort();
  const dayOrders = orders
    .filter((o) => o.deliveryDate === day)
    .sort((a, b) => Number(a.status === "delivered") - Number(b.status === "delivered") || Number(!!b.priority) - Number(!!a.priority) || rank(a.status) - rank(b.status));
  const lockedOrders = orders.filter((o) => o.status === "assigned");
  const lockedValue = lockedOrders.reduce((s, o) => s + (o.payoutCents ?? getRecipe(o.planId, state.catalog).floristPayoutCents), 0);

  const since = addDays(today, -30).toISOString();
  const monthPayouts = state.payouts.filter((p) => p.floristId === florist.id && p.createdAt >= since);
  const monthRevenue = monthPayouts.reduce((s, p) => s + p.amountCents, 0);
  const pending = state.payouts.filter((p) => p.floristId === florist.id && p.status === "pending");
  // Moncleur Pro offert les mois calmes
  const monthKey = iso(today).slice(0, 7);
  const deliveredThisMonth = state.orders.filter((o) => o.floristId === florist.id && o.status === "delivered" && o.deliveryDate.slice(0, 7) === monthKey).length;
  const proFree = deliveredThisMonth < PRO_FREE_BELOW;
  // Jours de pic à venir (visibles 3 semaines avant)
  const peaks = [...new Set(orders.filter((o) => isPeakDate(o.deliveryDate) && o.status !== "delivered").map((o) => o.deliveryDate))]
    .sort()
    .map((d) => ({ date: d, n: orders.filter((o) => o.deliveryDate === d && o.status !== "delivered").length }));

  // Démo : un atelier voisin n'a pas pu préparer une commande du jour → reprise urgente proposée
  const simulated = useRef(false);
  function simulateIncoming(silent = false) {
    const id = `r_sim_${Date.now().toString(36)}`;
    const names = [["Margaux", "Fontaine"], ["Chloé", "Bernard"], ["Sarah", "Lambert"], ["Louise", "Girard"]];
    const [fn, ln] = names[Math.floor(Math.random() * names.length)];
    const lat = florist.lat + (Math.random() - 0.5) * 0.03;
    const lng = florist.lng + (Math.random() - 0.5) * 0.04;
    const plan = (["classique", "signature", "prestige"] as const)[Math.floor(Math.random() * 3)];
    const recipient = { id, customerId: "c_sim", firstName: fn, lastName: ln, relation: "Amie", address: `${10 + Math.floor(Math.random() * 80)} rue de la Folie-Méricourt`, postalCode: "75011", city: "Paris", lat, lng, phone: "06 00 00 00 00", accessNotes: "" };
    const neighbour = state.florists.find((f) => f.id !== florist.id && f.active)?.id ?? null;
    const at = new Date().toISOString();
    const order: Order = {
      id: `ord_sim_${Date.now()}`,
      publicCode: publicCode(`sim_${Date.now()}`),
      attempt: 1,
      payoutCents: getRecipe(plan, state.catalog).floristPayoutCents,
      revenueCents: getRecipe(plan, state.catalog).priceCents,
      paymentStatus: "included",
      scheduleId: "sim",
      recipientId: id,
      planId: plan,
      mode: "surprise",
      modelId: pickModel({ planId: plan, mode: "surprise", recipientId: id }, state.models, []),
      deliveryDate: parisDate(),
      status: "scheduled",
      floristId: null,
      message: "Surprise ! Je pense fort à toi aujourd'hui.",
      courier: "uber_direct",
      distanceKm: Math.round(haversineKm(florist, { lat, lng }) * 10) / 10,
      rescue: true,
      declinedBy: neighbour ? [neighbour] : [],
      critical: true,
      handoffs: [{ from: neighbour, to: null, at, reason: "CRITICAL_REASSIGN : pas en préparation à 11 h 30" }],
      offer: { floristIds: [florist.id], at, remindAt: new Date(Date.now() + 3600_000).toISOString(), expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(), open: true, round: 2, bonusCents: Math.round(getRecipe(plan, state.catalog).floristPayoutCents * GUARANTEE.rescueBonusRate) },
      statusAt: { scheduled: at },
    };
    dispatch({ type: "inject", order, recipient });
    setFresh(order.id);
    if (!silent) chime();
    toast({ title: "Urgence près de chez vous", body: `${findModel(order.modelId, state.models)?.name ?? getRecipe(plan).name} pour ${fn}, aujourd'hui. Prime de secours : +${euros(order.offer!.bonusCents!, true)} (+20 %).`, tone: "alert" });
  }
  useEffect(() => {
    if (!isDemo || simulated.current) return;
    simulated.current = true;
    const t = setTimeout(() => simulateIncoming(), 9000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Notifications de garantie qui concernent cet atelier (rappel, bascule, reprise…)
  const seen = useRef<number | null>(null);
  const lastAt = useRef("");
  useEffect(() => {
    const log = state.guaranteeLog ?? [];
    const latest = log[0]?.at ?? "";
    if (seen.current === null) {
      seen.current = log.length;
      lastAt.current = latest;
      return;
    }
    const news = log.filter((e) => e.at > lastAt.current && e.floristIds.includes(florist.id) && ["remind", "expired", "day_missed", "day_reminder", "day_alert", "critical_reassign", "closure", "locked", "urgent"].includes(e.kind));
    lastAt.current = latest || lastAt.current;
    // 11 h : alerte sonore (en plus du SMS)
    if (news.some((e) => e.kind === "day_alert" || e.kind === "critical_reassign")) chime();
    news.slice(0, 2).forEach((e) => toast({ title: TITLES[e.kind] ?? "Moncleur", body: e.text, tone: ["expired", "day_missed", "day_alert", "critical_reassign"].includes(e.kind) ? "alert" : undefined }));
  }, [state.guaranteeLog]); // eslint-disable-line react-hooks/exhaustive-deps

  function advance(o: Order, to: OrderStatus) {
    dispatch({ type: "status", orderId: o.id, status: to });
    const r = state.recipients.find((x) => x.id === o.recipientId)!;
    if (to === "ready") {
      if (o.courier === "own") {
        toast({ title: "Bouquet prêt", body: "Votre livreur peut partir quand il veut." });
      } else {
        const name = o.courier === "uber_direct" ? "Uber Direct" : "Stuart";
        toast({ title: `Coursier ${name} demandé`, body: "Arrivée estimée à l'atelier dans 8 min." });
        if (isDemo) setTimeout(() => dispatch({ type: "status", orderId: o.id, status: "in_delivery" }), 3500);
      }
    }
    if (to === "delivered") {
      const left = FREE_ORDER_LIMIT - (florist.completedOrders + 1);
      toast({
        title: `Livré à ${r.firstName}`,
        body: florist.saasPlan === "pro" ? `${euros(o.payoutCents ?? getRecipe(o.planId, state.catalog).floristPayoutCents)} virés sous 48 h.` : left > 0 ? `Plus que ${left} commande${left > 1 ? "s" : ""} offerte${left > 1 ? "s" : ""}.` : "Vous avez utilisé vos 10 commandes offertes.",
        tone: "success",
      });
    }
  }

  async function activatePro() {
    if (!isDemo) {
      const { url } = await api.proSubscribe(florist.id);
      window.location.href = url;
      return;
    }
    dispatch({ type: "activatePro", floristId: florist.id });
    chime();
    toast({ title: "Moncleur Pro activé", body: "Commandes illimitées. Vos commandes en attente sont débloquées.", tone: "success" });
  }

  return (
    <AppShell
      tabs={PRO_TABS}
      tone="ink"
      right={
        <div className="flex items-center gap-2">
          {isDemo && (
            <span className="hidden sm:block">
              <Button size="sm" variant="outline" onClick={() => simulateIncoming()}>
                Simuler une urgence
              </Button>
            </span>
          )}
          <span className="hidden text-right text-sm sm:block">
            <span className="block font-semibold leading-tight">{florist.shopName}</span>
            <span className="text-xs text-ink-soft">{florist.saasPlan === "pro" ? "Moncleur Pro" : "Offre découverte"}</span>
          </span>
        </div>
      }
    >
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* En-tête : compteur freemium */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Panel className="p-5">
            {florist.saasPlan === "pro" ? (
              <>
                <p className="text-sm text-ink-soft">Abonnement</p>
                <p className="mt-1 font-display text-3xl">Moncleur Pro</p>
                <p className="mt-1 text-sm text-ink-soft">
                  {proFree
                    ? `${deliveredThisMonth} livraison${deliveredThisMonth > 1 ? "s" : ""} ce mois-ci : offert (moins de ${PRO_FREE_BELOW})`
                    : `${euros(PRO_PRICE_CENTS)} ce mois-ci · ${deliveredThisMonth} livraisons`}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <p className="text-sm text-ink-soft">Commandes offertes</p>
                  <p className="tabular font-display text-3xl">
                    {Math.min(florist.completedOrders, FREE_ORDER_LIMIT)}
                    <span className="text-lg text-ink-soft"> / {FREE_ORDER_LIMIT}</span>
                  </p>
                </div>
                <div className="mt-3 flex gap-1" aria-hidden>
                  {Array.from({ length: FREE_ORDER_LIMIT }, (_, i) => (
                    <span key={i} className={clsx("h-2 flex-1 rounded-full transition-colors duration-500", i < florist.completedOrders ? (locked ? "bg-peony" : "bg-stem") : "bg-line")} />
                  ))}
                </div>
                <p className="mt-3 text-sm text-ink-soft">
                  {locked ? "Offre découverte terminée." : `Encore ${FREE_ORDER_LIMIT - florist.completedOrders} livraisons avant de passer Pro.`}
                </p>
              </>
            )}
          </Panel>
          <Panel className="p-5">
            <p className="text-sm text-ink-soft">Revenus sur 30 jours</p>
            <p className="tabular mt-1 font-display text-4xl">{euros(monthRevenue)}</p>
            <p className="mt-1 text-sm text-ink-soft">{pending.length ? `${euros(pending.reduce((s, p) => s + p.amountCents, 0))} en cours de virement` : "Tous vos virements sont arrivés"}</p>
          </Panel>
          <Panel className="p-5">
            <p className="text-sm text-ink-soft">À produire cette semaine</p>
            <p className="tabular mt-1 font-display text-4xl">{orders.filter((o) => o.status !== "delivered").length} bouquets</p>
            <p className="mt-1 text-sm text-ink-soft">
              {(["classique", "signature", "prestige"] as const)
                .map((p) => `${orders.filter((o) => o.planId === p && o.status !== "delivered").length} ${getRecipe(p).name.replace("Le ", "")}`)
                .join(" · ")}
            </p>
          </Panel>
          <ReliabilityPanel florist={florist} />
        </div>

        {/* Paywall */}
        {locked && (
          <section className="pop mt-6 overflow-hidden rounded-[26px] bg-peony text-white">
            <div className="grid items-center gap-6 p-6 sm:p-8 md:grid-cols-[1fr_auto]">
              <div>
                <h2 className="font-display text-4xl leading-tight">
                  {lockedOrders.length ? `${lockedOrders.length} commande${lockedOrders.length > 1 ? "s" : ""} vous attend${lockedOrders.length > 1 ? "ent" : ""}, soit ${euros(lockedValue)}.` : "Vos 10 commandes offertes sont utilisées."}
                </h2>
                <p className="mt-2 max-w-xl text-white/85">
                  Activez Moncleur Pro pour les débloquer et continuer à recevoir les commandes de votre quartier : {euros(PRO_PRICE_CENTS)} par mois, offert les mois où vous livrez moins de {PRO_FREE_BELOW} bouquets. Sans activation, elles seront confiées à un autre atelier dans 24 h.
                </p>
              </div>
              <div className="text-center">
                <Button size="lg" variant="ink" onClick={activatePro}>Activer Pro, {euros(PRO_PRICE_CENTS)} / mois</Button>
                <p className="mt-2 text-xs text-white/75">Sans engagement · résiliable à tout moment</p>
              </div>
            </div>
          </section>
        )}

        {!locked && <PendingOffers florist={florist} />}
        <DayCutoffBanner florist={florist} today={parisDate()} />

        {peaks.map((p) => {
          const over = p.n > (florist.dailyCapacity ?? Infinity);
          return (
            <section key={p.date} className={clsx("mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[22px] px-5 py-4", over ? "bg-peony text-white" : "bg-pollen-soft text-[#5c3d00]")}>
              <p>
                <strong>{isPeakLabel(p.date)} dans {daysBetween(today, parseISO(p.date))} jours</strong> : {p.n} bouquet{p.n > 1 ? "s" : ""} prévu{p.n > 1 ? "s" : ""} le {frShort(p.date)}
                {florist.dailyCapacity ? ` pour une capacité de ${florist.dailyCapacity} par jour.` : "."} Commandez vos fleurs maintenant.
              </p>
              {over && <LinkButton href="/pro/boutique" variant="ink" size="sm">Augmenter ma capacité</LinkButton>}
            </section>
          );
        })}

        {/* Calendrier J → J+7 */}
        <div className="mt-8 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Jours de livraison">
          {days.map((d, i) => {
            const n = orders.filter((o) => o.deliveryDate === d && o.status !== "delivered").length;
            const dt = parseISO(d);
            return (
              <button
                key={d}
                role="tab"
                aria-selected={day === d}
                onClick={() => setDay(d)}
                className={clsx("min-w-[86px] shrink-0 rounded-2xl border px-3 py-3 text-left transition", day === d ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-ink/30")}
              >
                <span className={clsx("block text-xs", day === d ? "text-paper/70" : "text-ink-soft")}>
                  {i === 0 ? "Aujourd'hui" : i === 1 ? "Demain" : i > 7 ? frShort(d) : DAY.format(dt).replace(".", "")}
                  {isPeakDate(d) && " · pic"}
                </span>
                <span className="mt-0.5 block font-display text-2xl leading-none">{dt.getDate()}</span>
                <span className={clsx("mt-1.5 block text-xs font-semibold", n ? (day === d ? "text-pollen" : "text-peony") : day === d ? "text-paper/50" : "text-ink-soft")}>
                  {n ? `${n} bouquet${n > 1 ? "s" : ""}` : "Libre"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 space-y-4">
          {dayOrders.map((o) => (
            <OrderCard key={o.id} order={o} locked={locked && o.status === "assigned"} fresh={fresh === o.id} onAdvance={advance} onUnlock={activatePro} />
          ))}
          {!dayOrders.length && (
            <Panel className="p-10 text-center">
              <p className="font-display text-3xl">Rien à préparer le {frShort(day)}.</p>
              <p className="mt-2 text-ink-soft">Les commandes vous sont proposées sept jours avant la livraison : vous avez 48 h pour les confirmer.</p>
            </Panel>
          )}
        </div>

        <GuaranteeRules className="mt-10" />
      </main>
    </AppShell>
  );
}

const TITLES: Record<string, string> = {
  remind: "Rappel : commande à confirmer",
  expired: "Commande confiée à un autre atelier",
  day_missed: "Commande du jour retirée",
  day_reminder: "Préparation du jour",
  day_alert: "11 h : commande pas en préparation",
  critical_reassign: "Commande transférée à un atelier de secours",
  closure: "Fermeture prise en compte",
  locked: "Commande réattribuée",
  urgent: "Urgence près de chez vous",
};

const isPeakLabel = (d: string) => (d.slice(5) === "02-14" ? "Saint-Valentin" : parseISO(d).getMonth() === 4 ? "Fête des mères" : "Fête des pères");

const PLAN_COLOR = { classique: "#1f5c3a", signature: "#e23f6b", prestige: "#2b1030" } as const;

const rank = (s: OrderStatus) => ["in_delivery", "ready", "preparing", "assigned", "delivered"].indexOf(s);

function OrderCard({ order, locked, fresh, onAdvance, onUnlock }: { order: Order; locked: boolean; fresh: boolean; onAdvance: (o: Order, to: OrderStatus) => void; onUnlock: () => void }) {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [skipPhoto, setSkipPhoto] = useState(false);
  const [open, setOpen] = useState(order.status === "preparing");
  const r = state.recipients.find((x) => x.id === order.recipientId)!;
  const recipe = getRecipe(order.planId, state.catalog);
  const model = findModel(order.modelId, state.models);
  const pendingOffer = !order.acceptedAt && order.status === "assigned";
  const next = pendingOffer ? undefined : NEXT[order.status];
  const done = order.status === "delivered";
  const florist = state.florists.find((f) => f.id === order.floristId);
  const now = useNow(30_000);

  return (
    <article
      className={clsx(
        "relative overflow-hidden rounded-[22px] border bg-card transition",
        fresh ? "pop border-peony shadow-[0_0_0_4px_rgba(226,63,107,0.15)]" : "border-line",
        done && "opacity-60",
      )}
    >
      <div className={clsx("p-5 sm:p-6", locked && "pointer-events-none select-none blur-[5px]")} aria-hidden={locked}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-white" style={{ background: PLAN_COLOR[order.planId] }}>
              <span className="font-display text-2xl">{recipe.name.split(" ")[1][0]}</span>
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{model ? `${model.name} · ${recipe.name.replace("Le ", "")}` : recipe.name} pour {r.firstName} {r.lastName[0]}.</h3>
                {order.upgradeFrom && <span className="rounded-full bg-ink px-2 py-0.5 text-[11px] font-bold text-paper">Surclassé depuis {getRecipe(order.upgradeFrom).name.replace("Le ", "")}</span>}
                {order.extraStemId && <span className="rounded-full bg-pollen px-2 py-0.5 text-[11px] font-bold text-ink">Extra tige noble</span>}
                {order.billing === "merged" && <span className="rounded-full bg-peony px-2 py-0.5 text-[11px] font-bold text-white">Spécial événement</span>}
                <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-bold", order.mode === "surprise" ? "bg-lilac text-ink" : "bg-paper-2 text-ink-soft")} title={order.mode === "surprise" ? "Modèle tiré par la rotation : ce destinataire ne l'a pas reçu récemment" : "Modèle choisi par le client"}>
                  {order.mode === "surprise" ? "Surprise" : "Modèle imposé"}
                </span>
                {order.priority && <span className="rounded-full bg-peony px-2 py-0.5 text-[11px] font-bold text-white">Prioritaire</span>}
              </div>
              <p className="text-sm text-ink-soft">
                {r.address}, {r.postalCode} · {String(order.distanceKm ?? "–").replace(".", ",")} km · {order.courier === "own" ? "Votre livreur" : order.courier === "uber_direct" ? "Uber Direct" : "Stuart"}
              </p>
              {r.accessNotes && <p className="text-sm text-ink-soft">Accès : {r.accessNotes}</p>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {pendingOffer ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-pollen-soft px-2.5 py-1 text-xs font-semibold text-[#5c3d00]">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pollen" />À confirmer
              </span>
            ) : (
              <StatusBadge status={order.status} />
            )}
            {pendingOffer && order.offer && now > 0 && <span className="text-[11px] font-semibold text-ink-soft">Avant {fmtAt(order.offer.expiresAt)} · reste {fmtLeft(new Date(order.offer.expiresAt).getTime() - now)}</span>}
            {order.rescue && order.acceptedAt && <span className="text-[11px] font-semibold text-peony-deep">Atelier de secours{order.bonusCents ? ` · prime +${euros(order.bonusCents, true)}` : ""} · à lancer sous 1 h</span>}
            {order.paymentStatus === "pending" && <span className="text-[11px] font-semibold text-[#7a5300]">Paiement client à J-3, confirmée à J-1</span>}
            {order.paymentStatus === "failed" && <span className="text-[11px] font-semibold text-peony-deep">Paiement refusé : ne pas préparer</span>}
          </div>
        </div>

        {order.issue && !done && <p className="mt-3 rounded-xl bg-pollen-soft px-3 py-2 text-sm font-semibold text-[#5c3d00]">{order.issue} · tentative {order.attempt}</p>}
        <div className={clsx("mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-paper px-4 py-3", done && "hidden")}>
          <div className="min-w-0">
            <p className="text-xs text-ink-soft">Carte à écrire à la main</p>
            <p className="mt-0.5 font-display text-lg italic">« {order.message} »</p>
          </div>
          {order.publicCode && <CardCode code={order.publicCode} />}
        </div>

        {order.status === "preparing" && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {order.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={order.photoUrl} alt="Photo du bouquet" className="h-20 w-16 rounded-lg object-cover" />
            ) : null}
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border border-ink/15 bg-card px-5 text-[15px] font-semibold hover:border-ink/40">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const url = await compressImage(f);
                  dispatch({ type: "photo", orderId: order.id, photoUrl: url });
                  if (!isDemo) void api.orderPhoto(order.id, url).catch(() => {});
                }}
              />
              {order.photoUrl ? "Reprendre la photo" : "Photographier le bouquet"}
            </label>
            <span className="text-sm text-ink-soft">{order.photoUrl ? "Le client la recevra au départ." : "Elle est envoyée au client et au destinataire."}</span>
          </div>
        )}

        {open && !done && (
          <div className="pop mt-4 border-t border-line pt-4">
            <RecipeSheet recipe={recipe} model={model} extraStemId={order.extraStemId} payoutCents={order.payoutCents} />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {done ? (
            <span className="text-sm text-ink-soft">Livré à {order.statusAt.delivered ? new Date(order.statusAt.delivered).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
              {open ? "Masquer la fiche technique" : "Voir la fiche technique"}
            </Button>
          )}
          <div className="flex gap-2">
            {pendingOffer && florist && <OfferActions order={order} florist={florist} />}
            {next && (
              <Button
                variant={order.status === "assigned" ? "ink" : "primary"}
                disabled={next.to === "ready" && !order.photoUrl && !skipPhoto}
                onClick={() => (onAdvance(order, next.to), next.to === "preparing" && setOpen(true))}
              >
                {next.label}
              </Button>
            )}
            {next?.to === "ready" && !order.photoUrl && !skipPhoto && (
              <Button variant="ghost" onClick={() => setSkipPhoto(true)}>Continuer sans photo</Button>
            )}
            {order.status === "ready" && order.courier === "own" && <Button variant="ink" onClick={() => onAdvance(order, "in_delivery")}>Parti en livraison</Button>}
            {order.status === "ready" && order.courier !== "own" && <span className="flex items-center gap-2 text-sm font-semibold text-peony-deep"><span className="ring-pulse h-2 w-2 rounded-full bg-peony" /> Coursier en approche</span>}
            {order.status === "in_delivery" && (
              <Button
                variant="ghost"
                onClick={() => {
                  dispatch({ type: "absent", orderId: order.id });
                  toast({ title: "Nouvelle tentative demain", body: "Le client est prévenu. Gardez le bouquet au frais." });
                }}
              >
                Destinataire absent
              </Button>
            )}
            {order.status === "in_delivery" && <Button variant="stem" onClick={() => onAdvance(order, "delivered")}>Marquer comme livré</Button>}
          </div>
        </div>
      </div>

      {locked && (
        <div className="absolute inset-0 grid place-items-center bg-card/40 p-4">
          <div className="text-center">
            <p className="font-semibold">Commande verrouillée · {euros(order.payoutCents ?? recipe.floristPayoutCents)} pour vous</p>
            <Button className="mt-3" onClick={onUnlock}>Débloquer avec Moncleur Pro</Button>
          </div>
        </div>
      )}
    </article>
  );
}
