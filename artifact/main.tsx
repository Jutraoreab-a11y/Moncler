/**
 * Démo Moncleur en page unique : les vrais écrans de l'app, servis sans serveur.
 * Construit par artifact/build.mjs (esbuild + Tailwind), publié comme artifact.
 */
import { createRoot } from "react-dom/client";
import { StoreProvider } from "@/lib/store";
import { ToastProvider } from "@/components/toast";
import Home from "@/app/page";
import { Funnel } from "@/app/abonnement/funnel";
import Compte from "@/app/compte/page";
import Pro from "@/app/pro/page";
import Fiches from "@/app/pro/fiches/page";
import Boutique from "@/app/pro/boutique/page";
import Rejoindre from "@/app/pro/rejoindre/page";
import Admin from "@/app/admin/page";
import Dispatch from "@/app/admin/dispatch/page";
import Garantie from "@/app/admin/garantie/page";
import Catalogue from "@/app/admin/catalogue/page";
import Connexion from "@/app/connexion/page";
import { Merci } from "@/app/merci/merci";
import Rappels from "@/app/rappels/page";
import CGV from "@/app/cgv/page";
import Mentions from "@/app/mentions-legales/page";
import { useLocation } from "./shims/router";

const ROUTES: Record<string, () => React.ReactElement> = {
  "/": Home,
  "/abonnement": Funnel,
  "/compte": Compte,
  "/pro": Pro,
  "/pro/fiches": Fiches,
  "/pro/boutique": Boutique,
  "/pro/rejoindre": Rejoindre,
  "/admin": Admin,
  "/admin/dispatch": Dispatch,
  "/admin/garantie": Garantie,
  "/admin/catalogue": Catalogue,
  "/connexion": Connexion,
  "/merci": Merci,
  "/rappels": Rappels,
  "/cgv": CGV,
  "/mentions-legales": Mentions,
};

function App() {
  const { path, search } = useLocation();
  const Page = ROUTES[path] ?? Home;
  return <Page key={path + search} />;
}

createRoot(document.getElementById("root")!).render(
  <StoreProvider>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StoreProvider>,
);
