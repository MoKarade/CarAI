// tests/boutonRafraichir.test.ts — le bouton « Rafraîchir » montre « Lecture… » et se grise
// pendant la lecture (carte 7 du 15/10), au lieu de ne rien montrer.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bouton Rafraîchir", () => {
  const source = readFileSync("app/donnees/rafraichissement.tsx", "utf8");

  it("passe par une transition et se grise pendant la lecture", () => {
    expect(source).toContain("useTransition");
    expect(source).toContain("disabled={enCours}");
  });

  it("affiche « Lecture… » pendant la lecture, « Rafraîchir » sinon", () => {
    expect(source).toContain('enCours ? "Lecture…" : "Rafraîchir"');
  });
});
