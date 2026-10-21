import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { CATALOG, euros } from "@/lib/catalog";
import { EXTRA_STEMS, RETRACTATION_DAYS, subscriberPriceCents, UPGRADE_PRICES } from "@/lib/pricing";

export const metadata: Metadata = { title: "Conditions générales de vente" };

export default function CGV() {
  return (
    <LegalPage title="Conditions générales de vente" updated="13 octobre 2026">
      <section>
        <h2>1. Qui sommes-nous</h2>
        <p>Moncleur SAS, [capital], [adresse du siège], RCS [ville et numéro], TVA [numéro]. Contact : [e-mail du service client], [téléphone].</p>
        <p>Moncleur met en relation des abonnés avec des artisans fleuristes indépendants qui composent et livrent les bouquets.</p>
      </section>

      <section>
        <h2>2. Offres et prix</h2>
        <p>Les prix sont indiqués en euros TTC, livraison comprise. Un bouquet a un prix public par taille ; les abonnés bénéficient d&apos;une remise de 15 % sur tout bouquet en plus de leur formule.</p>
        <ul>
          {CATALOG.map((r) => (
            <li key={r.planId}>
              {r.name} : {euros(r.priceCents)} (prix public), {euros(subscriberPriceCents(r.planId, CATALOG), true)} au prix abonné.
            </li>
          ))}
        </ul>
        <p><strong>Abonnement mensuel</strong> : un bouquet par mois au prix public de la taille choisie, sans engagement. Un bouquet au plus par mois civil et par destinataire, soit douze par an. Une occasion (anniversaire, Saint-Valentin, fête des mères, fête des pères, autre date) remplace le bouquet du mois où elle tombe : il est livré à la date de l&apos;occasion, en version « Spécial événement », moyennant un supplément de 30 % du prix de la formule ({CATALOG.map((r) => `${r.name.replace("Le ", "")} ${euros(Math.round(r.priceCents * 0.3), true)}`).join(", ")}), prélevé trois jours avant la livraison.</p>
        <p><strong>Carnet Occasions Clés</strong> : l&apos;abonné choisit ses dates et la taille de chaque bouquet. La mensualité est égale à la somme de ces bouquets au prix abonné, divisée par 12. Douze dates au plus par année d&apos;abonnement, une par mois civil au plus. Une date ajoutée en cours d&apos;année est facturée à part au prix abonné, puis intégrée à la mensualité au renouvellement.</p>
        <p><strong>Options</strong> : surclassement d&apos;une occasion (Classique vers Signature {euros(UPGRADE_PRICES["classique>signature"])}, Classique vers Prestige {euros(UPGRADE_PRICES["classique>prestige"])}, Signature vers Prestige {euros(UPGRADE_PRICES["signature>prestige"])}) ; extra tige noble sur un bouquet Classique ({EXTRA_STEMS.map((x) => `${x.label} ${euros(x.priceCents)}`).join(", ")}).</p>
      </section>

      <section>
        <h2>3. Durée, engagement et résiliation</h2>
        <p>L&apos;abonnement mensuel est sans engagement : il peut être mis en pause ou résilié à tout moment depuis l&apos;espace « Mon carnet », rubrique Abonnements, en trois clics. La résiliation prend effet immédiatement ; aucun prélèvement n&apos;a lieu ensuite.</p>
        <p>Le Carnet Occasions Clés est souscrit pour une durée initiale de 12 mois. L&apos;abonné peut demander sa résiliation à tout moment par la même fonction ; elle prend effet au terme des 12 mois, les livraisons et prélèvements continuant jusque-là. À l&apos;issue des 12 mois, le Carnet se poursuit sans engagement et peut être résilié à tout moment.</p>
        <p>Chaque résiliation fait l&apos;objet d&apos;une confirmation par e-mail indiquant sa date de prise d&apos;effet.</p>
      </section>

      <section>
        <h2>4. Droit de rétractation</h2>
        <p>L&apos;abonné dispose de {RETRACTATION_DAYS} jours à compter de la souscription pour se rétracter, sans motif, depuis son espace. Tant qu&apos;aucun bouquet n&apos;a été livré, il est remboursé intégralement sous 14 jours.</p>
        <p>Les fleurs étant des biens susceptibles de se détériorer rapidement, un bouquet déjà livré ne peut pas faire l&apos;objet d&apos;une rétractation (article L221-28 du Code de la consommation). [À valider : articulation avec la rétractation sur l&apos;abonnement.]</p>
      </section>

      <section>
        <h2>5. Paiement</h2>
        <p>Le paiement s&apos;effectue par carte via Stripe. La mensualité est prélevée à la date anniversaire de la souscription. Les suppléments (occasions en plus, dates ajoutées, surclassements, extras) sont prélevés trois jours avant la livraison concernée ; l&apos;abonné est prévenu par e-mail et peut encore modifier l&apos;envoi. En cas d&apos;échec du paiement d&apos;un supplément la veille de la livraison, celle-ci est annulée sans frais.</p>
      </section>

      <section>
        <h2>6. Livraison</h2>
        <p>Livraison à Paris et en petite couronne, dans les zones affichées sur le site. Si le destinataire est absent, le bouquet est confié au gardien ou à la personne indiquée dans les notes d&apos;accès ; à défaut, une nouvelle tentative a lieu le lendemain sans frais. Les variétés peuvent varier selon la saison, dans le respect de la palette et du nombre de tiges de la fiche du bouquet.</p>
      </section>

      <section>
        <h2>7. Réclamations et médiation</h2>
        <p>Toute réclamation peut être adressée à [e-mail du service client] dans les 48 heures suivant la livraison, photo à l&apos;appui. En cas de litige non résolu, l&apos;abonné peut recourir gratuitement au médiateur de la consommation : [nom et coordonnées du médiateur].</p>
      </section>

      <section>
        <h2>8. Données personnelles</h2>
        <p>Les adresses et téléphones des destinataires servent uniquement à la livraison et sont transmis au fleuriste et au coursier pour cette seule finalité. Les dates importées dans les rappels restent privées. Droits d&apos;accès, de rectification et de suppression : [e-mail du délégué à la protection des données].</p>
      </section>

      <section>
        <h2>9. Droit applicable</h2>
        <p>Les présentes conditions sont soumises au droit français.</p>
      </section>
    </LegalPage>
  );
}
