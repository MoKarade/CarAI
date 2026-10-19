// tests/carteSansJargon.test.ts — la carte des trajets n'affiche plus « zoom 13 · 12 tuiles »
// (carte 12 du 15/10) : un chiffre technique qui ne sert à rien pour Marc.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("carte interactive des trajets", () => {
  const source = readFileSync("app/ui/CarteInteractive.tsx", "utf8");

  it("n'affiche plus le niveau de zoom ni le nombre de tuiles", () => {
    expect(source).not.toContain("zoom {vue.zoom}");
    expect(source).not.toContain("tuile{vue.nbTuiles");
  });

  it("garde les boutons Zoomer, Dézoomer et Recentrer", () => {
    expect(source).toContain("Dézoomer");
    expect(source).toContain("Recentrer");
  });
});
