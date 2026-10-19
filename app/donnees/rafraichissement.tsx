"use client";

// app/donnees/rafraichissement.tsx — rafraîchissement des pages serveur, sans WebSocket.
//
// `router.refresh()` re-rend le Server Component avec des données FRAÎCHES de la base :
// la page reste server-side (aucun jeton ni requête SQL côté navigateur).
//
// ⚠️ COÛT. Chaque refresh relit la base (Neon facture le transfert, limite mensuelle
// dépassée avec l'ancien rythme de 30 s). Le véhicule ne se met à jour qu'aux 30-60 min :
// 15 min suffisent. Aucun refresh onglet caché (voir planificateurRafraichissement.ts).
// Seule `/donnees` l'utilise ; /tendances et /activite (historique lourd) n'ont qu'un
// bouton manuel, `BoutonRafraichir`.

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  demarrerRafraichissement,
  INTERVALLE_DONNEES_MS,
} from "./planificateurRafraichissement";

export function RafraichissementAuto({
  intervalleMs = INTERVALLE_DONNEES_MS,
}: {
  intervalleMs?: number;
}) {
  const router = useRouter();
  const [derniere, setDerniere] = useState<Date | null>(null);

  useEffect(
    () =>
      demarrerRafraichissement(
        intervalleMs,
        () => {
          router.refresh();
          setDerniere(new Date());
        },
        document,
      ),
    [router, intervalleMs],
  );

  return (
    <p className="hint" role="status">
      Mise à jour automatique toutes les {Math.round(intervalleMs / 60_000)} min (en pause
      quand l’onglet est caché)
      {derniere
        ? ` — dernier rafraîchissement à ${derniere.toLocaleTimeString("fr-CA")}`
        : ""}
      . La fraîcheur réelle dépend du véhicule (rafraîchi aux 30-60 min par Toyota).
    </p>
  );
}

/** Rafraîchissement MANUEL : une lecture de la base, seulement sur clic. */
export function BoutonRafraichir() {
  const router = useRouter();
  // `useTransition` : « en cours » dure jusqu'à ce que la page ait fini de se relire, ce qui
  // évite de croire que le tap n'a rien fait (et de taper dix fois).
  const [enCours, demarrer] = useTransition();
  return (
    <p className="hint">
      <button
        type="button"
        disabled={enCours}
        aria-busy={enCours}
        onClick={() => demarrer(() => router.refresh())}
      >
        {enCours ? "Lecture…" : "Rafraîchir"}
      </button>
    </p>
  );
}
