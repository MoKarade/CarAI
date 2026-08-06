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
    // UNKNOWN n'est PAS un refus : « le véhicule gère la donnée mais n'en a pas fourni
    // de valide cette fois-ci » (Doc 2 §5.3) — même sémantique que dans l'ingestion.
    expect(classerSignal({ ...etat, dernierStatut: "UNKNOWN" })).toBe("sans_valeur");
    // Un ERROR enrichi de son motif reste un refus.
    expect(classerSignal({ ...etat, dernierStatut: "ERROR (COMPATIBILITY)" })).toBe("refuse");
  });

  it("deux SOURCES portant le même code sont deux états distincts", async () => {
    await dbTest.execute(sql`DELETE FROM vehicle_snapshots`);
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "smartcar", metricType: "battery_soc", signalCode: "code-partage", signalStatus: "SUCCESS", valueNumeric: 75 },
      { recordedAt: T(12), source: "toyota_na", metricType: "battery_soc", signalCode: "code-partage", signalStatus: "ERROR", valueNumeric: null },
    ]);
    const etats = await etatDesSignaux(dbx);
    const parSource = etats.filter((e) => e.signalCode === "code-partage");
    // Sans la source dans le DISTINCT, l'état toyota (plus récent) aurait MASQUÉ le
    // smartcar fonctionnel.
    expect(parSource).toHaveLength(2);
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

  it("la LIMITE garde le côté RÉCENT — une courbe ne se fige jamais sur le passé", async () => {
    // `LIMIT` en ordre croissant aurait gardé les plus VIEUX points : la courbe se
    // serait figée en silence dès qu'une série dépasse la borne (finding HIGH de la
    // revue du 06/08 — la leçon DriveAI des bornes de tête, sous un autre visage).
    await dbTest.insert(vehicleSnapshots).values(
      [10, 11, 12, 13, 14].map((h) => ({
        recordedAt: T(h),
        source: "smartcar" as const,
        metricType: "battery_soc",
        valueNumeric: h,
      })),
    );

    const { points } = await serieNumerique("battery_soc", { limite: 3, dbx });
    // Les 3 plus RÉCENTS, remis en ordre chronologique.
    expect(points.map((p) => p.valeur)).toEqual([12, 13, 14]);
  });

  it("une POSITION ne se trace pas, même appelée directement", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "smartcar", metricType: "location", valueNumeric: 46.1 },
    ]);
    const { points } = await serieNumerique("location", { dbx });
    expect(points).toEqual([]);
    const inconnue = await serieNumerique("location-approximatelocation", { dbx });
    expect(inconnue.points).toEqual([]);
  });
});

describe("sousEchantillonner — jamais perdre le premier ni le DERNIER point", () => {
  const serie = (n: number): PointSerie[] =>
    Array.from({ length: n }, (_, i) => ({ t: new Date(i * 1000), valeur: i }));

  it("réduit en gardant les extrémités", () => {
    const reduit = sousEchantillonner(serie(4000), 300);
    expect(reduit.length).toBeLessThanOrEqual(600);
    expect(reduit.length).toBeGreaterThanOrEqual(300);
    expect(reduit[0]!.valeur).toBe(0);
    // Perdre le dernier point mentirait sur la FRAÎCHEUR de la série.
    expect(reduit[reduit.length - 1]!.valeur).toBe(3999);
    // Et l'ordre chronologique survit à la décimation par seaux.
    for (let i = 1; i < reduit.length; i++) {
      expect(reduit[i]!.t.getTime()).toBeGreaterThanOrEqual(reduit[i - 1]!.t.getTime());
    }
  });

  it("un PIC survit à la décimation — la légende ne peut pas mentir", () => {
    // Un stride naïf (un point sur N) effaçait un pic tombé entre deux pas, et le
    // min–max affiché était alors calculé sur la série décimée (revue du 06/08).
    const points = serie(4000);
    points[1777] = { t: points[1777]!.t, valeur: 99_999 };
    points[2333] = { t: points[2333]!.t, valeur: -99_999 };

    const reduit = sousEchantillonner(points, 300);
    const valeurs = reduit.map((p) => p.valeur);
    expect(Math.max(...valeurs)).toBe(99_999);
    expect(Math.min(...valeurs)).toBe(-99_999);
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
