// Verrou de CarAI#249 : du CSS qu'aucun JSX ne pose plus ne revient pas (suite de #187).
//
// Ces sélecteurs sont restés après la fusion de /trajets et /recharges dans Activité et le
// remplacement de `.heros` par `.heros-constructeur`. On les cherche hors commentaires, avec
// une frontière de mot : `.heros` ne doit pas confondre `.heros-constructeur`, qui est vivant.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sansCommentairesCss } from "./aides/css";

const css = sansCommentairesCss(readFileSync("app/globals.css", "utf8"));

const MORTS = [
  "heros",
  "trajet-barre",
  "panneau-image",
  "faits-vehicule",
  "fait-valeur",
  "fait-libelle",
];

describe("style mort retiré de globals.css", () => {
  it.each(MORTS)(".%s n'est plus déclaré", (nom) => {
    expect(css).not.toMatch(new RegExp(`\\.${nom}(?![\\w-])`));
  });

  it("la classe voisine vivante .heros-constructeur est toujours là", () => {
    expect(css).toMatch(/\.heros-constructeur\s*\{/);
  });
});
