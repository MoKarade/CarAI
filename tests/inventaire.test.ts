// tests/inventaire.test.ts — inventaire et rétention, sur le VRAI schéma.
//
// PGlite (Postgres compilé en WASM) + les migrations RÉELLES du dossier drizzle/ : ce que
// ces tests exercent est le schéma que la production applique, index uniques compris. Pas
// de mock — c'est l'exigence « au moins un test d'intégration par feature » de l'écosystème.
//
// Deux propriétés s'y verrouillent :
//   1. L'inventaire agrège fidèlement ce que la base contient (comptes, bornes de dates).
//   2. La purge du raw VIDE le payload de transport hors fenêtre SANS toucher ni aux
//      lignes de livraison (surveillance du silence) ni aux mesures (conservées à vie).

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { vehicleSnapshots, webhookDeliveries } from "@/lib/db/schema";
import {
  bilanCouverture,
  inventaireMesures,
  journalLivraisons,
  type LigneInventaire,
} from "@/lib/vehicle/inventaire";
import { purgerRawWebhooks, retentionRawJours } from "@/lib/smartcar/ingest";
import { SIGNAUX_CONFIRMES_BZ } from "@/lib/smartcar/signals";

const client = new PGlite();
const dbTest = drizzle(client);

// Les fonctions sous test sont typées sur le pilote Neon de la prod ; PGlite expose la même
// surface Drizzle. Le cast est le prix d'un test SANS mock sur le vrai schéma.
type DbxInventaire = Parameters<typeof inventaireMesures>[0];
type DbxPurge = NonNullable<Parameters<typeof purgerRawWebhooks>[0]>["dbx"];
const dbx = dbTest as unknown as DbxInventaire;
const dbxPurge = dbTest as unknown as DbxPurge;

const T0 = new Date("2026-08-01T10:00:00.000Z");
const T1 = new Date("2026-08-02T10:00:00.000Z");
const T2 = new Date("2026-08-03T10:00:00.000Z");

beforeAll(async () => {
  await migrate(dbTest, { migrationsFolder: resolve(process.cwd(), "drizzle") });
});

beforeEach(async () => {
  await dbTest.execute(sql`DELETE FROM vehicle_snapshots`);
  await dbTest.execute(sql`DELETE FROM webhook_deliveries`);
});

afterAll(async () => {
  await client.close();
});

describe("inventaireMesures — agrégat par (source, métrique, code)", () => {
  it("compte les mesures et borne première/dernière", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T0, source: "smartcar", metricType: "battery_soc", signalCode: "tractionbattery-stateofcharge", valueNumeric: 70 },
      { recordedAt: T1, source: "smartcar", metricType: "battery_soc", signalCode: "tractionbattery-stateofcharge", valueNumeric: 72 },
      { recordedAt: T2, source: "smartcar", metricType: "battery_soc", signalCode: "tractionbattery-stateofcharge", valueNumeric: 74 },
      { recordedAt: T1, source: "smartcar", metricType: "odometer", signalCode: "odometer-traveleddistance", valueNumeric: 1200 },
    ]);

    const inventaire = await inventaireMesures(dbx);
    expect(inventaire).toHaveLength(2);

    const soc = inventaire.find((l) => l.metricType === "battery_soc");
    expect(soc).toMatchObject({ source: "smartcar", nbMesures: 3 });
    expect(soc!.premiere.toISOString()).toBe(T0.toISOString());
    expect(soc!.derniere.toISOString()).toBe(T2.toISOString());

    const odo = inventaire.find((l) => l.metricType === "odometer");
    expect(odo!.nbMesures).toBe(1);
  });

  it("sépare deux SOURCES d'une même métrique (jamais fusionnées, Doc 4 §3.1)", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T0, source: "smartcar", metricType: "battery_soc", signalCode: "tractionbattery-stateofcharge", valueNumeric: 70 },
      { recordedAt: T0, source: "toyota_na", metricType: "battery_soc", signalCode: null, valueNumeric: 71 },
    ]);

    const inventaire = await inventaireMesures(dbx);
    expect(inventaire.map((l) => l.source).sort()).toEqual(["smartcar", "toyota_na"]);
  });
});

describe("bilanCouverture — les absences sont NOMMÉES", () => {
  const ligne = (signalCode: string, source = "smartcar"): LigneInventaire => ({
    source,
    metricType: "x",
    signalCode,
    nbMesures: 1,
    premiere: T0,
    derniere: T0,
  });

  it("classe reçus / manquants / hors liste", () => {
    const bilan = bilanCouverture([
      ligne("tractionbattery-stateofcharge"),
      ligne("odometer-traveleddistance"),
      ligne("code-inconnu-du-rapport"),
    ]);

    expect(bilan.recus).toEqual(["tractionbattery-stateofcharge", "odometer-traveleddistance"]);
    expect(bilan.manquants).toHaveLength(SIGNAUX_CONFIRMES_BZ.length - 2);
    expect(bilan.manquants).toContain("closure-islocked");
    expect(bilan.horsListe).toEqual(["code-inconnu-du-rapport"]);
  });

  it("une mesure toyota_na ne prouve RIEN sur la souscription Smartcar", () => {
    const bilan = bilanCouverture([ligne("tractionbattery-stateofcharge", "toyota_na")]);
    expect(bilan.recus).toEqual([]);
    expect(bilan.manquants).toContain("tractionbattery-stateofcharge");
  });

  it("base pleine ⇒ zéro manquant", () => {
    const bilan = bilanCouverture(SIGNAUX_CONFIRMES_BZ.map((c) => ligne(c)));
    expect(bilan.manquants).toEqual([]);
    expect(bilan.recus).toHaveLength(SIGNAUX_CONFIRMES_BZ.length);
  });
});

describe("journalLivraisons — plus récentes d'abord, borné", () => {
  it("ordonne et respecte la limite", async () => {
    await dbTest.insert(webhookDeliveries).values([
      { eventId: "e1", eventType: "VEHICLE_STATE", receivedAt: T0, snapshotsWritten: 11, raw: {} },
      { eventId: "e2", eventType: "VEHICLE_STATE", receivedAt: T2, snapshotsWritten: 0, raw: {} },
      { eventId: "e3", eventType: "VEHICLE_STATE_TEST", receivedAt: T1, snapshotsWritten: 0, raw: {} },
    ]);

    const journal = await journalLivraisons(2, dbx);
    expect(journal.map((l) => l.eventId)).toEqual(["e2", "e3"]);
  });
});

describe("purgerRawWebhooks — le transport se vide, RIEN d'autre", () => {
  const MAINTENANT = new Date("2026-11-15T00:00:00.000Z");
  const VIEILLE = new Date("2026-08-01T00:00:00.000Z"); // 106 jours avant
  const RECENTE = new Date("2026-11-10T00:00:00.000Z"); // 5 jours avant

  async function inserer() {
    await dbTest.insert(webhookDeliveries).values([
      { eventId: "vieille", eventType: "VEHICLE_STATE", receivedAt: VIEILLE, snapshotsWritten: 11, raw: { grosse: "charge" } },
      { eventId: "recente", eventType: "VEHICLE_STATE", receivedAt: RECENTE, snapshotsWritten: 3, raw: { autre: "charge" } },
    ]);
  }

  it("vide le raw hors fenêtre, garde la LIGNE et le raw récent", async () => {
    await inserer();
    const purgees = await purgerRawWebhooks({
      maintenant: MAINTENANT,
      retentionJours: 90,
      dbx: dbxPurge,
    });
    expect(purgees).toBe(1);

    const lignes = await dbTest.select().from(webhookDeliveries);
    const vieille = lignes.find((l) => l.eventId === "vieille");
    const recente = lignes.find((l) => l.eventId === "recente");

    // La ligne SURVIT (idempotence + surveillance du silence) — seul le blob part.
    expect(vieille).toBeDefined();
    expect(vieille!.raw).toBeNull();
    expect(vieille!.snapshotsWritten).toBe(11);
    expect(recente!.raw).toEqual({ autre: "charge" });
  });

  it("est idempotente : un second passage ne touche plus rien", async () => {
    await inserer();
    await purgerRawWebhooks({ maintenant: MAINTENANT, retentionJours: 90, dbx: dbxPurge });
    const deuxieme = await purgerRawWebhooks({
      maintenant: MAINTENANT,
      retentionJours: 90,
      dbx: dbxPurge,
    });
    expect(deuxieme).toBe(0);
  });

  it("rétention 0 = tout garder, aucune requête destructrice", async () => {
    await inserer();
    const purgees = await purgerRawWebhooks({
      maintenant: MAINTENANT,
      retentionJours: 0,
      dbx: dbxPurge,
    });
    expect(purgees).toBe(0);

    const lignes = await dbTest.select().from(webhookDeliveries);
    expect(lignes.every((l) => l.raw !== null)).toBe(true);
  });

  it("ne touche JAMAIS aux mesures, même anciennes", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: VIEILLE, source: "smartcar", metricType: "odometer", valueNumeric: 500 },
    ]);
    await inserer();
    await purgerRawWebhooks({ maintenant: MAINTENANT, retentionJours: 90, dbx: dbxPurge });

    const mesures = await dbTest.select().from(vehicleSnapshots);
    expect(mesures).toHaveLength(1);
    expect(mesures[0]!.valueNumeric).toBe(500);
  });
});

describe("retentionRawJours — une variable mal tapée ne change pas la politique", () => {
  it("défaut 90, `0` désactive, invalide/négatif retombe au défaut", () => {
    expect(retentionRawJours({})).toBe(90);
    expect(retentionRawJours({ WEBHOOK_RAW_RETENTION_JOURS: "30" })).toBe(30);
    expect(retentionRawJours({ WEBHOOK_RAW_RETENTION_JOURS: "0" })).toBe(0);
    expect(retentionRawJours({ WEBHOOK_RAW_RETENTION_JOURS: "abc" })).toBe(90);
    expect(retentionRawJours({ WEBHOOK_RAW_RETENTION_JOURS: "-5" })).toBe(90);
    expect(retentionRawJours({ WEBHOOK_RAW_RETENTION_JOURS: " " })).toBe(90);
  });
});
