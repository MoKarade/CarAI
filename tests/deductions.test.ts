// tests/deductions.test.ts — extrapoler sans inventer.
//
// Marc, 13/08 : « je veux extrapoler […] vas beaucoup plus loin ». Ces tests portent moins
// sur les formules (une régression est une régression) que sur les REFUS : une
// extrapolation n'est utile que si elle sait se taire quand la donnée ne la porte pas.

import { describe, expect, it } from "vitest";
import { ECART_PNEU_KPA } from "@/lib/vehicle/alertes";
import {
  comparerAutonomie,
  joursAvantRecharge,
  kmParJourDeSemaine,
  projeterPneu,
  projeterSeuil,
  regresser,
  tendanceFiable,
  DUREE_MIN_JOURS,
  R2_MIN,
} from "@/lib/vehicle/deductions";

const J = (jour: number, heure = 12) => new Date(Date.UTC(2026, 7, jour, heure, 0, 0));

describe("regresser", () => {
  it("retrouve exactement une droite", () => {
    // −5 par jour, à partir de 240.
    const points = [0, 1, 2, 3, 4].map((d) => ({ t: J(1 + d), valeur: 240 - 5 * d }));
    const t = regresser(points)!;
    expect(t.penteParJour).toBeCloseTo(-5, 6);
    expect(t.r2).toBeCloseTo(1, 6);
    expect(t.dureeJours).toBeCloseTo(4, 6);
  });

  it("refuse de conclure sous trois points", () => {
    expect(regresser([])).toBeNull();
    expect(regresser([{ t: J(1), valeur: 1 }])).toBeNull();
    expect(regresser([{ t: J(1), valeur: 1 }, { t: J(2), valeur: 2 }])).toBeNull();
  });

  it("refuse quand tous les relevés sont au même instant", () => {
    const points = [1, 2, 3].map((v) => ({ t: J(1), valeur: v }));
    expect(regresser(points)).toBeNull();
  });

  // ⚠️ LE garde-fou : une droite passe par n'importe quel nuage. Sans R², on annoncerait
  // une tendance sur des mesures qui montent et descendent au hasard.
  it("un nuage SANS direction a un R² bas, et n'est donc pas fiable", () => {
    const valeurs = [240, 200, 245, 198, 250, 195];
    const points = valeurs.map((v, i) => ({ t: J(1 + i), valeur: v }));
    const t = regresser(points)!;
    expect(t.r2).toBeLessThan(R2_MIN);
    expect(tendanceFiable(t)).toBe(false);
  });

  it("une vraie pente sur une durée suffisante EST fiable", () => {
    const points = [0, 1, 2, 3, 4].map((d) => ({ t: J(1 + d), valeur: 240 - 4 * d }));
    expect(tendanceFiable(regresser(points))).toBe(true);
  });

  // Dérivé de la CONSTANTE : au premier rajustement, un test écrit en dur mentirait.
  it("une pente mesurée sur trop peu de temps n'extrapole rien", () => {
    const heures = [0, 1, 2, 3];
    const points = heures.map((h) => ({ t: J(1, 8 + h), valeur: 240 - h }));
    const t = regresser(points)!;
    expect(t.dureeJours).toBeLessThan(DUREE_MIN_JOURS);
    expect(tendanceFiable(t)).toBe(false);
  });
});

describe("projeterSeuil", () => {
  const descendante = { penteParJour: -5, ordonnee: 240, r2: 1, nbPoints: 5, dureeJours: 4 };

  it("date l'atteinte d'un seuil vers lequel on descend", () => {
    const quand = projeterSeuil(descendante, 230, 210, J(10))!;
    // 20 kPa à −5/jour = 4 jours.
    expect(quand.getTime() - J(10).getTime()).toBeCloseTo(4 * 86_400_000, -3);
  });

  it("REFUSE quand la pente s'éloigne du seuil — « jamais » n'est pas une date", () => {
    const montante = { ...descendante, penteParJour: 5 };
    expect(projeterSeuil(montante, 230, 210, J(10))).toBeNull();
  });

  it("REFUSE une pente nulle", () => {
    expect(projeterSeuil({ ...descendante, penteParJour: 0 }, 230, 210, J(10))).toBeNull();
  });

  it("un seuil déjà atteint rend l'instant courant, pas une date passée", () => {
    expect(projeterSeuil(descendante, 210, 210, J(10))).toEqual(J(10));
    expect(projeterSeuil(descendante, 200, 210, J(10))).toBeNull();
  });
});

describe("comparerAutonomie", () => {
  it("confronte l'annonce de la voiture à ce que la consommation implique", () => {
    // 50 % de 70 kWh = 35 kWh ; à 17,5 kWh/100 km ⇒ 200 km réels contre 260 annoncés.
    const c = comparerAutonomie({
      autonomieAnnonceeKm: 260,
      socPourcent: 50,
      capaciteKwh: 70,
      consommationKwhPar100km: 17.5,
    })!;
    expect(c.reelleKm).toBeCloseTo(200, 6);
    expect(c.ecartKm).toBeCloseTo(-60, 6);
    expect(c.ecartPourcent).toBeCloseTo(-23.08, 1);
  });

  it("un écart POSITIF veut dire que la voiture est pessimiste", () => {
    const c = comparerAutonomie({
      autonomieAnnonceeKm: 150,
      socPourcent: 50,
      capaciteKwh: 70,
      consommationKwhPar100km: 17.5,
    })!;
    expect(c.ecartKm).toBeGreaterThan(0);
  });

  it("REFUSE dès qu'un ingrédient manque", () => {
    const base = {
      autonomieAnnonceeKm: 260,
      socPourcent: 50,
      capaciteKwh: 70,
      consommationKwhPar100km: 17.5,
    };
    expect(comparerAutonomie({ ...base, autonomieAnnonceeKm: null })).toBeNull();
    expect(comparerAutonomie({ ...base, socPourcent: null })).toBeNull();
    expect(comparerAutonomie({ ...base, capaciteKwh: null })).toBeNull();
    expect(comparerAutonomie({ ...base, consommationKwhPar100km: null })).toBeNull();
  });

  // ⚠️ Une consommation nulle n'est pas une autonomie infinie, c'est une mesure cassée.
  it("REFUSE une consommation nulle ou négative", () => {
    const base = { autonomieAnnonceeKm: 260, socPourcent: 50, capaciteKwh: 70 };
    expect(comparerAutonomie({ ...base, consommationKwhPar100km: 0 })).toBeNull();
    expect(comparerAutonomie({ ...base, consommationKwhPar100km: -3 })).toBeNull();
  });
});

describe("joursAvantRecharge", () => {
  it("divise l'autonomie par le rythme observé", () => {
    expect(joursAvantRecharge(240, 60)).toBeCloseTo(4, 6);
  });

  it("REFUSE un rythme nul — « jamais » n'est pas une prévision", () => {
    expect(joursAvantRecharge(240, 0)).toBeNull();
    expect(joursAvantRecharge(240, null)).toBeNull();
    expect(joursAvantRecharge(null, 60)).toBeNull();
  });
});

describe("kmParJourDeSemaine", () => {
  const odo = (jour: number, heure: number, km: number) => ({ km, mesureLe: J(jour, heure) });

  it("attribue les kilomètres au bon jour de semaine", () => {
    // Le 2026-08-03 est un lundi.
    const km = kmParJourDeSemaine([
      odo(3, 8, 1000),
      odo(3, 20, 1060), // lundi : 60 km
      odo(4, 8, 1060),
      odo(4, 20, 1080), // mardi : 20 km
    ]);
    expect(km[0]!.libelle).toBe("lundi");
    expect(km[0]!.totalKm).toBeCloseTo(60, 6);
    expect(km[1]!.totalKm).toBeCloseTo(20, 6);
  });

  it("rend les sept jours, même ceux sans aucun relevé", () => {
    const km = kmParJourDeSemaine([odo(3, 8, 1000), odo(3, 20, 1060)]);
    expect(km).toHaveLength(7);
    expect(km[6]!.libelle).toBe("dimanche");
    expect(km[6]!.totalKm).toBe(0);
    expect(km[6]!.moyenneKm).toBe(0);
  });

  // ⚠️ La moyenne divise par les journées OBSERVÉES : sur dix jours il y a deux lundis et
  // un seul mercredi, et diviser tout par le même chiffre inventerait un creux.
  it("moyenne sur le nombre de journées RÉELLEMENT observées", () => {
    const km = kmParJourDeSemaine([
      odo(3, 8, 1000),
      odo(3, 20, 1100), // lundi 1 : 100 km
      odo(10, 8, 1200),
      odo(10, 20, 1240), // lundi 2 : 40 km
    ]);
    expect(km[0]!.nbJours).toBe(2);
    expect(km[0]!.totalKm).toBeCloseTo(140, 6);
    expect(km[0]!.moyenneKm).toBeCloseTo(70, 6);
  });

  it("un compteur qui recule ne produit pas de kilomètres négatifs", () => {
    const km = kmParJourDeSemaine([odo(3, 8, 1100), odo(3, 20, 1000)]);
    expect(km[0]!.totalKm).toBeGreaterThanOrEqual(0);
  });

  it("aucun relevé : sept jours à zéro, aucune division par zéro", () => {
    const km = kmParJourDeSemaine([]);
    expect(km).toHaveLength(7);
    expect(km.every((j) => j.totalKm === 0 && j.moyenneKm === 0)).toBe(true);
  });
});

describe("projeterPneu", () => {
  const serieDescendante = [0, 1, 2, 3, 4, 5].map((d) => ({
    t: J(1 + d),
    valeur: 240 - 6 * d,
  }));

  it("annonce la perte hebdomadaire et la date du seuil d'alerte", () => {
    // Pression ENCORE au-dessus du seuil (240 − 20 = 220) : il reste une date à annoncer.
    const p = projeterPneu({
      libelle: "arrière gauche",
      serie: serieDescendante,
      pressionActuelleKpa: 235,
      medianeAutresKpa: 240,
      maintenant: J(7),
    })!;
    expect(p.perteParSemaineKpa).toBeCloseTo(42, 5); // 6/jour × 7
    // 15 kPa à parcourir à 6 kPa/jour = 2,5 jours.
    expect(p.seuilAtteintLe!.getTime() - J(7).getTime()).toBeCloseTo(2.5 * 86_400_000, -4);

    // Et une roue DÉJÀ sous le seuil n'a plus de date à annoncer : c'est maintenant.
    const passe = projeterPneu({
      libelle: "arrière gauche",
      serie: serieDescendante,
      pressionActuelleKpa: 210,
      medianeAutresKpa: 240,
      maintenant: J(7),
    })!;
    expect(passe.seuilAtteintLe).toBeNull();
  });

  // Le seuil visé est celui des ALERTES, pas un chiffre constructeur qu'on n'a pas.
  it("le seuil se dérive de ECART_PNEU_KPA sous la médiane des autres", () => {
    const p = projeterPneu({
      libelle: "arrière gauche",
      serie: serieDescendante,
      // Pile AU seuil : la date projetée doit être MAINTENANT.
      pressionActuelleKpa: 240 - ECART_PNEU_KPA,
      medianeAutresKpa: 240,
      maintenant: J(7),
    })!;
    expect(p.seuilAtteintLe).toEqual(J(7));
  });

  it("REFUSE une tendance qui monte — rien à annoncer", () => {
    const monte = [0, 1, 2, 3].map((d) => ({ t: J(1 + d), valeur: 230 + 2 * d }));
    expect(
      projeterPneu({
        libelle: "avant droite",
        serie: monte,
        pressionActuelleKpa: 236,
        medianeAutresKpa: 238,
        maintenant: J(5),
      }),
    ).toBeNull();
  });

  // ⚠️ Sans ce refus, on daterait « à plat le 3 septembre » à partir de bruit.
  it("REFUSE un nuage sans direction", () => {
    const bruit = [240, 200, 245, 198, 250].map((v, i) => ({ t: J(1 + i), valeur: v }));
    expect(
      projeterPneu({
        libelle: "avant gauche",
        serie: bruit,
        pressionActuelleKpa: 220,
        medianeAutresKpa: 240,
        maintenant: J(6),
      }),
    ).toBeNull();
  });

  it("REFUSE une série trop courte", () => {
    expect(
      projeterPneu({
        libelle: "avant gauche",
        serie: [{ t: J(1), valeur: 240 }, { t: J(2), valeur: 230 }],
        pressionActuelleKpa: 230,
        medianeAutresKpa: 240,
        maintenant: J(3),
      }),
    ).toBeNull();
  });
});
