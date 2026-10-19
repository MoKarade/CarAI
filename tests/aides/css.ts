// tests/aides/css.ts — les deux lectures de `globals.css` dont les gardes ont besoin.
//
// ⚠️ Extrait de `tests/groupesAccueil.test.ts` le 14/09, quand un SECOND fichier de garde
// (`filtreActivite.test.ts`) en a eu besoin. Recopier ces dix lignes aurait suffi — et
// c'est exactement ainsi qu'on se retrouve avec deux découpeurs de media queries dont un
// seul connaît le prochain cas tordu. Une règle tenue à deux endroits est une règle et
// demie.

/**
 * Tout ce qui vit sous `@media (max-width: 700px)`, accolades comptées. PURE.
 *
 * Le pendant de `horsMediaQueries` : une garde mobile a besoin des DEUX sens — la règle
 * est-elle bien dans le bloc téléphone, et bien ABSENTE du CSS de base. Un media query
 * n'ajoute aucune spécificité, donc une règle sortie de son bloc s'applique à toutes les
 * largeurs sans que rien ne le signale.
 */
export function blocTelephone(source: string): string {
  let sortie = "";
  const motif = /@media \(max-width: 700px\)\s*\{/g;
  // La valeur rendue par `exec` ne sert pas : c'est `lastIndex` qui porte la position.
  while (motif.exec(source) !== null) {
    let profondeur = 1;
    let j = motif.lastIndex;
    while (j < source.length && profondeur > 0) {
      if (source[j] === "{") profondeur++;
      else if (source[j] === "}") profondeur--;
      j++;
    }
    sortie += source.slice(motif.lastIndex, j - 1);
  }
  return sortie;
}

/** Le corps d'une règle, par son sélecteur exact. `null` si elle n'existe pas. PURE. */
export function regleCss(source: string, selecteur: string): string | null {
  const echappe = selecteur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|[},])\\s*${echappe}\\s*\\{([^}]*)\\}`, "m").exec(source);
  return m ? m[1]! : null;
}

/** Le CSS privé de ses commentaires. PURE. */
export function sansCommentairesCss(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Le CSS privé de TOUS ses blocs `@media`, accolades comptées. PURE.
 *
 * Sert aux gardes qui affirment qu'une règle N'EXISTE PAS sur grand écran : un media query
 * n'ajoute aucune spécificité, donc une règle sortie de son bloc par mégarde s'applique
 * partout sans que rien ne la signale.
 */
export function horsMediaQueries(source: string): string {
  let sortie = "";
  let i = 0;
  while (i < source.length) {
    const debut = source.indexOf("@media", i);
    if (debut === -1) return sortie + source.slice(i);
    sortie += source.slice(i, debut);
    const ouvrante = source.indexOf("{", debut);
    if (ouvrante === -1) return sortie;
    let profondeur = 1;
    let j = ouvrante + 1;
    while (j < source.length && profondeur > 0) {
      if (source[j] === "{") profondeur++;
      else if (source[j] === "}") profondeur--;
      j++;
    }
    i = j;
  }
  return sortie;
}
