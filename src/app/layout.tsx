import type { Metadata, Viewport } from "next";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/hanken-grotesk";
import "./globals.css";
import { StoreProvider } from "@/lib/store";
import { ToastProvider } from "@/components/toast";

export const metadata: Metadata = {
  title: { default: "Moncleur — des fleurs pour ceux que vous aimez, sans jamais oublier", template: "%s · Moncleur" },
  description:
    "Programmez une fois, offrez toute l'année. Moncleur livre des bouquets d'artisans fleuristes à vos proches, chaque mois et à chaque date qui compte.",
};

export const viewport: Viewport = { themeColor: "#fcf3f5" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <StoreProvider>
          <ToastProvider>{children}</ToastProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
