// tests/etatSchema.test.ts — l'état du véhicule que le schéma peint.
//
// Ce fichier existe parce que cette construction est passée d'INLINE (dans l'onglet
// Analyse) à PARTAGÉE (Analyse + Accueil, Marc 13/08). Deux pages en dépendent : une
// divergence n'y serait plus visible à la lecture d'un seul écran.

import { describe, expect, it } from "vitest";
import { construireEtatSchema, lireVerrouillage } from "@/lib/vehicle/etatSchema";
import type { EtatVehicule, MesureQualifiee } from "@/lib/vehicle/state";

const T = (h: number) => new Date(Date.UTC(2026, 7, 13, h, 0, 0));
const MAINTENANT = T(18);

function mesure(partiel: Partial<MesureQualifiee> & { metricType: string }): MesureQualifiee {
  return {
    metricType: partiel.metricType,
    source: "smartcar",
    recordedAt: partiel.recordedAt ?? T(17),
    valueNumeric: partiel.valueNumeric ?? null,
    valueText: partiel.valueText ?? null,
    valueJson: partiel.valueJson ?? null,
    unit: partiel.unit ?? null,
  } as MesureQualifiee;
}

function etatAvec(mesures: MesureQualifiee[], fraicheurMax: Date | null = T(17)): EtatVehicule {
  return { mesures, fraicheurMax, vide: mesures.length === 0 } as EtatVehicule;
}

// Forme RÉELLE publiée par Smartcar : `{ values: [{ row, column, tirePressure }] }`.
// `row` 0 = avant, 1 = arrière ; `column` 0 = gauche, 1 = droite.
const QUATRE_ROUES = {
  values: [
    { row: 0, column: 0, tirePressure: 240 },
    { row: 0, column: 1, tirePressure: 238 },
    { row: 1, column: 0, tirePressure: 241 },
    { row: 1, column: 1, tirePressure: 239 },
  ],
};

describe("lireVerrouillage", () => {
  it("comprend les graphies de la source, dans les deux sens", () => {
    for (const vrai of ["true", "TRUE", " locked ", "1", "yes", "oui"]) {
      expect(lireVerrouillage(vrai)).toBe(true);
    }
    for (const faux of ["false", "UNLOCKED", "0", "no", "non"]) {
      expect(lireVerrouillage(faux)).toBe(false);
    }
  });

  // ⚠️ LE point de ce helper. Un état inconnu ne doit JAMAIS retomber sur « verrouillée » :
  // le schéma afficherait un cadenas rassurant sur une voiture dont on ne sait rien.
  it("rend null sur ce qu'elle ne sait pas trancher — jamais un défaut rassurant", () => {
    for (const inconnu of [null, undefined, "", "   ", "peut-être", "partial"]) {
      expect(lireVerrouillage(inconnu)).toBeNull();
    }
  });
});

describe("construireEtatSchema", () => {
  it("porte la DERNIÈRE pression connue, même ancienne", () => {
    // Relevé d'il y a des jours : c'est quand même celui qu'on affiche — « la dernière
    // dispo » (Marc, 13/08). Son ÂGE se lit à côté, il ne se devine pas.
    const vieux = new Date(Date.UTC(2026, 7, 9, 6, 0, 0));
    const schema = construireEtatSchema({
      etat: etatAvec([
        mesure({ metricType: "tire_pressure", valueJson: QUATRE_ROUES, unit: "kPa", recordedAt: vieux }),
      ]),
      seriesRoues: [],
      uniteRoues: null,
      maintenant: MAINTENANT,
    });
    expect(schema.pneus).toHaveLength(4);
    expect(schema.mesureLe).toEqual(vieux);
    expect(schema.unitePression).toBe("kPa");
  });

  it("sans relevé de pression, ne fabrique aucun pneu", () => {
    const schema = construireEtatSchema({
      etat: etatAvec([mesure({ metricType: "battery_soc", valueNumeric: 62 })]),
      seriesRoues: [],
      uniteRoues: null,
      maintenant: MAINTENANT,
    });
    // Zéro pneu, PAS quatre pneus « ok » : sur un schéma, l'absence d'alerte se lit
    // « tout va bien ».
    expect(schema.pneus).toEqual([]);
    expect(schema.verrouillee).toBeNull();
  });

  it("retombe sur la fraîcheur du véhicule quand les pneus ne disent rien", () => {
    const schema = construireEtatSchema({
      etat: etatAvec([mesure({ metricType: "battery_soc", valueNumeric: 62 })], T(15)),
      seriesRoues: [],
      uniteRoues: null,
      maintenant: MAINTENANT,
    });
    expect(schema.mesureLe).toEqual(T(15));
  });

  it("lit le verrouillage sans jamais l'inventer", () => {
    const avec = (texte: string | null) =>
      construireEtatSchema({
        etat: etatAvec([mesure({ metricType: "lock_status", valueText: texte })]),
        seriesRoues: [],
        uniteRoues: null,
        maintenant: MAINTENANT,
      }).verrouillee;

    expect(avec("true")).toBe(true);
    expect(avec("false")).toBe(false);
    expect(avec(null)).toBeNull();
  });

  // L'unité vient du relevé ; à défaut, de la série. Jamais supposée.
  it("prend l'unité du relevé, sinon celle de la série, sinon rien", () => {
    const base = {
      seriesRoues: [],
      maintenant: MAINTENANT,
    };
    const duReleve = construireEtatSchema({
      ...base,
      etat: etatAvec([mesure({ metricType: "tire_pressure", valueJson: QUATRE_ROUES, unit: "kPa" })]),
      uniteRoues: "kPa",
    });
    expect(duReleve.unitePression).toBe("kPa");

    const deLaSerie = construireEtatSchema({
      ...base,
      etat: etatAvec([mesure({ metricType: "tire_pressure", valueJson: QUATRE_ROUES, unit: null })]),
      uniteRoues: "kPa",
    });
    expect(deLaSerie.unitePression).toBe("kPa");

    const rien = construireEtatSchema({
      ...base,
      etat: etatAvec([mesure({ metricType: "battery_soc", valueNumeric: 62 })]),
      uniteRoues: null,
    });
    expect(rien.unitePression).toBeNull();
  });
});
