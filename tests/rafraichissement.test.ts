// tests/rafraichissement.test.ts — la contre-pression du bouton « Rafraîchir maintenant ».
//
// Deux moitiés, et la seconde est celle qui compte :
//   1. `deciderRafraichissement` est PURE — elle dit si le bouton peut tirer, et combien de
//      secondes il reste sinon.
//   2. `reserverRafraichissement` est ATOMIQUE, et ça ne se prouve QUE contre un vrai
//      Postgres. PGlite + les migrations réelles, comme `tests/inventaire.test.ts`.
//
// ⚠️ Le test qui vaut est celui de la COURSE : deux réservations lancées ENSEMBLE
// (`Promise.all`). Deux appels en séquence passent avec l'implémentation naïve
// « lire, comparer, écrire » — c'est précisément ce que la leçon JobAI dit de ne pas croire.

import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { appConfig } from "@/lib/db/schema";
import {
  CLE_RAFRAICHIR,
  PLANCHER_RAFRAICHIR_MS,
  deciderRafraichissement,
  dernierRafraichissement,
  reserverRafraichissement,
} from "@/lib/vehicle/rafraichissement";
import { baseDeTest } from "./aides/basePGlite";

// Le cast est le prix d'un test SANS mock sur le vrai schéma : les fonctions sous test sont
// typées sur le pilote Neon de la production, dont PGlite expose la surface Drizzle.
type Dbx = NonNullable<NonNullable<Parameters<typeof reserverRafraichissement>[0]>["dbx"]>;
const { base: dbTest } = baseDeTest([appConfig]);
const dbx = dbTest as unknown as Dbx;

const T = (ms: number) => new Date(Date.UTC(2026, 8, 18, 12, 0, 0) + ms);

describe("deciderRafraichissement — PURE", () => {
  it("autorise quand le bouton n'a jamais servi", () => {
    expect(deciderRafraichissement({ dernier: null, maintenant: T(0) })).toEqual({
      autorise: true,
    });
  });

  it("refuse dans le plancher, et DIT combien de secondes il reste", () => {
    const d = deciderRafraichissement({ dernier: T(0), maintenant: T(20_000) });
    expect(d).toEqual({ autorise: false, resteSecondes: 40 });
  });

  it("autorise PILE au plancher — la borne est inclusive du bon côté", () => {
    // Dérivé de la constante, pas de sa valeur du jour : un réglage ne doit pas casser ça.
    expect(
      deciderRafraichissement({ dernier: T(0), maintenant: T(PLANCHER_RAFRAICHIR_MS) }),
    ).toEqual({ autorise: true });
    expect(
      deciderRafraichissement({ dernier: T(0), maintenant: T(PLANCHER_RAFRAICHIR_MS - 1) })
        .autorise,
    ).toBe(false);
  });

  it("une date INVALIDE refuse plutôt que d'ouvrir la porte", () => {
    // Le sens sûr de l'erreur est le refus : une horloge cassée ne doit pas devenir un
    // laissez-passer permanent vers Smartcar.
    const d = deciderRafraichissement({ dernier: new Date(NaN), maintenant: T(0) });
    expect(d.autorise).toBe(false);
  });
});

describe("reserverRafraichissement — l'unicité vit dans l'ÉCRITURE", () => {
  it("la première réservation passe, la seconde est refusée", async () => {
    expect(await reserverRafraichissement({ dbx, maintenant: T(0) })).toBe(true);
    expect(await reserverRafraichissement({ dbx, maintenant: T(1_000) })).toBe(false);
  });

  it("⚠️ DEUX réservations SIMULTANÉES : une seule gagne", async () => {
    // LE test. Avec « lire, comparer, écrire », les deux lisent une table vide et gagnent
    // toutes les deux — et le plancher ne protège plus rien.
    const [a, b] = await Promise.all([
      reserverRafraichissement({ dbx, maintenant: T(0) }),
      reserverRafraichissement({ dbx, maintenant: T(0) }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("rouvre une fois le plancher écoulé", async () => {
    expect(await reserverRafraichissement({ dbx, maintenant: T(0) })).toBe(true);
    expect(
      await reserverRafraichissement({ dbx, maintenant: T(PLANCHER_RAFRAICHIR_MS + 1) }),
    ).toBe(true);
  });

  it("inscrit l'horodatage lisible par `dernierRafraichissement`", async () => {
    await reserverRafraichissement({ dbx, maintenant: T(0) });
    const quand = await dernierRafraichissement(dbx);
    expect(quand).not.toBeNull();
    expect(quand!.getTime()).toBe(T(0).getTime());
  });

  it("aucune réservation ⇒ `null`, jamais une date inventée", async () => {
    expect(await dernierRafraichissement(dbx)).toBeNull();
  });

  it("n'écrit que SA clé — la config du véhicule n'est jamais touchée", async () => {
    await dbTest.execute(
      sql`INSERT INTO app_config (key, value) VALUES ('smartcar.vehicleId', '"abc"'::jsonb)`,
    );
    await reserverRafraichissement({ dbx, maintenant: T(0) });
    const lignes = await dbTest.execute(
      sql`SELECT key FROM app_config ORDER BY key`,
    );
    const cles = (lignes.rows as { key: string }[]).map((r) => r.key);
    expect(cles).toEqual([CLE_RAFRAICHIR, "smartcar.vehicleId"].sort());
  });
});
