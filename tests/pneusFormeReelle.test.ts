// tests/pneusFormeReelle.test.ts — les pneus de la bZ, dans la forme qu'elle envoie VRAIMENT.
//
// CAS RÉEL, 19/08/2026. Marc : « les pneus ça marche pas, supprime tout ». Vérification
// faite par le connecteur MCP : la donnée était PARFAITE en base (268,9 / 262 kPa, mesurée
// 49 min plus tôt). C'est le parseur qui rendait une liste vide, sur toutes les livraisons.
//
// Il lisait `corps.values` — donc `.values` d'un TABLEAU, ce qui vaut `undefined`. Un
// commentaire affirmait pourtant gérer « le tableau direct ». Il ne le gérait pas. Zéro roue
// extraite de chaque relevé ⇒ aucune pression nulle part (schéma, courbes, alertes, MCP),
// sans une seule erreur nulle part. Une fonctionnalité morte sur une donnée valide.

import { describe, expect, it } from "vitest";
import { rouesDuJson } from "@/lib/vehicle/analyse";

/** La charge EXACTE lue sur la voiture de Marc le 19/08 — un TABLEAU, sans enveloppe. */
const FORME_REELLE_BZ = [
  { row: 0, column: 0, tirePressure: 268.9 },
  { row: 1, column: 0, tirePressure: 262 },
  { row: 0, column: 1, tirePressure: 268.9 },
  { row: 1, column: 1, tirePressure: 262 },
];

describe("rouesDuJson — les trois formes, une par une", () => {
  it("TABLEAU DIRECT : la forme réelle de la bZ", () => {
    const roues = rouesDuJson(FORME_REELLE_BZ);
    expect(roues, "c'est CE cas qui rendait la liste vide").toHaveLength(4);
    expect(roues).toEqual([
      { libelle: "avant gauche", pression: 268.9 },
      { libelle: "arrière gauche", pression: 262 },
      { libelle: "avant droite", pression: 268.9 },
      { libelle: "arrière droite", pression: 262 },
    ]);
  });

  it("ENVELOPPE `{ values: [...] }`", () => {
    expect(rouesDuJson({ values: FORME_REELLE_BZ })).toHaveLength(4);
  });

  it("DOUBLE enveloppe `{ values: { values: [...] } }` (livraison TEST)", () => {
    expect(rouesDuJson({ values: { values: FORME_REELLE_BZ } })).toHaveLength(4);
  });
});

describe("rouesDuJson — ce qu'il refuse", () => {
  it("rend une liste vide sur une forme inconnue, jamais une position inventée", () => {
    for (const x of [null, undefined, {}, [], "texte", 42, { autre: [1, 2] }]) {
      expect(rouesDuJson(x)).toEqual([]);
    }
  });

  it("saute une roue sans pression exploitable, garde les autres", () => {
    const roues = rouesDuJson([
      { row: 0, column: 0, tirePressure: 268.9 },
      { row: 0, column: 1, tirePressure: null },
      { row: 1, column: 0, tirePressure: "abc" },
      { row: 1, column: 1, tirePressure: 262 },
    ]);
    expect(roues).toHaveLength(2);
    expect(roues.map((r) => r.libelle)).toEqual(["avant gauche", "arrière droite"]);
  });

  it("place les roues : rangée 0 = avant, colonne 0 = gauche", () => {
    // Une inversion ici ferait attribuer une dérive de pression à la mauvaise roue —
    // erreur silencieuse et coûteuse, puisqu'on irait regarder le mauvais pneu.
    expect(rouesDuJson([{ row: 1, column: 1, tirePressure: 200 }])[0]!.libelle).toBe(
      "arrière droite",
    );
    expect(rouesDuJson([{ row: 0, column: 0, tirePressure: 200 }])[0]!.libelle).toBe(
      "avant gauche",
    );
  });
});
