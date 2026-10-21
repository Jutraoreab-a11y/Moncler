"use client";

import clsx from "clsx";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { PRO_TABS } from "@/components/pro/tabs";
import { useToast } from "@/components/toast";
import { Button, Field, inputCls, Panel } from "@/components/ui";
import { api, isDemo } from "@/lib/api-client";
import { euros } from "@/lib/catalog";
import { addDays, frShort, iso, startOfDay } from "@/lib/dates";
import { GUARANTEE } from "@/lib/guarantee";
import { useStore } from "@/lib/store";
import type { DeliveryMode } from "@/lib/types";

const MODES: { id: DeliveryMode; label: string; hint: string }[] = [
  { id: "own", label: "Mon propre livreur", hint: "Vous livrez et recevez 6 € de forfait livraison par bouquet." },
  { id: "uber_direct", label: "Uber Direct", hint: "Coursier demandé automatiquement quand le bouquet est prêt." },
  { id: "stuart", label: "Stuart", hint: "Coursier vélo ou scooter, même déclenchement automatique." },
];

export default function BoutiquePage() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const f = state.florists.find((x) => x.id === state.currentFloristId)!;
  const patch = (p: Partial<typeof f>) => dispatch({ type: "floristPatch", id: f.id, patch: p });
  const payouts = state.payouts.filter((p) => p.floristId === f.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <AppShell tabs={PRO_TABS} tone="ink">
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <h1 className="font-display text-5xl">Ma boutique</h1>
          <Panel className="space-y-5 p-6">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Nom de l'atelier"><input className={inputCls} value={f.shopName} onChange={(e) => patch({ shopName: e.target.value })} /></Field>
              <Field label="Responsable"><input className={inputCls} value={f.ownerName} onChange={(e) => patch({ ownerName: e.target.value })} /></Field>
              <Field label="Adresse" className="sm:col-span-2"><input className={inputCls} value={`${f.address}, ${f.city}`} readOnly /></Field>
            </div>
            <Field label={`Rayon de livraison : ${f.radiusKm} km`} hint="Vous ne recevez que les commandes situées dans ce rayon.">
              <input type="range" min={2} max={10} step={1} value={f.radiusKm} onChange={(e) => patch({ radiusKm: +e.target.value })} className="w-full accent-[#e23f6b]" />
            </Field>
            <Field label={`Capacité : ${f.dailyCapacity ?? 10} bouquets par jour maximum`} hint="Au-delà, les commandes du jour vont à l'atelier suivant. Pensez à l'augmenter avant la Saint-Valentin et la fête des mères.">
              <input type="range" min={2} max={40} step={1} value={f.dailyCapacity ?? 10} onChange={(e) => patch({ dailyCapacity: +e.target.value })} className="w-full accent-[#e23f6b]" />
            </Field>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Mode de livraison</legend>
              <div className="grid gap-2">
                {MODES.map((m) => (
                  <button key={m.id} onClick={() => patch({ deliveryMode: m.id })} aria-pressed={f.deliveryMode === m.id} className={clsx("rounded-2xl border-2 p-4 text-left", f.deliveryMode === m.id ? "border-peony bg-card" : "border-line hover:border-ink/30")}>
                    <span className="block font-semibold">{m.label}</span>
                    <span className="text-sm text-ink-soft">{m.hint}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center justify-between gap-4 rounded-2xl bg-paper p-4">
              <span>
                <span className="block font-semibold">Recevoir de nouvelles propositions</span>
                <span className="text-sm text-ink-soft">Pause : plus aucune nouvelle proposition, vos commandes confirmées restent à vous. Pour des congés, déclarez plutôt vos dates ci-dessous.</span>
              </span>
              <input type="checkbox" checked={f.active} onChange={(e) => patch({ active: e.target.checked })} className="h-5 w-5 shrink-0 accent-[#1f5c3a]" />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-2xl bg-paper p-4">
              <span>
                <span className="block font-semibold">Acceptation automatique</span>
                <span className="text-sm text-ink-soft">Chaque proposition est confirmée d&apos;office, sans attendre votre clic. Pratique si votre planning est stable.</span>
              </span>
              <input type="checkbox" checked={!!f.autoAccept} onChange={(e) => patch({ autoAccept: e.target.checked })} className="h-5 w-5 shrink-0 accent-[#1f5c3a]" />
            </label>
            <Field label="Mobile pour les alertes SMS" hint="Propositions, rappels et urgences. Jamais communiqué aux clients.">
              <input type="tel" inputMode="tel" autoComplete="tel" className={inputCls} value={f.phone ?? ""} placeholder="06 12 34 56 78" onChange={(e) => patch({ phone: e.target.value })} />
            </Field>
          </Panel>
          <Closures />
        </div>

        <div className="space-y-6 lg:pt-[72px]">
          <Panel className="p-6">
            <h2 className="font-display text-3xl">Virements</h2>
            <p className="mt-2 text-sm text-ink-soft">
              {f.stripeConnected ? "Compte bancaire vérifié via Stripe. Chaque bouquet livré est viré sous 48 h." : "Connectez votre compte bancaire pour recevoir vos virements."}
            </p>
            {!f.stripeConnected && (
              <Button
                className="mt-4"
                onClick={async () => {
                  if (!isDemo) {
                    const { url } = await api.connectOnboard(f.id);
                    window.location.href = url;
                    return;
                  }
                  patch({ stripeConnected: true });
                  toast({ title: "Compte bancaire connecté", tone: "success" });
                }}
              >
                Connecter mon IBAN
              </Button>
            )}
            <ul className="mt-5 divide-y divide-line">
              {payouts.slice(0, 8).map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="tabular text-ink-soft">{frShort(p.createdAt.slice(0, 10))}</span>
                  <span className={p.status === "paid" ? "text-stem" : "text-[#7a5300]"}>{p.status === "paid" ? "Versé" : "En cours"}</span>
                  <span className="tabular text-right font-semibold">
                    {euros(p.amountCents, true)}
                    {p.withheldCents ? <span className="block text-xs font-normal text-peony-deep">−{euros(p.withheldCents, true)} prime de secours retenue</span> : null}
                  </span>
                </li>
              ))}
              {!payouts.length && <li className="py-3 text-sm text-ink-soft">Votre premier virement apparaîtra après votre première livraison.</li>}
            </ul>
          </Panel>
        </div>
      </main>
    </AppShell>
  );
}

const WEEKDAYS = [
  [1, "Lun"],
  [2, "Mar"],
  [3, "Mer"],
  [4, "Jeu"],
  [5, "Ven"],
  [6, "Sam"],
  [0, "Dim"],
] as const;

/** Jours de fermeture et congés : aucune proposition ces jours-là, et les commandes confirmées partent chez un voisin. */
function Closures() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const f = state.florists.find((x) => x.id === state.currentFloristId)!;
  const today = iso(startOfDay());
  const [from, setFrom] = useState(iso(addDays(startOfDay(), 14)));
  const [to, setTo] = useState(iso(addDays(startOfDay(), 20)));
  const [reason, setReason] = useState("Congés");
  const closed = new Set(f.closedWeekdays ?? []);
  // Commandes déjà confirmées qui tomberaient pendant la fermeture saisie
  const impacted = state.orders.filter((o) => o.floristId === f.id && o.status === "assigned" && o.deliveryDate >= from && o.deliveryDate <= to);
  const lateLimit = iso(addDays(startOfDay(), GUARANTEE.lateClosureH / 24));
  const lateOnes = impacted.filter((o) => o.acceptedAt && o.deliveryDate <= lateLimit);
  const closures = (f.closures ?? []).filter((c) => c.to >= today);

  return (
    <Panel className="space-y-5 p-6">
      <div>
        <h2 className="font-display text-3xl">Fermetures et congés</h2>
        <p className="mt-1 text-sm text-ink-soft">Ces jours-là, aucune commande ne vous est proposée : un atelier voisin livre à votre place. Vos abonnés ne voient aucune différence.</p>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Fermé chaque semaine le</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map(([d, l]) => (
            <button
              key={d}
              aria-pressed={closed.has(d)}
              onClick={() => dispatch({ type: "floristPatch", id: f.id, patch: { closedWeekdays: closed.has(d) ? [...closed].filter((x) => x !== d) : [...closed, d] } })}
              className={clsx("h-10 min-w-12 rounded-full border px-3 text-sm font-semibold", closed.has(d) ? "border-ink bg-ink text-paper" : "border-line bg-card hover:border-ink/40")}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-3 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-[#1f5c3a]" checked={!!f.closedOnHolidays} onChange={(e) => dispatch({ type: "floristPatch", id: f.id, patch: { closedOnHolidays: e.target.checked } })} />
          <span>Fermé les jours fériés <span className="text-ink-soft">(1er mai compris)</span></span>
        </label>
      </fieldset>

      <div>
        <p className="mb-2 text-sm font-semibold">Ajouter une fermeture</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr_auto] sm:items-end">
          <Field label="Du"><input type="date" className={inputCls} min={today} value={from} onChange={(e) => (setFrom(e.target.value), e.target.value > to && setTo(e.target.value))} /></Field>
          <Field label="Au"><input type="date" className={inputCls} min={from} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Motif"><input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Congés, inventaire…" /></Field>
          <Button
            onClick={() => {
              dispatch({ type: "addClosure", floristId: f.id, closure: { id: `cl_${Date.now().toString(36)}`, from, to, reason: reason.trim() || undefined, declaredAt: new Date().toISOString() } });
              toast({ title: "Fermeture enregistrée", body: impacted.length ? `${impacted.length} commande${impacted.length > 1 ? "s" : ""} confiée${impacted.length > 1 ? "s" : ""} à un atelier voisin.` : "Aucune proposition ne vous sera faite ces jours-là.", tone: "success" });
            }}
          >
            Ajouter
          </Button>
        </div>
        {impacted.length > 0 && (
          <p className={clsx("mt-3 rounded-xl px-3 py-2 text-sm", lateOnes.length ? "bg-peony/10 text-peony-deep" : "bg-pollen-soft text-[#5c3d00]")}>
            {impacted.length} commande{impacted.length > 1 ? "s" : ""} déjà prévue{impacted.length > 1 ? "s" : ""} sur ces dates {impacted.length > 1 ? "partiront" : "partira"} chez un voisin.
            {lateOnes.length > 0 && ` ${lateOnes.length} est à moins de 48 h : cela compte comme un manquement (1 point).`}
          </p>
        )}
      </div>

      {closures.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {closures.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span>
                <span className="font-semibold">{c.from === c.to ? frShort(c.from) : `Du ${frShort(c.from)} au ${frShort(c.to)}`}</span>
                {c.reason && <span className="text-ink-soft"> · {c.reason}</span>}
              </span>
              <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "removeClosure", floristId: f.id, closureId: c.id })}>Retirer</Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
