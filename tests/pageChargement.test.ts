// tests/pageChargement.test.ts — un changement d'onglet montre « Chargement… » tout de suite
// (carte 4 du 15/10) au lieu d'un écran figé.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("écran de chargement", () => {
  it("existe à la racine de l'app", () => {
    expect(existsSync("app/loading.tsx")).toBe(true);
  });

  it("dit « Chargement… » et s'annonce aux lecteurs d'écran", () => {
    const source = readFileSync("app/loading.tsx", "utf8");
    expect(source).toContain("Chargement…");
    expect(source).toContain('role="status"');
  });
});
