// tests/bailNonRenseigne.test.ts — verrou de CarAI#239 : les termes du bail ne sont plus dans le
// code. Sans bail en base, `lireBail()` rend `null` et chaque surface le DIT au lieu de chiffrer.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MESSAGE_BAIL_NON_RENSEIGNE } from "@/lib/vehicle/lease";

const lire = (chemin: string): string => readFileSync(join(process.cwd(), chemin), "utf8");

describe("bail non renseigné", () => {
  it("aucun repli dans le code : lireBail lit la base seulement", () => {
    const config = lire("lib/config.ts");
    expect(config).not.toContain("BAIL_DEFAUT");
    expect(config).toMatch(/export async function lireBail\(\): Promise<Bail \| null>/);
    expect(config).not.toMatch(/lireConfig\(CLE_BAIL, SchemaBail\)\)\s*\?\?/);
  });

  it("le message dit où saisir les termes", () => {
    expect(MESSAGE_BAIL_NON_RENSEIGNE).toMatch(/^Bail non renseigné/);
    expect(MESSAGE_BAIL_NON_RENSEIGNE).toContain("Réglages");
  });

  it("l'accueil, Tendances et les deux outils MCP le disent au lieu de chiffrer", () => {
    for (const chemin of [
      "app/page.tsx",
      "app/tendances/page.tsx",
      "lib/mcp/outils.ts",
      "mcp/tools/history.tools.ts",
    ]) {
      expect(lire(chemin), chemin).toContain("MESSAGE_BAIL_NON_RENSEIGNE");
    }
  });

  it("le summary du hub n'envoie aucun état de bail sans termes", () => {
    const instantane = lire("lib/vehicle/instantane.ts");
    expect(instantane).toMatch(/const bail = bailTermes\s*\?\s*calculerEtatBail/);
    expect(instantane).toMatch(/bailTermes && lectureBail\.statut === "ok"/);
  });

  it("Réglages affiche un formulaire vide quand rien n'est enregistré", () => {
    const page = lire("app/reglages/page.tsx");
    expect(page).toContain("let bail: Bail | null = null;");
    expect(page).toContain("bail === null &&");
  });
});
