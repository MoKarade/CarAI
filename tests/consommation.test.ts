// tests/consommation.test.ts — la consommation réelle en kWh/100 km.
//
// Chiffre DÉRIVÉ de deux séries et d'une capacité : il n'est jamais mesuré directement.
// Les tests portent donc surtout sur ce qui le fausserait — une recharge comptée comme une
// consommation négative, une voiture à l'arrêt qui se décharge, un segment trop court.

import { describe, expect, it } from "vitest";
import {
  apparier,
  calculerConsommation,
  KM_MIN_SEGMENT,
  VITESSE_MIN_KMH,
} from "@/lib/vehicle/consommation";

const H = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 12, h, m, 0));
const odo = (km: number, h: number, m = 0) => ({ km, mesureLe: H(h, m) });
const soc = (pourcent: number, h: number, m = 0) => ({ t: H(h, m), pourcent });

const CAPACITE = 71.4;

describe("apparier", () => {
  it("apparie odomètre et charge sur des instants voisins", () => {
    const points = apparier([odo(100, 8), odo(150, 9)], [soc(80, 8, 2), soc(70, 9, 1)]);
    expect(points).toHaveLength(2);
    expect(points[0]!.soc).toBe(80);
    expect(points[1]!.soc).toBe(70);
  });

  // ⚠️ On n'INTERPOLE pas : un chiffre plus « complet » et moins vrai est un mauvais
  // échange sur une mesure dérivée.
  it("ÉCARTE un odomètre sans charge connue au même moment", () => {
    const points = apparier([odo(100, 8), odo(150, 15)], [soc(80, 8)]);
    expect(points).toHaveLength(1);
    expect(points[0]!.km).toBe(100);
  });
});

describe("calculerConsommation", () => {
  it("calcule les kWh/100 km sur un trajet réel", () => {
    // 100 km parcourus, 25 points de charge consommés sur 71,4 kWh ⇒ 17,85 kWh
    // ⇒ 17,85 kWh/100 km, valeur typique d'un SUV électrique.
    const conso = calculerConsommation({
      odometre: [odo(1000, 8), odo(1100, 10)],
      socs: [soc(90, 8), soc(65, 10)],
      capaciteKwh: CAPACITE,
    });

    expect(conso.kmTotal).toBe(100);
    expect(conso.kwhTotal).toBeCloseTo(17.85, 2);
    expect(conso.kwhPar100km!).toBeCloseTo(17.85, 2);
    expect(conso.nbSegments).toBe(1);
    // Autonomie théorique : 71,4 / 17,85 × 100 = 400 km.
    expect(conso.autonomieTheoriqueKm!).toBeCloseTo(400, 0);
  });

  // ⚠️ LE piège du signe : inclure une recharge fabriquerait une voiture qui produit de
  // l'énergie en roulant, et tirerait la moyenne vers le bas de façon invisible.
  it("IGNORE les segments où la charge REMONTE — une recharge n'est pas une consommation", () => {
    const conso = calculerConsommation({
      odometre: [odo(1000, 8), odo(1100, 10), odo(1100, 12)],
      socs: [soc(90, 8), soc(65, 10), soc(95, 12)], // recharge entre 10 h et 12 h
      capaciteKwh: CAPACITE,
    });
    // Seul le premier segment compte.
    expect(conso.nbSegments).toBe(1);
    expect(conso.kmTotal).toBe(100);
  });

  // ⚠️ La batterie se vide aussi À L'ARRÊT. Ne pas filtrer gonflerait la consommation
  // après chaque nuit de stationnement.
  it("ÉCARTE un segment passé à l'arrêt, et le COMPTE plutôt que de le taire", () => {
    const conso = calculerConsommation({
      odometre: [odo(1000, 8), odo(1002, 20)], // 2 km en 12 heures
      socs: [soc(90, 8), soc(85, 20)],
      capaciteKwh: CAPACITE,
    });
    expect(conso.nbSegments).toBe(0);
    expect(conso.nbEcartes).toBe(1);
    // Aucun segment exploitable ⇒ pas de chiffre, jamais un 0 qui aurait l'air d'une mesure.
    expect(conso.kwhPar100km).toBeNull();
  });

  it("le seuil de vitesse se dérive de la constante, des DEUX côtés", () => {
    // Juste au-dessus du seuil : retenu.
    const rapide = calculerConsommation({
      odometre: [odo(1000, 8), odo(1000 + (VITESSE_MIN_KMH + 2), 9)],
      socs: [soc(90, 8), soc(88, 9)],
      capaciteKwh: CAPACITE,
    });
    expect(rapide.nbSegments).toBe(1);

    // Juste en dessous : écarté.
    const lent = calculerConsommation({
      odometre: [odo(1000, 8), odo(1000 + (VITESSE_MIN_KMH - 2), 9)],
      socs: [soc(90, 8), soc(88, 9)],
      capaciteKwh: CAPACITE,
    });
    expect(lent.nbSegments).toBe(0);
    expect(lent.nbEcartes).toBe(1);
  });

  it("ignore un segment trop court — l'arrondi de l'odomètre y domine", () => {
    const conso = calculerConsommation({
      odometre: [odo(1000, 8), odo(1000 + KM_MIN_SEGMENT - 0.5, 8, 30)],
      socs: [soc(90, 8), soc(89, 8, 30)],
      capaciteKwh: CAPACITE,
    });
    expect(conso.nbSegments).toBe(0);
    // Ce n'est pas un rejet « voiture à l'arrêt » : il ne doit pas être compté comme tel.
    expect(conso.nbEcartes).toBe(0);
  });

  it("REFUSE de calculer sans capacité — aucun kWh n'existe sans elle", () => {
    const sansCapacite = calculerConsommation({
      odometre: [odo(1000, 8), odo(1100, 10)],
      socs: [soc(90, 8), soc(65, 10)],
      capaciteKwh: null,
    });
    expect(sansCapacite.kwhPar100km).toBeNull();
    expect(sansCapacite.autonomieTheoriqueKm).toBeNull();
  });

  it("sans donnée exploitable, rien n'est affirmé", () => {
    expect(
      calculerConsommation({ odometre: [], socs: [], capaciteKwh: CAPACITE }).kwhPar100km,
    ).toBeNull();
  });

  it("cumule PLUSIEURS segments plutôt que de moyenner des moyennes", () => {
    // Moyenner des moyennes donnerait le même poids à un segment de 5 km et à un de 200.
    const conso = calculerConsommation({
      odometre: [odo(0, 8), odo(200, 11), odo(210, 12)],
      socs: [soc(100, 8), soc(50, 11), soc(45, 12)],
      capaciteKwh: 100,
    });
    expect(conso.nbSegments).toBe(2);
    expect(conso.kmTotal).toBe(210);
    // 50 % + 5 % de 100 kWh = 55 kWh sur 210 km.
    expect(conso.kwhTotal).toBeCloseTo(55, 5);
    expect(conso.kwhPar100km!).toBeCloseTo((55 / 210) * 100, 5);
  });
});
