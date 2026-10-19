// tests/texteBatterie.test.ts — l'écran Activité dit « % de batterie », pas « SOC »
// (carte 13 du 15/10).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("textes de l'écran Activité", () => {
  const source = readFileSync("app/activite/page.tsx", "utf8");

  it("dit « déduite du % de batterie » partout où l'énergie est déduite", () => {
    expect(source).toContain("déduite du % de batterie</span>");
    expect(source).toContain("déduite du % de batterie et de la capacité nominale");
  });

  it("n'affiche plus « du SOC » dans un texte visible", () => {
    expect(source).not.toContain("déduite du SOC</span>");
    expect(source).not.toContain("DÉDUITE du SOC");
  });
});
