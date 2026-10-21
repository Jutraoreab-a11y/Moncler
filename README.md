# Moncleur

Abonnements floraux « Set & Forget » : l'abonné programme une fois les dates qui comptent, un fleuriste de quartier compose et livre le bouquet à chaque occasion.

Marketplace B2B2C : abonnement B2C (29 / 49 / 79 €) + SaaS fleuristes (10 commandes offertes, puis 29 €/mois), reversements Stripe Connect, coursiers Uber Direct / Stuart.

## Démarrer en 30 secondes (mode démo)

```bash
npm install
npm run dev
```

Ouvrez http://localhost:3000. Sans variable Supabase, l'application tourne **en démo** : les données vivent dans le navigateur et tout est cliquable.

À essayer :

1. `/abonnement` : choisir une gamme puis **Surprise** (rotation) ou **Modèle fixe**, et programmer un bouquet (l'autocomplétion d'adresse utilise la Base Adresse Nationale et montre le fleuriste attribué).
2. Ouvrir `/pro` et `/compte` **dans deux onglets côte à côte** : chaque clic du fleuriste (« Commencer la préparation », « Prêt à être récupéré », « Marquer comme livré ») fait avancer le suivi en direct chez l'abonné, avec pluie de pétales à la livraison.
3. Livrer 3 bouquets côté `/pro` : le compteur passe à 10/10 et le **paywall** se déclenche sur les commandes suivantes.
4. Une commande prioritaire arrive automatiquement après 9 s sur `/pro` (carillon + notification), ou via « Simuler une commande ».
5. Dans `/compte`, le bouton « Bouquet » de chaque envoi permet de changer de gamme, de mode ou de modèle date par date.
6. `/admin` : MRR B2C/B2B, livraisons hebdo, CA par fleuriste ; `/admin/dispatch` : carte du matching ; `/admin/catalogue` : gammes, modèles (ajout, retrait de la rotation, fiches techniques).

Le bandeau du haut permet de passer d'un espace à l'autre et de réinitialiser la démo.

## Passer en production

1. **Supabase** : créez un projet, exécutez `supabase/schema.sql` dans l'éditeur SQL. Passez votre compte en admin :
   `update public.users set role = 'admin' where email = 'vous@exemple.fr';`
2. **Stripe** : activez Connect (Express), lancez `STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup` pour créer les produits et prix, puis créez un endpoint webhook vers `/api/stripe/webhook` avec les événements
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.created`, `invoice.paid`, `invoice.payment_failed`, `account.updated` (cochez « événements des comptes connectés »).
   En local : `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
3. Copiez `.env.example` en `.env.local` et remplissez les clés.
4. **Déploiement Vercel** : `vercel.json` déclare le cron quotidien `/api/cron/dispatch` et le cron de garantie `/api/cron/guarantee` toutes les 15 minutes (définissez `CRON_SECRET` ; les crons infra-journaliers demandent l'offre Vercel Pro, sinon appelez la route depuis un planificateur externe).
5. **Coursiers** : renseignez les clés Uber Direct et/ou Stuart, et déclarez le webhook
   `/api/webhooks/courier?provider=uber&token=…` (ou `provider=stuart`).

Dès que `NEXT_PUBLIC_SUPABASE_URL` est défini, le store charge l'état depuis `/api/state` (filtré par RLS), écoute les changements de commandes en temps réel, et réplique chaque action via `/api/actions`. Le middleware protège `/compte`, `/pro` et `/admin` par rôle.

## Architecture

```
src/
  app/
    page.tsx                  Landing
    abonnement/               Tunnel B2C : formule → proche → dates → message → paiement
    compte/                   Carnet abonné : suivi en direct, prochains envois, proches, pause/résiliation
    pro/                      Moncleur Pro : commandes J → J+7, fiches techniques, freemium & paywall
      fiches/ boutique/ rejoindre/
    admin/                    Métriques, dispatching (carte), catalogue
    connexion/ auth/callback/ Lien magique Supabase
    api/
      checkout/               Session Stripe Checkout B2C (abonnement ou setup)
      stripe/webhook/         Abonnements B2C, bascule Freemium → Pro, Connect
      pro/subscribe/          Checkout Moncleur Pro 29 €/mois
      connect/onboard/        Onboarding Stripe Connect Express
      orders/[id]/status/     Bouton 1-clic fleuriste (coursier + virement)
      cron/dispatch/          Génération J+7, proposition aux ateliers, prélèvements J-3, confirmation J-1
      cron/guarantee/         Garantie de livraison toutes les 15 min (rappels, relais, 11 h, reports)
      webhooks/courier/       Statuts Uber Direct / Stuart
      state/ actions/         Lecture / écriture de l'état applicatif
  lib/
    engine.ts                 Moteur Set & Forget (partagé démo / serveur)
    matching.ts               Haversine + règle du plus proche disponible
    dates.ts                  Récurrences (mensuel, anniversaire, fête des mères…)
    catalog.ts seed.ts store.tsx types.ts
    server/                   Stripe, coursiers, transitions de commande
supabase/schema.sql           Tables, triggers, RLS, RPC nearest_florist, vues métriques
```

### Offres et facturation (`src/lib/pricing.ts`, partagé démo / serveur)

**Mensuel : un bouquet par mois, occasions à +30 %. Carnet : seulement vos dates, à −15 %.**

| Formule | Prix | Engagement | Contenu |
|---|---|---|---|
| Mensuel (`MONTHLY_RECURRING`) | 29 / 49 / 79 € par mois | aucun | 1 bouquet par mois (12 par an) ; une occasion remplace le bouquet de son mois pour +30 % (+8,70 / +14,70 / +23,70 €) |
| Carnet Occasions Clés (`SPECIAL_EVENTS_CARNET`) | somme des dates au prix abonné ÷ 12 (ex. 4 dates Signature = 13,89 €/mois) | 12 mois, puis sans engagement | chaque date a sa taille ; 12 dates max par an, 1 max par mois |

- **Date de Carnet ajoutée en cours d'année** : prélevée à J-3 au prix abonné, intégrée à la mensualité au renouvellement (`renewCarnets`).
- **Surclassement** : +15 / +40 / +25 € ; **extra tige noble** (Classique) : +8 / +10 / +12 €.
- **Économie unitaire** (`unitEconomics`) : rémunération fleuriste 10 / 20 / 35 €, coursier estimé 9,50 € (×1,5 les jours de pic), forfait 6 € à l'atelier qui livre lui-même, frais Stripe. Toutes les offres ont une marge positive (testé) ; seul le pire cas « date Classique livrée par coursier un jour de pic » est à −0,22 €, d'où la priorité donnée ce jour-là aux ateliers qui livrent eux-mêmes.
- **Calendrier** : J-21 commandes visibles pour les jours de pic, J-7 sinon ; J-3 suppléments prélevés + rappel ; J-1 confirmation (impayé = annulé).
- **Ateliers** : capacité journalière (au-delà → atelier suivant), Moncleur Pro 29 €/mois offert les mois à moins de 5 livraisons (avoir automatique sur la facture Stripe, `invoice.created`).
- **Juridique** : résiliation en 3 clics + e-mail de confirmation, rétractation 14 jours (remboursement si aucun bouquet livré), CGV et mentions légales en projet (`/cgv`, `/mentions-legales`) **à faire valider par un juriste**.

### Occasions du Mensuel

Un bouquet par mois et par destinataire, 12 par an au total. Une occasion (anniversaire, Saint-Valentin, fête des mères, fête des pères, autre date) remplace le bouquet du mois où elle tombe : il est livré à la date de l'occasion en « Spécial événement », pour +30 % de la formule (Classique +8,70 €, Signature +14,70 €, Prestige +23,70 €), prélevés à J-3 (prix Stripe `moncleur_occasion_boost_*`). Deux occasions le même mois : la seconde est refusée (tunnel, API et trigger SQL). Si le bouquet du mois est déjà parti, l'occasion de ce mois passe à l'année suivante.

### Garantie de livraison (`src/lib/guarantee.ts`, partagé démo / serveur)

Chaque bouquet part, quels que soient le mois et les disponibilités des ateliers.

| Moment | Règle |
| --- | --- |
| J-7 (J-21 les jours de pic) | Proposition à l'atelier le mieux placé : ouvert ce jour-là, sous sa capacité, non suspendu, dans son rayon. L'atelier habituel du destinataire passe devant s'il est à moins de 2 km du plus proche. Acceptation automatique possible. |
| +24 h | Rappel e-mail + SMS. |
| +48 h | Sans réponse : 1 point de manquement, proposition à l'atelier suivant. Un refus explicite ne coûte rien. |
| J-2 18 h | Date limite : la commande est ouverte aux 3 ateliers les plus proches, le premier qui accepte la prend (tours de 2 h). Personne : alerte équipe. |
| J-1 18 h | Toujours sans atelier : l'abonné est prévenu. |
| Jour J 9 h 30 | Rappel si la préparation n'a pas commencé. |
| Jour J 11 h 00 | La commande doit être « En préparation » ou « Prête ». Sinon : alerte sonore dans l'espace Pro + SMS. |
| Jour J 11 h 30 | Toujours rien : `CRITICAL_REASSIGN`. 2 points, retrait de la commande, transfert en urgence aux 3 ateliers de secours les plus proches avec une prime de préparation +20 %, retenue sur les prochains virements de l'atelier défaillant (`florist_debits`). Le secours a 1 h pour lancer la préparation ; au-delà, alerte équipe. |
| Jour J 15 h | Toujours personne : livraison le lendemain sans frais. Au 3e essai, annulation : supplément remboursé sur la carte, part incluse créditée sur la prochaine mensualité. |

Fermetures (jours fixes, jours fériés, congés) : aucune proposition ces jours-là ; une fermeture déclarée après acceptation renvoie la commande chez un voisin (1 point si moins de 48 h avant). Un supplément refusé à J-3 suspend la règle de 11 h. 3 points sur 30 jours suspendent les propositions jusqu'à revue par l'équipe (`/admin/garantie`). Une commande ne peut pas passer « en préparation » sans acceptation (API + trigger SQL). Les écritures du cron sont conditionnelles et l'acceptation d'une urgence est atomique (premier arrivé, premier servi).

### Croissance

- **Page destinataire** `/merci?code=XXXXXX` (lien court `/m/XXXXXX`, QR sur la carte) : qui offre, photo du bouquet, merci + photo renvoyés à l'abonné, offre de parrainage.
- **Parrainage** : −10 € sur le premier mois du filleul (coupon Stripe), 10 € de crédit pour le parrain (solde client Stripe).
- **Rappels gratuits** `/rappels` : saisie ou import de contacts (.vcf) / agenda (.ics), e-mail à J-7 avec lien de programmation prérempli.
- **Test de zone** sur l'accueil + liste d'attente ; **pages locales** `/livraison-fleurs/[quartier]`, `sitemap.xml`, `robots.txt`.
- **Photo du bouquet** prise par l'atelier avant le départ ; **destinataire absent** → nouvelle tentative le lendemain sans frais.

### Tests

```bash
npm test        # règles tarifaires, fusion, quotas, capacité, rétractation, import de dates
```

### Recette avant lancement

1. `supabase/schema.sql` puis `supabase/storage.sql` (bucket photos).
2. `npm run stripe:setup` en mode test ; webhook avec `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.created`, `invoice.paid`, `invoice.payment_failed`, `account.updated`.
3. `curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/health` doit renvoyer `ok: true`.
4. Parcours à jouer en mode test : Mensuel, Carnet, parrainage, rétractation, résiliation Carnet, J-3 (`/api/cron/dispatch`), absence coursier.

### Règles métier clés

- **Modes de choix du bouquet** (`lib/models.ts`, SQL `pick_model`) : chaque gamme contient plusieurs modèles (`bouquet_models`). Chaque date programmée a son mode :
  - *Modèle fixe* : le client choisit un modèle précis pour cette personne et cette date.
  - *Surprise* : seule la gamme est choisie. À chaque commande, on sert le modèle actif que ce destinataire a reçu il y a le plus longtemps (jamais reçu = prioritaire). On parcourt donc toute la gamme avant de répéter, et un nouveau modèle est servi en premier. Le nom reste secret côté client jusqu'au statut « Prêt ».
  - Changer de mode ou de modèle met à jour les commandes non commencées (trigger `resync_order_models`). Un modèle fixe retiré du catalogue bascule sur la rotation, sans bloquer l'envoi.

- **Matching** : fleuriste actif, non bloqué par le paywall, dont le rayon couvre le destinataire ; le plus proche gagne, à 500 m près on départage par charge du jour. Implémenté en TypeScript (`lib/matching.ts`) et en SQL (`nearest_florist`).
- **Freemium** : un trigger SQL incrémente `completed_orders` à chaque livraison. À 10 sur l'offre gratuite, `florist_is_locked()` exclut l'atelier du matching et l'API refuse (HTTP 402) le traitement de ses commandes non commencées. Après 24 h, le cron les réattribue.
- **Facturation B2C** : un abonnement Stripe par client, une ligne par formule (quantité = nombre d'envois mensuels). Les occasions (anniversaire, Saint-Valentin…) sont ajoutées en `invoiceItem` sur la facture suivante.
- **Reversements** : à la livraison, `transfers.create` vers le compte Connect de l'atelier (clé d'idempotence par commande) et ligne `payouts`.
