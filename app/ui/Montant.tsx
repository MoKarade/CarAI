// app/ui/Montant.tsx — un montant de recharge, MESURÉ et ESTIMÉ, sur deux lignes.
//
// Marc, 15/09 : « le 20 $ + ~30 $ » — deux montants collés dans une seule valeur de
// tuile, illisibles d'un coup d'œil. C'était la forme de l'accueil ET d'Activité, écrite
// deux fois.
//
// ⚠️ POURQUOI PAS UN SEUL TOTAL, puisque c'est ce qu'on lirait le plus vite. Parce que
// `totaliserPrix` l'interdit, et pour une raison qui tient : « additionner un prix connu et
// un prix supposé produit un montant dont personne ne peut dire ce qu'il vaut ». Mesuré le
// 15/09 sur un jeu typique, l'estimé fait 60 % du tout — un « 50 $ » unique serait
// donc à 60 % une supposition présentée comme une dépense.
//
// La lisibilité vient donc de la MISE EN PAGE, pas de la fusion : le chiffre sûr en grand,
// la part supposée sur sa propre ligne, dans sa propre couleur.

import { estimeLibelle } from "@/lib/vehicle/montants";

/** Source UNIQUE du format monétaire — il vivait en double, dans les deux écrans. */
export const dollars = (n: number) =>
  n.toLocaleString("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 2 });

export function MontantPrix({
  mesure,
  estime,
  suffixe = "",
}: {
  mesure: number;
  estime: number;
  /** Ce qui suit le montant, ex. « / 100 km ». */
  suffixe?: string;
}) {
  const libelle = estimeLibelle({ mesure, estime });
  return (
    <>
      <span className="tuile-valeur">
        {libelle.principal === null ? "0 $" : `${libelle.tildePrincipal ? "~" : ""}${dollars(libelle.principal)}${suffixe}`}
      </span>
      {libelle.secondaire !== null && (
        <span className="tuile-estime">
          + ~{dollars(libelle.secondaire)}
          {suffixe} estimés
        </span>
      )}
    </>
  );
}
