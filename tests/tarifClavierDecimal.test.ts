// tests/tarifClavierDecimal.test.ts — le champ « Tarif » d'un lieu ouvre le clavier à virgule
// sur téléphone (carte 16 du 15/10).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("formulaire d'un lieu de recharge", () => {
  const source = readFileSync("app/reglages/FormulaireLieu.tsx", "utf8");

  it("demande le clavier décimal pour le tarif", () => {
    const champ = source.slice(source.indexOf('name="tarif"') - 30, source.indexOf('name="tarif"') + 200);
    expect(champ).toContain('inputMode="decimal"');
  });
});
