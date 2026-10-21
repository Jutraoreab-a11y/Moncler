/**
 * Crée (ou retrouve) tous les produits et prix Stripe de Moncleur, identifiés par lookup_key.
 * Idempotent : relancer le script ne crée pas de doublon.
 *
 *   STRIPE_SECRET_KEY=sk_test_… npm run stripe:setup
 *
 * Prix créés :
 *  - Abonnements mensuels sans engagement   moncleur_monthly_{classique|signature|prestige}
 *  - Bouquet au tarif abonné (−15 %)          moncleur_subscriber_bouquet_{…}  (occasion en plus, date ajoutée)
 *  - Carnet Occasions Clés                   produit moncleur_carnet (mensualité variable)
 *  - Parrainage                              coupon MONCLEUR_PARRAINAGE_10
 *  - Surclassement à tarif abonné            moncleur_upgrade_{from}_{to}
 *  - Extra tige noble                        moncleur_extra_stem_{renoncules|david_austin|pivoines}
 *  - Moncleur Pro (fleuristes)               moncleur_pro
 */
import Stripe from "stripe";
import { CATALOG, PRO_PRICE_CENTS } from "../src/lib/catalog";
import { EXTRA_STEMS, occasionSurchargeCents, PLAN_ORDER, STRIPE_LOOKUP, subscriberPriceCents, UPGRADE_PRICES } from "../src/lib/pricing";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Définissez STRIPE_SECRET_KEY (clé de test sk_test_… recommandée).");
  process.exit(1);
}
const stripe = new Stripe(key);

async function ensure(lookup: string, product: { name: string; metadata?: Record<string, string> }, amount: number, recurring?: Stripe.PriceCreateParams.Recurring, extra: Record<string, string> = {}) {
  const found = await stripe.prices.list({ lookup_keys: [lookup], active: true, limit: 1 });
  if (found.data[0]) {
    const p = found.data[0];
    if (p.unit_amount !== amount) {
      // Le montant a changé : nouveau prix, la lookup_key lui est transférée
      const np = await stripe.prices.create({ product: p.product as string, currency: "eur", unit_amount: amount, recurring, lookup_key: lookup, transfer_lookup_key: true, metadata: extra });
      console.log(`↻ ${lookup.padEnd(42)} ${(amount / 100).toFixed(2)} €  ${np.id}`);
      return;
    }
    console.log(`✓ ${lookup.padEnd(42)} ${(amount / 100).toFixed(2)} €  ${p.id}`);
    return;
  }
  const price = await stripe.prices.create({ currency: "eur", unit_amount: amount, recurring, lookup_key: lookup, product_data: product, metadata: extra });
  console.log(`+ ${lookup.padEnd(42)} ${(amount / 100).toFixed(2)} €  ${price.id}`);
}

const monthly: Stripe.PriceCreateParams.Recurring = { interval: "month" };

async function main() {
  for (const r of CATALOG) {
    const g = r.name.replace("Le ", "");
    await ensure(STRIPE_LOOKUP.subscription("MONTHLY_RECURRING", r.planId), { name: `Moncleur Mensuel — ${g}`, metadata: { plan_type: "MONTHLY_RECURRING", plan_id: r.planId } }, r.priceCents, monthly, { commitment_period_months: "0" });
    // Mensuel : supplément occasion +30 % (le bouquet du mois livré le jour de l'occasion), facturé à J-3
    await ensure(STRIPE_LOOKUP.occasion(r.planId), { name: `+30 % Boost Event — ${g}`, metadata: { kind: "occasion_boost", plan_id: r.planId } }, occasionSurchargeCents(r.planId, CATALOG));
    // Carnet : date ajoutée en cours d'année, au tarif abonné (−15 %)
    await ensure(STRIPE_LOOKUP.addon(r.planId), { name: `Bouquet ${g} au tarif abonné (−15 %)`, metadata: { kind: "subscriber_bouquet", plan_id: r.planId } }, subscriberPriceCents(r.planId, CATALOG));
  }
  for (const from of PLAN_ORDER) {
    for (const to of PLAN_ORDER.slice(PLAN_ORDER.indexOf(from) + 1)) {
      const name = (p: string) => CATALOG.find((c) => c.planId === p)!.name.replace("Le ", "");
      await ensure(STRIPE_LOOKUP.upgrade(from, to), { name: `Surclassement ${name(from)} → ${name(to)}`, metadata: { kind: "upgrade", from, to } }, UPGRADE_PRICES[`${from}>${to}`]);
    }
  }
  for (const x of EXTRA_STEMS) {
    await ensure(STRIPE_LOOKUP.extraStem(x.id), { name: `Extra tige noble — ${x.label}`, metadata: { kind: "extra_stem", florist_budget_cents: String(x.budgetCents) } }, x.priceCents);
  }
  await ensure(STRIPE_LOOKUP.pro, { name: "Moncleur Pro — commandes illimitées", metadata: { kind: "florist_pro" } }, PRO_PRICE_CENTS, monthly);

  // Carnet : un produit unique, la mensualité (somme des dates au prix abonné ÷ 12) est passée à chaque souscription
  try {
    await stripe.products.retrieve("moncleur_carnet");
    console.log("✓ produit moncleur_carnet");
  } catch {
    await stripe.products.create({ id: "moncleur_carnet", name: "Moncleur Carnet Occasions Clés", metadata: { plan_type: "SPECIAL_EVENTS_CARNET", commitment_period_months: "12" } });
    console.log("+ produit moncleur_carnet");
  }
  // Parrainage : −10 € sur la première facture du filleul
  try {
    await stripe.coupons.retrieve("MONCLEUR_PARRAINAGE_10");
    console.log("✓ coupon MONCLEUR_PARRAINAGE_10");
  } catch {
    await stripe.coupons.create({ id: "MONCLEUR_PARRAINAGE_10", amount_off: 1000, currency: "eur", duration: "once", name: "Parrainage Moncleur" });
    console.log("+ coupon MONCLEUR_PARRAINAGE_10");
  }
  console.log("\nPrix Stripe prêts.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
