/**
 * Routeur en mémoire pour la démo publiée en page unique (artifact).
 * Remplace next/link et next/navigation ; la route courante est reflétée
 * dans le hash (#pro-fiches) pour pouvoir partager un écran précis.
 */
import { useSyncExternalStore } from "react";

type Loc = { path: string; search: string; anchor: string; n: number };
const toToken = (path: string) => path.replace(/^\//, "").replace(/\//g, "-");

function fromHash(): Loc {
  let h = "";
  try { h = decodeURIComponent(location.hash.slice(1)); } catch {}
  const routes = ["abonnement", "compte", "pro", "pro-fiches", "pro-boutique", "pro-rejoindre", "admin", "admin-dispatch", "admin-garantie", "admin-catalogue", "connexion", "merci", "rappels", "cgv", "mentions-legales"];
  if (h === "mentions-legales") return { path: "/mentions-legales", search: "", anchor: "", n: 0 };
  if (routes.includes(h)) return { path: "/" + h.replace(/-/g, "/"), search: "", anchor: "", n: 0 };
  return { path: "/", search: "", anchor: h, n: 0 };
}

let loc: Loc = typeof window === "undefined" ? { path: "/", search: "", anchor: "", n: 0 } : fromHash();
const subs = new Set<() => void>();

export function navigate(href: string, replace = false) {
  const url = new URL(href, "https://x.local" + loc.path);
  const anchor = url.hash.slice(1);
  loc = { path: url.pathname, search: url.search, anchor, n: loc.n + 1 };
  try {
    const token = loc.path === "/" ? anchor : toToken(loc.path);
    const target = token ? "#" + token : location.pathname + location.search;
    if (replace) history.replaceState(null, "", target);
    else history.pushState(null, "", target);
  } catch {}
  subs.forEach((f) => f());
  requestAnimationFrame(() => {
    const el = anchor ? document.getElementById(anchor) : null;
    if (el) el.scrollIntoView({ behavior: "smooth" });
    else window.scrollTo(0, 0);
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    loc = { ...fromHash(), n: loc.n + 1 };
    subs.forEach((f) => f());
  });
}

export function useLocation() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => loc,
    () => loc,
  );
}
