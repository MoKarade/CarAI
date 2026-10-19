// tests/rechercheAdresseSimple.test.ts — sans clé de géocodage, le message ne cite plus le nom
// d'une variable d'environnement (carte 17 du 15/10).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("recherche d'adresse d'un lieu", () => {
  const source = readFileSync("app/reglages/lieux.tsx", "utf8");

  it("dit simplement que la recherche n'est pas disponible", () => {
    expect(source).toContain(
      "La recherche d’adresse n’est pas disponible, pose le lieu sur la carte.",
    );
  });

  it("ne cite plus GOOGLE_GEOCODING_KEY à l'écran", () => {
    expect(source).not.toContain("(GOOGLE_GEOCODING_KEY)");
  });
});
