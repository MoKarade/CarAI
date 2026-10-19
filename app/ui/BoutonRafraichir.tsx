"use client";

// app/ui/BoutonRafraichir.tsx — `[UI-02]` : le bouton « Rafraîchir maintenant ».
//
// ⚠️ Il DIT ce qu'il fait pendant qu'il attend. Un poll Smartcar prend plusieurs secondes ;
// un bouton qui reste identique pendant ce temps se fait recliquer, et le second clic
// tombera sur le plancher — donc sur un refus que Marc lira comme une panne. Trois états
// distincts : au repos, en cours (désactivé, libellé changé), et le résultat.
//
// ⚠️ Le message vient du SERVEUR, tel quel. Le client ne compose aucune phrase : le refus
// pour cause de plancher, l'échec Smartcar et le « rien de neuf » sont trois choses
// différentes, et c'est l'action qui sait laquelle.

import { useState, useTransition } from "react";
import { rafraichirMaintenant, type RetourRafraichir } from "@/app/actions/rafraichir";

export function BoutonRafraichir() {
  const [enCours, demarrer] = useTransition();
  const [retour, setRetour] = useState<RetourRafraichir | null>(null);

  return (
    <div className="rafraichir">
      <button
        type="button"
        className="bouton-rafraichir touch-target"
        disabled={enCours}
        onClick={() =>
          demarrer(async () => {
            setRetour(null);
            setRetour(await rafraichirMaintenant());
          })
        }
      >
        {enCours ? "Lecture de la voiture…" : "Rafraîchir maintenant"}
      </button>
      {/* La région reste MONTÉE en permanence, vide au repos : une région live insérée au
          moment où elle doit parler rate la première annonce — la seule qui compte. */}
      <p className={`rafraichir-retour${retour ? ` ton-${retour.ton}` : ""}`} role="status">
        {retour?.message ?? ""}
      </p>
    </div>
  );
}
