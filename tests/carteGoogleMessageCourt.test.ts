// tests/carteGoogleMessageCourt.test.ts — quand la carte Google n'est pas disponible, le
// message est court et le détail technique est replié (carte 15 du 15/10).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("carte Google indisponible", () => {
  const source = readFileSync("app/ui/CarteGoogleVivante.tsx", "utf8");

  it("dit en une phrase que la carte de secours est affichée", () => {
    expect(source).toContain("Carte Google indisponible, carte de secours affichée");
  });

  it("replie le détail technique dans « Pourquoi ? »", () => {
    expect(source).toContain("<details");
    expect(source).toContain("<summary>Pourquoi ?</summary>");
    expect(source.indexOf("<summary>Pourquoi ?</summary>")).toBeLessThan(
      source.indexOf("Google a <strong>refusé la clé</strong>"),
    );
  });
});
