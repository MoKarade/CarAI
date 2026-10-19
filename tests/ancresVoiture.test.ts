// tests/ancresVoiture.test.ts — les marqueurs se posent SUR la voiture, et seulement là
// où une mesure existe.
//
// Deux choses à tenir, et la seconde est un garde-fou du dépôt :
//
//   1. GÉOMÉTRIE. Les ancres viennent des dimensions RÉELLES du modèle livré. Un chiffre
//      recopié de travers pose un marqueur dans le vide, et ça ne se voit qu'à l'écran —
//      or aucune branche `claude/*` n'a de prévisualisation ici.
//
//   2. NO-FAKE-DATA. Un modèle 3D complet affiche un hayon, un toit ouvrant, des phares.
//      La bZ ne publie leur état sur AUCUN d'eux : mesuré le 18/09 sur la base réelle,
//      trois valeurs en août puis plus rien. Peindre la carrosserie en vert affirmerait
//      « tout va bien » de pièces dont personne ne sait rien. Pas de mesure, pas de
//      marqueur — et c'est `marqueurPour` qui le tient, en un seul endroit.
//
// ⚠️ LA VALIDATION QUI COMPTE EST CROISÉE. Les dimensions du modèle sont confrontées à la
// bZ4X du catalogue Toyota : longueur 469 cm, empattement 285 cm. Si le modèle avait une
// autre échelle ou une autre orientation, ces deux nombres ne tomberaient pas — c'est ce
// qui prouve que « 1 unité = 1 cm » et « Y vers l'avant » ne sont pas des suppositions.

import { describe, expect, it } from "vitest";
import {
  ANCRES,
  COTE_VERIFIE,
  MODELE,
  dansLaVoiture,
  marqueurPour,
  type ElementVoiture,
} from "@/lib/vehicle/ancresVoiture";

/** La bZ4X du catalogue, en centimètres. Ce sont les chiffres du constructeur. */
const BZ4X_REELLE = { longueur: 469, empattement: 285, hauteur: 165 } as const;

describe("le repère du modèle concorde avec la vraie bZ4X", () => {
  it("la longueur mesurée tombe à moins de 1 % de celle du catalogue", () => {
    const longueur = MODELE.avantY - MODELE.arriereY;
    const ecart = Math.abs(longueur - BZ4X_REELLE.longueur) / BZ4X_REELLE.longueur;
    expect(ecart, `longueur du modèle ${longueur} cm`).toBeLessThan(0.01);
  });

  it("l'empattement tombe à moins de 3 % de celui du catalogue", () => {
    const empattement = MODELE.essieuY * 2;
    const ecart = Math.abs(empattement - BZ4X_REELLE.empattement) / BZ4X_REELLE.empattement;
    expect(ecart, `empattement du modèle ${empattement} cm`).toBeLessThan(0.03);
  });

  it("la hauteur tombe à moins de 3 % de celle du catalogue", () => {
    // ⚠️ `Z` descend : le toit est la valeur la plus négative, le sol la plus positive.
    const hauteur = MODELE.solZ - MODELE.toitZ;
    const ecart = Math.abs(hauteur - BZ4X_REELLE.hauteur) / BZ4X_REELLE.hauteur;
    expect(ecart, `hauteur du modèle ${hauteur} cm`).toBeLessThan(0.03);
  });

  it("⚠️ `Z` descend — l'inverser retournerait la voiture", () => {
    // Le piège du repère : ce modèle vient d'un outil où `Z` pointe vers le bas. Un
    // marqueur posé avec le signe inverse se retrouverait sous le bitume.
    expect(MODELE.toitZ).toBeLessThan(MODELE.solZ);
    expect(MODELE.centreRoueZ).toBeGreaterThan(MODELE.toitZ);
    expect(MODELE.centreRoueZ).toBeLessThan(MODELE.solZ);
  });
});

describe("chaque marqueur est POSÉ sur la carrosserie", () => {
  const elements = Object.keys(ANCRES) as ElementVoiture[];

  it("il y a un marqueur par élément instrumenté, et rien de plus", () => {
    // Les six familles que la bZ publie VRAIMENT (mesuré le 18/09) : les quatre pneus,
    // les portières, les fenêtres, le verrouillage, le capot et la trappe de charge.
    expect(elements).toHaveLength(9);
    expect(elements.filter((e) => e.startsWith("pneu-"))).toHaveLength(4);
  });

  it("⚠️ aucune ancre ne flotte hors du véhicule", () => {
    for (const e of elements) {
      expect(dansLaVoiture(ANCRES[e]), `${e} est hors de la carrosserie`).toBe(true);
    }
  });

  it("les quatre roues sont aux quatre coins, deux à deux symétriques", () => {
    const av = ANCRES["pneu-avant-gauche"];
    const ad = ANCRES["pneu-avant-droit"];
    const rv = ANCRES["pneu-arriere-gauche"];
    expect(av.x).toBe(-ad.x);
    expect(av.y).toBe(-rv.y);
    expect(av.y).toBeGreaterThan(0); // l'avant est du côté positif
    expect(av.z).toBe(ad.z);
  });

  it("deux marqueurs ne se posent jamais au même endroit", () => {
    const vus = new Set(elements.map((e) => `${ANCRES[e].x}|${ANCRES[e].y}|${ANCRES[e].z}`));
    expect(vus.size).toBe(elements.length);
  });

  it("⚠️ le côté conducteur est une HYPOTHÈSE, et le code le dit", () => {
    // Tant que personne n'a regardé l'écran, gauche et droite ne sont pas garanties :
    // afficher « avant-gauche » sur la roue de droite serait une donnée juste posée au
    // mauvais endroit. Ce test tombera le jour où on passera le drapeau à `true` — c'est
    // exactement à ce moment-là qu'il faut relire ce qui en dépend.
    expect(COTE_VERIFIE).toBe(false);
  });
});

describe("pas de mesure, pas de marqueur", () => {
  it("une mesure absente ne produit RIEN", () => {
    expect(marqueurPour("portieres", null)).toBeNull();
    expect(marqueurPour("portieres", undefined)).toBeNull();
  });

  it("une mesure présente produit son marqueur, ancre comprise", () => {
    const m = marqueurPour("pneu-avant-gauche", { psi: 31 });
    expect(m).not.toBeNull();
    expect(m!.ancre).toEqual(ANCRES["pneu-avant-gauche"]);
    expect(m!.mesure).toEqual({ psi: 31 });
  });

  it("⚠️ `false` et `0` sont des MESURES, pas des absences", () => {
    // Le piège classique : `if (!mesure)` jetterait « portière fermée » et « 0 psi », qui
    // sont précisément les états qu'on veut voir.
    expect(marqueurPour("verrouillage", false)).not.toBeNull();
    expect(marqueurPour("pneu-avant-droit", 0)).not.toBeNull();
  });
});

describe("`dansLaVoiture` DISCRIMINE", () => {
  it("refuse un point trop loin sur chaque axe", () => {
    expect(dansLaVoiture({ x: 400, y: 0, z: -80 })).toBe(false);
    expect(dansLaVoiture({ x: 0, y: 900, z: -80 })).toBe(false);
    expect(dansLaVoiture({ x: 0, y: -900, z: -80 })).toBe(false);
    expect(dansLaVoiture({ x: 0, y: 0, z: -900 })).toBe(false); // au-dessus du toit
    expect(dansLaVoiture({ x: 0, y: 0, z: 900 })).toBe(false); // sous le bitume
  });

  it("accepte le centre de la voiture", () => {
    expect(dansLaVoiture({ x: 0, y: 0, z: -80 })).toBe(true);
  });
});
