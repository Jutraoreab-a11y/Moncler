"use client";

/**
 * Page du destinataire, ouverte depuis le code ou le QR écrit sur la carte.
 * Elle dit qui offre le bouquet, permet d'envoyer un merci (texte + photo) à l'abonné,
 * puis propose d'offrir à son tour avec le code de parrainage de l'expéditeur.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Bouquet } from "@/components/bloom";
import { ModelBouquet } from "@/components/bouquet-choice";
import { PetalRain } from "@/components/petals";
import { Button, Field, inputCls, LinkButton, Logo } from "@/components/ui";
import { api, isDemo } from "@/lib/api-client";
import { getRecipe } from "@/lib/catalog";
import { frLong } from "@/lib/dates";
import { compressImage } from "@/lib/image";
import { findModel } from "@/lib/models";
import { useStore } from "@/lib/store";

interface RemoteView {
  recipientFirstName: string;
  senderFirstName: string | null;
  deliveryDate: string;
  message: string;
  planId: "classique" | "signature" | "prestige";
  modelId: string | null;
  photoUrl: string | null;
  florist: string | null;
  alreadyThanked: boolean;
  referralCode: string;
}

export function Merci() {
  const params = useSearchParams();
  const router = useRouter();
  const { state, dispatch } = useStore();
  const [code, setCode] = useState((params.get("code") ?? "").toUpperCase());
  const [entered, setEntered] = useState(code);
  const demoOrder = state.orders.find((o) => o.publicCode === code);
  // Production : la page destinataire lit le bouquet via l'API publique /api/merci/:code
  const [remote, setRemote] = useState<null | RemoteView>(null);
  useEffect(() => {
    if (isDemo || !code) return;
    fetch(`/api/merci/${code}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setRemote)
      .catch(() => setRemote(null));
  }, [code]);
  const order = isDemo
    ? demoOrder
    : remote
      ? ({ id: code, publicCode: code, deliveryDate: remote.deliveryDate, message: remote.message, planId: remote.planId, modelId: remote.modelId ?? undefined, photoUrl: remote.photoUrl ?? undefined, thanks: remote.alreadyThanked ? { text: "", at: "" } : undefined } as unknown as typeof demoOrder)
      : undefined;
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<string | undefined>();
  const [sent, setSent] = useState(false);

  if (!order) {
    // Exemples cliquables en démo
    const samples = state.orders.filter((o) => o.publicCode && o.status === "delivered" && state.recipients.find((r) => r.id === o.recipientId)?.customerId === "me").slice(-2);
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <div className="w-full max-w-sm text-center">
          <Logo />
          <h1 className="mt-8 font-display text-4xl">Vous avez reçu des fleurs ?</h1>
          <p className="mt-2 text-ink-soft">Entrez le code écrit sous le mot de la carte.</p>
          <form
            className="mt-6 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setCode(entered.trim().toUpperCase());
            }}
          >
            <input aria-label="Code de la carte" className={`${inputCls} text-center font-semibold uppercase tracking-[0.2em]`} maxLength={6} value={entered} onChange={(e) => setEntered(e.target.value)} placeholder="7KQ2MP" />
            <Button type="submit" variant="ink">Ouvrir</Button>
          </form>
          {code && <p role="alert" className="mt-3 text-sm text-peony-deep">Ce code ne correspond à aucun bouquet. Vérifiez les 6 caractères sur la carte.</p>}
          {isDemo && samples.length > 0 && (
            <p className="mt-6 text-sm text-ink-soft">
              Démo :{" "}
              {samples.map((o) => (
                <button key={o.id} className="mx-1 font-semibold text-ink underline" onClick={() => (setEntered(o.publicCode!), setCode(o.publicCode!))}>
                  {o.publicCode}
                </button>
              ))}
            </p>
          )}
        </div>
      </main>
    );
  }

  const r = isDemo ? state.recipients.find((x) => x.id === order.recipientId)! : { firstName: remote!.recipientFirstName, customerId: "" };
  const mine = isDemo && r.customerId === "me";
  const sender = isDemo ? (mine ? state.customer.firstName : "Quelqu'un qui pense à vous") : remote!.senderFirstName || "Quelqu'un qui pense à vous";
  const model = findModel(order.modelId, state.models);
  const recipe = getRecipe(order.planId, state.catalog);
  const florist = isDemo ? state.florists.find((f) => f.id === order.floristId) : remote!.florist ? { shopName: remote!.florist } : undefined;
  const ref = isDemo ? (mine ? state.customer.referralCode : undefined) : remote!.referralCode;
  const already = !!order.thanks;

  return (
    <main className="min-h-dvh">
      {sent && <PetalRain />}
      <div className="mx-auto max-w-xl px-4 py-12 text-center sm:px-6">
        <Logo />
        <p className="mt-10 text-ink-soft">Bonjour {r.firstName},</p>
        <h1 className="mt-1 font-display text-5xl leading-tight">Ce bouquet vient de {sender}.</h1>

        <div className="mx-auto mt-8 max-w-xs">
          {order.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={order.photoUrl} alt="Votre bouquet" className="aspect-[4/5] w-full rounded-[22px] object-cover" />
          ) : model ? (
            <div className="sway"><ModelBouquet model={model} /></div>
          ) : (
            <Bouquet palette={recipe.palette} seed={4} count={7} />
          )}
        </div>
        <p className="mt-4 text-sm text-ink-soft">
          {model ? `${model.name} · ${recipe.name}` : recipe.name}
          {florist ? `, composé par ${florist.shopName}` : ""} · livré le {frLong(order.deliveryDate)}
        </p>
        <blockquote className="mx-auto mt-6 max-w-md rotate-[-1deg] rounded-md bg-[#fffdf8] p-6 font-display text-2xl italic leading-snug shadow-[0_20px_40px_-20px_rgba(43,16,48,0.4)]">
          « {order.message} »
        </blockquote>

        {sent || already ? (
          <section className="pop mt-10 rounded-[26px] bg-ink p-7 text-left text-paper">
            <h2 className="font-display text-3xl">{sent ? `${sender} va adorer.` : `Vous avez déjà dit merci à ${sender}.`}</h2>
            <p className="mt-2 text-paper/75">Et si vous offriez des fleurs à votre tour ? Une date à ne pas oublier, un bouquet chaque mois : on s&apos;occupe de tout.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="lg" onClick={() => router.push(`/abonnement${ref ? `?ref=${ref}` : ""}`)}>
                Offrir des fleurs{ref ? " (−10 € avec le code de " + sender + ")" : ""}
              </Button>
              <LinkButton href="/rappels" variant="outline" size="lg" className="border-paper/25 bg-transparent text-paper hover:border-paper/60">
                Rappels gratuits
              </LinkButton>
            </div>
          </section>
        ) : (
          <form
            className="mt-10 space-y-4 text-left"
            onSubmit={async (e) => {
              e.preventDefault();
              dispatch({ type: "thanks", code: order.publicCode!, text, photoUrl: photo });
              if (!isDemo) void api.thanks(order.publicCode!, text, photo).catch(() => {});
              setSent(true);
            }}
          >
            <h2 className="font-display text-3xl">Dites merci à {sender}</h2>
            <Field label="Votre message" hint={`${text.length} / 280`}>
              <textarea required maxLength={280} className={`${inputCls} min-h-28`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Il est magnifique, merci !" />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex h-11 cursor-pointer items-center rounded-full border border-ink/15 bg-card px-5 font-semibold hover:border-ink/40">
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setPhoto(await compressImage(f, 1000));
                  }}
                />
                {photo ? "Changer la photo" : "Ajouter une photo du bouquet chez vous"}
              </label>
              {photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="Aperçu" className="h-14 w-14 rounded-lg object-cover" />
              )}
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={text.trim().length < 2}>
              Envoyer mon merci
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
