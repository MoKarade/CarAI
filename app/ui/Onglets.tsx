// app/ui/Onglets.tsx — la navigation à QUATRE écrans (refonte constructeur, étape 2).
//
// Choix de Marc (cadrage du 17/08) : Accueil · Activité · Tendances · Réglages, icônes +
// libellés courts, BARRE EN BAS sur téléphone (au pouce) et en haut sur grand écran. Les
// anciens écrans ne meurent pas : /trajets et /recharges fusionnent dans Activité,
// /analyse devient Tendances, /commandes rejoint le schéma et Réglages — chacun redirige.
//
// `/donnees` reste un écran SECONDAIRE : accessible (Réglages, pied de l'accueil), jamais
// dans la barre (« la base de données, je veux qu'elle soit un peu cachée », 13/08).

import Link from "next/link";
import { IcoAccueil, IcoActivite, IcoReglages, IcoTendances } from "./Icones";

const ONGLETS = [
  { href: "/", label: "Accueil", icone: IcoAccueil },
  { href: "/activite", label: "Activité", icone: IcoActivite },
  { href: "/tendances", label: "Tendances", icone: IcoTendances },
  { href: "/reglages", label: "Réglages", icone: IcoReglages },
] as const;

/**
 * Les écrans secondaires restent des cibles valides : la page se rend, aucun onglet n'est
 * marqué courant. Les anciennes URL n'y figurent pas — elles redirigent avant de rendre.
 */
export type CibleOnglet = (typeof ONGLETS)[number]["href"] | "/donnees";

export function Onglets({ actif }: { actif: CibleOnglet }) {
  return (
    <nav className="onglets" aria-label="Sections de CarAI">
      {ONGLETS.map((o) => {
        const Icone = o.icone;
        const contenu = (
          <>
            <Icone taille={19} />
            <span className="onglet-libelle">{o.label}</span>
          </>
        );
        return o.href === actif ? (
          <span key={o.href} aria-current="page">
            {contenu}
          </span>
        ) : (
          <Link key={o.href} href={o.href}>
            {contenu}
          </Link>
        );
      })}
    </nav>
  );
}
