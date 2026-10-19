"use client";

// app/ui/BoutonMaintenir.tsx — le geste « maintenir pour confirmer », en un seul endroit.
//
// Extrait de SchemaInteractif le 19/08/2026, quand la purge des données simulées a eu
// besoin du même geste. Deux implémentations d'une règle d'interaction, c'est une règle et
// demie : celle qu'on retouche et celle qu'on oublie. Le libellé du bouton pendant
// l'action est un paramètre — « Envoi… » pour une commande au véhicule, « Suppression… »
// pour une purge : mentir sur ce qui se passe serait pire que ne rien dire.

import { useEffect, useRef, useState } from "react";

/** Durée de l'appui maintenu — assez long pour être un geste voulu, pas une hésitation. */
const DUREE_APPUI_MS = 800;

/**
 * Un bouton qui n'agit qu'APRÈS un appui maintenu. L'anneau de remplissage (CSS, même
 * durée) montre la progression ; lâcher avant la fin annule sans rien envoyer. Au
 * clavier : Enter/Espace TENUS font le même geste (relâcher annule pareil).
 */
export function BoutonMaintenir({
  libelle,
  danger,
  occupe,
  libelleOccupe = "Envoi…",
  onConfirme,
}: {
  libelle: string;
  danger?: boolean;
  occupe: boolean;
  /** Ce qui s'affiche PENDANT l'action. Défaut « Envoi… » (le cas des commandes). */
  libelleOccupe?: string;
  onConfirme: () => void;
}) {
  const [enfonce, setEnfonce] = useState(false);
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);

  const annuler = () => {
    setEnfonce(false);
    if (minuteur.current) {
      clearTimeout(minuteur.current);
      minuteur.current = null;
    }
  };
  const commencer = () => {
    if (occupe || minuteur.current) return;
    setEnfonce(true);
    minuteur.current = setTimeout(() => {
      minuteur.current = null;
      setEnfonce(false);
      onConfirme();
    }, DUREE_APPUI_MS);
  };
  useEffect(() => annuler, []);

  return (
    <button
      type="button"
      className={`maintenir${danger ? " danger" : ""}${enfonce ? " enfonce" : ""}`}
      disabled={occupe}
      onPointerDown={(e) => {
        e.preventDefault();
        commencer();
      }}
      onPointerUp={annuler}
      onPointerLeave={annuler}
      onPointerCancel={annuler}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          commencer();
        }
      }}
      onKeyUp={annuler}
      onBlur={annuler}
      // Sur téléphone, l'appui long ouvrirait le menu contextuel et casserait le geste.
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`${libelle} — maintenir pour confirmer`}
    >
      <span className="maintenir-remplissage" aria-hidden="true" />
      <span className="maintenir-libelle">{occupe ? libelleOccupe : libelle}</span>
    </button>
  );
}

