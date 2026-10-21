// tests/preuveEcran.test.ts — la base fictive du contrôle par navigateur (CarAI#44).
//
// Le contrôle (scripts/preuve-ecran/lancer.mjs) n'est utile que si les données inventées font
// réellement apparaître ce qu'il vérifie : une base qui ne donnerait aucun segment de roulage
// ferait « prouver » l'absence de courbe, et le contrôle resterait vert pour de mauvaises
// raisons. Ce test relie donc la base fictive au calcul RÉEL de consommation.

import { describe, expect, it } from "vitest";
import { relevesFictifs } from "../scripts/preuve-ecran/base-fictive.mjs";
import { calculerConsommation, serieConsommation } from "@/lib/vehicle/consommation";

interface Releve {
  t: Date;
  metricType: string;
  valeur: number | null;
  unite: string | null;
  json?: { capacity: number };
}

const FIN = new Date("2026-10-21T12:00:00Z");
const releves: Releve[] = relevesFictifs({ fin: FIN, jours: 6 });

const serie = (metrique: string) =>
  releves.filter((r) => r.metricType === metrique && r.valeur !== null);

describe("relevesFictifs", () => {
  it("couvre la fenêtre demandée, sans rien dans le futur", () => {
    const temps = releves.map((r) => r.t.getTime());
    expect(Math.min(...temps)).toBeGreaterThanOrEqual(FIN.getTime() - 6 * 86_400_000);
    expect(Math.max(...temps)).toBeLessThanOrEqual(FIN.getTime());
  });

  it("publie la capacité de la batterie en JSON, comme la bZ (jamais en colonne numérique)", () => {
    const cap = releves.find((r) => r.metricType === "battery_capacity_nominal");
    expect(cap?.valeur).toBeNull();
    expect(cap?.json?.capacity).toBeGreaterThan(0);
  });

  it("l'odomètre ne recule jamais", () => {
    const km = serie("odometer").map((r) => r.valeur as number);
    for (let i = 1; i < km.length; i += 1) expect(km[i]!).toBeGreaterThanOrEqual(km[i - 1]!);
  });

  it("fait apparaître de VRAIS segments de roulage dans le calcul de consommation", () => {
    const conso = calculerConsommation({
      odometre: serie("odometer").map((r) => ({ km: r.valeur as number, mesureLe: r.t })),
      socs: serie("battery_soc").map((r) => ({ t: r.t, pourcent: r.valeur as number })),
      capaciteKwh: releves.find((r) => r.metricType === "battery_capacity_nominal")!.json!.capacity,
    });
    expect(conso.nbSegments).toBeGreaterThan(5);
    expect(serieConsommation(conso).length).toBe(conso.nbSegments);
    // Le scénario roule à 17 kWh/100 km : un calcul qui s'en écarte beaucoup est cassé.
    expect(conso.kwhPar100km!).toBeGreaterThan(15);
    expect(conso.kwhPar100km!).toBeLessThan(19);
  });
});
