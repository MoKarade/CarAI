// tests/previsionFinDeMois.test.ts — la prévision de fin de mois (CarAI#31).
//
// Une estimation qui prolonge un rythme : ce qui la fausserait est ce qu'on teste — trop peu de
// relevés, une collecte arrêtée, un odomètre qui saute, une consommation absente, un mois qui
// finit sur un changement d'heure.

import { describe, expect, it } from "vitest";
import {
  AGE_MAX_DERNIER_RELEVE_JOURS,
  JOURS_MIN_PREVISION,
  previsionFinDeMois,
} from "@/lib/vehicle/prevision";

const JOUR = 86_400_000;
const DEMI_JOUR = JOUR / 2;
// Midi à Québec (EDT, UTC-4) le 21 septembre : fin du mois = 1er octobre 00 h, soit 9,5 jours plus tard.
const MAINTENANT = new Date("2026-09-21T16:00:00Z");
const DERNIER = new Date(MAINTENANT.getTime() - 3_600_000);

/**
 * Un relevé toutes les 12 h pendant `jours` jours, finissant au dernier relevé. `kmParJour`
 * donne le rythme du bloc de 7 jours (0 = le plus récent) auquel appartient le relevé.
 */
function releves(
  jours: number,
  kmParJour: (bloc: number) => number,
  fin: Date = DERNIER,
): Array<{ km: number; mesureLe: Date }> {
  const points: Array<{ km: number; mesureLe: Date }> = [];
  let km = 10_000;
  for (let t = fin.getTime() - jours * JOUR; t <= fin.getTime(); t += DEMI_JOUR) {
    if (points.length > 0) {
      const bloc = Math.floor((fin.getTime() - t) / (7 * JOUR));
      km += kmParJour(bloc) / 2;
    }
    points.push({ km, mesureLe: new Date(t) });
  }
  return points;
}

const prevoir = (odometre: ReturnType<typeof releves>, kwhParCentKm: number | null = 17) =>
  previsionFinDeMois({ odometre, kwhParCentKm, maintenant: MAINTENANT });

describe("previsionFinDeMois — fenêtre pleine", () => {
  it("rythme constant : fourchette réduite à un point, kWh = km × consommation", () => {
    const p = prevoir(releves(28, () => 40));
    if (!p.disponible) throw new Error(p.raison);
    expect(p.joursRestants).toBeCloseTo(9.5, 6);
    expect(p.kmCentral).toBeCloseTo(40 * 9.5, 6);
    expect(p.kmMin).toBeCloseTo(p.kmMax, 6);
    expect(p.kwhCentral).toBeCloseTo(40 * 9.5 * 0.17, 6);
    expect(p.nbBlocs).toBe(4);
    expect(p.nbRejetes).toBe(0);
  });

  it("rythme variable : bas = semaine la plus calme, haut = la plus chargée, centre = moyenne", () => {
    const rythmes = [60, 40, 20, 40]; // du bloc le plus récent au plus ancien
    const p = prevoir(releves(28, (b) => rythmes[b] ?? 0));
    if (!p.disponible) throw new Error(p.raison);
    expect(p.kmMin).toBeCloseTo(20 * 9.5, 6);
    expect(p.kmCentral).toBeCloseTo(40 * 9.5, 6);
    expect(p.kmMax).toBeCloseTo(60 * 9.5, 6);
    expect(p.kwhMin).toBeCloseTo(20 * 9.5 * 0.17, 6);
    expect(p.kwhMax).toBeCloseTo(60 * 9.5 * 0.17, 6);
    expect(p.kmMin).toBeLessThan(p.kmCentral);
    expect(p.kmCentral).toBeLessThan(p.kmMax);
  });

  it("ignore le reste de début de fenêtre qui ne fait pas un bloc de 7 jours", () => {
    // 30 jours de relevés : 4 blocs complets, les 2 premiers jours (rythme absurde) sont laissés de côté.
    const p = prevoir(releves(30, (b) => (b >= 4 ? 500 : 40)));
    if (!p.disponible) throw new Error(p.raison);
    expect(p.nbBlocs).toBe(4);
    expect(p.kmMax).toBeCloseTo(40 * 9.5, 6);
  });

  it("le mois se décide à l'heure du Québec : le 30 à 23 h 30 locales, il reste une demi-heure de mois", () => {
    // 1er octobre 03 h 30 UTC = 30 septembre 23 h 30 EDT.
    const maintenant = new Date("2026-10-01T03:30:00Z");
    const p = previsionFinDeMois({
      odometre: releves(28, () => 40, new Date(maintenant.getTime() - 3_600_000)),
      kwhParCentKm: 17,
      maintenant,
    });
    if (!p.disponible) throw new Error(p.raison);
    expect(p.joursRestants).toBeCloseTo(0.5 / 24, 6);
  });

  it("décembre : le mois suivant est janvier de l'année d'après", () => {
    const maintenant = new Date("2026-12-30T17:00:00Z"); // 12 h à Québec (EST)
    const p = previsionFinDeMois({
      odometre: releves(28, () => 40, new Date(maintenant.getTime() - 3_600_000)),
      kwhParCentKm: 17,
      maintenant,
    });
    if (!p.disponible) throw new Error(p.raison);
    expect(p.joursRestants).toBeCloseTo(1.5, 6); // 30 déc. 12 h → 1er janv. 00 h
  });
});

describe("previsionFinDeMois — elle se tait, et dit pourquoi", () => {
  it("moins de 14 jours de relevés : absente, avec la raison", () => {
    const p = prevoir(releves(JOURS_MIN_PREVISION - 1, () => 40));
    expect(p.disponible).toBe(false);
    if (!p.disponible) expect(p.raison).toMatch(/au moins 14/);
  });

  it("exactement 14 jours : disponible, deux blocs", () => {
    const p = prevoir(releves(JOURS_MIN_PREVISION, () => 40));
    if (!p.disponible) throw new Error(p.raison);
    expect(p.nbBlocs).toBe(2);
  });

  it("aucun relevé, ou un seul : absente", () => {
    expect(prevoir([]).disponible).toBe(false);
    expect(prevoir([{ km: 100, mesureLe: DERNIER }]).disponible).toBe(false);
  });

  it("dernier relevé trop ancien : la collecte s'est arrêtée, pas de « rythme actuel »", () => {
    const fin = new Date(MAINTENANT.getTime() - (AGE_MAX_DERNIER_RELEVE_JOURS + 2) * JOUR);
    const p = prevoir(releves(20, () => 40, fin));
    expect(p.disponible).toBe(false);
    if (!p.disponible) expect(p.raison).toMatch(/dernier relevé/);
  });

  it("aucune consommation mesurée (null, 0 ou négative) : pas de kWh à projeter", () => {
    for (const conso of [null, 0, -3]) {
      const p = prevoir(releves(28, () => 40), conso);
      expect(p.disponible).toBe(false);
      if (!p.disponible) expect(p.raison).toMatch(/consommation/);
    }
  });

  it("voiture immobile : absente plutôt qu'une prévision de 0 km", () => {
    const p = prevoir(releves(28, () => 0));
    expect(p.disponible).toBe(false);
    if (!p.disponible) expect(p.raison).toMatch(/aucun kilom/);
  });

  it("des relevés hors de la fenêtre de 30 jours ne comptent pas", () => {
    const vieux = releves(10, () => 400, new Date(MAINTENANT.getTime() - 50 * JOUR));
    const p = prevoir(vieux);
    expect(p.disponible).toBe(false);
  });
});

describe("previsionFinDeMois — données douteuses", () => {
  it("un saut d'odomètre impossible est écarté, compté, et ne gonfle pas la prévision", () => {
    const base = releves(28, () => 40);
    const sale = base.map((p, i) => (i === 20 ? { ...p, km: p.km + 5_000 } : p));
    const p = prevoir(sale);
    if (!p.disponible) throw new Error(p.raison);
    expect(p.nbRejetes).toBe(1);
    expect(p.kmCentral).toBeCloseTo(40 * 9.5, 6);
  });

  it("un relevé en recul est écarté seul : le retour à la normale ne passe pas pour du roulage", () => {
    const base = releves(28, () => 40);
    const sale = base.map((p, i) => (i === 20 ? { ...p, km: p.km - 300 } : p));
    const p = prevoir(sale);
    if (!p.disponible) throw new Error(p.raison);
    expect(p.nbRejetes).toBe(1);
    expect(p.kmCentral).toBeCloseTo(40 * 9.5, 6);
  });

  it("le même relevé en double n'est pas un doute", () => {
    const base = releves(28, () => 40);
    const p = prevoir([...base, base[base.length - 1]!]);
    if (!p.disponible) throw new Error(p.raison);
    expect(p.nbRejetes).toBe(0);
  });

  it("plus d'un relevé sur dix incohérent : l'odomètre n'est pas fiable, la prévision se tait", () => {
    const base = releves(28, () => 40);
    const sale = base.map((p, i) => (i % 5 === 3 ? { ...p, km: p.km - 300 } : p));
    const p = prevoir(sale);
    expect(p.disponible).toBe(false);
    if (!p.disponible) expect(p.raison).toMatch(/incohérent/);
  });

  it("des valeurs non finies sont ignorées, pas propagées", () => {
    const base = releves(28, () => 40);
    const p = prevoir([...base, { km: Number.NaN, mesureLe: DERNIER }]);
    if (!p.disponible) throw new Error(p.raison);
    expect(Number.isFinite(p.kmCentral)).toBe(true);
  });
});
