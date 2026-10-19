// app/ui/Jauge.tsx — les cadrans. Un chiffre qu'on VOIT avant de le lire.
//
// Marc, 13/08 : « on dirait un logiciel de gestion tellement c'est moche et plat […] dans
// l'onglet accueil je veux que ce soit très visuel, quasiment pas de texte ».
//
// Un pourcentage écrit « 62 % » se lit ; un anneau rempli aux deux tiers se VOIT — et la
// différence compte sur un écran qu'on ouvre en dix secondes le matin. L'anneau ne remplace
// pas le chiffre pour autant : il l'entoure. Une jauge sans valeur chiffrée est jolie et
// inexploitable.
//
// SVG rendu côté SERVEUR, comme tout le reste : aucune bibliothèque, aucun JS.
//
// ⚠️ Une valeur ABSENTE ne dessine pas un anneau vide — un anneau à 0 % se lit « batterie à
// plat », ce qui est une affirmation. Elle rend un cadran GRIS en pointillé avec « — ».

const RAYON = 52;
const CIRCONFERENCE = 2 * Math.PI * RAYON;

export type TonJauge = "accent" | "ok" | "attention" | "danger";

/**
 * Cadran circulaire.
 *
 * `valeur` est la fraction remplie (0 à 1) ; `texte` est ce qui s'écrit au centre. Les deux
 * sont séparés exprès : une jauge d'autonomie se remplit sur une fraction de son maximum
 * mais s'écrit en kilomètres.
 */
export function Jauge({
  valeur,
  texte,
  libelle,
  ton = "accent",
  detail,
}: {
  /** Fraction remplie, entre 0 et 1. `null` = pas de mesure. */
  valeur: number | null;
  /** Ce qui s'écrit au centre — déjà formaté par l'appelant. */
  texte: string;
  libelle: string;
  ton?: TonJauge;
  /** Une précision courte sous le libellé. Optionnelle, et vraiment courte. */
  detail?: string;
}) {
  const fraction = valeur === null ? 0 : Math.max(0, Math.min(1, valeur));
  const rempli = CIRCONFERENCE * fraction;

  return (
    <figure className={`jauge ton-${ton} ${valeur === null ? "sans-mesure" : ""}`}>
      <svg viewBox="0 0 128 128" role="img" aria-label={`${libelle} : ${texte}`}>
        {/* Piste de fond : elle montre le TOUT dont la valeur est une part. Sans elle, un
            arc seul ne dit pas de quoi il est la fraction. */}
        <circle className="piste" cx="64" cy="64" r={RAYON} />
        {valeur !== null && (
          <circle
            className="remplissage"
            cx="64"
            cy="64"
            r={RAYON}
            strokeDasharray={`${rempli} ${CIRCONFERENCE - rempli}`}
            // On part du HAUT : un cadran qui démarre à 3 h se lit de travers.
            transform="rotate(-90 64 64)"
          />
        )}
      </svg>
      <figcaption>
        <span className="jauge-valeur">{texte}</span>
        <span className="jauge-libelle">{libelle}</span>
        {detail && <span className="jauge-detail">{detail}</span>}
      </figcaption>
    </figure>
  );
}

/**
 * Barre de progression horizontale — pour ce qui se compare à un PLAFOND (le bail, le
 * budget du mois). Un anneau conviendrait mal : ces valeurs peuvent DÉPASSER 100 %, et un
 * cercle plein ne sait pas montrer un dépassement.
 */
export function Barre({
  fraction,
  libelle,
  valeur,
  plafond,
  ton = "accent",
}: {
  /** Peut dépasser 1 : c'est justement l'information. */
  fraction: number | null;
  libelle: string;
  valeur: string;
  plafond: string;
  ton?: TonJauge;
}) {
  const f = fraction === null ? 0 : Math.max(0, fraction);
  // Au-delà de 100 %, la barre reste pleine et le DÉPASSEMENT se peint par-dessus : deux
  // longueurs sur la même piste, l'une qui déborde visiblement de l'autre.
  const dedans = Math.min(1, f) * 100;
  const dehors = f > 1 ? Math.min(1, f - 1) * 100 : 0;

  return (
    <div className={`barre-plafond ton-${ton}`}>
      <div className="barre-entete">
        <span className="barre-titre">{libelle}</span>
        <span className="barre-chiffres">
          <strong>{valeur}</strong> / {plafond}
        </span>
      </div>
      <div className="barre-piste-large">
        <span className="barre-dedans" style={{ width: `${dedans}%` }} />
        {dehors > 0 && <span className="barre-dehors" style={{ width: `${dehors}%` }} />}
      </div>
    </div>
  );
}
