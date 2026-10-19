// lib/vehicle/messageBail.ts — ce que l'écran DIT quand les montants du bail manquent. PURE.
//
// ⚠️ POURQUOI UN MODULE, et pas trois lignes de JSX. Chacun de ces états appelle un geste
// DIFFÉRENT de Marc : poser deux variables, rallumer son PC, corriger un jeton, nommer la
// bonne dette, renseigner une mensualité. Un tiret unique les confondrait tous — et
// l'enverrait chercher au mauvais endroit. Le message est donc une DONNÉE, testable, avec
// un cas par état, plutôt qu'une chaîne enfouie dans un rendu.

import type { LectureBail } from "@/lib/financeai/bail";

export interface MessageBail {
  /** Ce qui manque, en une phrase. */
  texte: string;
  /** `true` quand c'est une configuration à faire, `false` quand c'est un état passager
   *  (serveur éteint) : l'écran peint les deux différemment. */
  aConfigurer: boolean;
}

/**
 * Le message à afficher, ou `null` quand les montants sont là et qu'il n'y a rien à dire.
 *
 * @param paiementsCalculables `false` quand la lecture a réussi mais que le calcul n'a pas pu
 *   aboutir — en pratique : FinanceAI ne porte pas de mensualité. Ce cas ne se lit pas dans le
 *   statut (il est `ok`), d'où le second argument.
 */
export function messageBail(lecture: LectureBail, paiementsCalculables: boolean): MessageBail | null {
  switch (lecture.statut) {
    case "non-configure":
      return {
        texte:
          "Montants du bail : FinanceAI n’est pas branché. Poser FINANCEAI_BAIL_URL et " +
          "FINANCEAI_BAIL_TOKEN, et le même jeton côté FinanceAI.",
        aConfigurer: true,
      };
    case "injoignable":
      return {
        texte:
          "Montants du bail : FinanceAI n’a pas répondu. C’est normal s’il est en veille ou " +
          "éteint — rien n’est perdu, le chiffre revient au prochain chargement.",
        aConfigurer: false,
      };
    case "refuse":
      return {
        texte: "Montants du bail : FinanceAI a refusé le jeton. Les deux côtés doivent porter la même valeur.",
        aConfigurer: true,
      };
    case "absent":
      return {
        texte:
          "Montants du bail : aucune dette de véhicule dans FinanceAI. En enregistrer une " +
          "(catégorie « Car ») pour voir le payé et le total.",
        aConfigurer: true,
      };
    case "ambigu":
      return {
        texte:
          `Montants du bail : FinanceAI a ${lecture.candidates.length} dettes de véhicule` +
          (lecture.candidates.length > 0 ? ` (${lecture.candidates.join(", ")})` : "") +
          ". Nommer celle qui compte dans FINANCEAI_VEHICULE_DETTE.",
        aConfigurer: true,
      };
    case "invalide":
      return {
        texte: "Montants du bail : la réponse de FinanceAI n’a pas pu être lue. Aucun chiffre n’est affiché plutôt qu’un chiffre douteux.",
        aConfigurer: false,
      };
    case "ok":
      if (paiementsCalculables) return null;
      return {
        texte:
          "Montants du bail : FinanceAI ne porte pas de mensualité pour cette dette. " +
          "La renseigner pour voir le payé et le total.",
        aConfigurer: true,
      };
  }
}
