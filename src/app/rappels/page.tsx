"use client";

/**
 * Rappels gratuits : on note les dates de ses proches (à la main ou par import
 * de contacts / agenda), Moncleur prévient 7 jours avant, et un clic suffit
 * pour transformer la date en bouquet programmé.
 */
import clsx from "clsx";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useToast } from "@/components/toast";
import { Button, Field, inputCls, LinkButton, Panel } from "@/components/ui";
import { daysBetween, frLong, iso, nextOccurrence, startOfDay } from "@/lib/dates";
import { parseDatesFile } from "@/lib/import-dates";
import { useStore } from "@/lib/store";
import type { Reminder, Schedule } from "@/lib/types";

const nextOf = (r: Reminder) => nextOccurrence({ type: r.type === "birthday" ? "birthday" : "custom", date: r.date } as Schedule, startOfDay());

export default function RappelsPage() {
  const { state, dispatch } = useStore();
  const toast = useToast();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [label, setLabel] = useState("");
  const [preview, setPreview] = useState<Omit<Reminder, "id">[] | null>(null);

  const list = useMemo(
    () => [...state.reminders].map((r) => ({ r, next: nextOf(r) })).sort((a, b) => +a.next - +b.next),
    [state.reminders],
  );

  return (
    <AppShell right={<LinkButton href="/abonnement" size="sm">Offrir des fleurs</LinkButton>}>
      <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="font-display text-5xl">Mes rappels</h1>
        <p className="mt-2 max-w-xl text-lg text-ink-soft">
          Gratuit. Notez les dates de vos proches : on vous prévient 7 jours avant, et vous programmez un bouquet en un clic si l&apos;envie vous prend.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <Panel className="p-6">
            <h2 className="font-display text-3xl">À venir</h2>
            <ul className="mt-4 divide-y divide-line">
              {list.map(({ r, next }) => {
                const days = daysBetween(startOfDay(), next);
                const soon = days <= 7;
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="w-12 text-center">
                      <p className="font-display text-3xl leading-none">{next.getDate()}</p>
                      <p className="text-xs text-ink-soft">{frLong(next).split(" ")[2]}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{r.label}</p>
                      <p className={clsx("text-sm", soon ? "font-semibold text-peony-deep" : "text-ink-soft")}>{days === 0 ? "Aujourd'hui" : `Dans ${days} jour${days > 1 ? "s" : ""}`}</p>
                    </div>
                    <LinkButton
                      size="sm"
                      variant={soon ? "primary" : "outline"}
                      href={`/abonnement?offre=carnet&prenom=${encodeURIComponent(r.name)}&${r.type === "birthday" ? "anniversaire" : "date"}=${r.date}&libelle=${encodeURIComponent(r.label)}`}
                    >
                      Programmer un bouquet
                    </LinkButton>
                    <Button variant="ghost" size="sm" aria-label={`Supprimer ${r.label}`} onClick={() => dispatch({ type: "removeReminder", id: r.id })}>
                      ✕
                    </Button>
                  </li>
                );
              })}
              {!list.length && <li className="py-6 text-ink-soft">Aucune date pour l&apos;instant. Ajoutez la première à droite, ou importez vos contacts.</li>}
            </ul>
          </Panel>

          <div className="space-y-6">
            <Panel className="p-6">
              <h2 className="font-semibold">Ajouter une date</h2>
              <form
                className="mt-3 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  dispatch({ type: "addReminders", reminders: [{ id: `rem_${Date.now().toString(36)}`, name, date: date.slice(5), type: label ? "custom" : "birthday", label: label || `Anniversaire de ${name}` }] });
                  toast({ title: "Rappel ajouté", body: `On vous prévient 7 jours avant.`, tone: "success" });
                  setName("");
                  setDate("");
                  setLabel("");
                }}
              >
                <Field label="Prénom"><input required className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label="Date"><input required type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                <Field label="Occasion" hint="Laissez vide pour un anniversaire."><input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Anniversaire de mariage" /></Field>
                <Button type="submit" variant="ink" className="w-full">Ajouter</Button>
              </form>
            </Panel>

            <Panel className="p-6">
              <h2 className="font-semibold">Importer mes contacts ou mon agenda</h2>
              <p className="mt-1 text-sm text-ink-soft">Fichier .vcf (contacts iPhone, Android, Google) ou .ics (agenda). Il est lu sur votre appareil, vous choisissez ce qui est gardé.</p>
              <label className="mt-3 inline-flex h-11 cursor-pointer items-center rounded-full border border-ink/15 bg-card px-5 text-[15px] font-semibold hover:border-ink/40">
                <input
                  type="file"
                  accept=".vcf,.ics,text/vcard,text/calendar"
                  className="sr-only"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const found = parseDatesFile(f.name, await f.text());
                    setPreview(found);
                    if (!found.length) toast({ title: "Aucune date trouvée", body: "Le fichier ne contient ni anniversaire ni événement annuel." });
                  }}
                />
                Choisir un fichier
              </label>
              {preview && preview.length > 0 && (
                <div className="pop mt-4">
                  <p className="text-sm font-semibold">{preview.length} date{preview.length > 1 ? "s" : ""} trouvée{preview.length > 1 ? "s" : ""}</p>
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
                    {preview.map((p, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span>{p.label}</span>
                        <span className="tabular text-ink-soft">{p.date.split("-").reverse().join("/")}</span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-3 w-full"
                    onClick={() => {
                      dispatch({ type: "addReminders", reminders: preview.map((p, i) => ({ ...p, id: `rem_${Date.now().toString(36)}_${i}` })) });
                      toast({ title: `${preview.length} rappels ajoutés`, tone: "success" });
                      setPreview(null);
                    }}
                  >
                    Ajouter ces dates
                  </Button>
                </div>
              )}
            </Panel>
            <p className="text-xs text-ink-soft">Prochaine date : {list[0] ? `${list[0].r.label}, le ${frLong(iso(list[0].next))}` : "aucune"}.</p>
          </div>
        </div>
      </main>
    </AppShell>
  );
}
