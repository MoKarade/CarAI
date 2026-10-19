// app/ui/SelecteurFenetre.tsx — LE sélecteur de fenêtre de temps, partagé.
//
// Il vivait dans `app/tendances/page.tsx` depuis le 13/08 (Marc : « je veux pouvoir
// sélectionner la date, ou la range, ou le global »). Marc, 14/09 : « je veux filtrer par
// date mois etc » sur Activité — qui n'avait qu'un menu déroulant de raccourcis, sans jour
// précis ni plage.
//
// Il est EXTRAIT plutôt que recopié : deux sélecteurs qui font la même chose divergent,
// et c'est toujours le moins relu qui garde le vieux comportement. Ce qui change d'un
// écran à l'autre est passé en paramètre — la destination, les raccourcis proposés, le
// défaut — pas dupliqué.
//
// ⚠️ EN L'EXTRAYANT, UN BUG PRÉEXISTANT EST SORTI (corrigé ici, feu vert de Marc 14/09).
// Les raccourcis de Tendances pointaient sur `/analyse`, l'ANCIEN nom de l'écran. Or
// `app/analyse/page.tsx` fait `redirect("/tendances")` — une chaîne littérale, sans query
// string : le paramètre `?periode=` était donc PERDU dans la redirection, et cliquer « 7j »
// sur Tendances ne faisait rien d'autre que recharger la période par défaut. Rien de rouge
// nulle part : la page s'affichait parfaitement, avec la mauvaise fenêtre. C'est pour ça
// que la destination est désormais un PARAMÈTRE OBLIGATOIRE — un écran ne peut plus
// hériter par accident de la destination d'un autre.
//
// Server Component : aucun JS client. La sélection vit dans l'URL (liens + formulaire GET),
// donc elle se met en signet, se partage, et survit au rafraîchissement automatique.

import {
  RACCOURCIS,
  parametresFenetre,
  type Fenetre,
  type RaccourciFenetre,
} from "@/lib/vehicle/fenetre";

export function SelecteurFenetre({
  fenetre,
  base,
  raccourcis,
  defaut,
}: {
  fenetre: Fenetre;
  /** L'écran de destination, ex. `/activite`. Obligatoire : voir l'en-tête. */
  base: string;
  /** Les raccourcis proposés, dans l'ordre d'affichage. */
  raccourcis: readonly RaccourciFenetre[];
  /** Ce que « Effacer » restaure — le même défaut que celui passé à `analyserFenetre`. */
  defaut: RaccourciFenetre;
}) {
  // Un raccourci n'est « actif » que si la fenêtre vient bien d'un raccourci : une plage
  // saisie à la main ne doit allumer aucune pastille, sinon deux sélections s'affichent
  // comme actives en même temps.
  const parRaccourci = fenetre.mode !== "jour" && fenetre.mode !== "plage";
  return (
    <div className="selecteur-fenetre">
      <div className="raccourcis">
        {raccourcis.map((r) =>
          parRaccourci && fenetre.periode === r ? (
            <span key={r} aria-current="true">
              {RACCOURCIS[r].court}
            </span>
          ) : (
            <a key={r} href={`${base}?periode=${r}`}>
              {RACCOURCIS[r].court}
            </a>
          ),
        )}
      </div>

      <form method="get" action={base} className="filtres">
        <label>
          Du <input type="date" name="du" defaultValue={fenetre.du} />
        </label>
        <label>
          au <input type="date" name="au" defaultValue={fenetre.au} />
        </label>
        <button type="submit">Afficher</button>
        {!parRaccourci && <a href={`${base}?periode=${defaut}`}>Effacer</a>}
      </form>

      <p className="fenetre-active">
        <strong>{fenetre.libelle}</strong>
        {fenetre.avertissement && <span className="avertissement"> — {fenetre.avertissement}</span>}
      </p>
    </div>
  );
}

/** Le préfixe d'URL qui CONSERVE la fenêtre courante. Voir `parametresFenetre`. */
export function lienAvecFenetre(base: string, fenetre: Fenetre, extra?: string): string {
  const bouts = [parametresFenetre(fenetre)];
  if (extra) bouts.push(extra);
  return `${base}?${bouts.join("&")}`;
}
