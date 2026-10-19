// tests/tendancesMobile.test.ts — le contrôle de temps de Tendances au doigt, et le prix
// d'un bloc COLLÉ sur un écran de téléphone.
//
// Marc, refonte mobile : « trop petit à taper · ça déborde en largeur · trop d'infos d'un
// coup · les formulaires sont pénibles ». Mesuré au banc Chromium le 14/09, sur le VRAI
// `app/globals.css` et le balisage exact de `ControleTemps`, à 360 et 390 px :
//   • les DEUX curseurs de la brosse temporelle faisaient **16 px de haut** — on y glisse
//     le doigt pour cadrer la période, c'est le geste principal de cet écran ;
//   • les QUATRE boutons (+, −, Tout, 24 h) faisaient **34,1 px** ;
//   • zéro débordement en largeur — cet irritant-là n'existe pas ici non plus.
// Après : 1 cible sous 44 px sur 20, et c'est un lien DANS une phrase (voir plus bas).
//
// ══ POURQUOI LE BLOC CESSE D'ÊTRE COLLÉ SUR TÉLÉPHONE ════════════════════════════════
//
// `.controle-temps` est `position: sticky` : il reste en haut pendant qu'on fait défiler
// les courbes. Mesuré, il occupait déjà **195 px sur 844**, soit 23 % de l'écran en
// permanence. Agrandir ses cibles à 44 px le porte à **257 px**, soit **30,5 %** — un
// contrôle qui mange le tiers de l'écran coûte plus qu'il ne rend.
//
// ⚠️ Ce que le collage portait, c'est le CONFORT de zoomer en regardant une courbe plus
// bas. Ce qu'il ne portait PAS, c'est l'échelle commune entre les courbes : elle vient du
// composant `GraphiquesLies`, qui pilote toutes les séries depuis un seul état. Décoller
// le bloc ne défait donc pas la demande du 14/08 (« une échelle identique, même quand je
// zoome ») — ce test le vérifie en exigeant que le `sticky` reste au niveau de base.
//
// ⚠️ CASCADE. Un media query n'ajoute AUCUNE spécificité : `.controle-temps { position:
// static }` ne bat `.controle-temps { position: sticky }` que parce qu'elle est écrite
// APRÈS dans le fichier. Ce fichier a déjà payé ce piège plusieurs fois (une passe de
// densité écrite mille lignes plus bas écrasait en silence les paliers du héros). Le test
// compare donc les POSITIONS des deux règles, pas seulement leur existence.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  blocTelephone,
  horsMediaQueries,
  regleCss,
  sansCommentairesCss,
} from "./aides/css";

const CSS = readFileSync("app/globals.css", "utf8");
const cssNu = sansCommentairesCss(CSS);
const telephone = blocTelephone(cssNu);
const grandEcran = horsMediaQueries(cssNu);

describe("les lecteurs, avant de s'en servir", () => {
  it("le bloc téléphone contient du CSS, et pas tout le fichier", () => {
    // Anti-vacuité des deux côtés : une garde de PRÉSENCE se prouverait à partir de « le
    // bloc contient tout », une garde d'ABSENCE à partir de « il ne reste rien ».
    expect(telephone.length).toBeGreaterThan(1000);
    expect(telephone.length).toBeLessThan(cssNu.length / 2);
    expect(telephone).toContain(".onglets");
    expect(grandEcran.length).toBeGreaterThan(cssNu.length / 2);
    expect(grandEcran).not.toContain("max-width: 700px");
  });

  it("le découpeur de règles trouve un corps, et rend `null` sur l'inexistant", () => {
    expect(regleCss(grandEcran, ".controle-temps")).toContain("position: sticky");
    expect(regleCss(grandEcran, ".regle-qui-nexiste-pas")).toBeNull();
  });
});

describe("le contrôle de temps se manipule au doigt", () => {
  it("les deux curseurs de la brosse font au moins 44 px", () => {
    const r = regleCss(telephone, '.ct-brosse input[type="range"]');
    expect(r).not.toBeNull();
    expect(r).toContain("min-height: 44px");
  });

  it("les quatre boutons aussi", () => {
    const r = regleCss(telephone, ".ct-boutons button");
    expect(r).not.toBeNull();
    expect(r).toContain("min-height: 44px");
  });

  it("aucune de ces deux règles n'existe sur grand écran", () => {
    // Les règles de BASE de ces sélecteurs existent (largeur, police, rayon) : ce qui ne
    // doit pas fuir hors du bloc téléphone, c'est la hauteur minimale.
    expect(regleCss(grandEcran, '.ct-brosse input[type="range"]')).not.toContain("min-height");
    expect(regleCss(grandEcran, ".ct-boutons button")).not.toContain("min-height");
  });
});

describe("le bloc collé, et ce qu'il coûte sur un téléphone", () => {
  it("il est décollé sur téléphone", () => {
    expect(regleCss(telephone, ".controle-temps")).toContain("position: static");
  });

  it("il reste COLLÉ sur grand écran — on ne défait pas le contrôle unique", () => {
    expect(regleCss(grandEcran, ".controle-temps")).toContain("position: sticky");
  });

  it("la règle mobile est écrite APRÈS la règle de base, sinon elle ne gagne pas", () => {
    // ⚠️ Un media query n'ajoute aucune spécificité. Écrite avant, `position: static`
    // perdrait contre `position: sticky` à toutes les largeurs — et RIEN ne le dirait :
    // la page s'afficherait, avec le bloc toujours collé.
    const base = cssNu.indexOf(".controle-temps {");
    const mobile = cssNu.indexOf("@media (max-width: 700px) {\n  .controle-temps {");
    expect(base).toBeGreaterThan(-1);
    expect(mobile).toBeGreaterThan(-1);
    expect(mobile).toBeGreaterThan(base);
  });
});

describe("ce que le composant garantit, et que le CSS ne doit pas défaire", () => {
  const composant = readFileSync("app/ui/GraphiquesLies.tsx", "utf8");

  it("l'échelle commune vient d'un ÉTAT UNIQUE, pas de la position du bloc", () => {
    // C'est ce qui autorise à décoller le contrôle : toutes les courbes reçoivent la MÊME
    // fenêtre, calculée une fois. Si un jour chaque courbe calculait la sienne, décoller
    // le contrôle deviendrait une perte — et ce test le signalerait.
    expect(composant).toContain("series.map((serie) => (");
    expect(composant).toContain("fenetre={fenetre}");
    // Un seul `useState` de zoom pour tout le composant.
    expect(composant.match(/useState<Zoom>/g) ?? []).toHaveLength(1);
  });
});
