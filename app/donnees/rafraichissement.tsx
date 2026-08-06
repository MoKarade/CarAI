"use client";

// app/donnees/rafraichissement.tsx — « données à jour en live », sans WebSocket.
//
// `router.refresh()` re-rend le Server Component avec des données FRAÎCHES de la base :
// la page reste server-side (aucun jeton ni requête SQL côté navigateur), seul le
// déclencheur du rafraîchissement vit ici. 30 s est un bon rythme : le véhicule ne se
// rafraîchit qu'aux 30-60 min, et chaque refresh coûte une lecture Neon — plus vite
// n'apporterait AUCUNE fraîcheur de plus, seulement de la charge.

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function RafraichissementAuto({ intervalleMs = 30_000 }: { intervalleMs?: number }) {
  const router = useRouter();
  const [derniere, setDerniere] = useState<Date | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
      setDerniere(new Date());
    }, intervalleMs);
    return () => clearInterval(id);
  }, [router, intervalleMs]);

  return (
    <p className="hint" role="status">
      Mise à jour automatique toutes les {Math.round(intervalleMs / 1000)} s
      {derniere
        ? ` — dernier rafraîchissement à ${derniere.toLocaleTimeString("fr-CA")}`
        : ""}
      . La fraîcheur réelle dépend du véhicule (rafraîchi aux 30-60 min par Toyota).
    </p>
  );
}
