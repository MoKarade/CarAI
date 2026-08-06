// tests/mesures.test.ts — la requête filtrée qui alimente le tableau ET l'export CSV.
// PGlite + migrations réelles, comme tests/inventaire.test.ts : zéro mock.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { vehicleSnapshots, type VehicleSnapshot } from "@/lib/db/schema";
import {
  depuisPourPeriode,
  estPosition,
  listerMesures,
  pageEffective,
  periodeValide,
  valeurAffichable,
} from "@/lib/vehicle/mesures";

const client = new PGlite();
const dbTest = drizzle(client);
const dbx = dbTest as unknown as NonNullable<Parameters<typeof listerMesures>[0]>["dbx"];

const T = (j: number) => new Date(Date.UTC(2026, 7, j, 10, 0, 0));

beforeAll(async () => {
  await migrate(dbTest, { migrationsFolder: resolve(process.cwd(), "drizzle") });
});

beforeEach(async () => {
  await dbTest.execute(sql`DELETE FROM vehicle_snapshots`);
});

afterAll(async () => {
  await client.close();
});

async function semer() {
  await dbTest.insert(vehicleSnapshots).values([
    { recordedAt: T(1), source: "smartcar", metricType: "odometer", valueNumeric: 100, unit: "km" },
    { recordedAt: T(2), source: "smartcar", metricType: "battery_soc", valueNumeric: 70, unit: "percent" },
    { recordedAt: T(3), source: "smartcar", metricType: "odometer", valueNumeric: 150, unit: "km" },
    { recordedAt: T(4), source: "toyota_na", metricType: "battery_soc", valueNumeric: 71, unit: "percent" },
  ]);
}

describe("listerMesures — filtres, ordre, pagination, total", () => {
  it("sans filtre : tout, plus récent d'abord, avec le TOTAL", async () => {
    await semer();
    const { lignes, total } = await listerMesures({ dbx });
    expect(total).toBe(4);
    expect(lignes.map((l) => l.recordedAt.getUTCDate())).toEqual([4, 3, 2, 1]);
  });

  it("filtre par métrique et par source", async () => {
    await semer();
    const odo = await listerMesures({ filtres: { metricType: "odometer" }, dbx });
    expect(odo.total).toBe(2);
    expect(odo.lignes.every((l) => l.metricType === "odometer")).toBe(true);

    const toyota = await listerMesures({ filtres: { source: "toyota_na" }, dbx });
    expect(toyota.total).toBe(1);
  });

  it("filtre « depuis » sur l'instant de MESURE, pas de réception", async () => {
    await semer();
    const { total } = await listerMesures({ filtres: { depuis: T(3) }, dbx });
    expect(total).toBe(2);
  });

  it("pagination par offset : le total reste celui du FILTRE", async () => {
    await semer();
    const page2 = await listerMesures({ limite: 2, offset: 2, dbx });
    expect(page2.lignes).toHaveLength(2);
    expect(page2.total).toBe(4);
    expect(page2.lignes.map((l) => l.recordedAt.getUTCDate())).toEqual([2, 1]);
  });

  it("avecTotal: false saute le count — l'export ne recompte pas la table à chaque page", async () => {
    await semer();
    const sansTotal = await listerMesures({ limite: 2, avecTotal: false, dbx });
    expect(sansTotal.lignes).toHaveLength(2);
    expect(sansTotal.total).toBeNull();
  });

  it("pagination par CURSEUR : reprend exactement après la dernière ligne servie", async () => {
    await semer();
    const p1 = await listerMesures({ limite: 2, dbx });
    const derniere = p1.lignes[1]!;
    const p2 = await listerMesures({
      limite: 2,
      curseur: { recordedAt: derniere.recordedAt, id: derniere.id },
      dbx,
    });
    // Aucun recouvrement, aucune perte : la réunion des deux pages = tout.
    const ids = [...p1.lignes, ...p2.lignes].map((l) => l.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("CURSEUR insensible aux INSERTS entre deux pages (l'export sur base vivante)", async () => {
    await semer();
    const p1 = await listerMesures({ limite: 2, dbx });
    const derniere = p1.lignes[1]!;

    // Une livraison arrive ENTRE deux pages de l'export : avec un offset, tout se décale
    // et une ligne serait servie DEUX fois. Le curseur ne bouge pas.
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(5), source: "smartcar", metricType: "battery_soc", valueNumeric: 75 },
    ]);

    const p2 = await listerMesures({
      limite: 10,
      curseur: { recordedAt: derniere.recordedAt, id: derniere.id },
      dbx,
    });
    const idsP1 = new Set(p1.lignes.map((l) => l.id));
    expect(p2.lignes.some((l) => idsP1.has(l.id))).toBe(false);
    expect(p2.lignes).toHaveLength(2);
  });
});

describe("valeurAffichable — l'écran montre tout SAUF les coordonnées", () => {
  const base: VehicleSnapshot = {
    id: 1,
    recordedAt: T(1),
    receivedAt: T(1),
    source: "smartcar",
    metricType: "tire_pressure",
    signalCode: "wheel-tires",
    signalStatus: "SUCCESS",
    valueNumeric: null,
    valueText: null,
    valueJson: null,
    unit: null,
    locationType: null,
  };

  it("une POSITION renvoie vers l'export, jamais ses coordonnées", () => {
    const rendu = valeurAffichable({
      ...base,
      metricType: "location",
      signalCode: "location-preciselocation",
      valueJson: { latitude: 46.157352, longitude: -71.88961 },
    });
    expect(rendu).toBe("position (voir export CSV)");
    expect(rendu).not.toContain("46");
  });

  it("la garde est par CONTENU : un code de position INCONNU est masqué aussi", () => {
    // Finding HIGH de la revue du 06/08 (prouvé par exécution) : le pipeline stocke tout
    // code inconnu sous sa propre métrique et le repli « corps entier » conserve
    // {latitude, longitude} quel que soit le code. Une garde par identité exacte laissait
    // `location-approximatelocation` afficher ses coordonnées en clair. Quatre signaux
    // indépendants — chacun suffit.
    const inconnu = {
      ...base,
      metricType: "location-approximatelocation",
      signalCode: "location-approximatelocation",
      valueJson: { latitude: 46.157352, longitude: -71.88961 },
    };
    expect(estPosition(inconnu)).toBe(true);
    expect(valeurAffichable(inconnu)).toBe("position (voir export CSV)");

    // Par le locationType porté par la ligne, même sous un code absurde.
    expect(estPosition({ ...base, locationType: "last_parked" })).toBe(true);

    // Par les CLÉS du JSON, même sans code ni métrique reconnaissables.
    expect(
      valeurAffichable({ ...base, metricType: "mystere", valueJson: { lat: 1, lng: 2 } }),
    ).toBe("position (voir export CSV)");
  });

  it("un détail JSON non sensible S'AFFICHE — c'est pour le voir que le tableau existe", () => {
    const rendu = valeurAffichable({
      ...base,
      valueJson: { values: [{ tirePressure: 282.68 }] },
    });
    expect(rendu).toContain("282.68");
  });

  it("numérique avec unité, texte, et absence honnête", () => {
    expect(valeurAffichable({ ...base, valueNumeric: 293.8, unit: "km" })).toBe("293.8 km");
    expect(valeurAffichable({ ...base, valueText: "CHARGING" })).toBe("CHARGING");
    expect(valeurAffichable(base)).toBe("non communiqué");
  });
});

describe("depuisPourPeriode / periodeValide — la fenêtre du filtre", () => {
  const maintenant = new Date("2026-08-06T12:00:00.000Z");

  it("24h / 7j / 30j / tout", () => {
    expect(depuisPourPeriode("24h", maintenant)?.toISOString()).toBe(
      "2026-08-05T12:00:00.000Z",
    );
    expect(depuisPourPeriode("7j", maintenant)?.toISOString()).toBe(
      "2026-07-30T12:00:00.000Z",
    );
    expect(depuisPourPeriode("tout", maintenant)).toBeNull();
    // Une période inconnue N'AMPUTE PAS la sélection : tout l'historique.
    expect(depuisPourPeriode("bidon", maintenant)).toBeNull();
    expect(depuisPourPeriode(undefined, maintenant)).toBeNull();
  });

  it("periodeValide normalise — l'écran affiche la clé RÉELLEMENT appliquée", () => {
    expect(periodeValide("7j")).toBe("7j");
    expect(periodeValide("48h")).toBe("tout");
    expect(periodeValide(null)).toBe("tout");
    // Un nom de la chaîne de prototypes passait `in` et produisait une date invalide
    // (revue du 06/08) : `Object.hasOwn` ferme le cas.
    expect(periodeValide("constructor")).toBe("tout");
    expect(depuisPourPeriode("constructor", maintenant)).toBeNull();
  });
});

describe("pageEffective — jamais de page fantôme", () => {
  it("borne à la dernière page réelle, plancher 1", () => {
    // Sélection rétrécie sous le rafraîchissement auto : page 5 de 380 lignes → page 4.
    expect(pageEffective(5, 380, 100)).toBe(4);
    // Vieux lien ?page=3 sur 4 mesures → page 1, pas « aucune mesure ».
    expect(pageEffective(3, 4, 100)).toBe(1);
    expect(pageEffective(1, 0, 100)).toBe(1);
    expect(pageEffective(0, 50, 100)).toBe(1);
    expect(pageEffective(2, 250, 100)).toBe(2);
  });
});
