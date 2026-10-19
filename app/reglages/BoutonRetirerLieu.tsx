"use client";

// app/reglages/BoutonRetirerLieu.tsx — « Retirer » un lieu de recharge, avec confirmation.
//
// Avant : un tap retirait le lieu tout de suite, sans retour visuel. Un tap de trop sur
// téléphone supprimait un lieu (et son tarif). Maintenant : un premier tap demande
// « Retirer ce lieu ? », le second confirme ; pendant l'envoi, le bouton dit « Retrait… ».
// Le bouton reste dans le <form action={retirerLieu}> : l'action serveur n'a pas changé.

import { useState } from "react";
import { useFormStatus } from "react-dom";

export function BoutonRetirerLieu() {
  const { pending } = useFormStatus();
  const [confirmer, setConfirmer] = useState(false);

  if (pending) {
    return (
      <button type="submit" className="lien-bouton" disabled aria-busy="true">
        Retrait…
      </button>
    );
  }

  if (!confirmer) {
    return (
      <button type="button" className="lien-bouton" onClick={() => setConfirmer(true)}>
        Retirer
      </button>
    );
  }

  return (
    <>
      <span className="meta">Retirer ce lieu ?</span>
      <button type="submit" className="lien-bouton">
        Oui, retirer
      </button>
      <button type="button" className="lien-bouton" onClick={() => setConfirmer(false)}>
        Annuler
      </button>
    </>
  );
}
