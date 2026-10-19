// lib/reparationAuto.ts — la reconstruction post-incident, SANS que Marc ait à cliquer.
//
// Marc, 18/08 : « récupère tous les trajets et recharges et mets dans l'app ». Le bouton
// de Réglages demandait une action ; ce module fait le travail TOUT SEUL, à chaque
// affichage d'une page, jusqu'à ce qu'il n'y ait plus rien à reconstruire.
//
// ⚠️ APRÈS la réponse, jamais dedans. `after()` (Next 15) sort le travail du chemin
// critique : la page s'affiche à sa vitesse normale et la reconstruction avance derrière.
// ⚠️ Mais un `after()` HÉRITE de la durée de vie de son invocation, il ne s'y ajoute pas
// (leçon JobAI, trois `GET /carte` tués par « Task timed out ») : d'où un budget SERRÉ,
// et un curseur en base qui garde la place d'un affichage à l'autre.
// ⚠️ Ne lève JAMAIS vers la page : un rattrapage qui planterait ne doit pas teinter un
// écran qui, lui, fonctionne.

import { after } from "next/server";
import { BUDGET_PAGE_MS, rejouerJusquAuBout } from "@/lib/smartcar/rejeu";

/**
 * À appeler dans le rendu d'une page. Ne rend rien, n'attend rien : le travail part
 * après la réponse. Gratuit une fois la réparation terminée (une lecture de config, puis
 * retour immédiat).
 */
export function reparerEnArrierePlan(): void {
  after(async () => {
    try {
      const bilan = await rejouerJusquAuBout({ budgetMs: BUDGET_PAGE_MS });
      if (bilan) console.log(`[reparation] ${bilan}`);
    } catch (err) {
      console.error("[reparation] passe impossible — réessaiera au prochain affichage", err);
    }
  });
}
