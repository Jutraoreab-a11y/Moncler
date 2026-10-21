"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AddressInput } from "@/components/address-input";
import { Bouquet } from "@/components/bloom";
import { Button, Field, inputCls, Logo } from "@/components/ui";
import { euros, FREE_ORDER_LIMIT, PRO_PRICE_CENTS } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import type { DeliveryMode } from "@/lib/types";

export default function RejoindrePage() {
  const { dispatch } = useStore();
  const router = useRouter();
  const [f, setF] = useState({ shopName: "", ownerName: "", email: "", address: "", city: "", lat: 0, lng: 0, radiusKm: 6, deliveryMode: "uber_direct" as DeliveryMode });
  const ok = f.shopName && f.ownerName && /\S+@\S+/.test(f.email) && f.address;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = `f_${Date.now().toString(36)}`;
    dispatch({
      type: "addFlorist",
      florist: {
        id,
        shopName: f.shopName,
        ownerName: f.ownerName,
        address: f.address,
        city: f.city || "Paris",
        lat: f.lat || 48.8606,
        lng: f.lng || 2.3522,
        radiusKm: f.radiusKm,
        deliveryMode: f.deliveryMode,
        completedOrders: 0,
        saasPlan: "free",
        stripeConnected: false,
        active: true,
      },
    });
    router.push("/pro");
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden flex-col justify-between bg-ink p-10 text-paper lg:flex">
        <Logo tone="paper" />
        <div>
          <div className="w-56"><Bouquet palette={["#e23f6b", "#f4b73f", "#fbe3e8", "#7aa37f"]} seed={4} count={7} wrap="#f7e6ea" /></div>
          <h1 className="mt-8 font-display text-6xl leading-[1.02]">Votre atelier, plein toute l&apos;année.</h1>
          <ul className="mt-8 space-y-3 text-paper/80">
            <li>{FREE_ORDER_LIMIT} premières commandes sans abonnement</li>
            <li>Puis {euros(PRO_PRICE_CENTS)} par mois, sans commission sur vos bouquets</li>
            <li>Commandes visibles sept jours à l&apos;avance</li>
            <li>Coursiers déclenchés automatiquement</li>
          </ul>
        </div>
        <p className="text-sm text-paper/50">Déjà 40 ateliers partenaires à Paris.</p>
      </aside>

      <main className="px-4 py-10 sm:px-10">
        <div className="lg:hidden"><Logo /></div>
        <form onSubmit={submit} className="mx-auto mt-6 max-w-lg space-y-5 lg:mt-16">
          <h2 className="font-display text-5xl">Rejoindre Moncleur Pro</h2>
          <p className="text-ink-soft">Trois minutes. Vous pourrez recevoir vos premières commandes dès demain.</p>
          <Field label="Nom de l'atelier"><input className={inputCls} value={f.shopName} onChange={(e) => setF({ ...f, shopName: e.target.value })} placeholder="Atelier Pétale" /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Votre nom"><input className={inputCls} value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field>
            <Field label="E-mail professionnel"><input type="email" className={inputCls} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          </div>
          <Field label="Adresse de la boutique">
            <AddressInput value={f.address} onChange={(v) => setF((x) => ({ ...x, address: v }))} onPick={(h) => setF((x) => ({ ...x, address: h.street, city: `${h.postalCode} ${h.city}`, lat: h.lat, lng: h.lng }))} />
          </Field>
          <Field label={`Rayon de livraison : ${f.radiusKm} km`}>
            <input type="range" min={2} max={10} value={f.radiusKm} onChange={(e) => setF({ ...f, radiusKm: +e.target.value })} className="w-full accent-[#e23f6b]" />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Qui livre ?</legend>
            <div className="grid grid-cols-3 gap-2">
              {([["own", "Moi"], ["uber_direct", "Uber Direct"], ["stuart", "Stuart"]] as const).map(([id, l]) => (
                <button type="button" key={id} aria-pressed={f.deliveryMode === id} onClick={() => setF({ ...f, deliveryMode: id })} className={clsx("rounded-xl border-2 px-3 py-3 text-sm font-semibold", f.deliveryMode === id ? "border-peony bg-card" : "border-line")}>
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
          <Button type="submit" size="lg" className="w-full" disabled={!ok}>Créer mon espace</Button>
          <p className="text-center text-xs text-ink-soft">Vous connecterez votre IBAN via Stripe à l&apos;étape suivante.</p>
        </form>
      </main>
    </div>
  );
}
