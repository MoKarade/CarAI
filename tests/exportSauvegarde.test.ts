// tests/exportSauvegarde.test.ts — la sauvegarde externe chiffrée (CarAI#13).
//
// Ce qui est prouvé, contre un VRAI Postgres (PGlite + migrations réelles) :
//   1. le fichier est chiffré, et se refuse à la moindre altération ou à une mauvaise clé ;
//   2. le curseur enchaîne les lots sans trou ni doublon, et ne rend que le NOUVEAU ensuite ;
//   3. la RESTAURATION dans une seconde base rend exactement ce qui a été exporté, sans
//      doublon si on la rejoue, et laisse les séquences `id` utilisables ;
//   4. la route refuse tout sans jeton ET sans clé (échec fermé).

import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  TABLES_PAGINEES,
  chiffrer,
  cleDepuisEnv,
  curseurInitial,
  decoderCurseur,
  dechiffrer,
  encoderCurseur,
  lireFichier,
  lireLot,
  restaurerLots,
  type Executeur,
  type Lot,
} from "@/lib/export/sauvegarde";
import { decider } from "@/lib/export/acces";
import { baseDeTest } from "./aides/basePGlite";

const TOUTES = ["vehicle_snapshots", "service_history", "vehicle_commands_log", "poll_runs", "app_config"];
const source = baseDeTest();
const cible = baseDeTest();

const executeur = (client: typeof source.client): Executeur => async (texte, params) =>
  (await client.query(texte, params as unknown[])).rows as Array<Record<string, unknown>>;

const CLE = randomBytes(32);

async function vider(client: typeof source.client) {
  for (const t of TOUTES) await client.query(`DELETE FROM ${t}`);
}

async function peupler(client: typeof source.client, nbSnapshots: number) {
  for (let i = 0; i < nbSnapshots; i += 1) {
    await client.query(
      `INSERT INTO vehicle_snapshots (recorded_at, received_at, source, metric_type, signal_code, signal_status, value_numeric, value_json, unit)
       VALUES ($1, $1, 'smartcar', 'battery_soc', 'essai', 'SUCCESS', $2, $3::jsonb, '%')`,
      [new Date(Date.UTC(2026, 9, 1, 0, i * 15)).toISOString(), 80 - i, JSON.stringify({ i, texte: "é\"\\\n" })],
    );
  }
  await client.query(
    `INSERT INTO service_history (source, service_date, odometer_at_service, odometer_unit, tasks, total_cost, currency, dedupe_key)
     VALUES ('smartcar', '2026-03-01T00:00:00Z', 1200, 'km', '[{"nom":"rotation"}]'::jsonb, 99.5, 'CAD', 'essai-1')`,
  );
  await client.query(`INSERT INTO vehicle_commands_log (command_type, source, status, issued_by) VALUES ('lock', 'smartcar', 'success', 'essai')`);
  await client.query(`INSERT INTO vehicle_commands_log (command_type, source, status, params) VALUES ('charge_limit', 'smartcar', 'success', '{"limite":80}'::jsonb)`);
  await client.query(`INSERT INTO poll_runs (ok, recus, ecrits) VALUES (true, 84, 3), (false, 0, 0)`);
  await client.query(`INSERT INTO app_config (key, value) VALUES ('bail', '{"debut":"2026-01-01"}'::jsonb), ('autre', '[1,2,3]'::jsonb)`);
}

/** Enchaîne les lots jusqu'à `termine`, comme DriveAI. */
async function toutLire(client: typeof source.client, depuis = curseurInitial(), lignesMax = 10): Promise<Lot[]> {
  const lots: Lot[] = [];
  let curseur = depuis;
  for (let garde = 0; garde < 100; garde += 1) {
    const lot = await lireLot({ executer: executeur(client), curseur, cle: CLE, lignesMax });
    lots.push(lot);
    if (lot.termine) return lots;
    curseur = decoderCurseur(lot.curseur)!;
  }
  throw new Error("l'export ne se termine pas");
}

const rangees = (lot: Lot) =>
  lireFichier(lot.fichier, CLE)
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type?: string; table?: string; row?: Record<string, unknown> })
    .filter((o) => o.type !== "entete");

describe("chiffrement du lot", () => {
  it("aller-retour : ce qui est chiffré se relit à l'identique", () => {
    const clair = Buffer.from("des mesures, des accents é à ü, des lignes\nencore");
    expect(dechiffrer(chiffrer(clair, CLE), CLE).equals(clair)).toBe(true);
  });

  it("le fichier ne contient pas le clair, et deux chiffrements du même clair diffèrent (IV neuf)", () => {
    const clair = Buffer.from("battery_soc battery_soc battery_soc");
    const a = chiffrer(clair, CLE);
    const b = chiffrer(clair, CLE);
    expect(a.includes(Buffer.from("battery_soc"))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it("une mauvaise clé est refusée, bruyamment", () => {
    const f = chiffrer(Buffer.from("x"), CLE);
    expect(() => dechiffrer(f, randomBytes(32))).toThrow(/mauvaise clé|altéré/);
  });

  it("un octet changé n'importe où est refusé (corps, étiquette, en-tête)", () => {
    const f = chiffrer(Buffer.from("des données importantes"), CLE);
    for (const i of [8 + 12, f.length - 1, 6]) {
      const abime = Buffer.from(f);
      abime[i] = abime[i]! ^ 0xff;
      expect(() => dechiffrer(abime, CLE), `octet ${i}`).toThrow();
    }
  });

  it("un fichier qui n'est pas un lot CarAI est refusé avec un message clair", () => {
    expect(() => dechiffrer(Buffer.from("n'importe quoi de suffisamment long pour passer"), CLE)).toThrow(/pas un lot/);
  });
});

describe("clé et curseur", () => {
  it("la clé est 32 octets en base64, sinon null", () => {
    expect(cleDepuisEnv(CLE.toString("base64"))?.equals(CLE)).toBe(true);
    expect(cleDepuisEnv(undefined)).toBeNull();
    expect(cleDepuisEnv("  ")).toBeNull();
    expect(cleDepuisEnv(randomBytes(16).toString("base64"))).toBeNull();
  });

  it("le curseur fait l'aller-retour, et refuse tout ce qui n'a pas EXACTEMENT sa forme", () => {
    const c = { ...curseurInitial(), vehicle_snapshots: 42 };
    expect(decoderCurseur(encoderCurseur(c))).toEqual(c);
    expect(decoderCurseur(null)).toEqual(curseurInitial());
    expect(decoderCurseur("")).toEqual(curseurInitial());
    for (const mauvais of [
      "pas-du-base64-json",
      Buffer.from("[]").toString("base64url"),
      Buffer.from(JSON.stringify({ ...c, intrus: 1 })).toString("base64url"),
      Buffer.from(JSON.stringify({ ...c, poll_runs: -1 })).toString("base64url"),
      Buffer.from(JSON.stringify({ ...c, poll_runs: "3" })).toString("base64url"),
      Buffer.from(JSON.stringify({ vehicle_snapshots: 1 })).toString("base64url"),
    ]) {
      expect(decoderCurseur(mauvais), mauvais).toBeNull();
    }
  });
});

describe("lots et curseur, sur un vrai Postgres", () => {
  it("enchaîne les lots sans trou ni doublon, config en dernier, puis rend le curseur final", async () => {
    await vider(source.client);
    await peupler(source.client, 25);
    const lots = await toutLire(source.client);

    expect(lots.map((l) => [l.table, l.lignes])).toEqual([
      ["vehicle_snapshots", 10],
      ["vehicle_snapshots", 10],
      ["vehicle_snapshots", 5],
      ["service_history", 1],
      ["vehicle_commands_log", 2],
      ["poll_runs", 2],
      ["app_config", 2],
    ]);
    expect(lots.slice(0, -1).every((l) => !l.termine)).toBe(true);
    expect(lots.at(-1)!.termine).toBe(true);

    const ids = lots.filter((l) => l.table === "vehicle_snapshots").flatMap((l) => rangees(l).map((r) => r.row!.id as number));
    expect(new Set(ids).size).toBe(25);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("incrémental : avec le curseur final, seul le NOUVEAU sort, plus la config complète", async () => {
    await vider(source.client);
    await peupler(source.client, 12);
    const premiers = await toutLire(source.client);
    const final = decoderCurseur(premiers.at(-1)!.curseur)!;

    for (let i = 0; i < 3; i += 1) {
      await source.client.query(
        `INSERT INTO vehicle_snapshots (recorded_at, source, metric_type, value_numeric) VALUES ($1, 'smartcar', 'odometer', $2)`,
        [new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), 1000 + i],
      );
    }
    const apres = await toutLire(source.client, final);
    expect(apres.map((l) => l.table)).toEqual(["vehicle_snapshots", "app_config"]);
    expect(apres[0]!.lignes).toBe(3);
    expect(apres.at(-1)!.lignes).toBe(2);
    for (const l of apres.filter((x) => x.table === "vehicle_snapshots")) {
      for (const r of rangees(l)) expect(r.row!.id as number).toBeGreaterThan(final.vehicle_snapshots);
    }
  });

  it("une base à jour ne rend que la configuration, et annonce la fin", async () => {
    await vider(source.client);
    await peupler(source.client, 4);
    const final = decoderCurseur((await toutLire(source.client)).at(-1)!.curseur)!;
    const lots = await toutLire(source.client, final);
    expect(lots).toHaveLength(1);
    expect(lots[0]!.table).toBe("app_config");
    expect(lots[0]!.termine).toBe(true);
  });

  it("la borne d'octets coupe un lot, mais au moins UNE rangée sort toujours", async () => {
    await vider(source.client);
    await peupler(source.client, 5);
    const lot = await lireLot({ executer: executeur(source.client), curseur: curseurInitial(), cle: CLE, octetsMax: 1 });
    expect(lot.lignes).toBe(1);
    expect(decoderCurseur(lot.curseur)!.vehicle_snapshots).toBeGreaterThan(0);
  });

  it("ne sert que les tables prévues : aucun secret de courte durée, aucun cache", () => {
    expect([...TABLES_PAGINEES, "app_config"].sort()).toEqual([...TOUTES].sort());
    const exportees = readFileSync("lib/export/sauvegarde.ts", "utf8");
    expect(exportees).not.toMatch(/FROM otp_codes|FROM webhook_deliveries|FROM geocode_cache/);
  });
});

describe("restauration dans une base d'essai", () => {
  it("rend EXACTEMENT ce qui a été exporté, rejouée ne duplique rien, séquences recalées", async () => {
    await vider(source.client);
    await vider(cible.client);
    await peupler(source.client, 25);
    const lots = await toutLire(source.client);

    const clairs = lots.map((l) => lireFichier(l.fichier, CLE));
    const bilan = await restaurerLots(executeur(cible.client), clairs);
    expect(bilan.inserees.vehicle_snapshots).toBe(25);
    expect(bilan.inserees.poll_runs).toBe(2);
    expect(bilan.inserees.app_config).toBe(2);

    for (const t of TOUTES) {
      const ordre = t === "app_config" ? "key" : "id";
      const a = (await source.client.query(`SELECT to_jsonb(t) AS r FROM ${t} t ORDER BY ${ordre}`)).rows;
      const b = (await cible.client.query(`SELECT to_jsonb(t) AS r FROM ${t} t ORDER BY ${ordre}`)).rows;
      expect(b, t).toEqual(a);
    }

    // Rejouée : plus aucune rangée de mesure insérée (la config est réécrite, à l'identique).
    const encore = await restaurerLots(executeur(cible.client), clairs);
    expect(encore.inserees.vehicle_snapshots).toBe(0);
    expect((await cible.client.query(`SELECT count(*)::int AS n FROM vehicle_snapshots`)).rows[0]).toEqual({ n: 25 });

    // La séquence est recalée : une nouvelle mesure ne heurte pas un `id` restauré.
    await cible.client.query(
      `INSERT INTO vehicle_snapshots (recorded_at, source, metric_type) VALUES ('2027-01-01T00:00:00Z', 'smartcar', 'odometer')`,
    );
    const max = (await cible.client.query(`SELECT max(id)::int AS m, count(*)::int AS n FROM vehicle_snapshots`)).rows[0] as { m: number; n: number };
    expect(max.n).toBe(26);
    expect(max.m).toBeGreaterThan(25);
  });

  it("la configuration sauvegardée REMPLACE celle de la base cible", async () => {
    await vider(source.client);
    await vider(cible.client);
    await source.client.query(`INSERT INTO app_config (key, value) VALUES ('bail', '{"duree":36}'::jsonb)`);
    await cible.client.query(`INSERT INTO app_config (key, value) VALUES ('bail', '{"duree":1}'::jsonb)`);
    const lots = await toutLire(source.client);
    await restaurerLots(executeur(cible.client), lots.map((l) => lireFichier(l.fichier, CLE)));
    expect((await cible.client.query(`SELECT value FROM app_config WHERE key='bail'`)).rows[0]).toEqual({ value: { duree: 36 } });
  });

  it("refuse une table inconnue : un nom de table n'entre jamais dans une requête sans être listé", async () => {
    const piege = JSON.stringify({ type: "entete", version: 1 }) + "\n" + JSON.stringify({ table: "app_config; DROP TABLE vehicle_snapshots", row: {} }) + "\n";
    await expect(restaurerLots(executeur(cible.client), [piege])).rejects.toThrow(/Table inconnue/);
  });
});

describe("décision d'accès de la route (échec fermé)", () => {
  const ok = { EXPORT_TOKEN: "un-jeton-partage-assez-long", EXPORT_KEY: CLE.toString("base64") };

  it("503 sans jeton configuré, sans clé, ou avec une clé de mauvaise taille — même avec le bon jeton", () => {
    for (const env of [
      { EXPORT_KEY: ok.EXPORT_KEY },
      { EXPORT_TOKEN: ok.EXPORT_TOKEN },
      { ...ok, EXPORT_KEY: randomBytes(16).toString("base64") },
      {},
    ]) {
      expect(decider({ jeton: ok.EXPORT_TOKEN, apres: null, env })).toMatchObject({ type: "refus", statut: 503 });
    }
  });

  it("401 sans jeton, avec un mauvais jeton ou un jeton vide", () => {
    for (const jeton of [null, "", "mauvais", ok.EXPORT_TOKEN + "x"]) {
      expect(decider({ jeton, apres: null, env: ok })).toMatchObject({ type: "refus", statut: 401 });
    }
  });

  it("400 sur un curseur invalide, après l'authentification seulement", () => {
    expect(decider({ jeton: ok.EXPORT_TOKEN, apres: "n'importe quoi", env: ok })).toMatchObject({ type: "refus", statut: 400 });
    expect(decider({ jeton: "mauvais", apres: "n'importe quoi", env: ok })).toMatchObject({ statut: 401 });
  });

  it("feu vert : la clé et le curseur sont rendus", () => {
    const d = decider({ jeton: ok.EXPORT_TOKEN, apres: null, env: ok });
    expect(d.type).toBe("ok");
    if (d.type === "ok") {
      expect(d.cle.equals(CLE)).toBe(true);
      expect(d.curseur).toEqual(curseurInitial());
    }
  });

  it("la route passe par `decider`, ne journalise ni la clé ni le jeton, et n'accepte que GET", () => {
    const route = readFileSync("app/api/export/sauvegarde/route.ts", "utf8");
    expect(route).toContain("decider(");
    expect(route).not.toMatch(/console\.\w+\([^)]*(EXPORT_KEY|EXPORT_TOKEN)/);
    expect(route).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)/);
  });
});

describe("script de restauration (scripts/restaurer-sauvegarde.mjs)", () => {
  const lancer = (args: string[], env: Record<string, string>) =>
    spawnSync(process.execPath, ["scripts/restaurer-sauvegarde.mjs", ...args], {
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", ...env },
      encoding: "utf8",
    });

  async function dossierDeLots() {
    await vider(source.client);
    await peupler(source.client, 3);
    const dossier = mkdtempSync(join(tmpdir(), "carai-export-"));
    const lots = await toutLire(source.client);
    lots.forEach((l, i) => writeFileSync(join(dossier, `carai-2026-10-21T00-00-0${i}-${l.table}.carai`), l.fichier));
    return dossier;
  }

  it("mauvaise clé : refuse AVANT toute écriture, même avec une cible configurée", async () => {
    const dossier = await dossierDeLots();
    try {
      const r = lancer([dossier], {
        EXPORT_KEY: randomBytes(32).toString("base64"),
        RESTAURATION_DATABASE_URL: "postgresql://x:y@invalide.example.invalid/z",
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/mauvaise clé|altéré/);
      expect(r.stdout).not.toMatch(/Restauration terminée/);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it("n'utilise JAMAIS DATABASE_URL : sans RESTAURATION_DATABASE_URL, elle s'arrête après la vérification", async () => {
    const dossier = await dossierDeLots();
    try {
      const r = lancer([dossier], {
        EXPORT_KEY: CLE.toString("base64"),
        DATABASE_URL: "postgresql://prod:prod@prod.example.invalid/prod",
      });
      expect(r.status).toBe(2);
      expect(r.stdout).toMatch(/déchiffré\(s\) et vérifié\(s\)/);
      expect(r.stderr).toMatch(/RESTAURATION_DATABASE_URL absente/);
    } finally {
      rmSync(dossier, { recursive: true, force: true });
    }
  });

  it("sans clé ou sans fichier : message clair, code 2", () => {
    expect(lancer([], { EXPORT_KEY: CLE.toString("base64") }).status).toBe(2);
    const r = lancer([tmpdir()], {});
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/EXPORT_KEY/);
  });

  it("refuse une base cible qui contient déjà des mesures, sauf demande explicite (verrou dans le source)", () => {
    const script = readFileSync("scripts/restaurer-sauvegarde.mjs", "utf8");
    expect(script).toContain("--forcer-non-vide");
    expect(script).toMatch(/n > 0 && !forcer/);
    expect(script).not.toMatch(/process\.env\.DATABASE_URL/);
  });
});
