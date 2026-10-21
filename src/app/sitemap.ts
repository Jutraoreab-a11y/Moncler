import type { MetadataRoute } from "next";
import { ZONES } from "@/lib/zones";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://moncleur.fr";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["", "/abonnement", "/rappels", "/pro/rejoindre", "/cgv", "/mentions-legales"].map((p) => ({ url: `${SITE}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.6 }));
  return [...pages, ...ZONES.map((z) => ({ url: `${SITE}/livraison-fleurs/${z.slug}`, changeFrequency: "monthly" as const, priority: 0.7 }))];
}
