/**
 * Pages locales pour le référencement : « abonnement fleurs Paris 11e », etc.
 * Générées statiquement pour chaque zone couverte.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Bouquet } from "@/components/bloom";
import { SiteFooter, SiteNav } from "@/components/site-nav";
import { LinkButton } from "@/components/ui";
import { CATALOG, euros } from "@/lib/catalog";
import { haversineKm } from "@/lib/matching";
import { subscriberPriceCents } from "@/lib/pricing";
import { FLORISTS } from "@/lib/seed";
import { ZONES, zoneBySlug } from "@/lib/zones";

export const generateStaticParams = () => ZONES.map((z) => ({ slug: z.slug }));
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const z = zoneBySlug((await params).slug);
  if (!z) return {};
  return {
    title: `Abonnement fleurs ${z.name} : livraison chaque mois ou aux dates clés`,
    description: `Bouquets d'artisans fleuristes livrés à ${z.name} (${z.postalCode}) : chaque mois dès 29 €, ou seulement anniversaires et fêtes avec le Carnet. Livraison incluse.`,
    alternates: { canonical: `/livraison-fleurs/${z.slug}` },
  };
}

export default async function ZonePage({ params }: { params: Promise<{ slug: string }> }) {
  const z = zoneBySlug((await params).slug);
  if (!z) notFound();
  const near = FLORISTS.filter((f) => f.active)
    .map((f) => ({ f, d: haversineKm(f, z) }))
    .filter((x) => x.d <= x.f.radiusKm)
    .sort((a, b) => a.d - b.d);
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <div className="grid items-center gap-10 md:grid-cols-[1.3fr_1fr]">
          <div>
            <h1 className="font-display text-5xl leading-tight sm:text-6xl">Des fleurs livrées à {z.name}, sans jamais y penser.</h1>
            <p className="mt-5 text-lg text-ink-soft">
              Un bouquet chaque mois, ou seulement les dates qui comptent. Composé par un atelier de quartier{near[0] ? `, à ${near[0].d.toFixed(1).replace(".", ",")} km` : ""}, livré au {z.postalCode}.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/abonnement" size="lg">Programmer un bouquet</LinkButton>
              <LinkButton href="/#formules" size="lg" variant="outline">Voir les prix</LinkButton>
            </div>
          </div>
          <div className="mx-auto w-56"><Bouquet palette={CATALOG[1].palette} seed={z.postalCode.length * 7 + Number(z.postalCode.slice(-2))} count={7} /></div>
        </div>
        <ul className="mt-16 grid gap-4 sm:grid-cols-3">
          {CATALOG.map((r) => (
            <li key={r.planId} className="rounded-[22px] border border-line bg-card p-6">
              <p className="font-display text-2xl">{r.name}</p>
              <p className="mt-2">{euros(r.priceCents)} / mois en mensuel</p>
              <p className="text-sm text-ink-soft">{euros(subscriberPriceCents(r.planId, CATALOG), true)} la date avec le Carnet</p>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-ink-soft">{near.length ? `${near.length} atelier${near.length > 1 ? "s" : ""} partenaire${near.length > 1 ? "s" : ""} livre${near.length > 1 ? "nt" : ""} ${z.name}.` : `Les ateliers partenaires arrivent bientôt à ${z.name}.`}</p>
      </main>
      <SiteFooter />
    </>
  );
}
