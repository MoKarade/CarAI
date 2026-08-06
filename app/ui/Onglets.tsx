// app/ui/Onglets.tsx — navigation entre les écrans de CarAI.
//
// Un seul composant pour tous les écrans : deux barres d'onglets écrites chacune dans
// leur page finiraient par diverger (leçon JobAI sur les gardes dupliquées — la copie
// la plus pauvre gagne).

import Link from "next/link";

const ONGLETS = [
  { href: "/", label: "Tableau de bord" },
  { href: "/donnees", label: "Base de données" },
  { href: "/analyse", label: "Analyse" },
] as const;

export function Onglets({ actif }: { actif: (typeof ONGLETS)[number]["href"] }) {
  return (
    <nav className="onglets" aria-label="Sections de CarAI">
      {ONGLETS.map((o) =>
        o.href === actif ? (
          <span key={o.href} aria-current="page">
            {o.label}
          </span>
        ) : (
          <Link key={o.href} href={o.href}>
            {o.label}
          </Link>
        ),
      )}
    </nav>
  );
}
