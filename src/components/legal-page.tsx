import { SiteFooter, SiteNav } from "./site-nav";

/** Mise en page des pages juridiques (texte long, lisible). */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <SiteNav />
      <main className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <p className="rounded-2xl bg-pollen-soft px-4 py-3 text-sm text-[#7a5300]">
          Projet de texte à faire valider par un juriste avant la mise en ligne. Les éléments entre crochets sont à compléter.
        </p>
        <h1 className="mt-8 font-display text-5xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-soft">Dernière mise à jour : {updated}</p>
        <div className="legal mt-10 space-y-8 text-[16px] leading-relaxed [&_h2]:font-display [&_h2]:text-3xl [&_li]:ml-5 [&_li]:list-disc [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:space-y-1.5">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
