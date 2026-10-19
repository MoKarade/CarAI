// tests/graphesPlausibles.test.ts — un graphique ne doit pas tracer l'impossible.
//
// Captures de Marc, 19/08/2026 :
//   • « Odomètre — 590 mesures », min 2 800 km, MAX 78 432 km, échelle jusqu'à 84 000, deux
//     pics verticaux. La voiture affiche 4 500 km. Ce sont les relevés du véhicule SIMULÉ.
//   • « Pression des quatre pneus — 32 kPa à 296 kPa », avec un plancher annoncé à 11 kPa.
//     Un pneu à 11 kPa n'existe pas sur une voiture qui roule.
//
// J'avais posé la règle de l'odomètre dans `historiqueOdometre` — donc sur le graphique du
// BAIL uniquement. L'onglet Tendances lit `serieNumerique`, une AUTRE voie, et continuait
// d'afficher les pics. Corriger une voie de lecture ne corrige pas les autres.

import { describe, expect, it } from "vitest";
import { filtrerPlausible, pressionImpossible, PRESSION_PLANCHER_KPA } from "@/lib/vehicle/analyse";

const pt = (jour: number, valeur: number) => ({
  t: new Date(Date.UTC(2026, 7, jour)),
  valeur,
});

describe("filtrerPlausible — odomètre", () => {
  it("retire les pics du véhicule simulé", () => {
    // Reproduit la capture : deux pics à 78 432 au milieu de valeurs réelles.
    const serie = [pt(6, 2800), pt(7, 78432), pt(8, 3100), pt(13, 78432), pt(19, 4500)];
    expect(filtrerPlausible("odometer", serie).map((p) => p.valeur)).toEqual([
      2800, 3100, 4500,
    ]);
  });

  it("ne touche pas une série d'odomètre saine", () => {
    const serie = [pt(6, 2800), pt(8, 3100), pt(19, 4500)];
    expect(filtrerPlausible("odometer", serie)).toHaveLength(3);
  });

  it("laisse les AUTRES métriques intactes — un SOC redescend, c'est normal", () => {
    // Une garde de monotonie appliquée à tort ferait disparaître toute décharge de batterie.
    const soc = [pt(6, 100), pt(7, 40), pt(8, 90)];
    expect(filtrerPlausible("battery_soc", soc)).toHaveLength(3);
    expect(filtrerPlausible("battery_range", soc)).toHaveLength(3);
  });

  it("supporte une série vide", () => {
    expect(filtrerPlausible("odometer", [])).toEqual([]);
  });
});

describe("pressionImpossible — au TRACÉ, pas seulement à la purge", () => {
  const roues = (...kpa: number[]) =>
    kpa.map((tirePressure, i) => ({ row: i < 2 ? 0 : 1, column: i % 2, tirePressure }));

  it("écarte le relevé à 11 kPa et celui à 32 kPa des captures", () => {
    expect(pressionImpossible(roues(11, 11, 11, 11))).toBe(true);
    expect(pressionImpossible(roues(32, 32, 32, 32))).toBe(true);
  });

  it("GARDE un seul pneu bas — c'est une crevaison, pas une erreur", () => {
    // L'invariant le plus important : effacer ça reviendrait à masquer un vrai incident.
    expect(pressionImpossible(roues(32, 269, 262, 269))).toBe(false);
  });

  it("garde les pressions réelles de la bZ", () => {
    expect(pressionImpossible(roues(269, 269, 262, 262))).toBe(false);
    expect(pressionImpossible(roues(276, 269, 269, 269))).toBe(false);
  });

  it("le plancher reste loin sous un pneu roulable", () => {
    expect(PRESSION_PLANCHER_KPA).toBeLessThan(100);
  });
});
