// tests/panneAccueil.test.ts — l'accueil en panne dit la panne en mots simples, sans le texte
// technique brut de l'erreur (carte 5 du 15/10).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("accueil en panne", () => {
  const source = readFileSync("app/page.tsx", "utf8");

  it("n'affiche plus le détail technique de la panne", () => {
    expect(source).not.toContain("<code>{detail}</code>");
    expect(source).not.toContain("messagePanne: detail");
  });

  it("garde le message clair et l'explication « panne, pas absence »", () => {
    expect(source).toContain("{messagePanne(typePanne)}");
    expect(source).toContain("Une panne, pas une absence de données");
  });
});
