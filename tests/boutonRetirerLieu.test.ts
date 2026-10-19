// tests/boutonRetirerLieu.test.ts — « Retirer » un lieu demande confirmation puis dit
// « Retrait… » (carte 8 du 15/10).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("bouton Retirer un lieu", () => {
  const bouton = readFileSync("app/reglages/BoutonRetirerLieu.tsx", "utf8");
  const lieux = readFileSync("app/reglages/lieux.tsx", "utf8");

  it("demande une confirmation avant d'envoyer", () => {
    expect(bouton).toContain("Retirer ce lieu ?");
    expect(bouton).toContain("Oui, retirer");
    expect(bouton).toContain("Annuler");
  });

  it("dit « Retrait… » et se grise pendant l'envoi", () => {
    expect(bouton).toContain("useFormStatus");
    expect(bouton).toContain("Retrait…");
    expect(bouton).toContain("disabled");
  });

  it("est branché dans la liste des lieux, dans le formulaire de l'action serveur", () => {
    expect(lieux).toContain("<BoutonRetirerLieu />");
    expect(lieux).toContain("<form action={retirerLieu}>");
  });
});
