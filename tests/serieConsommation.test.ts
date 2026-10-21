// tests/serieConsommation.test.ts — la courbe de consommation d'« Évolution » (CarAI#41).
//
// La série est DÉRIVÉE des segments que `calculerConsommation` retient déjà : un point par
// segment, à sa date de fin, en kWh/100 km. Rien n'est lissé ni interpolé. Ce qui la
// fausserait : un segment de recharge ou d'arrêt qui laisserait un point, ou une fenêtre
// sans segment qui dessinerait une courbe plate au lieu de s'abstenir.

import { describe, expect, it } from "vitest";
import { calculerConsommation, serieConsommation } from "@/lib/vehicle/consommation";

const H = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 12, h, m, 0));
const odo = (km: number, h: number, m = 0) => ({ km, mesureLe: H(h, m) });
const soc = (pourcent: number, h: number, m = 0) => ({ t: H(h, m), pourcent });

const CAPACITE = 71.4;

describe("serieConsommation", () => {
  it("donne un point par segment retenu, à sa date de fin, en kWh/100 km", () => {
    const conso = calculerConsommation({
      odometre: [odo(1000, 8), odo(1100, 10), odo(1150, 12)],
      socs: [soc(90, 8), soc(65, 10), soc(55, 12)],
      capaciteKwh: CAPACITE,
    });
    const serie = serieConsommation(conso);
    expect(serie).toHaveLength(2);
    expect(serie[0]!.t).toEqual(H(10));
    // 25 points sur 100 km : 17,85 kWh/100 km. 10 points sur 50 km : 14,28 kWh/100 km.
    expect(serie[0]!.valeur).toBeCloseTo(17.85, 2);
    expect(serie[1]!.t).toEqual(H(12));
    expect(serie[1]!.valeur).toBeCloseTo(14.28, 2);
  });

  it("un seul segment : un seul point, égal au chiffre global", () => {
    const conso = calculerConsommation({
      odometre: [odo(1000, 8), odo(1100, 10)],
      socs: [soc(90, 8), soc(65, 10)],
      capaciteKwh: CAPACITE,
    });
    const serie = serieConsommation(conso);
    expect(serie).toHaveLength(1);
    expect(serie[0]!.valeur).toBeCloseTo(conso.kwhPar100km!, 6);
  });

  it("sans segment retenu : série VIDE, jamais une courbe plate inventée", () => {
    const conso = calculerConsommation({
      odometre: [odo(1000, 8)],
      socs: [soc(90, 8)],
      capaciteKwh: CAPACITE,
    });
    expect(serieConsommation(conso)).toEqual([]);
  });

  it("sans capacité de batterie : aucun kWh n'existe, série vide", () => {
    const conso = calculerConsommation({
      odometre: [odo(1000, 8), odo(1100, 10)],
      socs: [soc(90, 8), soc(65, 10)],
      capaciteKwh: null,
    });
    expect(serieConsommation(conso)).toEqual([]);
  });

  it("un segment ÉCARTÉ (voiture à l'arrêt) ne laisse aucun point", () => {
    const conso = calculerConsommation({
      odometre: [odo(1000, 8), odo(1002, 20), odo(1102, 22)],
      socs: [soc(90, 8), soc(85, 20), soc(60, 22)],
      capaciteKwh: CAPACITE,
    });
    expect(conso.nbEcartes).toBe(1);
    const serie = serieConsommation(conso);
    expect(serie).toHaveLength(1);
    expect(serie[0]!.t).toEqual(H(22));
  });

  it("une RECHARGE (la charge remonte) ne laisse aucun point", () => {
    const conso = calculerConsommation({
      odometre: [odo(1000, 8), odo(1100, 10), odo(1100, 12)],
      socs: [soc(90, 8), soc(65, 10), soc(95, 12)],
      capaciteKwh: CAPACITE,
    });
    const serie = serieConsommation(conso);
    expect(serie).toHaveLength(1);
    expect(serie[0]!.t).toEqual(H(10));
  });

  it("les points sont dans l'ordre du temps", () => {
    const serie = serieConsommation({
      segments: [
        { debut: H(12), fin: H(14), km: 10, socConsomme: 2, kwh: 1, kwhPar100km: 10 },
        { debut: H(8), fin: H(10), km: 10, socConsomme: 2, kwh: 1, kwhPar100km: 20 },
      ],
    });
    expect(serie.map((p) => p.valeur)).toEqual([20, 10]);
  });
});
