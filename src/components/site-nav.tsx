import Link from "next/link";
import { LinkButton, Logo } from "./ui";

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-7 text-[15px] text-ink-soft md:flex">
          <Link href="/#fonctionnement" className="hover:text-ink">Fonctionnement</Link>
          <Link href="/#formules" className="hover:text-ink">Formules</Link>
          <Link href="/#fleuristes" className="hover:text-ink">Pour les fleuristes</Link>
        </nav>
        <div className="flex items-center gap-1.5">
          <span className="hidden sm:block">
            <LinkButton href="/compte" variant="ghost" size="sm">
              Mon carnet
            </LinkButton>
          </span>
          <LinkButton href="/abonnement" size="sm">
            Offrir des fleurs
          </LinkButton>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-ink-soft">
            Des bouquets d&apos;artisans fleuristes de quartier, livrés à ceux que vous aimez. Programmés une fois, pour toujours.
          </p>
        </div>
        <FooterCol title="Offrir" links={[["Formules", "/#formules"], ["Commencer", "/abonnement"], ["Mon carnet", "/compte"], ["Rappels gratuits", "/rappels"], ["Vous avez reçu des fleurs ?", "/merci"]]} />
        <FooterCol title="Fleuristes" links={[["Devenir partenaire", "/pro/rejoindre"], ["Espace Moncleur Pro", "/pro"]]} />
        <FooterCol title="Moncleur" links={[["Conditions générales de vente", "/cgv"], ["Mentions légales", "/mentions-legales"], ["Résilier un abonnement", "/compte#abonnements"], ["Administration", "/admin"]]} />
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-10 text-xs text-ink-soft sm:px-6">© {new Date().getFullYear()} Moncleur SAS. Paiements sécurisés par Stripe.</p>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 space-y-2 text-sm text-ink-soft">
        {links.map(([l, h]) => (
          <li key={l}>
            <Link href={h} className="hover:text-ink">{l}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
