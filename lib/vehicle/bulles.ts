// lib/vehicle/bulles.ts — QUELLE bulle reste ouverte après un appui. PURE, testée.
//
// Marc, 20/08 : « je veux pouvoir cliquer autre part pour désélectionner ce que j'ai
// cliqué sur la voiture ». Un `<details>` natif ne se referme QUE par un second appui sur
// son propre résumé : sans règle, une bulle ouverte le reste pendant qu'on lit ailleurs, et
// masque la carrosserie qu'elle décrit.
//
// La règle vit ICI plutôt que dans le composant parce que c'est une DÉCISION, pas du
// câblage — et parce qu'il n'y a pas d'environnement DOM dans les tests de ce dépôt. Le
// composant se contente de traduire : nœuds ouverts → identifiants, règle, puis fermeture.

/**
 * Les identifiants des bulles à FERMER, sachant celles qui sont ouvertes et celle qui
 * contient le point d'appui (`null` si l'appui est tombé ailleurs). PURE.
 *
 * ⚠️ La bulle visée n'est jamais fermée ICI, même si elle est déjà ouverte : l'appui va
 * déclencher la bascule NATIVE du `<details>` juste après, et la refermer nous-mêmes
 * l'annulerait — un appui sur une bulle ouverte ne la refermerait plus jamais. On ne
 * s'occupe que des AUTRES.
 */
export function bullesAFermer(
  ouvertes: readonly string[],
  visee: string | null,
): string[] {
  return ouvertes.filter((id) => id !== visee);
}
