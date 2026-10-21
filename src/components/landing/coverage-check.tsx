"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { api, isDemo } from "@/lib/api-client";
import { useStore } from "@/lib/store";
import { coverage } from "@/lib/zones";

/** « Livrez-vous chez maman ? » : test de zone par code postal + liste d'attente. */
export function CoverageCheck() {
  const { state, dispatch } = useStore();
  const [cp, setCp] = useState("");
  const [result, setResult] = useState<null | ReturnType<typeof coverage>>(null);
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  return (
    <div className="mt-8 max-w-md">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setResult(coverage(cp, state.florists));
          setDone(false);
        }}
      >
        <label htmlFor="cp" className="sr-only">Code postal du destinataire</label>
        <input
          id="cp"
          inputMode="numeric"
          maxLength={5}
          value={cp}
          onChange={(e) => setCp(e.target.value.replace(/\D/g, ""))}
          placeholder="Code postal de votre proche"
          className="h-12 min-w-0 flex-1 rounded-full border border-line bg-card px-5 text-[15px] outline-none focus:border-peony focus:ring-4 focus:ring-peony/10"
        />
        <Button type="submit" variant="ink" size="lg" className="h-12" disabled={cp.length !== 5}>Vérifier</Button>
      </form>
      {result && (
        <div className="pop mt-3 text-sm" role="status">
          {result.match ? (
            <p className="rounded-2xl bg-stem-soft px-4 py-3 text-stem">
              Oui. {result.match.florist.shopName} livre {result.zone!.name}, à {result.match.distanceKm.toFixed(1).replace(".", ",")} km.
            </p>
          ) : done ? (
            <p className="rounded-2xl bg-stem-soft px-4 py-3 text-stem">C&apos;est noté : on vous écrit dès qu&apos;un atelier ouvre au {cp}.</p>
          ) : (
            <form
              className="rounded-2xl bg-pollen-soft p-4 text-[#7a5300]"
              onSubmit={(e) => {
                e.preventDefault();
                dispatch({ type: "waitlist", email, postalCode: cp });
                if (!isDemo) void api.waitlist(email, cp).catch(() => {});
                setDone(true);
              }}
            >
              <p>Pas encore au {cp}. Nous livrons Paris et la petite couronne. Laissez votre e-mail, on vous prévient.</p>
              <div className="mt-2 flex gap-2">
                <input type="email" required aria-label="Votre e-mail" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.fr" className="h-10 min-w-0 flex-1 rounded-full border border-line bg-card px-4 outline-none" />
                <Button type="submit" size="sm" variant="ink" className="h-10">Me prévenir</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
