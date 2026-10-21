import Link from "next/link";
import { Bouquet, Bud } from "@/components/bloom";
import { HeroCarnet } from "@/components/landing/hero-carnet";
import { SiteFooter, SiteNav } from "@/components/site-nav";
import { LinkButton } from "@/components/ui";
import { ModelBouquet } from "@/components/bouquet-choice";
import { CATALOG, euros, FREE_ORDER_LIMIT, PRO_PRICE_CENTS } from "@/lib/catalog";
import { MODELS, modelsOf } from "@/lib/models";
import { addonPriceCents, CARNET_YEARLY_QUOTA, EXTRA_STEMS, subscriberPriceCents } from "@/lib/pricing";
import { CoverageCheck } from "@/components/landing/coverage-check";

const STEPS = [
  { t: "Ajoutez vos proches", d: "Une adresse, un code d'entrée, un numéro. Deux minutes par personne, une seule fois." },
  { t: "Choisissez leurs dates", d: "Le 15 de chaque mois, son anniversaire, la fête des mères. Autant de dates que vous voulez." },
  { t: "On s'occupe du reste", d: "Un fleuriste près de chez eux compose le bouquet le jour même. Vous recevez la photo et l'avis de livraison." },
];

const YEAR = [
  { m: "Jan", ev: [] },
  { m: "Fév", ev: ["Saint-Valentin"] },
  { m: "Mar", ev: ["Anniv. Léa"] },
  { m: "Avr", ev: [] },
  { m: "Mai", ev: ["Fête des mères"] },
  { m: "Juin", ev: ["Fête des pères"] },
  { m: "Juil", ev: [] },
  { m: "Août", ev: ["Anniv. Mamie"] },
  { m: "Sep", ev: [] },
  { m: "Oct", ev: ["Anniv. de mariage"] },
  { m: "Nov", ev: [] },
  { m: "Déc", ev: ["Noël"] },
];

const FAQ = [
  ["Et si je veux changer le message avant l'envoi ?", "Vous recevez un rappel 48 h avant chaque livraison. Un clic pour modifier le mot, la formule ou décaler la date."],
  ["Et si le fleuriste est fermé ou malade ce jour-là ?", "Chaque commande est confirmée par l'atelier une semaine avant. S'il ne répond pas sous 48 h, s'il est en congés, ou si le bouquet n'est pas en préparation le jour J à 11 h 30, un atelier de secours voisin prend le relais, avec la même fiche technique. Vous n'avez rien à faire. Si vraiment aucun atelier n'est disponible, on vous prévient la veille et vous choisissez entre un report et un remboursement intégral."],
  ["Qui compose les bouquets ?", "Des artisans fleuristes indépendants, sélectionnés à moins de 7 km du destinataire. Chaque bouquet suit une fiche technique Moncleur : même générosité, partout."],
  ["Je peux arrêter quand je veux ?", "Avec l'abonnement mensuel, oui : pause ou résiliation en un clic, sans frais. Le Carnet Occasions Clés engage 12 mois : vous pouvez le résilier à tout moment, la fin prend effet au bout des 12 mois, puis il continue sans engagement. Dans les 14 jours après la souscription, tant qu'aucun bouquet n'est parti, vous êtes remboursé intégralement."],
  ["Et si personne n'est là pour recevoir le bouquet ?", "Le livreur dépose chez le gardien ou un voisin si vous l'avez indiqué. Sinon, nouvelle tentative le lendemain, sans frais. Vous êtes prévenu à chaque étape."],
  ["Comment sait-on qui offre le bouquet ?", "Chaque carte porte un code. Votre proche découvre votre prénom, peut vous envoyer un merci avec une photo, et vous le recevez dans votre carnet."],
  ["Et si son anniversaire tombe deux jours après le bouquet du mois ?", "On réunit les deux en un seul bouquet spécial, sans supplément. Si vous préférez deux livraisons, un clic dans votre carnet suffit."],
  ["Où livrez-vous ?", "Paris et la petite couronne aujourd'hui. Testez le code postal de votre proche en haut de la page ; s'il n'est pas couvert, laissez votre e-mail : nous ouvrons une zone dès que trois ateliers y sont actifs."],
];

export default function Home() {
  return (
    <>
      <SiteNav />
      <main>
        {/* HERO */}
        <section className="relative overflow-hidden">
          <div className="mx-auto grid max-w-6xl items-center gap-16 px-4 pb-20 pt-12 sm:px-6 md:pt-20 lg:grid-cols-[1.15fr_1fr]">
            <div>
              <h1 className="font-display text-[clamp(48px,7.4vw,96px)] leading-[0.92] tracking-[-0.025em]">
                Ils recevront des fleurs.
                <span className="block italic text-ink-soft">Vous n&apos;aurez plus jamais à y penser.</span>
              </h1>
              <p className="mt-7 max-w-[34ch] text-lg leading-relaxed text-ink-soft">
                Programmez une fois les dates qui comptent. Un fleuriste de leur quartier compose et livre le bouquet, chaque fois, à l&apos;heure.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <LinkButton href="/abonnement" size="lg">
                  Programmer un premier bouquet
                </LinkButton>
                <LinkButton href="/compte" size="lg" variant="outline">
                  Voir un carnet en action
                </LinkButton>
              </div>
              <p className="mt-6 text-sm text-ink-soft">Dès {euros(2900)} par mois. Sans engagement, pause en un clic.</p>
              <CoverageCheck />
            </div>
            <HeroCarnet />
          </div>
        </section>

        {/* ANNÉE */}
        <section aria-labelledby="annee" className="border-y border-line bg-card">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="annee" className="max-w-xl font-display text-4xl leading-tight sm:text-5xl">
              Une année entière d&apos;attentions, réglée en cinq minutes.
            </h2>
            <ol className="mt-10 grid grid-cols-4 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-6 lg:grid-cols-12">
              {YEAR.map((y, i) => (
                <li key={y.m} className="relative flex min-h-[132px] flex-col bg-card p-3">
                  <span className="text-xs font-semibold text-ink-soft">{y.m}</span>
                  <Bud color={i % 2 ? "#e23f6b" : "#b82a53"} size={18} className="mt-2 opacity-90" />
                  <span className="mt-1 text-[11px] text-ink-soft">Mensuel</span>
                  {y.ev.map((e) => (
                    <span key={e} className="mt-auto rounded-lg bg-pollen-soft px-1.5 py-1 text-[11px] font-semibold leading-tight text-[#7a5300]">
                      {e}
                    </span>
                  ))}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FONCTIONNEMENT */}
        <section id="fonctionnement" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
          <h2 className="font-display text-4xl sm:text-5xl">Comment ça marche</h2>
          <ol className="mt-12 grid gap-10 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.t} className="border-t-2 border-ink pt-5">
                <span className="font-display text-5xl text-peony">{i + 1}</span>
                <h3 className="mt-3 text-xl font-semibold">{s.t}</h3>
                <p className="mt-2 max-w-[38ch] text-ink-soft">{s.d}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* FORMULES */}
        <section id="formules" className="scroll-mt-20 bg-lilac/60">
          <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <h2 className="max-w-lg font-display text-4xl sm:text-5xl">Un bouquet par mois. Les grandes dates en Spécial événement.</h2>
              <p className="max-w-sm text-ink-soft">Mensuel : une occasion remplace le bouquet du mois, livré le jour J pour +30 %. Carnet : seulement vos dates, −15 %. Livraison incluse dans tous les cas.</p>
            </div>
            <div className="mt-12 flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="font-display text-3xl">Abonnement mensuel</h3>
              <p className="text-ink-soft">Sans engagement · 1 bouquet par mois · pause en un clic</p>
            </div>
            <div className="mt-5 grid gap-5 md:grid-cols-3">
              {CATALOG.map((r, i) => (
                <article
                  key={r.planId}
                  className={`relative flex flex-col rounded-[28px] p-7 ${i === 1 ? "bg-ink text-paper" : "bg-card"}`}
                >
                  {i === 1 && (
                    <span className="absolute right-6 top-6 rounded-full bg-pollen px-3 py-1 text-xs font-bold text-ink">Le plus offert</span>
                  )}
                  <div className="mx-auto -mt-2 w-44">
                    <Bouquet palette={r.palette} seed={i * 5 + 2} count={5 + i * 2} wrap={i === 1 ? "#f7e6ea" : "#e9ddf3"} />
                  </div>
                  <h3 className="mt-2 font-display text-3xl">{r.name}</h3>
                  <p className={`mt-1 text-sm ${i === 1 ? "text-paper/70" : "text-ink-soft"}`}>{r.size}</p>
                  <p className="mt-5 flex items-baseline gap-1">
                    <span className="font-display text-5xl">{euros(r.priceCents)}</span>
                    <span className={i === 1 ? "text-paper/70" : "text-ink-soft"}>/ mois</span>
                  </p>
                  <ul className={`mt-5 space-y-1.5 text-[15px] ${i === 1 ? "text-paper/85" : "text-ink-soft"}`}>
                    {r.stems.map((s) => (
                      <li key={s.label}>
                        {s.qty} × {s.label}
                      </li>
                    ))}
                    <li>{r.packaging}</li>
                  </ul>
                  <p className={`mt-4 text-sm ${i === 1 ? "text-paper/85" : "text-ink-soft"}`}>
                    Occasion (bouquet du mois livré ce jour-là) : <strong className={i === 1 ? "text-paper" : "text-ink"}>+{euros(addonPriceCents(r.planId, CATALOG), true)}</strong>
                  </p>
                  <p className={`mt-2 text-sm font-semibold ${i === 1 ? "text-pollen" : "text-peony-deep"}`}>
                    {modelsOf(r.planId, MODELS).length} modèles : {modelsOf(r.planId, MODELS).map((m) => m.name).join(", ")}
                  </p>
                  <LinkButton href={`/abonnement?offre=mensuel&formule=${r.planId}`} variant={i === 1 ? "primary" : "ink"} className="mt-8 w-full">
                    Choisir {r.name.replace("Le ", "le ")}
                  </LinkButton>
                </article>
              ))}
            </div>

            <div className="mt-8 grid gap-8 rounded-[28px] bg-ink p-7 text-paper sm:p-10 lg:grid-cols-[1.1fr_1fr]">
              <div>
                <span className="rounded-full bg-pollen px-3 py-1 text-xs font-bold text-ink">Engagement 12 mois, puis sans engagement</span>
                <h3 className="mt-4 font-display text-4xl leading-tight sm:text-5xl">Carnet Occasions Clés</h3>
                <p className="mt-3 max-w-md text-paper/75">
                  Choisissez vos dates (anniversaires, Saint-Valentin, fêtes des mères et des pères) et la taille de chaque bouquet. Vous payez seulement ces bouquets, au prix abonné, lissés sur 12 mois. Jusqu&apos;à {CARNET_YEARLY_QUOTA} dates, une par mois au plus.
                </p>
                <p className="mt-5 font-display text-3xl">
                  4 dates en Signature : {euros(Math.ceil((4 * subscriberPriceCents("signature", CATALOG)) / 12), true)}
                  <span className="text-base text-paper/60"> / mois</span>
                </p>
              </div>
              <ul className="grid gap-3 self-center">
                {CATALOG.map((r) => (
                  <li key={r.planId}>
                    <Link href={`/abonnement?offre=carnet&formule=${r.planId}`} className="flex items-center justify-between gap-4 rounded-2xl bg-paper/10 px-5 py-4 transition hover:bg-paper/15">
                      <span>
                        <span className="block font-display text-2xl">{r.name}</span>
                        <span className="text-sm text-paper/60"><s>{euros(r.priceCents)}</s> au prix public</span>
                      </span>
                      <span className="font-display text-3xl">{euros(subscriberPriceCents(r.planId, CATALOG), true)}<span className="text-base text-paper/60"> la date</span></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-8 overflow-x-auto rounded-[22px] bg-card">
              <table className="w-full min-w-[560px] text-left text-sm">
                <caption className="px-6 pt-5 text-left font-semibold">Options pour les grandes occasions, à tarif abonné</caption>
                <tbody>
                  <tr className="border-b border-line">
                    <th scope="row" className="px-6 py-3 font-normal text-ink-soft">Occasion (Mensuel, 1 par mois)</th>
                    {CATALOG.map((r) => (
                      <td key={r.planId} className="py-3 last:pr-6">{r.name.replace("Le ", "")} <strong>+{euros(addonPriceCents(r.planId, CATALOG), true)}</strong></td>
                    ))}
                  </tr>
                  <tr className="border-b border-line">
                    <th scope="row" className="px-6 py-3 font-normal text-ink-soft">Surclasser une occasion</th>
                    <td className="py-3">Classique → Signature <strong>+15 €</strong></td>
                    <td className="py-3">Classique → Prestige <strong>+40 €</strong></td>
                    <td className="py-3 pr-6">Signature → Prestige <strong>+25 €</strong></td>
                  </tr>
                  <tr>
                    <th scope="row" className="px-6 py-3 font-normal text-ink-soft">Extra tige noble (Classique)</th>
                    {EXTRA_STEMS.map((x) => (
                      <td key={x.id} className="py-3 last:pr-6">{x.label} <strong>+{euros(x.priceCents)}</strong></td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* MODES DE CHOIX */}
        <section aria-labelledby="modes" className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <h2 id="modes" className="max-w-2xl font-display text-4xl leading-tight sm:text-5xl">Le même bouquet qu&apos;elle adore, ou une surprise chaque mois.</h2>
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <article className="rounded-[28px] border border-line bg-card p-7">
              <h3 className="font-display text-3xl">Modèle fixe</h3>
              <p className="mt-2 max-w-md text-ink-soft">
                Elle ne jure que par les pivoines ? Choisissez Pivoine Reine pour son anniversaire, Rose Poudre pour le mois, Jardin d&apos;Été pour la Saint-Valentin. Un bouquet précis par personne et par date.
              </p>
              <div className="mt-6 flex items-end gap-3">
                {["m_pivoine_reine", "m_rose_poudre", "m_jardin_ete"].map((id) => {
                  const m = MODELS.find((x) => x.id === id)!;
                  return (
                    <figure key={id} className="flex-1 rounded-2xl bg-paper p-3">
                      <div className="mx-auto w-20"><ModelBouquet model={m} /></div>
                      <figcaption className="mt-1 text-center text-sm font-semibold">{m.name}</figcaption>
                    </figure>
                  );
                })}
              </div>
            </article>
            <article className="rounded-[28px] bg-ink p-7 text-paper">
              <h3 className="font-display text-3xl">Surprise</h3>
              <p className="mt-2 max-w-md text-paper/75">
                Vous choisissez la gamme, on fait tourner les modèles. Jamais deux fois le même d&apos;affilée, et le nom du bouquet n&apos;est révélé que le jour où il part.
              </p>
              <ol className="mt-6 grid grid-cols-3 gap-3">
                {[
                  ["Ce mois-ci", "m_corail", true],
                  ["Le mois prochain", "m_nuit_violette", false],
                  ["Dans deux mois", "m_jardin_ete", false],
                ].map(([month, id, shown]) => {
                  const m = MODELS.find((x) => x.id === id)!;
                  return (
                    <li key={month as string} className="rounded-2xl bg-paper/10 p-3 text-center">
                      <p className="text-xs text-paper/60">{month as string}</p>
                      <div className={`relative mx-auto mt-1 w-20 ${shown ? "" : "opacity-40 blur-[3px]"}`}><ModelBouquet model={m} wrap="#f7e6ea" /></div>
                      <p className="mt-1 text-sm font-semibold">{shown ? m.name : "?"}</p>
                    </li>
                  );
                })}
              </ol>
            </article>
          </div>
        </section>

        {/* ATELIERS */}
        <section aria-labelledby="ateliers" className="mx-auto max-w-6xl px-4 pb-24 sm:px-6">
          <h2 id="ateliers" className="max-w-2xl font-display text-4xl leading-tight sm:text-5xl">Composés à moins de 7 km de chez eux, par des ateliers de quartier.</h2>
          <p className="mt-3 max-w-xl text-ink-soft">Chaque commande part chez l&apos;atelier partenaire le plus proche du destinataire, qui suit la fiche technique Moncleur et la saison.</p>
          <ul className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              ["Commande une semaine avant", "L'atelier achète au marché au bon prix et sans gaspillage : trois semaines avant pour la Saint-Valentin et la fête des mères."],
              ["Photo avant le départ", "Le fleuriste photographie le bouquet. Vous la recevez, votre proche aussi sur sa page de remerciement."],
              ["Livré par le quartier", "L'atelier livre lui-même ou confie la course à un coursier. Destinataire absent : nouvelle tentative le lendemain, sans frais."],
            ].map(([title, body]) => (
              <li key={title} className="rounded-[24px] border border-line bg-card p-6">
                <p className="font-display text-2xl">{title}</p>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* FLEURISTES */}
        <section id="fleuristes" className="scroll-mt-20 bg-ink text-paper">
          <div className="mx-auto grid max-w-6xl gap-14 px-4 py-24 sm:px-6 lg:grid-cols-2">
            <div>
              <p className="text-pollen">Moncleur Pro, pour les fleuristes</p>
              <h2 className="mt-3 font-display text-4xl leading-[1.05] sm:text-6xl">Des commandes qui reviennent chaque mois. Sans prospecter.</h2>
              <p className="mt-6 max-w-md text-paper/75">
                Vous recevez les commandes de votre quartier une semaine à l&apos;avance, avec la fiche technique du bouquet. Vous composez, un coursier passe, le virement part automatiquement.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <LinkButton href="/pro/rejoindre" variant="primary" size="lg">
                  Devenir fleuriste partenaire
                </LinkButton>
                <LinkButton href="/pro" variant="outline" size="lg" className="border-paper/25 bg-transparent text-paper hover:border-paper/60">
                  Visiter l&apos;espace Pro
                </LinkButton>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-px self-end overflow-hidden rounded-[24px] bg-paper/15">
              {[
                [String(FREE_ORDER_LIMIT), "premières commandes sans abonnement"],
                [euros(PRO_PRICE_CENTS), "par mois ensuite, commandes illimitées"],
                ["J-7", "visibilité sur votre production"],
                ["48 h", "délai de virement après livraison"],
              ].map(([v, l]) => (
                <div key={l} className="bg-ink p-6">
                  <dt className="sr-only">{l}</dt>
                  <dd className="font-display text-5xl text-paper">{v}</dd>
                  <dd className="mt-2 text-sm text-paper/65">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* FAQ */}
        <section className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
          <h2 className="font-display text-4xl sm:text-5xl">Questions fréquentes</h2>
          <div className="mt-10 divide-y divide-line border-y border-line">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold">
                  {q}
                  <span className="text-2xl text-peony transition group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-3 max-w-[60ch] text-ink-soft">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="px-4 pb-24 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-center rounded-[32px] bg-peony px-6 py-16 text-center text-white">
            <h2 className="max-w-2xl font-display text-4xl leading-tight sm:text-6xl">Qui aimeriez-vous surprendre le mois prochain ?</h2>
            <LinkButton href="/abonnement" variant="ink" size="lg" className="mt-8">
              Programmer un bouquet
            </LinkButton>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
