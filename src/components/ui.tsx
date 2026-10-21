import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps } from "react";
import type { OrderStatus } from "@/lib/types";

type Variant = "primary" | "ink" | "ghost" | "outline" | "stem";

const variants: Record<Variant, string> = {
  primary: "bg-peony text-white hover:bg-peony-deep shadow-[0_8px_24px_-10px_rgba(226,63,107,0.8)]",
  ink: "bg-ink text-paper hover:bg-[#3d1a43]",
  ghost: "text-ink hover:bg-paper-2",
  outline: "border border-ink/15 bg-card text-ink hover:border-ink/40",
  stem: "bg-stem text-white hover:bg-[#174a2e]",
};

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background,transform,border-color] active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none";

const sizes = { sm: "h-9 px-4 text-sm", md: "h-11 px-5 text-[15px]", lg: "h-14 px-7 text-base" };

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...p
}: ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <button className={clsx(base, variants[variant], sizes[size], className)} {...p} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...p
}: ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof sizes }) {
  return <Link className={clsx(base, variants[variant], sizes[size], className)} {...p} />;
}

export function Logo({ className, tone = "ink" }: { className?: string; tone?: "ink" | "paper" }) {
  return (
    <Link href="/" className={clsx("inline-flex items-center gap-2", className)} aria-label="Moncleur, accueil">
      <svg width="26" height="26" viewBox="0 0 40 40" aria-hidden>
        {[0, 72, 144, 216, 288].map((a) => (
          <ellipse key={a} cx="20" cy="11" rx="6.5" ry="10" fill="#e23f6b" transform={`rotate(${a} 20 20)`} opacity="0.9" />
        ))}
        <circle cx="20" cy="20" r="4.5" fill="#f4b73f" />
      </svg>
      <span className={clsx("font-display text-[26px] leading-none", tone === "paper" ? "text-paper" : "text-ink")}>moncleur</span>
    </Link>
  );
}

export const STATUS_META: Record<OrderStatus, { label: string; cls: string; dot: string }> = {
  scheduled: { label: "À attribuer", cls: "bg-lilac text-ink", dot: "bg-ink-soft" },
  assigned: { label: "Programmé", cls: "bg-lilac text-ink", dot: "bg-[#8b6bb0]" },
  preparing: { label: "En préparation", cls: "bg-pollen-soft text-[#7a5300]", dot: "bg-pollen" },
  ready: { label: "Prêt à partir", cls: "bg-[#fde2ea] text-peony-deep", dot: "bg-peony" },
  in_delivery: { label: "En livraison", cls: "bg-[#fde2ea] text-peony-deep", dot: "bg-peony" },
  delivered: { label: "Livré", cls: "bg-stem-soft text-stem", dot: "bg-stem" },
  cancelled: { label: "Annulé", cls: "bg-paper-2 text-ink-soft line-through", dot: "bg-ink-soft" },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", m.cls)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", m.dot, (status === "in_delivery" || status === "preparing") && "animate-pulse")} />
      {m.label}
    </span>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-soft">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-soft/60 outline-none transition focus:border-peony focus:ring-4 focus:ring-peony/10";

export function Panel({ className, ...p }: ComponentProps<"section">) {
  return <section className={clsx("rounded-[22px] border border-line bg-card", className)} {...p} />;
}
