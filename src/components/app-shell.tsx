"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./ui";
import { isDemo } from "@/lib/api-client";
import { useStore } from "@/lib/store";

const SPACES = [
  { href: "/compte", label: "Abonné" },
  { href: "/pro", label: "Fleuriste" },
  { href: "/admin", label: "Admin" },
];

export function AppShell({
  children,
  tabs,
  tone = "paper",
  right,
}: {
  children: React.ReactNode;
  tabs?: { href: string; label: string }[];
  tone?: "paper" | "ink";
  right?: React.ReactNode;
}) {
  const path = usePathname();
  const { dispatch } = useStore();
  return (
    <div className={clsx("min-h-dvh", tone === "ink" && "bg-[#f5eef1]")}>
      {isDemo && (
        <div className="bg-ink text-paper">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs sm:px-6">
            <span className="text-paper/75">Démo interactive · données stockées dans ce navigateur</span>
            <div className="flex items-center gap-1">
              {SPACES.map((s) => (
                <Link
                  key={s.href}
                  href={s.href}
                  className={clsx("rounded-full px-2.5 py-1 font-semibold", path.startsWith(s.href) ? "bg-paper text-ink" : "text-paper/80 hover:text-paper")}
                >
                  {s.label}
                </Link>
              ))}
              <button onClick={() => dispatch({ type: "reset" })} className="ml-1 rounded-full px-2.5 py-1 text-paper/60 hover:text-paper">
                Réinitialiser
              </button>
            </div>
          </div>
        </div>
      )}
      <header className="border-b border-line bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Logo />
            {tabs && (
              <nav className="hidden gap-1 md:flex">
                {tabs.map((t) => (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={clsx("rounded-full px-3.5 py-1.5 text-sm font-semibold", path === t.href ? "bg-ink text-paper" : "text-ink-soft hover:text-ink")}
                  >
                    {t.label}
                  </Link>
                ))}
              </nav>
            )}
          </div>
          {right}
        </div>
        {tabs && (
          <nav className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
            {tabs.map((t) => (
              <Link key={t.href} href={t.href} className={clsx("shrink-0 rounded-full px-3 py-1 text-sm font-semibold", path === t.href ? "bg-ink text-paper" : "text-ink-soft")}>
                {t.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      {children}
    </div>
  );
}
