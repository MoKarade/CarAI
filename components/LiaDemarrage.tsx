"use client";

// LIA démarrée HORS du rendu (Marc, 23/10/2026 : présente tout le temps, même pendant un chargement
// ou si une page plante). Le démarrage a lieu au chargement de CE module, jamais dans un effet ni
// dans le rendu : le layout rend ce composant sur toutes les pages, /login comprise, sans condition de
// session (sans session, `/api/lia/ask` répond 401 et LIA dit « indisponible », et `/api/lia/etat` aussi : elle garde son état local). Une seule voie : demarrerLia,
// jamais <Lia /> en plus. Tout ce qui se décide est dans lib/lia/ ; ce fichier ne fait que brancher.

import { demarrerLia } from "@mokarade/lia-ui/boot";
import { etatHttp } from "@mokarade/lia-ui/etat-http";
import { demanderLia } from "@/lib/lia/client";

if (typeof window !== "undefined") {
  demarrerLia({
    ask: (question, signal) => demanderLia(question, signal, { page: window.location.pathname }),
    // Une seule LIA, un seul état (Marc, 23/10/2026) : le même que celui du hub, relayé par la route de CETTE app (même origine,
    // session de l'utilisateur, aucun jeton dans le navigateur). Sans session ou hub injoignable, LIA garde son état local.
    etat: etatHttp("/api/lia/etat"),
  });
}

export default function LiaDemarrage() {
  return null;
}
