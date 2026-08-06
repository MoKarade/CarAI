// lib/csv.ts — fabrication de CSV, avec la leçon JobAI codée dedans :
//
// « Un export de données est une surface d'EXÉCUTION, pas un dump. » Une cellule qui
// commence par `=`, `+`, `-` ou `@` est évaluée comme une formule à l'ouverture par
// Excel, LibreOffice et Google Sheets. Tout champ texte qui sort vers un tableur se
// neutralise ICI, au point de formatage — jamais dans le composant qui télécharge.

/** Vrai si la chaîne est un nombre complet (« -5.2 », « 1e3 ») : un tableur la traite
 * comme un NOMBRE, pas comme une formule — la neutraliser casserait la colonne. */
function estNumerique(texte: string): boolean {
  return texte.trim() !== "" && Number.isFinite(Number(texte));
}

/** Neutralise puis échappe UNE cellule. Toujours entre guillemets : simple et sans cas limite. */
export function champCsv(valeur: string | number | null | undefined): string {
  if (valeur === null || valeur === undefined) return '""';
  const texte = String(valeur);

  // Une formule potentielle (`=SUM(…)`, `@…`, `+…`, `-…` non numérique) est préfixée
  // d'une apostrophe : le tableur l'affiche comme du texte inerte.
  const neutralise =
    /^[=+\-@\t\r]/.test(texte) && !estNumerique(texte) ? `'${texte}` : texte;

  return `"${neutralise.replace(/"/g, '""')}"`;
}

/** Une ligne CSV à partir de cellules déjà typées. */
export function ligneCsv(cellules: Array<string | number | null | undefined>): string {
  return cellules.map(champCsv).join(",");
}

/**
 * Document complet : BOM UTF-8 (sans lui, Excel sous Windows lit « Ã© » pour « é » —
 * c'est un fichier DESTINÉ à un tableur, pas à un parseur), en-têtes, lignes, CRLF.
 */
export function documentCsv(
  entetes: string[],
  lignes: Array<Array<string | number | null | undefined>>,
): string {
  const corps = [ligneCsv(entetes), ...lignes.map(ligneCsv)].join("\r\n");
  // BOM écrit en ÉCHAPPEMENT explicite : un caractère U+FEFF littéral est invisible à la
  // relecture et un éditeur/linter peut le retirer sans que personne ne le voie.
  return "\uFEFF" + corps + "\r\n";
}
