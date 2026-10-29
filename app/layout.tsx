import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { ServiceWorker } from "@/components/ServiceWorker";
import LiaDemarrage from "@/components/LiaDemarrage";
import NavApps from "@/components/NavApps";
import { APP_COURANTE, navAppsAutorisee } from "@/lib/navAppsMonter";
import "./globals.css";

export const metadata: Metadata = {
  // Le squelette laissait « App Template » ici : c'était le titre de l'onglet, et ç'aurait
  // été le nom affiché sous l'icône une fois l'app installée sur l'écran d'accueil.
  title: "CarAI",
  description: "Suivi du véhicule électrique — charge, autonomie, odomètre, bail.",
  // L'app est privée : elle ne doit pas être indexée.
  robots: { index: false, follow: false },
  // Rend l'app installable (cf. app/manifest.ts). Next pose le <link rel="manifest">.
  manifest: "/manifest.webmanifest",
  // iOS ignore le manifeste pour l'icône d'accueil : il lui faut celle-ci, OPAQUE
  // (Safari ne gère pas la transparence et la remplacerait par du noir).
  appleWebApp: {
    capable: true,
    title: "CarAI",
    // « default » garde la barre d'état lisible dans les deux thèmes ;
    // « black-translucent » ferait passer le contenu SOUS l'encoche.
    statusBarStyle: "default",
  },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  // Thème sombre ASSUMÉ (décision Marc, refonte constructeur du 17/08) : une seule
  // valeur, le `--fond` de globals.css (hexadécimal depuis CarAI#217 ; tests/theme.test.ts
  // vérifie l'égalité, la barre système ne dérive plus en silence).
  themeColor: "#060911",
  // Installée, l'app doit occuper l'écran jusque sous l'encoche.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Onglet « Apps » : propriétaire seul, jamais sur /login ni sans session (échec fermé).
  const navApps = await navAppsAutorisee();
  return (
    <html lang="fr-CA">
      <body>
        {navApps && <NavApps courant={APP_COURANTE} />}
        {children}
        <ServiceWorker />
        {/* LIA sans condition de session (Marc, 23/10/2026 : présente tout le temps). Sans session, sa
            question reçoit 401 de la route, protégée : elle répond « indisponible », jamais autre chose. */}
        <LiaDemarrage />
        <Analytics />
      </body>
    </html>
  );
}
