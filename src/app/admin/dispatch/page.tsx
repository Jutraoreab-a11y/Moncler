"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ADMIN_TABS } from "@/components/pro/tabs";
import { useToast } from "@/components/toast";
import { Button, inputCls, Panel, StatusBadge } from "@/components/ui";
import { getRecipe } from "@/lib/catalog";
import { frShort, iso, startOfDay } from "@/lib/dates";
import { haversineKm, isLocked } from "@/lib/matching";
import { useStore } from "@/lib/store";

const COLORS = ["#e23f6b", "#1f5c3a", "#8b6bb0", "#f4b73f", "#2b1030", "#3f7a9e"];

export default function DispatchPage() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [hover, setHover] = useState<string | null>(null);
  const today = iso(startOfDay());
  const upcoming = useMemo(
    () => state.orders.filter((o) => o.deliveryDate >= today && !["delivered", "cancelled"].includes(o.status)).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)),
    [state.orders, today],
  );
  const unassigned = upcoming.filter((o) => o.status === "scheduled");
  const stuck = upcoming.filter((o) => o.status === "assigned" && isLocked(state.florists.find((f) => f.id === o.floristId)!));

  // Projection équirectangulaire locale (Paris)
  const pts = [...state.florists, ...state.recipients];
  const minLat = Math.min(...pts.map((p) => p.lat)) - 0.012, maxLat = Math.max(...pts.map((p) => p.lat)) + 0.012;
  const minLng = Math.min(...pts.map((p) => p.lng)) - 0.02, maxLng = Math.max(...pts.map((p) => p.lng)) + 0.02;
  const W = 640, H = Math.round((W * (maxLat - minLat)) / ((maxLng - minLng) * Math.cos((48.86 * Math.PI) / 180)));
  const x = (lng: number) => ((lng - minLng) / (maxLng - minLng)) * W;
  const y = (lat: number) => H - ((lat - minLat) / (maxLat - minLat)) * H;
  const kmPx = W / (haversineKm({ lat: 48.86, lng: minLng }, { lat: 48.86, lng: maxLng }));
  const colorOf = (fid: string | null) => (fid ? COLORS[state.florists.findIndex((f) => f.id === fid) % COLORS.length] : "#9a8a9c");

  return (
    <AppShell tabs={ADMIN_TABS} tone="ink">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-5xl">Dispatching</h1>
            <p className="mt-2 text-ink-soft">Chaque commande va à l&apos;atelier actif le plus proche dont le rayon couvre le destinataire.</p>
          </div>
          <Button
            onClick={() => {
              const before = unassigned.length;
              dispatch({ type: "dispatchAll" });
              toast({ title: "Attribution relancée", body: before ? `${before} commande(s) en attente traitée(s).` : "Aucune commande en attente.", tone: "success" });
            }}
          >
            Relancer l&apos;attribution
          </Button>
        </div>

        {(unassigned.length > 0 || stuck.length > 0) && (
          <p className="mt-6 rounded-2xl bg-pollen-soft px-4 py-3 text-sm text-[#7a5300]">
            {unassigned.length} commande(s) sans fleuriste · {stuck.length} bloquée(s) chez un atelier en fin d&apos;offre découverte.
          </p>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <Panel className="overflow-hidden p-2">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Carte des ateliers et des destinataires">
              <rect width={W} height={H} fill="#fbf6f8" rx="18" />
              {state.florists.map((f, i) => (
                <circle key={`z${f.id}`} cx={x(f.lng)} cy={y(f.lat)} r={f.radiusKm * kmPx} fill={COLORS[i % COLORS.length]} opacity={isLocked(f) || !f.active ? 0.03 : hover === f.id ? 0.16 : 0.07} stroke={COLORS[i % COLORS.length]} strokeOpacity={0.3} strokeDasharray={isLocked(f) ? "4 4" : undefined} />
              ))}
              {upcoming.map((o) => {
                const r = state.recipients.find((z) => z.id === o.recipientId)!;
                const f = state.florists.find((z) => z.id === o.floristId);
                return f ? <line key={`l${o.id}`} x1={x(f.lng)} y1={y(f.lat)} x2={x(r.lng)} y2={y(r.lat)} stroke={colorOf(f.id)} strokeOpacity={0.45} strokeWidth={1.2} /> : null;
              })}
              {upcoming.map((o) => {
                const r = state.recipients.find((z) => z.id === o.recipientId)!;
                return <circle key={`r${o.id}`} cx={x(r.lng)} cy={y(r.lat)} r={4.5} fill="white" stroke={colorOf(o.floristId)} strokeWidth={2.5} />;
              })}
              {state.florists.map((f, i) => (
                <g key={f.id} onMouseEnter={() => setHover(f.id)} onMouseLeave={() => setHover(null)}>
                  <circle cx={x(f.lng)} cy={y(f.lat)} r={9} fill={COLORS[i % COLORS.length]} opacity={isLocked(f) ? 0.4 : 1} />
                  <text x={x(f.lng) + 13} y={y(f.lat) + 4} fontSize="12" fontWeight="600" fill="#2b1030">{f.shopName}</text>
                </g>
              ))}
            </svg>
          </Panel>

          <Panel className="p-6">
            <h2 className="font-semibold">Ateliers</h2>
            <ul className="mt-4 space-y-3">
              {state.florists.map((f, i) => {
                const n = upcoming.filter((o) => o.floristId === f.id).length;
                return (
                  <li key={f.id} className="flex items-center gap-3" onMouseEnter={() => setHover(f.id)} onMouseLeave={() => setHover(null)}>
                    <span className="h-3 w-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="flex-1 text-sm">
                      <span className="font-semibold">{f.shopName}</span>
                      <span className="block text-xs text-ink-soft">{f.radiusKm} km · {f.deliveryMode === "own" ? "Livreur maison" : f.deliveryMode === "uber_direct" ? "Uber Direct" : "Stuart"}{isLocked(f) ? " · paywall atteint" : ""}</span>
                    </span>
                    <span className="tabular text-sm font-semibold">{n}</span>
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>

        <Panel className="mt-6 overflow-x-auto p-6">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-ink-soft">
              <tr className="border-b border-line">
                <th className="py-2.5 font-semibold">Livraison</th>
                <th className="font-semibold">Destinataire</th>
                <th className="font-semibold">Bouquet</th>
                <th className="font-semibold">Statut</th>
                <th className="font-semibold">Atelier</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((o) => {
                const r = state.recipients.find((z) => z.id === o.recipientId)!;
                return (
                  <tr key={o.id} className="border-b border-line/60 last:border-0">
                    <td className="tabular py-2.5">{frShort(o.deliveryDate)}</td>
                    <td>{r.firstName} {r.lastName} <span className="text-ink-soft">· {r.postalCode}</span></td>
                    <td>{getRecipe(o.planId).name}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td>
                      <select
                        aria-label={`Atelier pour ${r.firstName}`}
                        className={`${inputCls} py-1.5 text-sm`}
                        value={o.floristId ?? ""}
                        disabled={!["scheduled", "assigned"].includes(o.status)}
                        onChange={(e) => dispatch({ type: "reassign", orderId: o.id, floristId: e.target.value })}
                      >
                        {!o.floristId && <option value="">Non attribuée</option>}
                        {state.florists.map((f) => (
                          <option key={f.id} value={f.id} disabled={isLocked(f)}>
                            {f.shopName} · {haversineKm(f, r).toFixed(1)} km
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      </main>
    </AppShell>
  );
}
