"use client";

import { useEffect, useRef, useState } from "react";
import { inputCls } from "./ui";

export interface AddressHit {
  label: string;
  street: string;
  postalCode: string;
  city: string;
  lat: number;
  lng: number;
}

/**
 * Autocomplétion via la Base Adresse Nationale (api-adresse.data.gouv.fr) :
 * gratuite, sans clé, CORS ouvert. Renvoie aussi les coordonnées pour le matching.
 */
export function AddressInput({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: (h: AddressHit) => void }) {
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const skip = useRef(false);

  useEffect(() => {
    if (skip.current) {
      skip.current = false;
      return;
    }
    if (value.trim().length < 4) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(value)}&limit=5&type=housenumber`, { signal: ctl.signal });
        const j = await r.json();
        setHits(
          (j.features ?? []).map((f: { properties: Record<string, string>; geometry: { coordinates: [number, number] } }) => ({
            label: f.properties.label,
            street: f.properties.name,
            postalCode: f.properties.postcode,
            city: f.properties.city,
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          })),
        );
        setOpen(true);
        setHi(0);
      } catch {}
    }, 220);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [value]);

  const pick = (h: AddressHit) => {
    skip.current = true;
    onChange(h.street);
    onPick(h);
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        className={inputCls}
        value={value}
        placeholder="22 rue de la Roquette"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls="addr-list"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !hits.length) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(h + 1, hits.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
          if (e.key === "Enter") (e.preventDefault(), pick(hits[hi]));
        }}
      />
      {open && hits.length > 0 && (
        <ul id="addr-list" role="listbox" className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-line bg-card shadow-xl">
          {hits.map((h, i) => (
            <li key={h.label} role="option" aria-selected={i === hi}>
              <button type="button" onMouseDown={() => pick(h)} className={`block w-full px-3.5 py-2.5 text-left text-sm ${i === hi ? "bg-paper-2" : ""}`}>
                {h.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
