// tests/libellesIndicateurs.test.ts — les indicateurs des Réglages parlent de « Réception des
// données » et de « Relevé de secours », pas de « Webhook » / « Poll » (carte 14 du 15/10).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("indicateurs des Réglages", () => {
  const source = readFileSync("app/reglages/page.tsx", "utf8");

  it("dit « Réception des données » et « Relevé de secours »", () => {
    expect(source).toContain("Réception des données : rien reçu pour l’instant");
    expect(source).toContain("Réception des données : dernière fois");
    expect(source).toContain("Relevé de secours : pas encore d’historique");
    expect(source).toContain("Relevé de secours : régulier");
    expect(source).toContain("Relevé de secours : des passages sautés");
  });

  it("n'affiche plus « Webhook : » ni « Poll : » dans un libellé", () => {
    expect(source).not.toMatch(/"Webhook :|`Webhook :|"Poll :/);
  });
});
