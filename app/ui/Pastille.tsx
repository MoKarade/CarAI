// app/ui/Pastille.tsx — les badges qui REMPLACENT les paragraphes (refonte du 17/08).
//
// Décision de Marc au cadrage : « trop de texte » était son blocage n°1, et il a choisi
// « Pastilles + icônes » ET « ⓘ au tap » — les deux se combinent : la pastille dit l'état
// en deux mots, le ⓘ garde l'explication COMPLÈTE accessible au tap. Le no-fake-data ne
// perd rien : une estimation reste marquée (~), une panne reste dite (⚠), une donnée
// vieille reste datée (horloge). Seule la FORME change — badge au lieu de phrase.
//
// `InfoTap` est un <details> natif : zéro JavaScript, fonctionne au tap ET au clavier,
// se referme au second tap. Un popover JS ferait pareil en plus fragile.
//
// ⚠️ CLASSE CSS : `insigne`, PAS `pastille`. `.pastille` appartenait DÉJÀ aux puces de
// légende (cartes, graphiques, schéma) — un rond de 0,6 em. La première version de ce
// composant a réutilisé le nom : la règle historique `width: 0.6em` restait la plus
// spécifique sur cette propriété, chaque badge faisait 0,6 em de large et les textes se
// superposaient (« texte fucké », Marc, capture du 17/08). Même famille de bug que
// `tuile` vs `tuile-osm`, même remède : un nom à soi, et un tripwire dans
// tests/refonte.test.ts qui interdit `pastille` ici.

import type { ReactNode } from "react";
import { IcoAttention, IcoCoche, IcoEstime, IcoHorloge, IcoInfo } from "./Icones";

export type TonPastille = "ok" | "attention" | "danger" | "estime" | "neutre";

const ICONE_PAR_TON: Record<TonPastille, ReactNode> = {
  ok: <IcoCoche taille={13} />,
  attention: <IcoAttention taille={13} />,
  danger: <IcoAttention taille={13} />,
  estime: <IcoEstime taille={13} />,
  neutre: null,
};

/**
 * Un état en deux mots. `icone` remplace l'icône par défaut du ton ; `null` la retire.
 */
export function Pastille({
  ton = "neutre",
  icone,
  children,
}: {
  ton?: TonPastille;
  icone?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={`insigne insigne-${ton}`}>
      {icone === undefined ? ICONE_PAR_TON[ton] : icone}
      {children}
    </span>
  );
}

/** La fraîcheur d'une donnée, en pastille : horloge + « il y a X ». */
export function PastilleAge({ texte, vieux = false }: { texte: string; vieux?: boolean }) {
  return (
    <Pastille ton={vieux ? "attention" : "neutre"} icone={<IcoHorloge taille={13} />}>
      {texte}
    </Pastille>
  );
}

/**
 * Le ⓘ qui porte l'explication complète — repliée par défaut, dépliée au tap.
 *
 * `resume` est ce que lisent les lecteurs d'écran et ce qui s'affiche à côté du ⓘ quand
 * il est fourni ; sinon seul le ⓘ apparaît. Le contenu déplié est le texte INTÉGRAL
 * qu'affichait l'ancienne version en paragraphe : rien n'est perdu, tout est rangé.
 */
export function InfoTap({ resume, children }: { resume?: string; children: ReactNode }) {
  return (
    <details className="itap">
      {/* `||` et non `??` : un `resume=""` donnerait un aria-label VIDE — pire que rien. */}
      <summary aria-label={resume || "Explication"}>
        <IcoInfo taille={15} />
        {resume && <span className="itap-resume">{resume}</span>}
      </summary>
      <div className="itap-bulle">{children}</div>
    </details>
  );
}

/** Une rangée de pastilles sous un chiffre ou un titre — l'unité de mise en page. */
export function Pastilles({ children, genre }: { children: ReactNode; genre?: string }) {
  return (
    <div className="insignes" data-lia-genre={genre}>
      {children}
    </div>
  );
}
