// tests/odometreMonotone.test.ts — un odomètre ne recule pas, donc la courbe du bail non plus.
//
// CAS RÉEL, 19/08/2026. Marc envoie une capture du graphique « Kilométrage vs bail » : un pic
// bleu occupant les deux tiers de la hauteur, collé à gauche, à côté d'un compteur annoncé à
// 4 500 km. La base contient encore des relevés du VÉHICULE SIMULÉ de Smartcar, entrés avant
// que la garde `simulee` n'existe — dont un à 78 432 km. Sur une échelle de bail montant à
// 117 600 km, 78 432 fait exactement 67 % de la hauteur : le pic.
//
// Le graphique n'était pas cassé. Il était fidèle à une donnée fausse — ce qui est pire,
// parce que ça ne ressemble à aucune erreur connue.

import { describe, expect, it } from "vitest";
import { filtrerOdometreMonotone } from "@/lib/vehicle/history";

const j = (jour: number, km: number) => ({
  km,
  mesureLe: new Date(Date.UTC(2026, 6, jour)),
});

describe("filtrerOdometreMonotone", () => {
  it("retire le relevé du véhicule SIMULÉ — le cas de la capture", () => {
    const points = [j(14, 120), j(15, 78_432), j(16, 300), j(17, 4_500)];
    expect(filtrerOdometreMonotone(points).map((p) => p.km)).toEqual([120, 300, 4_500]);
  });

  it("ne touche à rien quand la série est déjà croissante", () => {
    const points = [j(14, 120), j(15, 300), j(16, 4_500)];
    expect(filtrerOdometreMonotone(points)).toHaveLength(3);
  });

  it("tolère plusieurs aberrations d'affilée", () => {
    const points = [j(14, 120), j(15, 78_432), j(16, 66_000), j(17, 300)];
    expect(filtrerOdometreMonotone(points).map((p) => p.km)).toEqual([120, 300]);
  });

  it("garde un palier : deux relevés identiques ne sont pas un recul", () => {
    // Voiture immobile pendant deux jours : le compteur ne bouge pas. Retirer le premier
    // effacerait la preuve que la voiture n'a pas roulé.
    const points = [j(14, 4_500), j(15, 4_500), j(16, 4_600)];
    expect(filtrerOdometreMonotone(points)).toHaveLength(3);
  });

  it("CONSERVE une aberration qui serait le DERNIER relevé", () => {
    // Règle volontairement conservatrice : on ne retire un point que si un relevé PLUS TARD
    // le contredit. Sans point postérieur, on ne peut pas savoir — et inventer une borne
    // haute reviendrait à décider à la place de la voiture.
    const points = [j(14, 120), j(15, 300), j(16, 78_432)];
    expect(filtrerOdometreMonotone(points)).toHaveLength(3);
  });

  it("trie par date avant de juger", () => {
    const points = [j(17, 4_500), j(14, 120), j(15, 78_432), j(16, 300)];
    expect(filtrerOdometreMonotone(points).map((p) => p.km)).toEqual([120, 300, 4_500]);
  });

  it("supporte une série vide ou à un seul point", () => {
    expect(filtrerOdometreMonotone([])).toEqual([]);
    expect(filtrerOdometreMonotone([j(14, 4_500)])).toHaveLength(1);
  });
});
