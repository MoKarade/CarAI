// tests/tendancesSeptJours.test.ts — CarAI#200 : alléger les lectures de Tendances.
//
// La limite mensuelle de transfert Neon a été dépassée. Deux verrous :
//   1. /tendances s'ouvre sur 7 jours (et plus sur « tout l'historique »).
//   2. la lecture BRUTE d'une série porte un plafond, ancré du côté RÉCENT, et le DIT.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { vehicleSnapshots } from "@/lib/db/schema";
import { DEFAUT_TENDANCES, RACCOURCIS_GLISSANTS, analyserFenetre } from "@/lib/vehicle/fenetre";
import { LIMITE_SERIE_BRUTE, lireSerie } from "@/lib/vehicle/history";

const MAINTENANT = new Date("2026-08-13T18:00:00.000Z");

describe("Tendances s'ouvre sur 7 jours", () => {
  it("le défaut de l'écran est 7j", () => {
    expect(DEFAUT_TENDANCES).toBe("7j");
  });

  it("sans paramètre, la fenêtre est « 7 derniers jours » et non « tout »", () => {
    const f = analyserFenetre({}, MAINTENANT, {
      raccourcis: RACCOURCIS_GLISSANTS,
      defaut: DEFAUT_TENDANCES,
    });
    expect(f.periode).toBe("7j");
    expect(f.mode).toBe("raccourci");
    expect(f.libelle).toContain("7 derniers jours");
    expect(f.depuis!.toISOString()).toBe("2026-08-06T18:00:00.000Z");
  });

  it("« tout » reste atteignable explicitement", () => {
    const f = analyserFenetre({ periode: "tout" }, MAINTENANT, {
      raccourcis: RACCOURCIS_GLISSANTS,
      defaut: DEFAUT_TENDANCES,
    });
    expect(f.mode).toBe("tout");
    expect(f.depuis).toBeNull();
  });

  it("un lien périmé ou forgé retombe sur 7j", () => {
    const f = analyserFenetre({ periode: "constructor" }, MAINTENANT, {
      raccourcis: RACCOURCIS_GLISSANTS,
      defaut: DEFAUT_TENDANCES,
    });
    expect(f.periode).toBe("7j");
  });

  it("la page ET le bouton « Effacer » s'appuient sur la MÊME constante", () => {
    // Deux défauts écrits à la main finissent par diverger : la page s'ouvrirait sur 7 j
    // et « Effacer » ramènerait sur autre chose. On lit la source, comme tendancesMobile.
    const page = readFileSync(resolve(process.cwd(), "app/tendances/page.tsx"), "utf8");
    expect(page).toMatch(/defaut:\s*DEFAUT_TENDANCES/);
    expect(page).toMatch(/defaut=\{DEFAUT_TENDANCES\}/);
    expect(page).not.toMatch(/defaut="tout"/);
  });
});

describe("lireSerie brut — plafonnée, côté RÉCENT, et elle le dit", () => {
  const client = new PGlite();
  const dbTest = drizzle(client);
  const dbx = dbTest as unknown as NonNullable<Parameters<typeof lireSerie>[0]["dbx"]>;
  const T = (h: number) => new Date(Date.UTC(2026, 7, 6, h, 0, 0));

  beforeAll(async () => {
    await migrate(dbTest, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  });
  beforeEach(async () => {
    await dbTest.execute(sql`DELETE FROM vehicle_snapshots`);
    await dbTest.insert(vehicleSnapshots).values(
      [10, 11, 12, 13, 14].map((h) => ({
        recordedAt: T(h),
        source: "smartcar" as const,
        metricType: "battery_soc",
        valueNumeric: h,
        unit: "%",
      })),
    );
  });
  afterAll(async () => {
    await client.close();
  });

  it("le plafond par défaut existe et est borné", () => {
    expect(Number.isFinite(LIMITE_SERIE_BRUTE)).toBe(true);
    expect(LIMITE_SERIE_BRUTE).toBeGreaterThan(0);
  });

  it("garde les relevés les plus RÉCENTS, remis en ordre chronologique", async () => {
    const s = await lireSerie({ metricType: "battery_soc", limite: 3, dbx });
    expect(s.points.map((p) => p.valeur)).toEqual([12, 13, 14]);
    expect(s.points.map((p) => p.instant.getTime())).toEqual([T(12), T(13), T(14)].map((d) => d.getTime()));
  });

  it("DIT quand le plafond a mordu, et seulement alors", async () => {
    expect((await lireSerie({ metricType: "battery_soc", limite: 3, dbx })).tronquee).toBe(true);
    expect((await lireSerie({ metricType: "battery_soc", limite: 5, dbx })).tronquee).toBe(false);
    const large = await lireSerie({ metricType: "battery_soc", dbx });
    expect(large.tronquee).toBe(false);
    expect(large.points).toHaveLength(5);
  });

  it("une série vide reste « vide », non tronquée", async () => {
    const s = await lireSerie({ metricType: "inconnue", dbx });
    expect(s.vide).toBe(true);
    expect(s.tronquee).toBe(false);
  });

  it("l'agrégat SQL n'est jamais tronqué", async () => {
    const s = await lireSerie({ metricType: "battery_soc", granularite: "jour", limite: 1, dbx });
    expect(s.tronquee).toBe(false);
    expect(s.points).toHaveLength(1);
    expect(s.points[0]!.echantillons).toBe(5);
  });

  it("le code porte bien un .limit() sur la lecture brute", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/vehicle/history.ts"), "utf8");
    const brut = src.slice(src.indexOf('granularite === "brut"'), src.indexOf("const unite = troncature"));
    expect(brut).toContain(".limit(");
  });
});
