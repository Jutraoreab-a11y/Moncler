/**
 * Illustrations florales génératives (SVG, sans image) — déterministes via seed.
 */
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function Flower({
  cx,
  cy,
  r,
  petals,
  color,
  heart = "#f4b73f",
  rot = 0,
  shape = "round",
}: {
  cx: number;
  cy: number;
  r: number;
  petals: number;
  color: string;
  heart?: string;
  rot?: number;
  shape?: "round" | "pointed" | "layered";
}) {
  const items = [];
  const layers = shape === "layered" ? 3 : 1;
  for (let l = 0; l < layers; l++) {
    const lr = r * (1 - l * 0.28);
    const n = petals + l;
    for (let i = 0; i < n; i++) {
      const a = (360 / n) * i + rot + l * 17;
      items.push(
        <ellipse
          key={`${l}-${i}`}
          cx={cx}
          cy={cy - lr * 0.55}
          rx={shape === "pointed" ? lr * 0.28 : lr * 0.42}
          ry={lr * 0.6}
          fill={color}
          opacity={l === 0 ? 0.92 : 0.85}
          stroke="rgba(43,16,48,0.18)"
          strokeWidth={0.6}
          transform={`rotate(${a} ${cx} ${cy})`}
        />,
      );
    }
  }
  return (
    <g>
      {items}
      <circle cx={cx} cy={cy} r={r * 0.22} fill={heart} />
    </g>
  );
}

export function Bouquet({
  palette,
  seed = 7,
  count = 7,
  className,
  wrap = "#e9ddf3",
  title,
}: {
  palette: string[];
  seed?: number;
  count?: number;
  className?: string;
  wrap?: string;
  title?: string;
}) {
  const rand = rng(seed * 9301 + 49297);
  const W = 240;
  const flowers = Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const angle = -Math.PI * 0.85 + t * Math.PI * 0.7 + (rand() - 0.5) * 0.2;
    const dist = 58 + rand() * 30;
    const cx = W / 2 + Math.cos(angle) * dist;
    const cy = 128 + Math.sin(angle) * dist * 0.95;
    const shapes = ["round", "pointed", "layered"] as const;
    return {
      cx,
      cy,
      r: 17 + rand() * 11,
      petals: 5 + Math.floor(rand() * 4),
      color: palette[i % palette.length],
      rot: rand() * 60,
      shape: shapes[Math.floor(rand() * 3)],
    };
  });
  const leaves = Array.from({ length: 6 }, (_, i) => ({
    x: W / 2 + (i - 2.5) * 26 + (rand() - 0.5) * 10,
    y: 120 + rand() * 30,
    rot: (i - 2.5) * 22,
  }));

  return (
    <svg viewBox="0 0 240 260" className={className} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {/* tiges */}
      {flowers.map((f, i) => (
        <path key={`s${i}`} d={`M${f.cx} ${f.cy} Q ${W / 2 + (f.cx - W / 2) * 0.3} 180 ${W / 2 + (i - count / 2) * 2} 236`} stroke="#3f7a52" strokeWidth={2.2} fill="none" />
      ))}
      {leaves.map((l, i) => (
        <ellipse key={`l${i}`} cx={l.x} cy={l.y} rx={9} ry={24} fill={i % 2 ? "#5c8a64" : "#7aa37f"} transform={`rotate(${l.rot} ${l.x} ${l.y})`} />
      ))}
      {/* papier */}
      <path d="M62 168 L120 250 L178 168 Q120 186 62 168 Z" fill={wrap} stroke="rgba(43,16,48,0.25)" strokeWidth={1} />
      <path d="M62 168 L96 170 L120 250 Z" fill="rgba(255,255,255,0.35)" />
      <path d="M108 214 Q120 206 132 214 Q120 222 108 214 Z" fill="#e23f6b" />
      {flowers.map((f, i) => (
        <Flower key={i} {...f} />
      ))}
    </svg>
  );
}

/** Petite fleur décorative isolée */
export function Bud({ color = "#e23f6b", size = 28, className }: { color?: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden>
      <Flower cx={20} cy={20} r={16} petals={6} color={color} />
    </svg>
  );
}
