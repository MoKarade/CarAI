// tests/pointsDeRupture.test.ts — l'app n'a que DEUX points de rupture, et c'est tenu ici.
//
// ⚠️ NÉ D'UNE MESURE, le 18/09/2026, quand Marc a demandé de « full retravailler
// l'interface sur PC et téléphone ». La feuille en portait SIX : 34rem, 40rem, 46rem,
// 52rem, 700px et 900px — quatre en `rem` et deux en `px`, soit 544 / 640 / 700 / 736 /
// 832 / 900 une fois converties. Personne ne pouvait dire ce que l'écran faisait entre
// 832 px (où une carte bascule en colonne) et 900 px (où la grille du héros s'installe).
// C'est là que l'incohérence se fabrique, et elle ne se voit sur aucune capture d'écran :
// il faut redimensionner la fenêtre pile dans l'intervalle pour la rencontrer.
//
// ⚠️ **CETTE GARDE LIT LE CSS DÉCOMMENTÉ, et ce n'est pas une précaution de style.**
// L'en-tête de `globals.css` ÉNUMÈRE les six anciens seuils pour raconter d'où l'on vient :
// une garde qui lirait la source brute rougirait sur l'explication de sa propre existence.
// C'est le piège « une garde écrite à côté de son sujet lit son propre commentaire », payé
// ailleurs dans l'écosystème — d'où l'anti-vacuité plus bas, qui prouve que le décommentage
// a laissé du code derrière lui.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sansCommentairesCss } from "./aides/css";

/**
 * Les deux seuls seuils de largeur admis.
 *
 * `max-width: 700px` borne le téléphone, `min-width: 700px` est son complément exact, et
 * `min-width: 900px` ouvre la disposition grand écran. Rien d'autre.
 */
export const SEUILS_AUTORISES = ["700px", "900px"] as const;

/** Une condition `@media` telle qu'elle est écrite, avec sa ligne. */
export interface ConditionMedia {
  ligne: number;
  condition: string;
}

/** Toutes les conditions `@media` d'une feuille. PURE. */
export function conditionsMedia(css: string): ConditionMedia[] {
  const sorties: ConditionMedia[] = [];
  css.split("\n").forEach((texte, i) => {
    const m = /@media\s*\(([^)]+)\)/.exec(texte);
    if (m) sorties.push({ ligne: i + 1, condition: m[1]!.trim() });
  });
  return sorties;
}

/**
 * Les conditions de LARGEUR qui n'emploient pas un seuil autorisé. PURE.
 *
 * ⚠️ Ne juge que les conditions qui parlent de largeur : `prefers-reduced-motion`,
 * `prefers-color-scheme` et consorts ne sont pas des points de rupture et n'ont rien à
 * faire dans ce compte. Une garde qui les ramasserait forcerait à l'exempter, et une
 * exemption est exactement ce qui rouvre la porte.
 */
export function seuilsHorsCanon(css: string): ConditionMedia[] {
  return conditionsMedia(css).filter(({ condition }) => {
    const m = /(?:min|max)-width:\s*([^\s)]+)/.exec(condition);
    if (m === null) return false;
    return !(SEUILS_AUTORISES as readonly string[]).includes(m[1]!);
  });
}

const brut = readFileSync("app/globals.css", "utf8");
const css = sansCommentairesCss(brut);

describe("deux points de rupture, et seulement deux", () => {
  it("⚠️ aucune largeur hors { 700px, 900px }", () => {
    const fautifs = seuilsHorsCanon(css);
    const detail = fautifs.map((f) => `L${f.ligne} (${f.condition})`).join(", ");
    expect(fautifs, `points de rupture hors canon : ${detail}`).toEqual([]);
  });

  it("les deux seuils sont RÉELLEMENT employés — sinon la règle ne garde rien", () => {
    // Une garde qui interdit tout sauf A et B reste verte sur une feuille qui n'a plus
    // aucun `@media`. Le compte prouve qu'elle a un objet.
    const largeurs = conditionsMedia(css)
      .map((c) => /(?:min|max)-width:\s*([^\s)]+)/.exec(c.condition)?.[1])
      .filter((v): v is string => v !== undefined);
    expect(largeurs.length).toBeGreaterThanOrEqual(5);
    for (const seuil of SEUILS_AUTORISES) expect(largeurs).toContain(seuil);
  });

  it("le décommentage n'a pas mangé la feuille", () => {
    // L'anti-vacuité de la garde : sans elle, « aucun seuil fautif » serait indistinguable
    // de « il ne reste plus rien à lire ». Mesuré le 18/09 : la feuille garde environ les
    // deux tiers de ses caractères une fois les commentaires retirés.
    const partDeCode = css.replace(/\s/g, "").length / brut.replace(/\s/g, "").length;
    expect(partDeCode).toBeGreaterThan(0.5);
    expect(css).toContain("@media");
  });
});

describe("le détecteur DISCRIMINE", () => {
  it("attrape une largeur en rem, et la nomme", () => {
    const fautifs = seuilsHorsCanon("@media (max-width: 46rem) {\n  .x { color: red; }\n}");
    expect(fautifs).toHaveLength(1);
    expect(fautifs[0]!.condition).toBe("max-width: 46rem");
  });

  it("attrape un px voisin mais non canonique", () => {
    expect(seuilsHorsCanon("@media (min-width: 768px) { .x { color: red } }")).toHaveLength(1);
  });

  it("laisse passer les deux seuils admis, dans les deux sens", () => {
    const sain = [
      "@media (max-width: 700px) { .a { color: red } }",
      "@media (min-width: 700px) { .b { color: red } }",
      "@media (min-width: 900px) { .c { color: red } }",
    ].join("\n");
    expect(seuilsHorsCanon(sain)).toEqual([]);
  });

  it("⚠️ ne juge PAS ce qui n'est pas une largeur", () => {
    // Le cas qui ferait poser une exemption si on l'oubliait — et une exemption posée une
    // fois se réutilise pour de mauvaises raisons.
    const sain = [
      "@media (prefers-reduced-motion: reduce) { .a { animation: none } }",
      "@media (prefers-color-scheme: dark) { .b { color: white } }",
      "@media print { .c { display: none } }",
    ].join("\n");
    expect(seuilsHorsCanon(sain)).toEqual([]);
  });
});
