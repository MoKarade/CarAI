// lib/vehicle/montants.ts — comment se présente un couple (mesuré, estimé). PURE.
//
// Séparé du composant parce que c'est une DÉCISION, pas un rendu : quel chiffre porte la
// valeur principale, et quand le tilde de l'estimation s'applique. Un ternaire dans le JSX
// se recopie ; une fonction se teste, et les deux écrans qui l'emploient disent alors la
// même chose.

export interface LibelleMontant {
  /** Le chiffre qui porte la tuile. `null` quand il n'y a rien à montrer. */
  principal: number | null;
  /** Le tilde de l'estimation s'applique-t-il au principal ? */
  tildePrincipal: boolean;
  /** La part estimée, sur sa propre ligne. `null` quand il n'y en a pas. */
  secondaire: number | null;
}

/**
 * ⚠️ LE MESURÉ PORTE LA TUILE quand les deux existent — jamais leur somme.
 *
 * Quand il n'y a QUE de l'estimé, c'est lui qui porte la tuile, avec son tilde : sinon la
 * tuile afficherait « 0 $ » sur un mois où Marc a bel et bien rechargé, ce qui est faux
 * dans l'autre sens.
 */
export function estimeLibelle(totaux: { mesure: number; estime: number }): LibelleMontant {
  const { mesure, estime } = totaux;
  if (mesure > 0 && estime > 0) {
    return { principal: mesure, tildePrincipal: false, secondaire: estime };
  }
  if (mesure > 0) return { principal: mesure, tildePrincipal: false, secondaire: null };
  if (estime > 0) return { principal: estime, tildePrincipal: true, secondaire: null };
  return { principal: null, tildePrincipal: false, secondaire: null };
}
