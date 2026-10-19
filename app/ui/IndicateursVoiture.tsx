// app/ui/IndicateursVoiture.tsx — l'état de la voiture en ICÔNES SEULES, détail au tap.
//
// Marc, 17/08 (2ᵉ passe de cadrage) : « pas de texte pour la voiture, juste des
// couleurs/icônes » — et au choix guidé : « icônes + tap pour détail ». Chaque indicateur
// est donc un <details> : l'icône colorée dit l'état d'un coup d'œil, le tap ouvre la
// bulle qui porte le DÉTAIL complet (le no-fake-data vit là : valeurs, âges, réserves).
//
// ⚠️ Zéro texte À L'ÉCRAN ne veut pas dire zéro texte DANS LE DOM : chaque icône porte un
// `aria-label` complet — un lecteur d'écran entend « Voiture verrouillée », pas « bouton ».
//
// Serveur pur : des <details> natifs, aucun JavaScript.

import type { ReactNode } from "react";
import {
  IcoAttention,
  IcoCoche,
  IcoHorloge,
  IcoVerrou,
  IcoVerrouOuvert,
} from "./Icones";

export type TonIndicateur = "ok" | "attention" | "danger" | "inconnu";

/**
 * Un indicateur : icône colorée, détail au tap.
 *
 * `libelle` est ce que le lecteur d'écran énonce ET le titre de la bulle — le même texte
 * pour l'œil et pour l'oreille, jamais deux versions qui divergent.
 */
export function Indicateur({
  ton,
  libelle,
  icone,
  children,
}: {
  ton: TonIndicateur;
  libelle: string;
  icone: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className={`indicateur ind-${ton}`}>
      <summary aria-label={libelle}>{icone}</summary>
      <div className="ind-bulle">
        <strong>{libelle}</strong>
        {children}
      </div>
    </details>
  );
}

/** La rangée d'indicateurs sous le schéma. */
export function Indicateurs({ children }: { children: ReactNode }) {
  return <div className="indicateurs">{children}</div>;
}

/** Icônes toutes prêtes pour les quatre indicateurs standards de la voiture. */
export const ICONES_INDICATEURS = {
  verrouille: <IcoVerrou taille={18} />,
  deverrouille: <IcoVerrouOuvert taille={18} />,
  ok: <IcoCoche taille={18} />,
  attention: <IcoAttention taille={18} />,
  horloge: <IcoHorloge taille={18} />,
};

/** Pneu stylisé pour l'indicateur pneus — le rectangle arrondi du schéma, en miniature. */
export function IcoPneu({ taille = 18 }: { taille?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={taille}
      height={taille}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="8" y="3.5" width="8" height="17" rx="4" />
      <path d="M12 8v8" strokeDasharray="1.5 2.4" />
    </svg>
  );
}

/** Portière stylisée pour l'indicateur ouvrants. */
export function IcoPortiere({ taille = 18 }: { taille?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={taille}
      height={taille}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 20.5H5.5v-9L12 4h8v16.5Z" />
      <path d="M15.5 12.5h2" />
    </svg>
  );
}
