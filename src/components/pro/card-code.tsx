"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

export const merciUrl = (code: string) => `moncleur.fr/m/${code}`;

/**
 * Code à recopier sur la carte (ou QR à coller) : le destinataire découvre qui lui offre
 * le bouquet, envoie un merci et peut s'abonner à son tour.
 */
export function CardCode({ code, size = 76 }: { code: string; size?: number }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(`https://${merciUrl(code)}`, { type: "svg", margin: 0, color: { dark: "#2b1030", light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [code]);
  return (
    <div className="flex items-center gap-3">
      <span className="block shrink-0 rounded-md bg-white p-1.5" style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="text-xs text-ink-soft">
        À recopier sous le mot
        <span className="block font-semibold tracking-wider text-ink">{merciUrl(code)}</span>
      </span>
    </div>
  );
}
