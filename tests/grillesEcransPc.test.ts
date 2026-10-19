// tests/grillesEcransPc.test.ts — CarAI#188 : les quatre écrans utilisent la largeur du PC.
//
// Avant : seul l'accueil passait en colonnes (`.heros-constructeur`, au-delà de 900 px) ;
// Activité, Tendances et Données restaient empilés comme sur téléphone. Les trois écrans
// secondaires posent maintenant leurs groupes de blocs dans `.colonnes-pc`.
//
// Ce que ce test garde, dans l'ordre où ça casse :
//   1. la règle de grille existe SOUS `@media (min-width: 900px)` — sinon elle s'appliquerait
//      aussi sur téléphone, où la page resterait empilée sans que personne ne le voie ;
//   2. elle n'existe PAS hors media query (un media query n'ajoute aucune spécificité : une
//      règle sortie de son bloc s'applique partout) ;
//   3. chaque écran emploie réellement la classe — une règle que plus aucun JSX ne pose est
//      du CSS mort, le piège exact que le ménage UI-CSS-MORT (#187) vient de nettoyer.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { horsMediaQueries, regleCss, sansCommentairesCss } from "./aides/css";

const brut = readFileSync("app/globals.css", "utf8");
const css = sansCommentairesCss(brut);

/** Tout ce qui vit sous `@media (min-width: 900px)`, accolades comptées. PURE. */
function blocGrandEcran(source: string): string {
  let sortie = "";
  const motif = /@media \(min-width: 900px\)\s*\{/g;
  while (motif.exec(source) !== null) {
    let profondeur = 1;
    let j = motif.lastIndex;
    while (j < source.length && profondeur > 0) {
      if (source[j] === "{") profondeur++;
      else if (source[j] === "}") profondeur--;
      j++;
    }
    sortie += source.slice(motif.lastIndex, j - 1) + "\n";
  }
  return sortie;
}

const grandEcran = blocGrandEcran(css);

describe("la grille des écrans secondaires est un PALIER grand écran", () => {
  const regle = regleCss(grandEcran, ".colonnes-pc");

  it("`.colonnes-pc` est une grille à colonnes sous @media (min-width: 900px)", () => {
    expect(regle, "règle .colonnes-pc absente du bloc 900 px").not.toBeNull();
    expect(regle).toMatch(/display:\s*grid/);
    expect(regle).toMatch(/grid-template-columns:\s*repeat\(auto-fit,/);
  });

  it("⚠️ elle n'existe PAS hors media query — le téléphone reste empilé", () => {
    expect(regleCss(horsMediaQueries(css), ".colonnes-pc")).toBeNull();
  });

  it("l'accueil garde sa propre grille de héros sous le même palier", () => {
    expect(grandEcran).toMatch(/\.heros-constructeur\s*\{[^}]*grid-template-columns:/);
  });

  it("le détecteur DISCRIMINE : une règle hors palier n'est pas prise pour une règle de palier", () => {
    expect(regleCss(blocGrandEcran("@media (max-width: 700px) { .x { display: grid; } }"), ".x")).toBeNull();
    expect(regleCss(blocGrandEcran("@media (min-width: 900px) { .x { display: grid; } }"), ".x")).toMatch(
      /display:\s*grid/,
    );
  });
});

describe("chaque écran pose réellement ses groupes en colonnes", () => {
  const compte = (fichier: string) =>
    (readFileSync(fichier, "utf8").match(/className="colonnes-pc"/g) ?? []).length;

  it("Tendances : deux groupes (état + consommation, déductions + bail)", () => {
    expect(compte("app/tendances/page.tsx")).toBe(2);
  });

  it("Activité : le fil des journées", () => {
    expect(compte("app/activite/page.tsx")).toBe(1);
  });

  it("Données : cadence du poll + livraisons du webhook", () => {
    expect(compte("app/donnees/page.tsx")).toBe(1);
  });

  it("Activité range bien les JOURNÉES dans le groupe, pas la carte ni les courbes", () => {
    const src = readFileSync("app/activite/page.tsx", "utf8");
    const debut = src.indexOf('className="colonnes-pc"');
    const fin = src.indexOf("</div>", debut);
    const groupe = src.slice(debut, fin);
    expect(groupe).toContain("<Journee");
    expect(groupe).not.toContain("Carte");
    expect(groupe).not.toContain("Graphique");
  });
});
