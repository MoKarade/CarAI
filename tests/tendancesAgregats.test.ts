// tests/tendancesAgregats.test.ts — CarAI#254 : les courbes LONGUES de Tendances sont agrégées en SQL.
//
// Avant : à 30 jours et « tout », la page lisait jusqu'à 4 000 relevés bruts par métrique pour
// n'en dessiner que ~300 — le transfert Neon payait ce qu'on jetait aussitôt (limite mensuelle
// dépassée, CarAI#200). Après : au-delà de 7 jours la base rend UN point par heure ou par jour.
//
// Ce fichier prouve DEUX choses sur une vraie base de test : (1) la quantité lue (un point par
// tranche, jamais les relevés), (2) que l'agrégat reste JUSTE (moyenne, maximum pour
// l'odomètre, deux sources jamais mêlées, borne haute respectée).

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vehicleSnapshots } from "@/lib/db/schema";
import {
  SEUIL_COURBE_BRUTE_MS,
  SEUIL_COURBE_HORAIRE_MS,
  granulariteCourbe,
  libelleReleves,
  serieCourbe,
} from "@/lib/vehicle/analyse";

const MAINTENANT = new Date("2026-08-13T18:00:00.000Z");
const JOUR = 86_400_000;
const il_y_a = (jours: number) => new Date(MAINTENANT.getTime() - jours * JOUR);

describe("granulariteCourbe — brut jusqu'à 7 jours, agrégé au-delà", () => {
  it("7 jours exacts (le défaut de l'écran) restent BRUTS", () => {
    expect(granulariteCourbe(il_y_a(7), null, MAINTENANT)).toBe("brut");
    expect(granulariteCourbe(il_y_a(1), null, MAINTENANT)).toBe("brut");
  });

  it("une plage d'une semaine qui traverse un changement d'heure reste brute", () => {
    const debut = il_y_a(7);
    const fin = new Date(MAINTENANT.getTime() + 3_600_000);
    expect(fin.getTime() - debut.getTime()).toBeLessThanOrEqual(SEUIL_COURBE_BRUTE_MS);
    expect(granulariteCourbe(debut, fin, MAINTENANT)).toBe("brut");
  });

  it("30 jours → à l'heure ; 45 jours inclus", () => {
    expect(granulariteCourbe(il_y_a(30), null, MAINTENANT)).toBe("heure");
    expect(granulariteCourbe(il_y_a(8), null, MAINTENANT)).toBe("heure");
    expect(SEUIL_COURBE_HORAIRE_MS).toBe(45 * JOUR);
    expect(granulariteCourbe(il_y_a(45), null, MAINTENANT)).toBe("heure");
  });

  it("au-delà de 45 jours, ou « tout » (durée inconnue) → au jour", () => {
    expect(granulariteCourbe(il_y_a(46), null, MAINTENANT)).toBe("jour");
    expect(granulariteCourbe(null, null, MAINTENANT)).toBe("jour");
  });

  it("la borne haute d'une plage compte : une plage passée de 3 jours est brute", () => {
    expect(granulariteCourbe(il_y_a(100), il_y_a(97), MAINTENANT)).toBe("brut");
  });
});

describe("libelleReleves — un agrégat ne se présente pas comme des relevés", () => {
  it("brut : des relevés", () => {
    expect(libelleReleves("brut", "battery_soc", 337)).toBe("337 relevés");
  });
  it("agrégé : le dit, avec le bon agrégat", () => {
    expect(libelleReleves("heure", "battery_soc", 720)).toBe("720 points — moyenne de l’heure");
    expect(libelleReleves("jour", "odometer", 41)).toBe("41 points — maximum du jour");
  });
});

describe("serieCourbe — sur une base de test", () => {
  const client = new PGlite();
  const dbTest = drizzle(client);
  type Dbx = NonNullable<Parameters<typeof serieCourbe>[1]["dbx"]>;
  const dbx = dbTest as unknown as Dbx;

  // 40 jours de relevés toutes les 30 minutes, jusqu'à MAINTENANT inclus.
  const PAS = 30 * 60_000;
  const instants: Date[] = [];
  for (let t = il_y_a(40).getTime(); t <= MAINTENANT.getTime(); t += PAS) instants.push(new Date(t));

  beforeAll(async () => {
    await migrate(dbTest, { migrationsFolder: resolve(process.cwd(), "drizzle") });
    // ⚠️ `DATE_TRUNC('day')` suit le fuseau de la SESSION de la base. Neon tourne en UTC ; PGlite
    // prend celui de la machine (le robot du PC est en heure du Québec : l'odomètre « du jour »
    // s'y coupait à 4 h du matin UTC et le test rougissait là seulement). On fige UTC, comme en
    // production, pour que les frontières de jour du test soient celles du code.
    await client.exec("SET TIME ZONE 'UTC'");
    await dbTest.execute(sql`DELETE FROM vehicle_snapshots`);
    const lignes = instants.flatMap((t, i) => [
      {
        recordedAt: t,
        source: "smartcar" as const,
        metricType: "battery_soc",
        // :00 → heure du jour, :30 → heure du jour + 1 : la moyenne d'une heure vaut h + 0,5.
        valueNumeric: t.getUTCHours() + (t.getUTCMinutes() === 30 ? 1 : 0),
        unit: "%",
      },
      {
        recordedAt: t,
        source: "smartcar" as const,
        metricType: "odometer",
        valueNumeric: 1000 + i,
        unit: "km",
      },
    ]);
    for (let i = 0; i < lignes.length; i += 1000) {
      await dbTest.insert(vehicleSnapshots).values(lignes.slice(i, i + 1000));
    }
    // Deux sources qui se contredisent sur la même heure : jamais moyennées entre elles.
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: il_y_a(2), source: "smartcar" as const, metricType: "battery_range", valueNumeric: 300, unit: "km" },
      { recordedAt: il_y_a(2), source: "toyota_na" as const, metricType: "battery_range", valueNumeric: 100, unit: "km" },
    ]);
  }, 60_000);
  afterAll(async () => {
    await client.close();
  });

  const heuresDistinctes = (depuis: Date) =>
    new Set(
      instants.filter((t) => t >= depuis).map((t) => Math.floor(t.getTime() / 3_600_000)),
    ).size;

  it("30 jours : UN point par heure, pas un par relevé", async () => {
    const depuis = il_y_a(30);
    const r = await serieCourbe("battery_soc", { depuis, maintenant: MAINTENANT, dbx });
    const releves = instants.filter((t) => t >= depuis).length;
    expect(r.granularite).toBe("heure");
    expect(r.points).toHaveLength(heuresDistinctes(depuis));
    expect(r.points.length).toBeLessThan(releves);
    expect(r.points.length).toBe(Math.ceil(releves / 2));
    expect(r.tronquee).toBe(false);
    expect(r.unite).toBe("%");
  });

  it("la valeur d'une tranche est la MOYENNE de ses relevés", async () => {
    const r = await serieCourbe("battery_soc", { depuis: il_y_a(30), maintenant: MAINTENANT, dbx });
    const pleine = r.points.find((p) => p.t.getUTCHours() === 5 && p.t.getTime() > il_y_a(29).getTime());
    expect(pleine!.valeur).toBe(5.5);
    // Du plus ancien au plus récent.
    const ts = r.points.map((p) => p.t.getTime());
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it("« tout » : UN point par jour", async () => {
    const r = await serieCourbe("battery_soc", { depuis: null, maintenant: MAINTENANT, dbx });
    const jours = new Set(instants.map((t) => Math.floor(t.getTime() / JOUR))).size;
    expect(r.granularite).toBe("jour");
    expect(r.points).toHaveLength(jours);
  });

  it("l'odomètre prend le MAXIMUM de la tranche, pas sa moyenne", async () => {
    const r = await serieCourbe("odometer", { depuis: null, maintenant: MAINTENANT, dbx });
    const premierJour = Math.floor(instants[0]!.getTime() / JOUR);
    const dernierDuPremierJour = instants.reduce(
      (max, t, i) => (Math.floor(t.getTime() / JOUR) === premierJour ? i : max),
      0,
    );
    expect(r.points[0]!.valeur).toBe(1000 + dernierDuPremierJour);
    // Un odomètre ne recule jamais, même agrégé.
    const valeurs = r.points.map((p) => p.valeur);
    expect(valeurs).toEqual([...valeurs].sort((a, b) => a - b));
  });

  it("la borne haute est respectée en SQL, sans perdre la première tranche", async () => {
    const depuis = il_y_a(30);
    const jusqu = il_y_a(10);
    const r = await serieCourbe("battery_soc", { depuis, jusqu, maintenant: MAINTENANT, dbx });
    expect(r.points.length).toBeGreaterThan(0);
    expect(Math.max(...r.points.map((p) => p.t.getTime()))).toBeLessThan(jusqu.getTime());
    // Fenêtre qui ne tombe pas sur une heure ronde : la 1re tranche (partielle) est gardée.
    const decalee = new Date(il_y_a(30).getTime() + 10 * 60_000);
    const d = await serieCourbe("battery_soc", { depuis: decalee, jusqu, maintenant: MAINTENANT, dbx });
    expect(d.points[0]!.t.getTime()).toBeLessThan(decalee.getTime());
  });

  it("deux sources qui se contredisent restent DEUX points, jamais une moyenne", async () => {
    const r = await serieCourbe("battery_range", { depuis: il_y_a(30), maintenant: MAINTENANT, dbx });
    expect(r.points.map((p) => p.valeur).sort((a, b) => a - b)).toEqual([100, 300]);
  });

  it("7 jours (le défaut) : relevés BRUTS, comme avant", async () => {
    const depuis = il_y_a(7);
    const r = await serieCourbe("battery_soc", { depuis, maintenant: MAINTENANT, dbx });
    expect(r.granularite).toBe("brut");
    expect(r.points).toHaveLength(instants.filter((t) => t >= depuis).length);
  });

  it("l'agrégat ne lit AUCUNE ligne brute : seul `execute` (le GROUP BY) est appelé", async () => {
    const espion = {
      execute: dbTest.execute.bind(dbTest),
      select: () => {
        throw new Error("lecture brute interdite sur une courbe longue");
      },
    } as unknown as Dbx;
    const r = await serieCourbe("battery_soc", { depuis: il_y_a(30), maintenant: MAINTENANT, dbx: espion });
    expect(r.points.length).toBeGreaterThan(0);
  });

  it("une position ne se trace pas, agrégée non plus", async () => {
    const r = await serieCourbe("location", { depuis: il_y_a(30), maintenant: MAINTENANT, dbx });
    expect(r.points).toEqual([]);
  });
});

describe("la page Tendances", () => {
  it("lit ses courbes par `serieCourbe` et ne rappelle pas dansLaFenetre sur un agrégat", () => {
    const page = readFileSync(resolve(process.cwd(), "app/tendances/page.tsx"), "utf8");
    expect(page).toMatch(/serieCourbe\(m\.metricType/);
    expect(page).not.toMatch(/serieNumerique\(m\.metricType/);
    expect(page).toMatch(/granularite === "brut" \? dansLaFenetre\(points, fenetre\) : points/);
  });
});
