// tests/coutParKm.test.ts — « ça me coûte combien du 100 km ? » (Marc, 15/09).
//
// Les chiffres de ce fichier sont FICTIFS mais reproduisent la forme d'un cas observé le
// 15/09 : 20 $ mesurés, 30 $ estimés, 182,5 kWh observés, odomètre à 5 000 km. C'est ce
// genre de jeu qui a montré les deux pièges que le module existe pour fermer.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  COUVERTURE_SUFFISANTE,
  consommationReference,
  coutParCentKm,
} from "../lib/vehicle/coutParKm";
import { rechargesParMois, type PrixSession } from "../lib/vehicle/tarifsBornes";
import { kmDepuis, kmEntre } from "../lib/vehicle/bilan";

const mesure = (montant: number): PrixSession => ({
  montant,
  qualite: "mesure",
  explication: "test",
});
const estime = (montant: number): PrixSession => ({
  montant,
  qualite: "estime",
  explication: "test",
});
const inconnu: PrixSession = { montant: null, qualite: "inconnu", explication: "test" };

describe("la consommation de référence se DÉRIVE du véhicule", () => {
  it("tient compte de l'état de charge, pas seulement de l'autonomie", () => {
    // bZ : 71 kWh nominaux, batterie à 64 %, 312 km annoncés.
    const conso = consommationReference({
      capaciteKwh: 71,
      autonomieKm: 312,
      socPourcent: 64,
    });
    expect(conso).not.toBeNull();
    expect(conso!).toBeCloseTo(14.6, 1);
    // ⚠️ LE POINT DE CE TEST. L'autonomie annoncée correspond à la charge COURANTE : en
    // l'ignorant on obtiendrait 22,8 kWh/100 km — une consommation d'un facteur 1,6 trop
    // haute, donc une couverture 1,6 fois trop BASSE, donc un avertissement permanent.
    expect((71 / 312) * 100).toBeCloseTo(22.8, 1);
  });

  it("rend null dès qu'un terme manque — jamais une valeur inventée", () => {
    const socles = { capaciteKwh: 71, autonomieKm: 312, socPourcent: 64 };
    expect(consommationReference({ ...socles, capaciteKwh: null })).toBeNull();
    expect(consommationReference({ ...socles, autonomieKm: null })).toBeNull();
    expect(consommationReference({ ...socles, socPourcent: null })).toBeNull();
    // Une batterie à 0 % n'explique aucun kilomètre ; 120 % n'existe pas.
    expect(consommationReference({ ...socles, socPourcent: 0 })).toBeNull();
    expect(consommationReference({ ...socles, socPourcent: 120 })).toBeNull();
    expect(consommationReference({ ...socles, autonomieKm: 0 })).toBeNull();
  });
});

describe("le coût aux 100 km", () => {
  it("rend null sans kilomètres — une division sans dénominateur ne vaut pas zéro", () => {
    // ⚠️ « 0 $/100 km » se lirait « rouler ne me coûte rien ». L'absence se dit.
    expect(
      coutParCentKm({
        totaux: { mesure: 10, estime: 0 },
        kmParcourus: 0,
        kwhObserve: 50,
        consoReferenceKwhParCentKm: 15,
      }),
    ).toBeNull();
  });

  it("rend null sans montant exploitable", () => {
    expect(
      coutParCentKm({
        totaux: { mesure: 0, estime: 0 },
        kmParcourus: 500,
        kwhObserve: 80,
        consoReferenceKwhParCentKm: 15,
      }),
    ).toBeNull();
  });

  it("sépare le plancher mesuré du haut de la fourchette", () => {
    const r = coutParCentKm({
      totaux: { mesure: 20, estime: 30 },
      kmParcourus: 1000,
      kwhObserve: 150,
      consoReferenceKwhParCentKm: 15,
    });
    expect(r).not.toBeNull();
    expect(r!.mesureParCentKm).toBeCloseTo(2, 5); // 20 $ / 10 centaines de km
    expect(r!.totalParCentKm).toBeCloseTo(5, 5); // 50 $ / 10
    expect(r!.partEstimee).toBeCloseTo(0.6, 5);
    // 150 kWh observés pour 150 attendus (15 × 10) : tout s'explique.
    expect(r!.couverture).toBeCloseTo(1, 5);
  });

  it("CHIFFRE le trou de l'historique au lieu de le taire (jeu fictif)", () => {
    // ⚠️ LE PIÈGE QUE CE MODULE EXISTE POUR FERMER. 182,5 kWh observés ne peuvent pas avoir
    // fait 5 000 km : il en faudrait ~730. Le coût obtenu est donc un PLANCHER, et la
    // couverture le dit — au lieu d'un « 1 $/100 km » quatre fois trop bas et crédible.
    const r = coutParCentKm({
      totaux: { mesure: 20, estime: 30 },
      kmParcourus: 5000,
      kwhObserve: 182.5,
      consoReferenceKwhParCentKm: 14.6,
    });
    expect(r).not.toBeNull();
    expect(r!.couverture!).toBeCloseTo(0.25, 2);
    expect(r!.couverture!).toBeLessThan(COUVERTURE_SUFFISANTE);
    expect(r!.totalParCentKm).toBeCloseTo(1, 2);
  });

  it("une couverture inconnue reste null, jamais « tout va bien »", () => {
    const r = coutParCentKm({
      totaux: { mesure: 10, estime: 0 },
      kmParcourus: 100,
      kwhObserve: 15,
      consoReferenceKwhParCentKm: null,
    });
    expect(r!.couverture).toBeNull();
  });
});

describe("la tendance par mois", () => {
  it("regroupe, sépare le mesuré de l'estimé, et compte les inconnus", () => {
    const mois = rechargesParMois([
      { debut: new Date("2026-08-14T16:00:00Z"), energieKwh: 10, prix: mesure(2) },
      { debut: new Date("2026-08-20T16:00:00Z"), energieKwh: 5, prix: estime(3) },
      { debut: new Date("2026-09-13T16:00:00Z"), energieKwh: 46.7, prix: mesure(1) },
      { debut: new Date("2026-09-14T16:00:00Z"), energieKwh: 2, prix: inconnu },
    ]);
    expect(mois.map((m) => m.cle)).toEqual(["2026-08", "2026-09"]);
    expect(mois[0]!.mesure).toBe(2);
    expect(mois[0]!.estime).toBe(3);
    expect(mois[0]!.kwh).toBe(15);
    expect(mois[1]!.nbSessions).toBe(2);
    expect(mois[1]!.nbInconnus).toBe(1);
    // Un prix inconnu ne compte NI en mesuré NI en estimé : il se compte à part.
    expect(mois[1]!.mesure).toBe(1);
    expect(mois[1]!.estime).toBe(0);
  });

  it("⚠️ LE MOIS SE DÉCIDE DANS LE FUSEAU DE MARC, pas en UTC", () => {
    // 31 août, 21 h à Montréal = 1ᵉʳ septembre 01 h UTC. Comptée en UTC, cette recharge
    // ouvrirait septembre sur une session qu'il a vécue en août.
    const mois = rechargesParMois([
      { debut: new Date("2026-09-01T01:00:00Z"), energieKwh: 8, prix: mesure(1) },
    ]);
    expect(mois).toHaveLength(1);
    expect(mois[0]!.cle).toBe("2026-08");
    // Contre-épreuve : le même instant lu en UTC donnerait septembre.
    expect(new Date("2026-09-01T01:00:00Z").toISOString().slice(0, 7)).toBe("2026-09");
  });

  it("un mois sans recharge n'existe pas — zéro se lirait « rien dépensé »", () => {
    const mois = rechargesParMois([
      { debut: new Date("2026-07-15T16:00:00Z"), energieKwh: 8, prix: mesure(1) },
      { debut: new Date("2026-09-15T16:00:00Z"), energieKwh: 8, prix: mesure(1) },
    ]);
    // Août est ABSENT : on n'a rien observé, ce qui n'est pas « rien dépensé ».
    expect(mois.map((m) => m.cle)).toEqual(["2026-07", "2026-09"]);
  });

  it("rien à agréger rend une liste vide, pas une ligne à zéro", () => {
    expect(rechargesParMois([])).toEqual([]);
  });
});

describe("les kilomètres d'une FENÊTRE, pas depuis toujours", () => {
  const odo = [
    { km: 1000, mesureLe: new Date("2026-08-01T12:00:00Z") },
    { km: 1200, mesureLe: new Date("2026-08-10T12:00:00Z") },
    { km: 1500, mesureLe: new Date("2026-08-20T12:00:00Z") },
    { km: 2000, mesureLe: new Date("2026-09-01T12:00:00Z") },
  ];

  it("mesure entre les deux bornes, pas jusqu'à aujourd'hui", () => {
    expect(
      kmEntre(odo, new Date("2026-08-05T00:00:00Z"), new Date("2026-08-25T00:00:00Z")),
    ).toBe(500); // 1500 − 1000 (dernier relevé AVANT le 5 août)
    // ⚠️ La contre-épreuve : `kmDepuis` irait jusqu'au dernier relevé connu, 2 000 km.
    expect(kmDepuis(odo, new Date("2026-08-05T00:00:00Z"))).toBe(1000);
  });

  it("sans point de départ connu, null — jamais zéro", () => {
    // Avant le tout premier relevé, on ne sait pas ce qui a été parcouru.
    expect(
      kmEntre(odo, new Date("2026-07-01T00:00:00Z"), new Date("2026-08-05T00:00:00Z")),
    ).toBeNull();
    expect(kmEntre([], new Date("2026-08-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z"))).toBeNull();
  });

  it("une fenêtre sans relevé rend zéro : le compteur n'a pas bougé", () => {
    expect(
      kmEntre(odo, new Date("2026-08-11T00:00:00Z"), new Date("2026-08-19T00:00:00Z")),
    ).toBe(0);
  });

  it("des bornes inversées rendent null plutôt qu'un négatif", () => {
    expect(
      kmEntre(odo, new Date("2026-09-01T00:00:00Z"), new Date("2026-08-01T00:00:00Z")),
    ).toBeNull();
  });
});

describe("l'écran mesure bien les DEUX grandeurs sur la même fenêtre", () => {
  // ⚠️ LE PIÈGE N° 1 SE GARDE À SON POINT D'USAGE, pas seulement dans la fonction pure.
  // `kmEntre` peut être parfaitement testée pendant qu'Activité appelle `kmDepuis` : le
  // coût serait alors calculé sur tous les kilomètres du bail contre les seules recharges
  // observées — quatre fois trop bas, et vert de partout.
  const source = readFileSync("app/activite/page.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("le coût aux 100 km part de `kmEntre`, jamais de `kmDepuis`", () => {
    expect(source, "le recenseur ne trouve plus le calcul du coût").toContain("coutParCentKm({");
    expect(source).toContain("kmEntre(odo,");
    expect(source, "`kmDepuis` mesure jusqu'à MAINTENANT : il déborde la fenêtre").not.toContain(
      "kmDepuis(",
    );
  });

  it("la couverture vient du véhicule, pas d'une consommation écrite en dur", () => {
    expect(source).toContain("consommationReference({");
    expect(source).toContain('derniereNumerique("battery_range")');
    expect(source).toContain('derniereNumerique("battery_soc")');
  });
});
