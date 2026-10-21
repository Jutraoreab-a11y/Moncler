import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Mentions légales" };

export default function Mentions() {
  return (
    <LegalPage title="Mentions légales" updated="13 octobre 2026">
      <section>
        <h2>Éditeur</h2>
        <p>Moncleur SAS, [capital], [adresse], RCS [ville et numéro]. Directeur de la publication : [nom].</p>
      </section>
      <section>
        <h2>Hébergement</h2>
        <p>Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis. Base de données : Supabase, région [UE].</p>
      </section>
      <section>
        <h2>Paiements</h2>
        <p>Les paiements et les versements aux fleuristes sont opérés par Stripe Payments Europe Ltd.</p>
      </section>
      <section>
        <h2>Contact</h2>
        <p>[e-mail] · [téléphone]</p>
      </section>
    </LegalPage>
  );
}
