"use client";

/**
 * Écrans de la garantie de livraison côté atelier : propositions à confirmer,
 * urgences à reprendre, compte à rebours de 11 h, fiabilité, règles.
 */
import clsx from "clsx";
import { useEffect, useState } from "react";
import { Button, Panel } from "@/components/ui";
import { useToast } from "@/components/toast";
import { api, isDemo } from "@/lib/api-client";
import { euros, getRecipe } from "@/lib/catalog";
import { frShort } from "@/lib/dates";
import { criticalDeadline, floristStepDone, GUARANTEE, isOfferedTo, outstandingDebitCents, parisDate, readyDeadline } from "@/lib/guarantee";
import { isSuspended, strikePoints, SUSPEND_AT_POINTS, STRIKE_WINDOW_DAYS } from "@/lib/matching";
import { findModel } from "@/lib/models";
import { OWN_DELIVERY_FEE_CENTS } from "@/lib/pricing";
import { useStore } from "@/lib/store";
import type { Florist, Order } from "@/lib/types";

/**
 * Horloge rafraîchie (comptes à rebours). Vaut 0 avant le montage : le rendu serveur et le
 * premier rendu navigateur n'affichent aucune durée, ce qui évite un écart d'hydratation.
 */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function fmtLeft(ms: number) {
  if (ms <= 0) return "maintenant";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 10) return `${h} h ${String(min % 60).padStart(2, "0")}`;
  return `${h} h`;
}

export const fmtAt = (isoTs: string) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(isoTs));

const REASONS = ["Fermé ce jour-là", "Capacité atteinte", "Fleurs indisponibles", "Trop loin", "Autre"];

/** Boutons Accepter / Refuser d'une proposition, avec motif de refus. */
export function OfferActions({ order, florist, compact }: { order: Order; florist: Florist; compact?: boolean }) {
  const { dispatch, state } = useStore();
  const toast = useToast();
  const [refusing, setRefusing] = useState(false);
  const r = state.recipients.find((x) => x.id === order.recipientId);
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    const action = { type: "acceptOffer" as const, orderId: order.id, floristId: florist.id };
    if (!isDemo) {
      // Urgence ouverte à plusieurs ateliers : on attend le serveur (premier arrivé, premier servi)
      setBusy(true);
      try {
        await api.sync(action);
      } catch (e) {
        setBusy(false);
        toast({ title: "Commande déjà prise", body: e instanceof Error ? e.message : "Un autre atelier a été plus rapide.", tone: "alert" });
        dispatch({ type: "declineOffer", orderId: order.id, floristId: florist.id }, { local: true });
        return;
      }
    }
    dispatch(action, { local: !isDemo });
    toast({ title: "Commande confirmée", body: `${r?.firstName ?? "Livraison"} le ${frShort(order.deliveryDate)} : elle est à vous.`, tone: "success" });
  };
  if (refusing)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-soft">Pourquoi ?</span>
        {REASONS.map((x) => (
          <button
            key={x}
            className="rounded-full border border-line bg-card px-3 py-1.5 text-sm font-semibold hover:border-ink/40"
            onClick={() => {
              dispatch({ type: "declineOffer", orderId: order.id, floristId: florist.id, reason: x });
              toast({ title: "Proposition refusée", body: "Aucune pénalité : elle part chez un atelier voisin." });
            }}
          >
            {x}
          </button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => setRefusing(false)}>Annuler</Button>
      </div>
    );
  return (
    <div className="flex gap-2">
      <Button size={compact ? "sm" : "md"} variant="ghost" onClick={() => setRefusing(true)}>Refuser</Button>
      <Button size={compact ? "sm" : "md"} variant={order.offer?.open ? "primary" : "stem"} onClick={accept} disabled={busy}>
        {order.offer?.open ? "Je la prends" : "Accepter"}
      </Button>
    </div>
  );
}

/** Propositions en attente de réponse de l'atelier, urgences d'abord. */
export function PendingOffers({ florist }: { florist: Florist }) {
  const { state } = useStore();
  const now = useNow();
  const pending = state.orders
    .filter((o) => isOfferedTo(o, florist.id))
    .sort((a, b) => Number(!!b.offer?.open) - Number(!!a.offer?.open) || a.offer!.expiresAt.localeCompare(b.offer!.expiresAt));
  if (!pending.length || !now) return null;
  const urgent = pending.filter((o) => o.offer?.open);
  return (
    <section className="mt-6 space-y-3" aria-label="Commandes à confirmer">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-3xl">
          {urgent.length ? `${urgent.length} urgence${urgent.length > 1 ? "s" : ""} à reprendre` : `${pending.length} commande${pending.length > 1 ? "s" : ""} à confirmer`}
          {urgent.length > 0 && pending.length > urgent.length && <span className="text-ink-soft"> · {pending.length - urgent.length} à confirmer</span>}
        </h2>
        <p className="text-sm text-ink-soft">Sans réponse sous 48 h, la commande est proposée à un autre atelier.</p>
      </div>
      {pending.map((o) => {
        const r = state.recipients.find((x) => x.id === o.recipientId);
        const recipe = getRecipe(o.planId, state.catalog);
        const model = findModel(o.modelId, state.models);
        const left = new Date(o.offer!.expiresAt).getTime() - now;
        const open = !!o.offer?.open;
        const from = o.handoffs?.at(-1)?.from;
        // Proposition directe : rémunération déjà calculée pour l'atelier ; urgence : recalculée pour lui, prime comprise
        const base = o.payoutCents ?? recipe.floristPayoutCents;
        const pay = open ? base - (o.courier === "own" ? OWN_DELIVERY_FEE_CENTS : 0) + (florist.deliveryMode === "own" ? OWN_DELIVERY_FEE_CENTS : 0) + (o.offer?.bonusCents ?? 0) : base;
        return (
          <article key={o.id} className={clsx("pop flex flex-wrap items-center justify-between gap-4 rounded-[22px] border p-4 sm:p-5", open ? "border-peony bg-peony/5 shadow-[0_0_0_4px_rgba(226,63,107,0.12)]" : o.offer?.remindedAt ? "border-pollen bg-pollen-soft/50" : "border-line bg-card")}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {open && <span className="rounded-full bg-peony px-2 py-0.5 text-[11px] font-bold text-white">{o.critical ? "Secours · CRITICAL_REASSIGN" : "Urgent · premier qui accepte"}</span>}
                {o.offer?.remindedAt && !open && <span className="rounded-full bg-pollen px-2 py-0.5 text-[11px] font-bold text-ink">Rappel</span>}
                <h3 className="font-semibold">
                  {o.deliveryDate === parisDate() ? "Aujourd'hui" : frShort(o.deliveryDate)} · {model ? `${model.name} · ${recipe.name.replace("Le ", "")}` : recipe.name} pour {r?.firstName} {r?.lastName?.[0]}.
                </h3>
              </div>
              <p className="mt-0.5 text-sm text-ink-soft">
                {r?.postalCode} · {euros(pay)} pour vous{open && o.offer?.bonusCents ? ` dont ${euros(o.offer.bonusCents, true)} de prime de secours (+20 %)` : ""}
                {open && from ? ` · ${state.florists.find((f) => f.id === from)?.shopName ?? "Un atelier"} ne peut pas l'honorer` : ""}
              </p>
              <p className={clsx("mt-1 text-sm font-semibold", left < 6 * 3600_000 ? "text-peony-deep" : "text-ink")}>
                {open ? `Ouverte encore ${fmtLeft(left)}` : `Répondez avant ${fmtAt(o.offer!.expiresAt)} · reste ${fmtLeft(left)}`}
              </p>
            </div>
            <OfferActions order={o} florist={florist} compact />
          </article>
        );
      })}
    </section>
  );
}

/** Bandeau du jour J : tout doit être prêt (ou parti) avant 11 h. */
export function DayCutoffBanner({ florist, today }: { florist: Florist; today: string }) {
  const { state } = useStore();
  const now = useNow(10_000);
  const due = state.orders.filter((o) => o.floristId === florist.id && o.deliveryDate === today && o.acceptedAt && !floristStepDone(o) && o.status !== "cancelled");
  if (!due.length || !now) return null;
  const alertAt = Math.min(...due.map((o) => readyDeadline(o).getTime()));
  const critical = criticalDeadline(today).getTime();
  // Avant 11 h : compte à rebours vers 11 h ; entre 11 h et 11 h 30 : vers la réattribution critique
  const alarm = now >= alertAt;
  const deadline = alarm ? critical : alertAt;
  const left = deadline - now;
  const hot = alarm || left < 90 * 60_000;
  return (
    <section className={clsx("mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[22px] px-5 py-4", hot ? "bg-peony text-white" : "bg-ink text-paper")} role="status">
      <p>
        <strong>
          {alarm ? "Alerte : " : ""}
          {due.length} commande{due.length > 1 ? "s" : ""} du jour à passer « En préparation » avant {new Date(alertAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })}
        </strong>
        {" · "}
        {alarm
          ? `transfert à un atelier de secours dans ${fmtLeft(left)}, prime de secours retenue sur vos virements.`
          : `reste ${fmtLeft(left)}. Sans action, alerte à 11 h puis transfert à 11 h 30.`}
      </p>
      <span className="tabular font-display text-3xl">{fmtLeft(left)}</span>
    </section>
  );
}

/** Fiabilité de l'atelier : points de manquement sur 30 jours. */
export function ReliabilityPanel({ florist }: { florist: Florist }) {
  const { state } = useStore();
  const pts = strikePoints(florist);
  const suspended = isSuspended(florist);
  const recent = (florist.strikes ?? []).filter((s) => Date.now() - new Date(s.at).getTime() < STRIKE_WINDOW_DAYS * 86400_000 && (!florist.strikesClearedAt || s.at > florist.strikesClearedAt));
  const mine = state.orders.filter((o) => o.floristId === florist.id && o.acceptedAt && o.status !== "cancelled").length;
  const owed = outstandingDebitCents(florist);
  return (
    <Panel className={clsx("p-5", suspended && "border-peony")}>
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-ink-soft">Fiabilité · 30 jours</p>
        <p className="tabular font-display text-3xl">
          {pts}
          <span className="text-lg text-ink-soft"> / {SUSPEND_AT_POINTS}</span>
        </p>
      </div>
      <div className="mt-3 flex gap-1" aria-hidden>
        {Array.from({ length: SUSPEND_AT_POINTS }, (_, i) => (
          <span key={i} className={clsx("h-2 flex-1 rounded-full", i < pts ? (suspended ? "bg-peony" : "bg-pollen") : "bg-stem/70")} />
        ))}
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        {suspended
          ? "Propositions suspendues. L'équipe Moncleur va vous appeler."
          : pts
            ? recent.at(-1)?.reason ?? "Un manquement récent."
            : `Aucun manquement · ${mine} commande${mine > 1 ? "s" : ""} confirmée${mine > 1 ? "s" : ""}`}
      </p>
      {owed > 0 && <p className="mt-2 text-sm font-semibold text-peony-deep">Retenue sur vos prochains virements : {euros(owed, true)}</p>}
    </Panel>
  );
}

/** Rappel des règles, compréhensibles en 20 secondes. */
export function GuaranteeRules({ className }: { className?: string }) {
  const steps = [
    ["J-7", "On vous propose la commande", "Elle vous est réservée 48 h. Acceptez en un clic, ou refusez sans pénalité."],
    ["+24 h", "Rappel", "Toujours pas de réponse : rappel par e-mail et SMS."],
    ["+48 h", "Passage de relais", "Sans réponse, elle part chez l'atelier voisin (1 point)."],
    ["J-2 18 h", "Date limite", "Au-delà, la commande est ouverte aux 3 ateliers les plus proches."],
    ["Jour J 9 h 30", "Rappel du matin", "Si la préparation n'a pas commencé."],
    ["Jour J 11 h", "Heure limite", "Chaque commande du jour doit être « En préparation » ou « Prête ». Sinon : alerte sonore et SMS."],
    ["Jour J 11 h 30", "Réattribution critique", `Toujours rien : la commande part chez un atelier de secours, avec une prime de préparation +${Math.round(GUARANTEE.rescueBonusRate * 100)} % retenue sur vos prochains virements (2 points).`],
    ["Jour J 15 h", "Filet de sécurité", "Si personne n'a pu la prendre, livraison le lendemain sans frais pour l'abonné. Au 3e essai, remboursement."],
  ];
  return (
    <Panel className={clsx("p-6", className)}>
      <h2 className="font-display text-3xl">La garantie de livraison</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Chaque bouquet part, quoi qu&apos;il arrive. Congés, jours de fermeture et jours fériés se déclarent dans Ma boutique : vous ne recevez alors aucune proposition ces jours-là. 3 points sur 30 jours suspendent les propositions.
      </p>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map(([when, title, body]) => (
          <li key={when} className="rounded-2xl bg-paper p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-peony-deep">{when}</p>
            <p className="mt-1 font-semibold">{title}</p>
            <p className="mt-1 text-sm text-ink-soft">{body}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
