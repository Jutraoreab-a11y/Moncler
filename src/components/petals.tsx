"use client";

import { useEffect, useState } from "react";

/** Pluie de pétales — déclenchée une seule fois, sur une réussite. */
export function PetalRain({ count = 36 }: { count?: number }) {
  const [petals, setPetals] = useState<{ l: number; d: number; s: number; r: number; c: string; dur: number }[]>([]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#e23f6b", "#f2a7b8", "#f4b73f", "#e9ddf3", "#b82a53"];
    setPetals(
      Array.from({ length: count }, () => ({
        l: Math.random() * 100,
        d: Math.random() * 0.9,
        s: 10 + Math.random() * 14,
        r: Math.random() * 360,
        c: colors[Math.floor(Math.random() * colors.length)],
        dur: 2.6 + Math.random() * 2,
      })),
    );
    const t = setTimeout(() => setPetals([]), 5200);
    return () => clearTimeout(t);
  }, [count]);
  if (!petals.length) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[90] overflow-hidden" aria-hidden>
      <style>{`@keyframes fall{0%{transform:translateY(-10vh) rotate(0)}100%{transform:translateY(110vh) rotate(540deg)}}`}</style>
      {petals.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.l}%`,
            width: p.s,
            height: p.s * 1.4,
            background: p.c,
            borderRadius: "60% 0 60% 0",
            animation: `fall ${p.dur}s cubic-bezier(.3,.1,.5,1) ${p.d}s forwards`,
            transform: `rotate(${p.r}deg)`,
          }}
          className="absolute -top-10"
        />
      ))}
    </div>
  );
}
