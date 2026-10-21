"use client";

import clsx from "clsx";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ModelBouquet } from "@/components/bouquet-choice";
import { ADMIN_TABS } from "@/components/pro/tabs";
import { useToast } from "@/components/toast";
import { Button, Field, inputCls, Panel } from "@/components/ui";
import { euros, getRecipe } from "@/lib/catalog";
import { occasionSurchargeCents, PLAN_ORDER, subscriberPriceCents, unitEconomics, UPGRADE_PRICES } from "@/lib/pricing";
import { modelsOf } from "@/lib/models";
import { useStore } from "@/lib/store";
import type { BouquetModel, PlanId, Recipe } from "@/lib/types";

export default function CataloguePage() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const setGamme = (planId: PlanId, patch: Partial<Recipe>) => dispatch({ type: "recipe", planId, patch });

  // Popularité : part des commandes par modèle et par mode
  const usage = (id: string) => state.orders.filter((o) => o.modelId === id && o.status !== "cancelled").length;
  const surpriseShare = (planId: PlanId) => {
    const os = state.orders.filter((o) => o.planId === planId && o.mode);
    return os.length ? Math.round((os.filter((o) => o.mode === "surprise").length / os.length) * 100) : 0;
  };

  return (
    <AppShell tabs={ADMIN_TABS} tone="ink">
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-5xl">Catalogue</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          Trois gammes, plusieurs modèles par gamme. Les modèles actifs alimentent la rotation des abonnés en mode Surprise et sont proposés à ceux qui choisissent un modèle fixe. Un modèle retiré ne casse aucun abonnement : ses dates basculent sur la rotation.
        </p>

        {state.catalog.map((r) => {
          const margin = r.priceCents - r.floristPayoutCents;
          const all = modelsOf(r.planId, state.models, true);
          return (
            <section key={r.planId} className="mt-12">
              <Panel className="grid gap-6 p-6 lg:grid-cols-[1fr_2fr]">
                <div>
                  <p className="text-sm text-ink-soft">Gamme</p>
                  <input aria-label="Nom de la gamme" className="w-full bg-transparent font-display text-4xl outline-none" value={r.name} onChange={(e) => setGamme(r.planId, { name: e.target.value })} />
                  <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div><dt className="text-ink-soft">Marge</dt><dd className="font-display text-2xl text-stem">{euros(margin)}</dd></div>
                    <div><dt className="text-ink-soft">En rotation</dt><dd className="font-display text-2xl">{all.filter((m) => m.active).length} modèles</dd></div>
                    <div><dt className="text-ink-soft">Mode surprise</dt><dd className="font-display text-2xl">{surpriseShare(r.planId)} %</dd></div>
                  </dl>
                  <AddonMargin recipe={r} />
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Prix client €"><input type="number" className={inputCls} value={r.priceCents / 100} onChange={(e) => setGamme(r.planId, { priceCents: Math.round(+e.target.value * 100) })} /></Field>
                  <Field label="Reversé €"><input type="number" className={inputCls} value={r.floristPayoutCents / 100} onChange={(e) => setGamme(r.planId, { floristPayoutCents: Math.round(+e.target.value * 100) })} /></Field>
                  <Field label="Budget fleurs €"><input type="number" className={inputCls} value={r.flowerBudgetCents / 100} onChange={(e) => setGamme(r.planId, { flowerBudgetCents: Math.round(+e.target.value * 100) })} /></Field>
                  <Field label="Format"><input className={inputCls} value={r.size} onChange={(e) => setGamme(r.planId, { size: e.target.value })} /></Field>
                </div>
              </Panel>

              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {all.map((m) => (
                  <ModelEditor key={m.id} model={m} uses={usage(m.id)} />
                ))}
                <button
                  onClick={() => {
                    const base = all[0];
                    dispatch({
                      type: "addModel",
                      model: {
                        id: `m_${Date.now().toString(36)}`,
                        planId: r.planId,
                        name: "Nouveau modèle",
                        tagline: "À décrire",
                        stems: base ? base.stems.map((s) => ({ ...s })) : [{ label: "Variété", qty: 5 }],
                        palette: ["#f2a7b8", "#ffffff", "#7aa37f"],
                        packaging: base?.packaging ?? "",
                        notes: "",
                        active: false,
                      },
                    });
                    toast({ title: "Modèle créé", body: "Activez-le pour l'ajouter à la rotation." });
                  }}
                  className="grid min-h-28 place-items-center rounded-[22px] border-2 border-dashed border-line text-ink-soft hover:border-ink/40 hover:text-ink"
                >
                  <span className="text-center">
                    <span className="block font-display text-4xl">+</span>
                    Ajouter un modèle {r.name.replace("Le ", "")}
                  </span>
                </button>
              </div>
            </section>
          );
        })}
      </main>
    </AppShell>
  );
}

/** Économie des options, livraison et paiement compris. */
function AddonMargin({ recipe }: { recipe: Recipe }) {
  const { state } = useStore();
  const sub = subscriberPriceCents(recipe.planId, state.catalog);
  const eco = (revenueCents: number, payoutCents: number) => unitEconomics({ revenueCents, payoutCents, courier: "uber_direct" }).marginCents;
  const rows = [
    { label: "Bouquet mensuel", price: recipe.priceCents, margin: eco(recipe.priceCents, recipe.floristPayoutCents) },
    // Mensuel : l'occasion remplace le bouquet du mois, le supplément s'ajoute au même bouquet
    { label: "Mois avec occasion (+30 %)", price: recipe.priceCents + occasionSurchargeCents(recipe.planId, state.catalog), margin: eco(recipe.priceCents + occasionSurchargeCents(recipe.planId, state.catalog), recipe.floristPayoutCents) },
    { label: "Date de Carnet (−15 %)", price: sub, margin: eco(sub, recipe.floristPayoutCents) },
    ...PLAN_ORDER.slice(0, PLAN_ORDER.indexOf(recipe.planId)).map((from) => {
      const price = UPGRADE_PRICES[`${from}>${recipe.planId}`];
      const extraPayout = recipe.floristPayoutCents - getRecipe(from, state.catalog).floristPayoutCents;
      return { label: `Surclassement depuis ${getRecipe(from, state.catalog).name.replace("Le ", "")}`, price, margin: price - extraPayout - Math.round(price * 0.015) };
    }),
  ];
  return (
    <dl className="mt-4 space-y-1 border-t border-line pt-3 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-3">
          <dt className="text-ink-soft">{r.label}</dt>
          <dd className="tabular">
            {euros(r.price, true)} · marge <span className={r.margin < 0 ? "font-semibold text-peony-deep" : "text-stem"}>{euros(r.margin, true)}</span>
          </dd>
        </div>
      ))}
      <p className="text-xs text-ink-soft">Livraison estimée et frais de paiement déduits.</p>
    </dl>
  );
}

function ModelEditor({ model: m, uses }: { model: BouquetModel; uses: number }) {
  const { dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<BouquetModel>) => dispatch({ type: "model", id: m.id, patch });

  return (
    <Panel className={clsx("p-5", !m.active && "opacity-70")}>
      <div className="flex items-start gap-3">
        <div className="w-20 shrink-0"><ModelBouquet model={m} /></div>
        <div className="min-w-0 flex-1">
          <input aria-label="Nom du modèle" className="w-full bg-transparent font-display text-2xl outline-none" value={m.name} onChange={(e) => set({ name: e.target.value })} />
          <input aria-label="Accroche" className="w-full bg-transparent text-sm text-ink-soft outline-none" value={m.tagline} onChange={(e) => set({ tagline: e.target.value })} />
          <p className="mt-2 text-xs text-ink-soft">{uses} commande{uses > 1 ? "s" : ""}</p>
        </div>
      </div>
      <label className="mt-4 flex items-center justify-between rounded-xl bg-paper px-3 py-2 text-sm">
        <span className="font-semibold">{m.active ? "Dans la rotation et proposé" : "Retiré du catalogue"}</span>
        <input type="checkbox" checked={m.active} onChange={(e) => set({ active: e.target.checked })} className="h-4 w-4 accent-[#1f5c3a]" />
      </label>
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Fermer la fiche" : "Modifier la fiche technique"}
      </Button>
      {open && (
        <div className="pop mt-3 space-y-3">
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">Tiges</legend>
            <div className="space-y-2">
              {m.stems.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <input type="number" aria-label="Quantité" className={`${inputCls} w-16 px-2`} value={s.qty} onChange={(e) => set({ stems: m.stems.map((x, j) => (j === i ? { ...x, qty: +e.target.value } : x)) })} />
                  <input aria-label="Variété" className={inputCls} value={s.label} onChange={(e) => set({ stems: m.stems.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                  <Button variant="ghost" size="sm" aria-label="Retirer" onClick={() => set({ stems: m.stems.filter((_, j) => j !== i) })}>✕</Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => set({ stems: [...m.stems, { label: "Nouvelle variété", qty: 1 }] })}>Ajouter une variété</Button>
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-sm font-semibold">Palette</legend>
            <div className="flex flex-wrap items-center gap-2">
              {m.palette.map((c, i) => (
                <input key={i} type="color" aria-label={`Couleur ${i + 1}`} value={c} onChange={(e) => set({ palette: m.palette.map((x, j) => (j === i ? e.target.value : x)) })} className="h-8 w-8 cursor-pointer rounded-full border border-line bg-transparent" />
              ))}
              <Button variant="ghost" size="sm" onClick={() => set({ palette: [...m.palette, "#f2a7b8"] })}>Ajouter</Button>
              {m.palette.length > 1 && <Button variant="ghost" size="sm" onClick={() => set({ palette: m.palette.slice(0, -1) })}>Retirer</Button>}
            </div>
          </fieldset>
          <Field label="Emballage"><input className={inputCls} value={m.packaging} onChange={(e) => set({ packaging: e.target.value })} /></Field>
          <Field label="Consignes"><textarea className={`${inputCls} min-h-16`} value={m.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
      )}
    </Panel>
  );
}
