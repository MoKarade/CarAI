// tests/pageIntrouvable.test.ts — l'adresse inconnue se dit en français, avec un lien
// vers l'accueil (carte 2 du 15/10). Next.js a sinon une page 404 en anglais.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("page introuvable", () => {
  it("existe et parle français", () => {
    expect(existsSync("app/not-found.tsx")).toBe(true);
    const source = readFileSync("app/not-found.tsx", "utf8");
    expect(source).toContain("Page introuvable");
    expect(source).not.toContain("could not be found");
  });

  it("ramène à l'accueil", () => {
    const source = readFileSync("app/not-found.tsx", "utf8");
    expect(source).toMatch(/href="\/"/);
    expect(source).toContain("Retour à l’accueil");
  });
});
