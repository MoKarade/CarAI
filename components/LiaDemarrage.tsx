"use client";

// LIA démarrée HORS du rendu (Marc, 23/10/2026 : présente tout le temps, même pendant un chargement
// ou si une page plante). Le démarrage a lieu au chargement de CE module, jamais dans un effet ni
// dans le rendu : le layout ne rend ce composant que pour une session admise (lib/lia/monter.ts),
// donc le module n'est chargé, et LIA n'est amorcée, que dans ce cas. Une seule voie : demarrerLia,
// jamais <Lia /> en plus. Tout ce qui se décide est dans lib/lia/ ; ce fichier ne fait que brancher.

import { demarrerLia } from "@mokarade/lia-ui/boot";
import { demanderLia } from "@/lib/lia/client";

if (typeof window !== "undefined") {
  demarrerLia({ ask: (question, signal) => demanderLia(question, signal, { page: window.location.pathname }) });
}

export default function LiaDemarrage() {
  return null;
}
