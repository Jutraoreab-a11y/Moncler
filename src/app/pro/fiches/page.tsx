"use client";

import { AppShell } from "@/components/app-shell";
import { RecipeSheet } from "@/components/pro/recipe-sheet";
import { PRO_TABS } from "@/components/pro/tabs";
import { Panel } from "@/components/ui";
import { euros } from "@/lib/catalog";
import { modelsOf } from "@/lib/models";
import { useStore } from "@/lib/store";

export default function FichesPage() {
  const { state } = useStore();
  return (
    <AppShell tabs={PRO_TABS} tone="ink">
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-5xl">Fiches techniques</h1>
        <p className="mt-2 max-w-xl text-ink-soft">
          Chaque gamme compte plusieurs modèles. La commande vous indique toujours lequel composer : celui choisi par le client, ou celui tiré par la rotation surprise. Les variétés peuvent changer selon la saison, tant que la palette et le nombre de tiges sont respectés.
        </p>
        {state.catalog.map((r) => (
          <section key={r.planId} className="mt-12">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-ink pb-2">
              <h2 className="font-display text-4xl">{r.name}</h2>
              <p className="text-sm text-ink-soft">{r.size} · budget fleurs {euros(r.flowerBudgetCents)} · vous recevez {euros(r.floristPayoutCents)}</p>
            </div>
            <div className="mt-5 space-y-4">
              {modelsOf(r.planId, state.models).map((m) => (
                <Panel key={m.id} className="p-6">
                  <RecipeSheet recipe={r} model={m} />
                </Panel>
              ))}
            </div>
          </section>
        ))}
      </main>
    </AppShell>
  );
}
