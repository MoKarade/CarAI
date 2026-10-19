// tests/grilleHeros.test.ts — la grille du héros déclare autant de colonnes qu'il y a
// d'enfants à y mettre.
//
// ⚠️ LE DÉFAUT QU'IL ATTRAPE (21/08). La grille déclarait TROIS colonnes — voiture, jauges,
// carte — mais `.hc-jauges` avait disparu la veille, quand charge et autonomie sont passées
// SUR la carrosserie. Personne n'a rendu sa colonne : la carte occupait la deuxième, la
// troisième restait vide, et l'accueil montrait un grand rectangle noir sur sa moitié
// droite. Rien ne l'a signalé — ni le typecheck, ni les 1 094 tests, ni le lint.
//
// C'est une classe de bug, pas un accident : retirer un bloc d'une grille laisse toujours
// sa piste derrière lui, et le CSS n'a aucun moyen de s'en apercevoir.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const page = readFileSync("app/page.tsx", "utf8");

/** Les enfants DIRECTS du héros, `display: contents` déplié. */
function enfantsDuHeros(): string[] {
  // `.hc-etat` est transparent à la grille (`display: contents`) : ce sont SES enfants qui
  // deviennent des éléments de grille, pas lui. Un test qui compterait `.hc-etat` pour un
  // compterait faux — et dans le bon sens, ce qui est pire.
  const enfants: string[] = [];
  if (/className="hc-voiture"/.test(page)) enfants.push("hc-voiture");
  if (/className="hc-jauges"/.test(page)) enfants.push("hc-jauges");
  if (/className="hc-carte"/.test(page)) enfants.push("hc-carte");
  return enfants;
}

/** Le nombre de pistes d'un `grid-template-columns`, `minmax(a, b)` compté pour une. */
function nbPistes(declaration: string): number {
  return declaration.replace(/minmax\([^)]*\)/g, "X").trim().split(/\s+/).filter(Boolean).length;
}

describe("la grille du héros suit ce qu'on lui donne", () => {
  const declarations = [...css.matchAll(/\.heros-constructeur\s*\{[^}]*grid-template-columns:\s*([^;]+);/g)]
    .map((m) => m[1]!);

  it("au moins une déclaration de colonnes existe", () => {
    expect(declarations.length).toBeGreaterThan(0);
  });

  it("⚠️ aucune déclaration ne promet plus de colonnes qu'il n'y a d'enfants", () => {
    const attendu = enfantsDuHeros().length;
    expect(attendu, "le héros doit avoir des enfants reconnus").toBeGreaterThan(0);
    for (const d of declarations) {
      expect(nbPistes(d), `« ${d.trim()} » pour ${attendu} enfant(s)`).toBeLessThanOrEqual(attendu);
    }
  });

  it("le compteur de pistes DISCRIMINE", () => {
    // Preuve que le test ci-dessus mesure bien ce qu'il annonce.
    expect(nbPistes("auto minmax(20rem, 1fr)")).toBe(2);
    expect(nbPistes("minmax(13rem, 1.1fr) minmax(15rem, 1.3fr) minmax(20rem, 2fr)")).toBe(3);
    expect(nbPistes("1fr")).toBe(1);
  });

  it("`.hc-jauges` n'existe plus — si elle revient, la grille doit suivre", () => {
    // Ce test n'interdit pas son retour : il documente l'état qui justifie deux colonnes,
    // et tombera avec celui du dessus si on la remet sans rendre sa piste.
    expect(enfantsDuHeros()).toEqual(["hc-voiture", "hc-carte"]);
  });
});
