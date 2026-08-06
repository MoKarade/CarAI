// tests/analyse.test.ts — l'état vivant des signaux et les courbes, sur le VRAI schéma.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { vehicleSnapshots } from "@/lib/db/schema";
import {
  classerSignal,
  etatDesSignaux,
  serieNumerique,
  sousEchantillonner,
  traceSvg,
  type EtatSignal,
  type PointSerie,
} from "@/lib/vehicle/analyse";
import { resumerStatutsSignaux } from "@/lib/smartcar/signals";

const client = new PGlite();
const dbTest = drizzle(client);
const dbx = dbTest as unknown as Parameters<typeof etatDesSignaux>[0];

const T = (h: number) => new Date(Date.UTC(2026, 7, 6, h, 0, 0));

beforeAll(async () => {
  await migrate(dbTest, { migrationsFolder: resolve(process.cwd(), "drizzle") });
});

beforeEach(async () => {
  await dbTest.execute(sql`DELETE FROM vehicle_snapshots`);
});

afterAll(async () => {
  await client.close();
});

describe("etatDesSignaux — le DERNIER statut fait foi", () => {
  it("un signal passé d'ERROR à SUCCESS est classé sur sa ligne la plus récente", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "smartcar", metricType: "battery_soc", signalCode: "tractionbattery-stateofcharge", signalStatus: "ERROR", valueNumeric: null },
      { recordedAt: T(12), source: "smartcar", metricType: "battery_soc", signalCode: "tractionbattery-stateofcharge", signalStatus: "SUCCESS", valueNumeric: 75 },
      { recordedAt: T(12), source: "smartcar", metricType: "sunroof_status", signalCode: "closure-sunroof", signalStatus: "ERROR", valueNumeric: null },
    ]);

    const etats = await etatDesSignaux(dbx);
    const soc = etats.find((e) => e.signalCode === "tractionbattery-stateofcharge")!;
    expect(soc.dernierStatut).toBe("SUCCESS");
    expect(soc.porteValeur).toBe(true);
    expect(soc.nbMesures).toBe(2);
    expect(classerSignal(soc)).toBe("fonctionne");

    const toit = etats.find((e) => e.signalCode === "closure-sunroof")!;
    expect(classerSignal(toit)).toBe("refuse");
  });

  it("SUCCESS sans valeur n'est ni « fonctionne » ni « refusé » — c'est dit tel quel", () => {
    const etat: EtatSignal = {
      signalCode: "x",
      metricType: "x",
      source: "smartcar",
      dernierStatut: "SUCCESS",
      derniereMesure: T(12),
      porteValeur: false,
      nbMesures: 3,
    };
    expect(classerSignal(etat)).toBe("sans_valeur");
    // Sans statut déclaré mais avec valeur : fonctionne (les premières livraisons
    // n'avaient pas la colonne statut).
    expect(classerSignal({ ...etat, dernierStatut: null, porteValeur: true })).toBe(
      "fonctionne",
    );
  });
});

describe("serieNumerique — du plus ancien au plus récent, avec son unité", () => {
  it("ordonne, filtre depuis, ignore les lignes sans valeur numérique", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "smartcar", metricType: "battery_soc", valueNumeric: 70, unit: "percent" },
      { recordedAt: T(11), source: "smartcar", metricType: "battery_soc", valueNumeric: null, valueText: "?" },
      { recordedAt: T(12), source: "smartcar", metricType: "battery_soc", valueNumeric: 74, unit: "percent" },
      { recordedAt: T(13), source: "smartcar", metricType: "odometer", valueNumeric: 2800 },
    ]);

    const { points, unite } = await serieNumerique("battery_soc", { dbx });
    expect(points.map((p) => p.valeur)).toEqual([70, 74]);
    expect(unite).toBe("percent");

    const fenetre = await serieNumerique("battery_soc", { depuis: T(11), dbx });
    expect(fenetre.points.map((p) => p.valeur)).toEqual([74]);
  });
});

describe("sousEchantillonner — jamais perdre le premier ni le DERNIER point", () => {
  const serie = (n: number): PointSerie[] =>
    Array.from({ length: n }, (_, i) => ({ t: new Date(i * 1000), valeur: i }));

  it("réduit à la cible en gardant les extrémités", () => {
    const reduit = sousEchantillonner(serie(4000), 300);
    expect(reduit).toHaveLength(300);
    expect(reduit[0]!.valeur).toBe(0);
    // Perdre le dernier point mentirait sur la FRAÎCHEUR de la série.
    expect(reduit[reduit.length - 1]!.valeur).toBe(3999);
  });

  it("ne touche pas une série déjà courte", () => {
    expect(sousEchantillonner(serie(10), 300)).toHaveLength(10);
  });
});

describe("traceSvg — des coordonnées vérifiables au pixel", () => {
  it("projette min en bas, max en haut, le temps de gauche à droite", () => {
    const trace = traceSvg(
      [
        { t: new Date(0), valeur: 0 },
        { t: new Date(1000), valeur: 100 },
      ],
      { largeur: 100, hauteur: 100 },
    )!;
    const [p0, p1] = trace.polyline.split(" ");
    // Marge de 5 % sur [0,100] → fenêtre [-5,105], hauteur 110. Le min se projette à
    // 100·(105/110) = 95.5 px du haut, le max à 4.5 px. Le temps va de x=0 à x=100.
    expect(p0).toBe("0,95.5");
    expect(p1).toBe("100,4.5");
    expect(trace.min).toBe(0);
    expect(trace.max).toBe(100);
  });

  it("série plate : une ligne au centre, jamais de division par zéro", () => {
    const trace = traceSvg(
      [
        { t: new Date(0), valeur: 50 },
        { t: new Date(1000), valeur: 50 },
      ],
      { largeur: 100, hauteur: 100 },
    )!;
    expect(trace.polyline).toBe("0,50 100,50");
  });

  it("série vide : null, jamais un dessin inventé", () => {
    expect(traceSvg([])).toBeNull();
  });
});

describe("resumerStatutsSignaux — la ventilation qui alimente le journal", () => {
  it("sépare SUCCESS et échecs, avec leur motif", () => {
    const resultat = resumerStatutsSignaux([
      { code: "odometer-traveleddistance", body: { value: 5 }, status: { value: "SUCCESS" } },
      { code: "closure-sunroof", status: { value: "ERROR" } },
      { code: "tractionbattery-stateofcharge", body: { value: 75 } },
    ]);
    expect(resultat.succes).toEqual([
      "odometer-traveleddistance",
      "tractionbattery-stateofcharge",
    ]);
    expect(resultat.enEchec).toEqual([{ code: "closure-sunroof", statut: "ERROR" }]);
  });
});
