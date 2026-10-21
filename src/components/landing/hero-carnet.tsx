"use client";

import { useEffect, useState } from "react";
import { Bouquet } from "@/components/bloom";
import { getRecipe } from "@/lib/catalog";

const ENTRIES = [
  { who: "Hélène", rel: "Maman", what: "Bouquet du mois", plan: "signature" as const, inHours: 18.7, seed: 3 },
  { who: "Léa", rel: "Anniversaire", what: "Le Prestige", plan: "prestige" as const, inHours: 4 * 24 + 6, seed: 11 },
  { who: "Jeanne", rel: "Mamie", what: "Petit bonjour mensuel", plan: "classique" as const, inHours: 9 * 24 + 2, seed: 5 },
];

function split(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export function HeroCarnet() {
  const [base] = useState(() => Date.now());
  const [now, setNow] = useState(base);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const e = ENTRIES[active];
  const left = split(e.inHours * 3600_000 - (now - base));
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <div className="relative mx-auto w-full max-w-[460px]">
      {/* bouquet flottant */}
      <div className="pointer-events-none absolute -top-16 right-[-6px] z-10 w-40 sm:-right-10 sm:w-52">
        <div className="sway" key={e.seed}>
          <Bouquet palette={getRecipe(e.plan).palette} seed={e.seed} count={e.plan === "prestige" ? 9 : e.plan === "signature" ? 7 : 5} />
        </div>
      </div>

      <div className="rise relative rounded-[28px] border border-line bg-card p-6 shadow-[0_40px_80px_-40px_rgba(43,16,48,0.45)]">
        <p className="text-sm text-ink-soft">Le carnet de Camille</p>
        <p className="mt-6 text-sm font-semibold text-ink-soft">
          {e.who} reçoit son bouquet dans
        </p>
        <div className="tabular mt-1 flex items-baseline gap-1 font-display text-[54px] leading-none text-ink sm:text-[64px]" aria-live="off">
          {left.d > 0 && (
            <>
              {left.d}
              <span className="mr-2 text-2xl text-ink-soft">j</span>
            </>
          )}
          {pad(left.h)}
          <span className="text-2xl text-ink-soft">h</span>
          {pad(left.m)}
          <span className="text-2xl text-ink-soft">m</span>
          <span className="text-peony">{pad(left.s)}</span>
        </div>

        <ul className="mt-7 space-y-1.5">
          {ENTRIES.map((x, i) => (
            <li key={x.who}>
              <button
                onClick={() => setActive(i)}
                aria-pressed={i === active}
                className={`flex w-full items-center justify-between rounded-2xl px-3.5 py-3 text-left transition ${
                  i === active ? "bg-paper-2" : "hover:bg-paper"
                }`}
              >
                <span>
                  <span className="block text-[15px] font-semibold">
                    {x.who} <span className="font-normal text-ink-soft">· {x.rel}</span>
                  </span>
                  <span className="text-sm text-ink-soft">{x.what}</span>
                </span>
                <span className="text-sm font-semibold text-ink">{getRecipe(x.plan).name.replace("Le ", "")}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-5 border-t border-line pt-4 text-[13px] text-ink-soft">
          Programmé une seule fois, il y a 5 mois. Rien à faire d&apos;autre.
        </p>
      </div>
    </div>
  );
}
