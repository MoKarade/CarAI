// tests/lease.test.ts — suivi du bail (Doc 4 §3.4).
//
// C'est le calcul qui alimentera une décision financière de Marc (racheter du kilométrage,
// renégocier, rouler moins). Les tests portent donc autant sur ce que le module REFUSE
// d'affirmer que sur ce qu'il calcule.

import { describe, expect, it } from "vitest";
import { ajouterMois, calculerEtatBail, resumerBail, rythmeKmParJour } from "@/lib/vehicle/lease";

const BAIL = {
  debut: "2026-07-14",
  dureeMois: 48,
  kilometrageAutorise: 112_000,
  coutParKmExcedentaire: null,
  devise: "CAD",
};

function jour(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

describe("ajouterMois", () => {
  it("ajoute des mois simples", () => {
    expect(ajouterMois(jour("2026-07-14"), 48).toISOString().slice(0, 10)).toBe("2030-07-14");
  });

  it("gère une fin de mois qui n'existe pas dans le mois cible", () => {
    // 31 janvier + 1 mois : février n'a pas de 31. Sans ce garde, JS déborde sur mars.
    expect(ajouterMois(jour("2026-01-31"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});

describe("rythmeKmParJour", () => {
  it("mesure une pente sur plusieurs points", () => {
    const rythme = rythmeKmParJour([
      { km: 1000, mesureLe: jour("2026-07-14") },
      { km: 1500, mesureLe: jour("2026-07-24") },
      { km: 2000, mesureLe: jour("2026-08-03") },
    ]);
    expect(rythme).toBeCloseTo(50, 5);
  });

  it("utilise TOUS les points, pas seulement les extrêmes", () => {
    // Un point aberrant au milieu doit peser sur la régression. Une formule
    // (dernier − premier) / durée l'ignorerait complètement.
    const avec = rythmeKmParJour([
      { km: 0, mesureLe: jour("2026-07-01") },
      { km: 900, mesureLe: jour("2026-07-02") },
      { km: 100, mesureLe: jour("2026-07-11") },
    ]);
    const sans = rythmeKmParJour([
      { km: 0, mesureLe: jour("2026-07-01") },
      { km: 100, mesureLe: jour("2026-07-11") },
    ]);
    expect(avec).not.toBeCloseTo(sans!, 3);
  });

  it("avoue son ignorance avec moins de deux points", () => {
    expect(rythmeKmParJour([{ km: 1000, mesureLe: jour("2026-07-14") }])).toBeNull();
    expect(rythmeKmParJour([])).toBeNull();
  });

  it("refuse une pente négative plutôt que d'annoncer un odomètre qui recule", () => {
    const rythme = rythmeKmParJour([
      { km: 2000, mesureLe: jour("2026-07-14") },
      { km: 1000, mesureLe: jour("2026-07-24") },
    ]);
    expect(rythme).toBeNull();
  });

  it("rend null quand toutes les mesures tombent au même instant", () => {
    const rythme = rythmeKmParJour([
      { km: 1000, mesureLe: jour("2026-07-14") },
      { km: 1200, mesureLe: jour("2026-07-14") },
    ]);
    expect(rythme).toBeNull();
  });
});

describe("calculerEtatBail", () => {
  it("projette un dépassement au rythme observé", () => {
    // 100 km/jour sur 48 mois ≈ 146 000 km, largement au-dessus de 112 000.
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 0, mesureLe: jour("2026-07-14") },
        { km: 2200, mesureLe: jour("2026-08-05") },
      ],
      maintenant: jour("2026-08-05"),
    });

    expect(etat.rythmeKmParJour).toBeCloseTo(100, 0);
    expect(etat.projectionFinBail).toBeGreaterThan(112_000);
    expect(etat.depassementProjete).toBeGreaterThan(0);
  });

  it("NE CHIFFRE PAS le dépassement quand le tarif au km est inconnu, et le DIT", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 0, mesureLe: jour("2026-07-14") },
        { km: 2200, mesureLe: jour("2026-08-05") },
      ],
      maintenant: jour("2026-08-05"),
    });

    expect(etat.depassementProjete).toBeGreaterThan(0);
    expect(etat.coutDepassementProjete).toBeNull();
    expect(etat.limites.some((l) => l.includes("Tarif au kilomètre"))).toBe(true);
  });

  it("chiffre le dépassement dès que le tarif est connu", () => {
    const etat = calculerEtatBail({
      bail: { ...BAIL, coutParKmExcedentaire: 0.15 },
      historiqueOdometre: [
        { km: 0, mesureLe: jour("2026-07-14") },
        { km: 2200, mesureLe: jour("2026-08-05") },
      ],
      maintenant: jour("2026-08-05"),
    });

    expect(etat.coutDepassementProjete).toBeCloseTo(etat.depassementProjete! * 0.15, 5);
    expect(etat.limites.some((l) => l.includes("Tarif au kilomètre"))).toBe(false);
  });

  it("annonce une marge quand le rythme tient dans l'allocation", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 0, mesureLe: jour("2026-07-14") },
        { km: 1100, mesureLe: jour("2026-08-05") },
      ],
      maintenant: jour("2026-08-05"),
    });

    expect(etat.depassementProjete).toBeLessThan(0);
    expect(resumerBail(etat)).toContain("marge projetée");
  });

  it("sans aucun relevé : rien n'est inventé, et la limite est nommée", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [],
      maintenant: jour("2026-08-05"),
    });

    expect(etat.kilometrageActuel).toBeNull();
    expect(etat.consommePourcent).toBeNull();
    expect(etat.projectionFinBail).toBeNull();
    expect(etat.limites.some((l) => l.includes("Aucun relevé"))).toBe(true);
    expect(resumerBail(etat)).toContain("Kilométrage inconnu");
  });

  it("avec un seul relevé : le kilométrage est connu, le rythme non", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [{ km: 2200, mesureLe: jour("2026-08-05") }],
      maintenant: jour("2026-08-05"),
    });

    expect(etat.kilometrageActuel).toBe(2200);
    expect(etat.rythmeKmParJour).toBeNull();
    expect(etat.projectionFinBail).toBeNull();
    expect(etat.limites.some((l) => l.includes("Un seul relevé"))).toBe(true);
  });

  it("expose le temps écoulé, seul point de comparaison honnête du kilométrage consommé", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [{ km: 2200, mesureLe: jour("2026-08-05") }],
      maintenant: jour("2026-08-05"),
    });

    // 22 jours sur ~1461 : le bail est à peine entamé. Comparer « 2 % consommé » à
    // « 1,5 % écoulé » a du sens ; comparer 2 % à 100 % n'en aurait aucun.
    expect(etat.ecoulePourcent).toBeGreaterThan(1);
    expect(etat.ecoulePourcent).toBeLessThan(3);
    expect(etat.joursRestants).toBeGreaterThan(1400);
  });
});
