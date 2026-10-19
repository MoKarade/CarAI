// tests/recommandation.test.ts — « quoi faire », et rien quand il n'y a rien à faire.
//
// Deux cas qui font qu'une recommandation reste lue : ELLE PARLE quand une action est
// calculable, et ELLE SE TAIT sinon. Le cas « se taire » est le normal, et celui qu'un
// refactor casse sans que rien ne rougisse.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { construireAlertes, type Alerte } from "@/lib/vehicle/alertes";
import { recommander } from "@/lib/vehicle/recommandation";
import type { MesureQualifiee } from "@/lib/vehicle/state";

const alerte = (cle: string): Alerte => ({
  cle,
  gravite: "avertissement",
  titre: "t",
  detail: "d",
});

const mesure = (p: Partial<MesureQualifiee>): MesureQualifiee => ({
  metricType: "x",
  source: "smartcar",
  recordedAt: new Date("2026-08-12T12:00:00Z"),
  receivedAt: new Date("2026-08-12T12:00:00Z"),
  valueNumeric: null,
  valueText: null,
  valueJson: null,
  unit: null,
  locationType: null,
  signalCode: null,
  ageMinutes: 5,
  interpretationFiable: true,
  raisonInterpretation: null,
  ...p,
});

describe("recommander", () => {
  it("dit de brancher la voiture quand la charge est basse et le câble absent", () => {
    expect(recommander([alerte("charge-basse")])).toEqual({
      cle: "charge-basse",
      texte: "Branche la voiture.",
    });
  });

  it("SE TAIT quand aucune alerte n'appelle d'action", () => {
    expect(recommander([])).toBeNull();
  });

  it("SE TAIT sur une alerte dont l'action n'est pas encore écrite", () => {
    expect(recommander([alerte("deverrouillee"), alerte("pneu-ecart-AVG")])).toBeNull();
  });

  it("retient la recommandation même parmi d'autres alertes", () => {
    const reco = recommander([alerte("deverrouillee"), alerte("charge-basse")]);
    expect(reco?.cle).toBe("charge-basse");
  });
});

describe("de bout en bout, depuis les mesures", () => {
  const charge = (soc: number, branchee: string) => [
    mesure({ metricType: "battery_soc", valueNumeric: soc }),
    mesure({ metricType: "charge_plugged_in", valueText: branchee }),
    mesure({ metricType: "charging_status", valueText: "false" }),
  ];

  it("charge basse et non branchée → une phrase", () => {
    const reco = recommander(construireAlertes({ mesures: charge(12, "false") }));
    expect(reco?.texte).toBe("Branche la voiture.");
  });

  it("charge basse mais DÉJÀ branchée → rien", () => {
    expect(recommander(construireAlertes({ mesures: charge(12, "true") }))).toBeNull();
  });

  it("charge suffisante, non branchée → rien", () => {
    expect(recommander(construireAlertes({ mesures: charge(80, "false") }))).toBeNull();
  });
});

describe("l'accueil", () => {
  const source = readFileSync("app/page.tsx", "utf8");

  it("n'affiche la recommandation que par le composant qui rend null sans action", () => {
    expect(source).toMatch(/<RecommandationAccueil reco=\{recommander\(alertes\)\} \/>/);
    expect(source).toMatch(/if \(reco === null\) return null;/);
  });
});
