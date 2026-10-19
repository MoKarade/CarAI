// tests/valeurHorsCharge.test.ts — une valeur de session de charge ne ment plus hors charge.
//
// CAS RÉEL, 19/08/2026, découvert au premier usage du connecteur MCP : la bZ publiait
// `charge_time_remaining = 250` avec une mesure de cinq minutes, alors que la batterie était
// à 100 %, le câble débranché et le statut `NOT_CHARGING`. La voiture ne remet pas ce
// compteur à zéro en fin de session — elle rediffuse la dernière valeur indéfiniment.
//
// Sans garde, ce nombre devenait « Temps de charge restant : 250 » dans Tendances et dans la
// réponse du MCP. C'est du fake data au sens strict : pas une valeur inventée par l'app, mais
// une valeur vraie présentée dans un contexte qui la rend fausse.

import { describe, expect, it } from "vitest";
import { formaterValeur, type MesureQualifiee } from "@/lib/vehicle/state";

const T = new Date("2026-08-19T17:53:56Z");

const mesure = (p: Partial<MesureQualifiee>): MesureQualifiee => ({
  metricType: "x",
  source: "smartcar",
  recordedAt: T,
  receivedAt: T,
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

describe("formaterValeur — une réserve s'affiche, elle ne se devine pas", () => {
  it("accole la raison à une valeur non interprétable", () => {
    const rendu = formaterValeur(
      mesure({
        metricType: "charge_time_remaining",
        valueNumeric: 250,
        interpretationFiable: false,
        raisonInterpretation: "aucune charge en cours au dernier relevé",
      }),
    );
    expect(rendu).toContain("250");
    expect(rendu, "la valeur nue est ce qui ment").toContain("aucune charge en cours");
  });

  it("laisse une valeur interprétable parfaitement nue", () => {
    // La garde ne doit pas polluer le cas normal : pendant une charge, « 250 » se lit tel quel.
    expect(
      formaterValeur(mesure({ metricType: "charge_time_remaining", valueNumeric: 250 })),
    ).toBe("250");
  });

  it("garde le message d'unité pour un pourcentage ambigu", () => {
    // Régression : la raison est devenue un champ, le message historique doit survivre.
    expect(
      formaterValeur(
        mesure({
          metricType: "battery_soc",
          valueNumeric: 0.3,
          interpretationFiable: false,
          raisonInterpretation: "unité non déclarée",
        }),
      ),
    ).toBe("0.3 (unité non déclarée)");
  });
});

// ── La garde elle-même, exercée à travers la vraie lecture d'état ────────────────────────
//
// `lireEtatVehicule` lit la base ; on la teste en remplaçant sa source de lignes. C'est
// nécessaire parce que la garde a besoin de TOUTES les mesures pour décider (elle cherche
// `charging_status` parmi elles) — la tester sur une mesure isolée prouverait autre chose.
describe("garde « hors charge »", () => {
  const ligne = (metricType: string, v: Partial<Record<string, unknown>> = {}) => ({
    metricType,
    source: "smartcar",
    recordedAt: T,
    receivedAt: T,
    valueNumeric: null,
    valueText: null,
    valueJson: null,
    unit: null,
    locationType: null,
    signalCode: null,
    ...v,
  });

  async function etatAvec(lignes: ReturnType<typeof ligne>[]) {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("@/lib/smartcar/ingest", () => ({ dernieresValeurs: async () => lignes }));
    const { lireEtatVehicule } = await import("@/lib/vehicle/state");
    const etat = await lireEtatVehicule(T);
    vi.doUnmock("@/lib/smartcar/ingest");
    return etat;
  }

  const timer = (etat: { mesures: MesureQualifiee[] }) =>
    etat.mesures.find((m) => m.metricType === "charge_time_remaining")!;

  it("marque la valeur quand le statut dit explicitement « pas de charge »", async () => {
    const etat = await etatAvec([
      ligne("charge_time_remaining", { valueNumeric: 250 }),
      ligne("charging_status", { valueNumeric: 0, valueText: "false" }),
    ]);
    expect(timer(etat).interpretationFiable).toBe(false);
    expect(timer(etat).raisonInterpretation).toContain("aucune charge");
  });

  it("ne touche à RIEN pendant une charge", async () => {
    const etat = await etatAvec([
      ligne("charge_time_remaining", { valueNumeric: 250 }),
      ligne("charging_status", { valueNumeric: 1, valueText: "true" }),
    ]);
    expect(timer(etat).interpretationFiable).toBe(true);
    expect(timer(etat).raisonInterpretation).toBeNull();
  });

  it("ne discrédite RIEN quand le statut de charge est inconnu", async () => {
    // « Je ne sais pas » n'autorise pas à jeter le doute sur une mesure. Sans cette règle,
    // la garde mordrait sur toute base où `charging_status` n'est pas encore arrivé.
    const etat = await etatAvec([ligne("charge_time_remaining", { valueNumeric: 250 })]);
    expect(timer(etat).interpretationFiable).toBe(true);
    expect(timer(etat).raisonInterpretation).toBeNull();
  });

  it("laisse tranquilles les métriques qui n'ont rien à voir avec la charge", async () => {
    const etat = await etatAvec([
      ligne("odometer", { valueNumeric: 4500, unit: "km" }),
      ligne("charging_status", { valueNumeric: 0, valueText: "false" }),
    ]);
    const odo = etat.mesures.find((m) => m.metricType === "odometer")!;
    expect(odo.interpretationFiable).toBe(true);
  });

  it("ne marque pas une ABSENCE de valeur — ça n'apprendrait rien", async () => {
    const etat = await etatAvec([
      ligne("charge_wattage"),
      ligne("charging_status", { valueNumeric: 0, valueText: "false" }),
    ]);
    const w = etat.mesures.find((m) => m.metricType === "charge_wattage")!;
    expect(w.interpretationFiable).toBe(true);
  });
});
