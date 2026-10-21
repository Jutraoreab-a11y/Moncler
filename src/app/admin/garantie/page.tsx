"use client";

/**
 * Garantie de livraison — tour de contrôle de l'équipe Moncleur :
 * commandes pas encore confirmées, urgences, alertes, fiabilité des ateliers, journal.
 */
import clsx from "clsx";
import { useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { ADMIN_TABS } from "@/components/pro/tabs";
import { fmtAt, fmtLeft, GuaranteeRules, useNow } from "@/components/pro/guarantee-ui";
import { useToast } from "@/components/toast";
import { Button, inputCls, Panel } from "@/components/ui";
import { euros, getRecipe } from "@/lib/catalog";
import { frShort } from "@/lib/dates";
import { guaranteeState, outstandingDebitCents, parisDate } from "@/lib/guarantee";
import { closedOn, haversineKm, isLocked, isSuspended, strikePoints, SUSPEND_AT_POINTS } from "@/lib/matching";
import { isDemo } from "@/lib/api-client";
import { useStore } from "@/lib/store";
import type { Order } from "@/lib/types";

const STATE_LABEL = {
  alert: ["Alerte", "bg-peony text-white"],
  urgent: ["Urgence ouverte", "bg-peony/10 text-peony-deep"],
  reminded: ["Rappel envoyé", "bg-pollen-soft text-[#5c3d00]"],
  offered: ["Proposée", "bg-lilac/60 text-ink"],
  accepted: ["Confirmée", "bg-stem-soft text-stem"],
  none: ["Sans atelier", "bg-paper-2 text-ink-soft"],
} as const;

const KIND_DOT: Record<string, string> = {
  offer: "bg-lilac",
  accepted: "bg-stem",
  remind: "bg-pollen",
  expired: "bg-peony",
  declined: "bg-ink-soft",
  urgent: "bg-peony",
  day_reminder: "bg-pollen",
  day_missed: "bg-peony",
  closure: "bg-ink-soft",
  locked: "bg-ink-soft",
  alert: "bg-peony-deep",
  rescue_late: "bg-peony-deep",
  customer_warning: "bg-peony-deep",
  rollover: "bg-pollen",
  day_alert: "bg-pollen",
  critical_reassign: "bg-peony-deep",
  refund: "bg-peony-deep",
};

export default function GarantiePage() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const now = useNow();
  const today = parisDate();
  const open = useMemo(() => state.orders.filter((o) => o.deliveryDate >= today && !["delivered", "cancelled"].includes(o.status)), [state.orders, today]);
  const waiting = open.filter((o) => !o.acceptedAt || o.alert).sort((a, b) => Number(!!b.alert) - Number(!!a.alert) || Number(!!b.offer?.open) - Number(!!a.offer?.open) || a.deliveryDate.localeCompare(b.deliveryDate));
  const accepted = open.filter((o) => o.acceptedAt).length;
  const alerts = open.filter((o) => o.alert);
  const since = new Date(now - 30 * 86400_000).toISOString();
  const handoffs30 = state.orders.flatMap((o) => o.handoffs ?? []).filter((h) => h.at >= since);
  const rescues = state.orders.filter((o) => o.rescue && o.acceptedAt).length;
  const name = (id: string | null | undefined) => state.florists.find((f) => f.id === id)?.shopName ?? "—";

  return (
    <AppShell tabs={ADMIN_TABS} tone="ink">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-5xl">Garantie de livraison</h1>
            <p className="mt-2 max-w-2xl text-ink-soft">Chaque bouquet part. Proposition à J-7, SMS de relance à J-6, relais à J-5, ouverture aux voisins à J-2 18 h. Jour J : alerte à 11 h, réattribution critique à 11 h 30.</p>
          </div>
          {isDemo && <Simulator onDone={(t) => toast({ title: "Simulation appliquée", body: t, tone: "success" })} />}
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Confirmées" value={`${accepted} / ${open.length}`} hint="commandes à venir" />
          <Kpi label="En attente de réponse" value={waiting.filter((o) => o.offer && !o.offer.open).length} hint={`${waiting.filter((o) => o.offer?.remindedAt).length} rappel(s) envoyé(s)`} />
          <Kpi label="Urgences ouvertes" value={waiting.filter((o) => o.offer?.open).length} hint="premier atelier qui accepte" tone={waiting.some((o) => o.offer?.open) ? "warn" : undefined} />
          <Kpi label="Alertes équipe" value={alerts.length} hint="à placer à la main" tone={alerts.length ? "bad" : undefined} />
          <Kpi label="Relais sur 30 jours" value={handoffs30.length} hint={`${rescues} reprise(s) urgente(s)`} />
        </div>

        <Panel className="mt-6 overflow-x-auto p-6">
          <h2 className="font-semibold">À surveiller</h2>
          {!waiting.length ? (
            <p className="mt-3 text-sm text-ink-soft">Toutes les commandes à venir sont confirmées par un atelier.</p>
          ) : (
            <table className="mt-3 w-full min-w-[820px] text-left text-sm">
              <thead className="text-ink-soft">
                <tr className="border-b border-line">
                  <th className="py-2.5 font-semibold">Livraison</th>
                  <th className="font-semibold">Destinataire</th>
                  <th className="font-semibold">État</th>
                  <th className="font-semibold">Proposée à</th>
                  <th className="font-semibold">Échéance</th>
                  <th className="font-semibold">Placer à la main</th>
                </tr>
              </thead>
              <tbody>
                {waiting.map((o) => (
                  <WatchRow key={o.id} o={o} now={now} name={name} />
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Panel className="overflow-x-auto p-6">
            <h2 className="font-semibold">Fiabilité des ateliers</h2>
            <table className="mt-3 w-full min-w-[600px] text-left text-sm">
              <thead className="text-ink-soft">
                <tr className="border-b border-line">
                  <th className="py-2.5 font-semibold">Atelier</th>
                  <th className="font-semibold">Points (30 j)</th>
                  <th className="font-semibold">Retenue à venir</th>
                  <th className="font-semibold">Disponibilité</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.florists.map((f) => {
                  const pts = strikePoints(f);
                  const susp = isSuspended(f);
                  const next = (f.closures ?? []).find((c) => c.to >= today);
                  return (
                    <tr key={f.id} className="border-b border-line/60 last:border-0">
                      <td className="py-2.5">
                        <span className="font-semibold">{f.shopName}</span>
                        <span className="block text-xs text-ink-soft">{f.autoAccept ? "Acceptation automatique" : "Acceptation manuelle"}</span>
                      </td>
                      <td>
                        <span className={clsx("tabular whitespace-nowrap font-semibold", susp ? "text-peony-deep" : pts ? "text-[#7a5300]" : "text-stem")}>{pts} / {SUSPEND_AT_POINTS}</span>
                        {susp && <span className="ml-2 rounded-full bg-peony px-2 py-0.5 text-[11px] font-bold text-white">Suspendu</span>}
                      </td>
                      <td className="tabular text-xs">{outstandingDebitCents(f) ? <span className="font-semibold text-peony-deep">{euros(outstandingDebitCents(f), true)}</span> : <span className="text-ink-soft">—</span>}</td>
                      <td className="text-xs text-ink-soft">
                        {!f.active ? "En pause" : isLocked(f) ? "Paywall atteint" : closedOn(f, today) ? "Fermé aujourd'hui" : "Ouvert"}
                        {next && <span className="block">{next.reason ?? "Fermeture"} du {frShort(next.from)} au {frShort(next.to)}</span>}
                        {(f.closedWeekdays ?? []).length > 0 && <span className="block">Fermé le {(f.closedWeekdays ?? []).map((d) => ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"][d]).join(", ")}</span>}
                      </td>
                      <td className="text-right">
                        {pts > 0 && (
                          <Button size="sm" variant="ghost" onClick={() => (dispatch({ type: "clearStrikes", floristId: f.id }), toast({ title: `${f.shopName} : compteur remis à zéro`, tone: "success" }))}>
                            {susp ? "Lever la suspension" : "Remettre à zéro"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>

          <Panel className="p-6">
            <h2 className="font-semibold">Journal</h2>
            <ul className="mt-3 max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {(state.guaranteeLog ?? []).slice(0, 40).map((e, i) => (
                <li key={`${e.at}-${i}`} className="flex gap-3 text-sm">
                  <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", KIND_DOT[e.kind] ?? "bg-line")} />
                  <span>
                    <span className="block">{e.text}</span>
                    <span className="text-xs text-ink-soft">{fmtAt(e.at)}{e.audience !== "florist" ? ` · ${e.audience === "ops" ? "équipe" : "abonné"}` : ""}</span>
                  </span>
                </li>
              ))}
              {!(state.guaranteeLog ?? []).length && <li className="text-sm text-ink-soft">Les propositions, rappels et relais apparaîtront ici.</li>}
            </ul>
          </Panel>
        </div>

        <GuaranteeRules className="mt-6" />
      </main>
    </AppShell>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint: string; tone?: "warn" | "bad" }) {
  return (
    <Panel className={clsx("p-5", tone === "bad" && "border-peony", tone === "warn" && "border-pollen")}>
      <p className="text-sm text-ink-soft">{label}</p>
      <p className={clsx("tabular mt-1 font-display text-4xl", tone === "bad" && "text-peony-deep")}>{value}</p>
      <p className="mt-1 text-xs text-ink-soft">{hint}</p>
    </Panel>
  );
}

function WatchRow({ o, now, name }: { o: Order; now: number; name: (id: string | null | undefined) => string }) {
  const { state, dispatch } = useStore();
  const r = state.recipients.find((x) => x.id === o.recipientId);
  const st = guaranteeState(o);
  const [lbl, cls] = STATE_LABEL[st];
  const to = o.offer ? o.offer.floristIds.map(name).join(", ") : o.floristId ? name(o.floristId) : "—";
  return (
    <tr className="border-b border-line/60 align-top last:border-0">
      <td className="tabular py-2.5">{frShort(o.deliveryDate)}</td>
      <td>
        {r?.firstName} {r?.lastName} <span className="text-ink-soft">· {r?.postalCode}</span>
        <span className="block text-xs text-ink-soft">{getRecipe(o.planId).name}{o.handoffs?.length ? ` · ${o.handoffs.length} relais` : ""}</span>
      </td>
      <td>
        <span className={clsx("rounded-full px-2 py-0.5 text-xs font-semibold", cls)}>{lbl}</span>
        {o.critical && !o.acceptedAt && <span className="ml-1 rounded-full bg-peony-deep px-2 py-0.5 text-[11px] font-bold text-white">CRITICAL_REASSIGN</span>}
        {o.alert && <span className="mt-1 block max-w-[220px] text-xs text-peony-deep">{o.alert}</span>}
      </td>
      <td className="text-xs">{to}</td>
      <td className="text-xs">{o.offer && now ? `${fmtAt(o.offer.expiresAt)} · ${fmtLeft(new Date(o.offer.expiresAt).getTime() - now)}` : "—"}</td>
      <td>
        <select
          aria-label={`Placer la commande de ${r?.firstName}`}
          className={`${inputCls} py-1.5 text-sm`}
          value=""
          onChange={(e) => e.target.value && dispatch({ type: "reassign", orderId: o.id, floristId: e.target.value })}
        >
          <option value="">Choisir un atelier…</option>
          {state.florists.map((f) => (
            <option key={f.id} value={f.id} disabled={isLocked(f) || closedOn(f, o.deliveryDate)}>
              {f.shopName} · {r ? haversineKm(f, r).toFixed(1) : "?"} km{closedOn(f, o.deliveryDate) ? " · fermé" : ""}
            </option>
          ))}
        </select>
      </td>
    </tr>
  );
}

/** Démo : avancer le temps pour voir les règles s'appliquer. */
function Simulator({ onDone }: { onDone: (t: string) => void }) {
  const { dispatch } = useStore();
  return (
    <div className="rounded-2xl border border-dashed border-ink/25 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-soft">Simulateur (démo)</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => (dispatch({ type: "timeTravel", hours: 24 }), onDone("24 h sans réponse : les rappels partent."))}>+24 h sans réponse</Button>
        <Button size="sm" variant="outline" onClick={() => (dispatch({ type: "timeTravel", hours: 48 }), onDone("48 h sans réponse : les commandes passent à l'atelier suivant."))}>+48 h sans réponse</Button>
        <Button size="sm" variant="outline" onClick={() => (dispatch({ type: "simulateCutoff", h: 11, m: 1 }), onDone("Jour J, 11 h 01 : alerte sonore et SMS aux ateliers dont les commandes ne sont pas en préparation."))}>Jour J, 11 h 01</Button>
        <Button size="sm" variant="ink" onClick={() => (dispatch({ type: "simulateCutoff", h: 11, m: 31 }), onDone("Jour J, 11 h 31 : réattribution critique vers les ateliers de secours (+20 %)."))}>Jour J, 11 h 31</Button>
      </div>
    </div>
  );
}
