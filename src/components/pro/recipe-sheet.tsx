import { Bouquet } from "@/components/bloom";
import { ModelBouquet } from "@/components/bouquet-choice";
import { euros } from "@/lib/catalog";
import { sheetFor } from "@/lib/models";
import { findExtraStem } from "@/lib/pricing";
import type { BouquetModel, Recipe } from "@/lib/types";

/** Fiche technique d'un bouquet, telle que vue par le fleuriste. */
export function RecipeSheet({ recipe: gamme, model, compact = false, extraStemId, payoutCents }: { recipe: Recipe; model?: BouquetModel; compact?: boolean; extraStemId?: string; payoutCents?: number }) {
  const recipe = sheetFor(gamme, model);
  const extra = findExtraStem(extraStemId);
  return (
    <div className="grid gap-5 sm:grid-cols-[120px_1fr]">
      {!compact && (
        <div className="mx-auto w-28 sm:w-full">
          {model ? <ModelBouquet model={model} /> : <Bouquet palette={recipe.palette} seed={recipe.stems.length * 3} count={recipe.stems.reduce((s, x) => s + x.qty, 0) > 20 ? 9 : recipe.stems.length + 3} />}
        </div>
      )}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-2xl">
            {model ? model.name : recipe.name}
            {model && <span className="ml-2 font-sans text-sm text-ink-soft">{gamme.name}</span>}
          </p>
          <p className="text-sm text-ink-soft">
            Budget fleurs {euros(recipe.flowerBudgetCents + (extra?.budgetCents ?? 0))} · vous recevez <strong className="text-stem">{euros(payoutCents ?? recipe.floristPayoutCents + (extra?.budgetCents ?? 0))}</strong>
          </p>
        </div>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {recipe.stems.map((s) => (
              <tr key={s.label} className="border-b border-line/70 last:border-0">
                <td className="tabular w-10 py-1.5 font-semibold">{s.qty}</td>
                <td>{s.label}</td>
              </tr>
            ))}
            {extra && (
              <tr className="bg-pollen-soft">
                <td className="tabular py-1.5 pl-1 font-semibold">+</td>
                <td className="font-semibold">Extra tige noble : {extra.label} <span className="font-normal text-ink-soft">(+{euros(extra.budgetCents)} de budget)</span></td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-ink-soft">Palette</span>
          {recipe.palette.map((c) => (
            <span key={c} title={c} className="h-5 w-5 rounded-full border border-ink/10" style={{ background: c }} />
          ))}
        </div>
        <dl className="mt-3 grid gap-1 text-sm">
          <div className="flex gap-2"><dt className="text-ink-soft">Emballage</dt><dd>{recipe.packaging}</dd></div>
          <div className="flex gap-2"><dt className="text-ink-soft">Format</dt><dd>{recipe.size}</dd></div>
        </dl>
        <p className="mt-2 text-sm text-ink-soft">{recipe.notes}</p>
      </div>
    </div>
  );
}
