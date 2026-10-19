// tests/capaciteBatterie.test.ts — la capacité doit se lire là où la voiture la met.
//
// CAS RÉEL, 19/08/2026, découvert en lisant les recharges par le connecteur MCP : trois
// écrans lisaient `battery_capacity_nominal` via `valueNumeric` et obtenaient tous `null`.
// La bZ publie sa capacité en JSON, parce que la réponse porte aussi le choix de version.
//
// Rien n'était en erreur : chaque écran affichait honnêtement « — » faute de capacité. Le
// résultat, lui, était grave — `energieKwh` valait `null` pour CHAQUE session, donc toute
// recharge facturée au kWh (la maison) restait sans prix. 8 sessions sur 14 en 30 jours.

import { describe, expect, it } from "vitest";
import { capaciteBatterieKwh } from "@/lib/vehicle/capacite";
import type { MesureQualifiee } from "@/lib/vehicle/state";

const T = new Date("2026-08-19T16:52:46Z");

const mesure = (p: Partial<MesureQualifiee>): MesureQualifiee => ({
  metricType: "battery_capacity_nominal",
  source: "smartcar",
  recordedAt: T,
  receivedAt: T,
  valueNumeric: null,
  valueText: null,
  valueJson: null,
  unit: "kWh",
  locationType: null,
  signalCode: null,
  ageMinutes: 67,
  interpretationFiable: true,
  raisonInterpretation: null,
  ...p,
});

/** La charge EXACTE que la bZ a envoyée le 19/08 — copiée depuis la réponse du connecteur. */
const JSON_REEL_BZ = {
  source: "USER_SELECTED",
  capacity: 57.7,
  availableCapacities: [
    { capacity: 57.7, description: "BEV:XLE" },
    { capacity: 74.7, description: "BEV:XLE" },
  ],
};

describe("capaciteBatterieKwh", () => {
  it("lit la capacité dans le JSON — le cas RÉEL de la bZ", () => {
    const trouve = capaciteBatterieKwh({ mesures: [mesure({ valueJson: JSON_REEL_BZ })] });
    expect(trouve, "c'est CE cas qui rendait null et privait la maison de prix").toBe(57.7);
  });

  it("ne choisit JAMAIS dans availableCapacities", () => {
    // Deux versions de bZ existent (57,7 et 74,7 kWh). En deviner une fausserait toute
    // l'énergie de 30 % — sans que rien ne le signale. Sans `capacity`, on rend null.
    const sansChoix = { source: "DEFAULT", availableCapacities: JSON_REEL_BZ.availableCapacities };
    expect(capaciteBatterieKwh({ mesures: [mesure({ valueJson: sansChoix })] })).toBeNull();
  });

  it("préfère la colonne numérique quand elle est remplie", () => {
    expect(
      capaciteBatterieKwh({ mesures: [mesure({ valueNumeric: 64, valueJson: JSON_REEL_BZ })] }),
    ).toBe(64);
  });

  it("retombe sur battery_capacity si la nominale ne dit rien", () => {
    expect(
      capaciteBatterieKwh({
        mesures: [
          mesure({ metricType: "battery_capacity_nominal" }),
          mesure({ metricType: "battery_capacity", valueNumeric: 55 }),
        ],
      }),
    ).toBe(55);
  });

  it("prend la mesure la plus RÉCENTE quand plusieurs existent", () => {
    const vieux = mesure({
      recordedAt: new Date("2026-08-01T00:00:00Z"),
      valueJson: { capacity: 74.7 },
    });
    const recent = mesure({ valueJson: JSON_REEL_BZ });
    expect(capaciteBatterieKwh({ mesures: [vieux, recent] })).toBe(57.7);
  });

  it("accepte une capacité rendue en chaîne", () => {
    // La refuser silencieusement reproduirait exactement le bug qu'on corrige.
    expect(capaciteBatterieKwh({ mesures: [mesure({ valueJson: { capacity: "57.7" } })] })).toBe(57.7);
  });

  it("rend null plutôt qu'un zéro, sur tout ce qui n'est pas une capacité", () => {
    for (const json of [null, {}, { capacity: 0 }, { capacity: -5 }, { capacity: "abc" }, "texte"]) {
      expect(capaciteBatterieKwh({ mesures: [mesure({ valueJson: json })] })).toBeNull();
    }
    expect(capaciteBatterieKwh({ mesures: [] })).toBeNull();
  });

  it("ignore les métriques qui ne sont pas une capacité", () => {
    expect(
      capaciteBatterieKwh({
        mesures: [mesure({ metricType: "battery_soc", valueNumeric: 100 })],
      }),
    ).toBeNull();
  });
});

describe("aucun écran ne relit la capacité dans son coin", () => {
  it("les trois consommateurs passent par la fonction unique", async () => {
    // Une valeur lue à trois endroits finit par diverger, et c'est le plus grossier des
    // trois qui gagne (leçon JobAI sur les colonnes recopiées). Ce test empêche le retour
    // du `?.valueNumeric` qui rendait null partout.
    const { readFileSync } = await import("node:fs");
    for (const f of ["app/tendances/page.tsx", "app/activite/page.tsx", "lib/mcp/outils.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, `${f} doit utiliser capaciteBatterieKwh`).toContain("capaciteBatterieKwh(");
      expect(
        src.includes('metricType === "battery_capacity_nominal"'),
        `${f} relit la capacité à la main`,
      ).toBe(false);
    }
  });
});
