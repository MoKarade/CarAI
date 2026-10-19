// tests/pageErreur.test.ts — une erreur imprévue se dit en français avec un bouton
// « Réessayer », sans texte technique (carte 3 du 15/10).

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("page d'erreur générale", () => {
  it("existe, en composant client, et parle français", () => {
    expect(existsSync("app/error.tsx")).toBe(true);
    const source = readFileSync("app/error.tsx", "utf8");
    expect(source.startsWith('"use client"')).toBe(true);
    expect(source).toContain("Quelque chose n’a pas marché");
  });

  it("propose Réessayer, qui relance l'affichage", () => {
    const source = readFileSync("app/error.tsx", "utf8");
    expect(source).toContain("Réessayer");
    expect(source).toContain("onClick={() => reset()}");
  });

  it("n'affiche jamais le texte technique de l'erreur", () => {
    const source = readFileSync("app/error.tsx", "utf8");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("digest");
  });
});
