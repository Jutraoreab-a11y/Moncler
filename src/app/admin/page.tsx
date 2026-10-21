"use client";

import { useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { ADMIN_TABS } from "@/components/pro/tabs";
import { Panel } from "@/components/ui";
import { euros, getRecipe, PRO_PRICE_CENTS } from "@/lib/catalog";
import { addDays, frShort, iso, startOfDay } from "@/lib/dates";
import { isLocked } from "@/lib/matching";
import { commitmentEnd, DELIVERY_COST_CENTS, isPeakDate, occasionSurchargeCents, PEAK_DELIVERY_MULTIPLIER, planOccurrences, subscriberPriceCents, unitEconomics } from "@/lib/pricing";
import { CATALOG } from "@/lib/catalog";
import type { PlanType } from "@/lib/types";
import { useStore } from "@/lib/store";

export default function AdminPage() {
  const { state } = useStore();

  const m = useMemo(() => {
    const live = state.subscriptions.filter((x) => x.status === "active");
    const activeCustomers = new Set(live.map((x) => x.customerId));
    const mrrOf = (t: PlanType) => live.filter((x) => x.planType === t).reduce((sum, x) => sum + getRecipe(x.planId, state.catalog).priceCents, 0);
    const mrrMonthly = mrrOf("MONTHLY_RECURRING");
    const mrrCarnet = mrrOf("SPECIAL_EVENTS_CARNET");
    const mrrB2C = mrrMonthly + mrrCarnet;
    // Revenu restant garanti par les engagements Carnet
    const today0 = startOfDay();
    const carnets = live.filter((x) => x.planType === "SPECIAL_EVENTS_CARNET");
    const committed = carnets.reduce((sum, x) => {
      const end = commitmentEnd(x);
      if (!end || end <= today0) return sum;
      const monthsLeft = Math.max(0, (end.getFullYear() - today0.getFullYear()) * 12 + end.getMonth() - today0.getMonth());
      return sum + monthsLeft * getRecipe(x.planId, state.catalog).priceCents;
    }, 0);
    // Suppléments des 30 prochains jours (occasions +30 %, surclassements, extras)
    const occ = planOccurrences(state, today0, addDays(today0, 30)).filter((e) => e.status === "planned");
    const extras = occ.reduce((sum, e) => sum + e.priceCents, 0);
    const extrasBy = {
      addon: occ.reduce((sum, e) => sum + (e.lines.find((l) => l.kind === "addon")?.amountCents ?? 0), 0),
      upgrade: occ.reduce((sum, e) => sum + (e.lines.find((l) => l.kind === "upgrade")?.amountCents ?? 0), 0),
      extra: occ.reduce((sum, e) => sum + (e.lines.find((l) => l.kind === "extra_stem")?.amountCents ?? 0), 0),
    };
    const pros = state.florists.filter((f) => f.saasPlan === "pro");
    const mrrB2B = pros.length * PRO_PRICE_CENTS;
    const delivered = state.florists.reduce((s, f) => s + f.completedOrders, 0);
    const byFlorist = state.florists
      .map((f) => ({ f, revenue: state.payouts.filter((p) => p.floristId === f.id).reduce((s, p) => s + p.amountCents, 0) }))
      .sort((a, b) => b.revenue - a.revenue);
    // Livraisons par semaine, 12 dernières semaines (à partir des virements)
    const today = startOfDay();
    const weeks = Array.from({ length: 12 }, (_, i) => {
      const end = addDays(today, -7 * (11 - i));
      const start = addDays(end, -7);
      const n = state.payouts.filter((p) => p.createdAt.slice(0, 10) > iso(start) && p.createdAt.slice(0, 10) <= iso(end)).length;
      return { label: frShort(end), n };
    });
    const gmv = state.orders.filter((o) => o.status === "delivered").reduce((s, o) => s + getRecipe(o.planId, state.catalog).priceCents, 0) +
      state.payouts.filter((p) => p.orderId.startsWith("hist_")).reduce((s, p) => s + Math.round(p.amountCents / 0.58), 0);
    const margin = gmv - state.payouts.reduce((s, p) => s + p.amountCents, 0);
    // Marge moyenne par bouquet sur les 30 prochains jours (coursier par défaut)
    const econ = occ.map((e) => unitEconomics({ revenueCents: e.revenueCents, payoutCents: e.payoutCents, courier: "uber_direct", date: e.date }));
    const avgMargin = econ.length ? Math.round(econ.reduce((sum, x) => sum + x.marginCents, 0) / econ.length) : 0;
    return { avgMargin, waitlist: state.waitlist.length, mrrB2C, mrrMonthly, mrrCarnet, committed, carnets: carnets.length, monthlies: live.length - carnets.length, extras, extrasBy, mrrB2B, delivered, byFlorist, weeks, activeCustomers: activeCustomers.size, pros: pros.length, gmv, margin };
  }, [state]);

  const max = Math.max(...m.weeks.map((w) => w.n), 1);
  const maxRev = Math.max(...m.byFlorist.map((x) => x.revenue), 1);

  return (
    <AppShell tabs={ADMIN_TABS} tone="ink">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-5xl">Tableau de bord</h1>
        <dl className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Kpi l="MRR Mensuel" v={euros(m.mrrMonthly)} s={`${m.monthlies} abonnements sans engagement`} />
          <Kpi l="MRR Carnet Occasions" v={euros(m.mrrCarnet)} s={`${m.carnets} carnets · ${euros(m.committed)} encore engagés`} />
          <Kpi l="Suppléments à 30 jours" v={euros(m.extras, true)} s={`Occasions ${euros(m.extrasBy.addon, true)} · surclassements ${euros(m.extrasBy.upgrade)} · extras ${euros(m.extrasBy.extra)}`} />
          <Kpi l="MRR fleuristes" v={euros(m.mrrB2B)} s={`${m.pros} ateliers Pro sur ${state.florists.length}`} />
          <Kpi l="Bouquets livrés" v={String(m.delivered)} s={`${m.activeCustomers} abonnés actifs`} />
          <Kpi l="Marge par bouquet (30 j)" v={euros(m.avgMargin, true)} s={`après fleuriste, livraison et paiement · ${m.waitlist} en liste d'attente`} />
        </dl>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <EconomicsTable />
          <PeaksPanel />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Panel className="p-6">
            <h2 className="font-semibold">Livraisons par semaine</h2>
            <div className="mt-6 flex h-48 items-end gap-2" role="img" aria-label="Histogramme des livraisons hebdomadaires sur 12 semaines">
              {m.weeks.map((w, i) => (
                <div key={i} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-xs font-semibold text-ink-soft opacity-0 transition group-hover:opacity-100">{w.n}</span>
                  <div className="w-full rounded-t-md bg-peony transition-[height] duration-700" style={{ height: `${(w.n / max) * 100}%`, minHeight: 2, opacity: 0.45 + (i / 11) * 0.55 }} />
                  <span className="text-[10px] text-ink-soft">{i % 2 === 1 ? w.label : "\u00a0"}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="p-6">
            <h2 className="font-semibold">Chiffre d&apos;affaires par fleuriste</h2>
            <ul className="mt-5 space-y-4">
              {m.byFlorist.map(({ f, revenue }) => (
                <li key={f.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-semibold">
                      {f.shopName}
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${f.saasPlan === "pro" ? "bg-stem-soft text-stem" : isLocked(f) ? "bg-[#fde2ea] text-peony-deep" : "bg-lilac"}`}>
                        {f.saasPlan === "pro" ? "Pro" : isLocked(f) ? "Paywall" : `${f.completedOrders}/10`}
                      </span>
                    </span>
                    <span className="tabular">{euros(revenue)}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-paper-2">
                    <div className="h-2 rounded-full bg-ink" style={{ width: `${(revenue / maxRev) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </main>
    </AppShell>
  );
}

function Kpi({ l, v, s }: { l: string; v: string; s: string }) {
  return (
    <Panel className="p-5">
      <dt className="text-sm text-ink-soft">{l}</dt>
      <dd className="tabular mt-1 font-display text-4xl">{v}</dd>
      <dd className="mt-1 text-xs text-ink-soft">{s}</dd>
    </Panel>
  );
}

/** Marge réelle par type de bouquet : fleuriste, coursier, frais de paiement. */
function EconomicsTable() {
  const { state } = useStore();
  const rows = CATALOG.flatMap((r) => {
    const payout = state.catalog.find((x) => x.planId === r.planId)!.floristPayoutCents;
    const price = state.catalog.find((x) => x.planId === r.planId)!.priceCents;
    const sub = subscriberPriceCents(r.planId, state.catalog);
    const name = r.name.replace("Le ", "");
    return [
      { label: `Mensuel ${name}`, revenue: price },
      { label: `Mensuel ${name}, mois avec occasion`, revenue: price + occasionSurchargeCents(r.planId, state.catalog) },
      { label: `Date de Carnet ${name}`, revenue: sub },
    ].map((x) => ({ ...x, e: unitEconomics({ revenueCents: x.revenue, payoutCents: payout, courier: "uber_direct" }), peak: unitEconomics({ revenueCents: x.revenue, payoutCents: payout, courier: "uber_direct", date: "2027-02-14" }) }));
  });
  return (
    <Panel className="overflow-x-auto p-6">
      <h2 className="font-semibold">Marge par bouquet</h2>
      <p className="mt-1 text-xs text-ink-soft">
        Coursier estimé à {euros(DELIVERY_COST_CENTS.uber_direct, true)} (×{PEAK_DELIVERY_MULTIPLIER} les jours de pic, pire cas), frais Stripe 1,5 % + 0,25 €. Atelier qui livre lui-même : forfait {euros(DELIVERY_COST_CENTS.own)}, prioritaire les jours de pic.
      </p>
      <table className="mt-4 w-full min-w-[520px] text-left text-sm">
        <thead className="text-ink-soft">
          <tr className="border-b border-line">
            <th className="py-2 font-semibold">Bouquet</th>
            <th className="text-right font-semibold">Encaissé</th>
            <th className="text-right font-semibold">Fleuriste</th>
            <th className="text-right font-semibold">Livraison</th>
            <th className="text-right font-semibold">Marge</th>
            <th className="text-right font-semibold">Jour de pic</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((x) => (
            <tr key={x.label} className="border-b border-line/60 last:border-0">
              <td className="py-2">{x.label}</td>
              <td className="text-right">{euros(x.revenue, true)}</td>
              <td className="text-right">{euros(x.e.floristCents, true)}</td>
              <td className="text-right">{euros(x.e.deliveryCents, true)}</td>
              <td className={`text-right font-semibold ${x.e.marginCents < 0 ? "text-peony-deep" : "text-stem"}`}>{euros(x.e.marginCents, true)}</td>
              <td className={`text-right ${x.peak.marginCents < 0 ? "font-semibold text-peony-deep" : "text-ink-soft"}`}>{euros(x.peak.marginCents, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** Pics à venir : demande prévue face à la capacité des ateliers. */
function PeaksPanel() {
  const { state } = useStore();
  const today = startOfDay();
  const occ = planOccurrences(state, today, addDays(today, 240)).filter((e) => e.status === "planned" && isPeakDate(e.date));
  const dates = [...new Set(occ.map((e) => e.date))].sort().slice(0, 3);
  const capacity = state.florists.filter((f) => f.active).reduce((sum, f) => sum + (f.dailyCapacity ?? 10), 0);
  const label = (d: string) => (d.slice(5) === "02-14" ? "Saint-Valentin" : d.slice(5, 7) === "05" ? "Fête des mères" : "Fête des pères");
  return (
    <Panel className="p-6">
      <h2 className="font-semibold">Pics à venir</h2>
      <p className="mt-1 text-xs text-ink-soft">Bouquets déjà programmés par les abonnés, visibles par les ateliers 3 semaines avant.</p>
      <ul className="mt-4 space-y-4">
        {dates.map((d) => {
          const n = occ.filter((e) => e.date === d).length;
          return (
            <li key={d}>
              <div className="flex justify-between text-sm">
                <span className="font-semibold">{label(d)} · {frShort(d)}</span>
                <span className="tabular">{n} / {capacity} places</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-paper-2">
                <div className={`h-2 rounded-full ${n / capacity > 0.8 ? "bg-peony" : "bg-stem"}`} style={{ width: `${Math.min(100, (n / capacity) * 100)}%` }} />
              </div>
            </li>
          );
        })}
        {!dates.length && <li className="text-sm text-ink-soft">Aucun pic dans les 8 prochains mois.</li>}
      </ul>
    </Panel>
  );
}
