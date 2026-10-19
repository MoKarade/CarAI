// lib/vehicle/recommandation.ts — « quoi faire », seulement quand il y a une action à prendre.
//
// ══ LA RÈGLE DE CE MODULE : UNE PHRASE, OU RIEN ════════════════════════════════════
//
// Arbitrage de Marc (18/09/2026) : l'accueil porte des chiffres nus, « mais une
// recommandation quand il y a une action à prendre ». Une phrase qui s'afficherait tous les
// jours apprendrait à ne plus être lue — même raison que `alertes.ts`. Sans action
// calculable, la réponse est `null` et l'accueil n'affiche RIEN.
//
// ══ POURQUOI ÇA SE DÉDUIT DES ALERTES, ET NE REFAIT AUCUN CALCUL ═════════════════════
//
// Les conditions (charge sous le seuil, câble non branché, valeur interprétable) vivent déjà
// dans `construireAlertes`. Les recopier ici donnerait deux seuils à tenir ensemble ; on lit
// donc la CLÉ de l'alerte qui s'est déclenchée. Une recommandation est le verbe qui répond à
// une alerte, pas une seconde mesure.
//
// ⚠️ Une seule règle pour l'instant, celle de l'exemple de CarAI#190. Ajouter une ligne à
// `ACTIONS` ne demande que la clé de l'alerte et la phrase.

import type { Alerte } from "@/lib/vehicle/alertes";

export interface Recommandation {
  /** Clé de l'alerte d'où elle vient — stable, sert de `key` React. */
  cle: string;
  /** Une phrase courte, à l'impératif. */
  texte: string;
}

/** Clé d'alerte → phrase d'action. L'ordre du tableau est l'ordre de priorité. */
const ACTIONS: ReadonlyArray<readonly [cle: string, texte: string]> = [
  ["charge-basse", "Branche la voiture."],
];

/**
 * L'action la plus prioritaire que les alertes en cours appellent, ou `null`. PURE.
 *
 * Une seule recommandation, jamais une liste : deux phrases à la fois deviennent un
 * paragraphe, et le but est qu'elle se lise en un coup d'œil.
 */
export function recommander(alertes: readonly Alerte[]): Recommandation | null {
  for (const [cle, texte] of ACTIONS) {
    if (alertes.some((a) => a.cle === cle)) return { cle, texte };
  }
  return null;
}
