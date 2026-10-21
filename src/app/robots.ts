import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://moncleur.fr";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/pro/rejoindre"], disallow: ["/api/", "/compte", "/pro$", "/pro/boutique", "/pro/fiches", "/admin", "/merci", "/rappels"] }],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
