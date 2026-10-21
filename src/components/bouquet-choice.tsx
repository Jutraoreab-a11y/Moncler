"use client";

import clsx from "clsx";
import { Bouquet } from "./bloom";
import { modelsOf } from "@/lib/models";
import type { BouquetModel, PlanId, SelectionMode } from "@/lib/types";

const seedOf = (id: string) => [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
export const countOf = (planId: PlanId) => (planId === "prestige" ? 9 : planId === "signature" ? 7 : 5);

/** Illustration d'un modèle précis. */
export function ModelBouquet({ model, className, wrap }: { model: BouquetModel; className?: string; wrap?: string }) {
  return <Bouquet palette={model.palette} seed={seedOf(model.id)} count={countOf(model.planId)} className={className} wrap={wrap} title={model.name} />;
}

/** Éventail de bouquets : visuel du mode Surprise. */
export function SurpriseFan({ models, className }: { models: BouquetModel[]; className?: string }) {
  const shown = models.slice(0, 3);
  return (
    <div className={clsx("relative mx-auto aspect-[1.3] h-full max-w-full", className)} aria-hidden>
      {shown.map((m, i) => (
        <div
          key={m.id}
          className="absolute bottom-0 left-1/2 w-[56%] origin-bottom"
          style={{ transform: `translateX(-50%) rotate(${(i - (shown.length - 1) / 2) * 16}deg)`, zIndex: i === 1 ? 2 : 1 }}
        >
          <ModelBouquet model={m} />
        </div>
      ))}
    </div>
  );
}

/**
 * Choix du mode (modèle fixe / surprise) puis, en mode fixe, du modèle.
 */
export function BouquetChoice({
  planId,
  mode,
  modelId,
  models,
  onChange,
  dense = false,
}: {
  planId: PlanId;
  mode: SelectionMode;
  modelId?: string;
  models: BouquetModel[];
  onChange: (v: { mode: SelectionMode; modelId?: string }) => void;
  dense?: boolean;
}) {
  const pool = modelsOf(planId, models);

  return (
    <div>
      <div role="radiogroup" aria-label="Mode de choix du bouquet" className={clsx("grid gap-3", dense ? "grid-cols-2" : "sm:grid-cols-2")}>
        <ModeCard
          on={mode === "surprise"}
          onClick={() => onChange({ mode: "surprise", modelId: undefined })}
          title="Surprise"
          body={`Un bouquet différent à chaque envoi, parmi les ${pool.length} modèles de la gamme. Jamais deux fois le même d'affilée.`}
          visual={<SurpriseFan models={pool} className="h-24" />}
          dense={dense}
        />
        <ModeCard
          on={mode === "fixed"}
          onClick={() => onChange({ mode: "fixed", modelId: modelId ?? pool[0]?.id })}
          title="Modèle fixe"
          body="Vous choisissez un bouquet précis. C'est toujours celui-là qui sera livré pour cette date."
          visual={pool[0] && <div className="mx-auto h-24 w-20"><ModelBouquet model={pool.find((m) => m.id === modelId) ?? pool[0]} /></div>}
          dense={dense}
        />
      </div>

      {mode === "fixed" && (
        <div role="radiogroup" aria-label="Modèle de bouquet" className={clsx("pop mt-4 grid gap-3", dense ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
          {pool.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={modelId === m.id}
              onClick={() => onChange({ mode: "fixed", modelId: m.id })}
              className={clsx(
                "rounded-2xl border-2 bg-card p-3 text-left transition",
                modelId === m.id ? "border-peony shadow-[0_14px_30px_-20px_rgba(226,63,107,0.9)]" : "border-transparent hover:border-line",
              )}
            >
              <div className={clsx("mx-auto", dense ? "w-16" : "w-24")}><ModelBouquet model={m} /></div>
              <p className={clsx("mt-1 font-display leading-tight", dense ? "text-lg" : "text-xl")}>{m.name}</p>
              {!dense && <p className="text-xs text-ink-soft">{m.tagline}</p>}
              <div className="mt-2 flex gap-1">
                {m.palette.map((c) => (
                  <span key={c} className="h-2.5 w-2.5 rounded-full border border-ink/10" style={{ background: c }} />
                ))}
              </div>
            </button>
          ))}
        </div>
      )}

      {mode === "surprise" && !dense && (
        <p className="pop mt-4 rounded-2xl bg-lilac/70 px-4 py-3 text-sm text-ink">
          Ce mois-ci, le suivant, puis le suivant : {pool.map((m) => m.name).join(", ")}… dans un ordre qui change pour chaque proche. Le nom du bouquet est révélé quand il est prêt à partir.
        </p>
      )}
    </div>
  );
}

function ModeCard({ on, onClick, title, body, visual, dense }: { on: boolean; onClick: () => void; title: string; body: string; visual: React.ReactNode; dense: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={clsx("flex flex-col rounded-[22px] border-2 bg-card text-left transition", dense ? "p-3" : "p-5", on ? "border-peony" : "border-transparent hover:border-line")}
    >
      {!dense && <div className="mb-3 h-24">{visual}</div>}
      <span className="flex items-center gap-2">
        <span className={clsx("grid h-4 w-4 place-items-center rounded-full border-2", on ? "border-peony" : "border-line")}>{on && <span className="h-1.5 w-1.5 rounded-full bg-peony" />}</span>
        <span className="font-semibold">{title}</span>
      </span>
      <span className={clsx("mt-1 text-ink-soft", dense ? "text-xs" : "text-sm")}>{body}</span>
    </button>
  );
}
