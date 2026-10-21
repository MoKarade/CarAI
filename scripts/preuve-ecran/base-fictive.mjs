// scripts/preuve-ecran/base-fictive.mjs — une base FICTIVE derrière le protocole HTTP de Neon.
//
// Sert UNIQUEMENT au contrôle par navigateur (lancer.mjs) : l'app construite parle à Neon en
// HTTP (`neon()`), donc on lui répond comme Neon, depuis PGlite (Postgres en WASM) migrée par
// les VRAIES migrations de `drizzle/` et remplie de relevés inventés. Rien de ceci n'est lu par
// le build servi ; aucune donnée personnelle, aucune adresse réelle.
//
// ⚠️ Aucune de ces valeurs n'est une mesure : un trajet type de 40 km à 17 kWh/100 km, une
// recharge la nuit. Elles existent pour que l'écran ait quelque chose à tracer.
//
// Le rythme change d'une semaine à l'autre (×1, ×0,7, ×1,3, du plus récent au plus ancien) : une
// prévision de fin de mois (CarAI#31) donne une FOURCHETTE, et sur un rythme parfaitement
// régulier elle se réduirait à un point que rien ne permettrait de distinguer d'un bug.

import http from "node:http";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const CAPACITE_KWH = 71.4;
const KM_PAR_DEMI_HEURE = 20;
const KWH_PAR_100_KM = 17;

/** Facteur de rythme du bloc de 7 jours (0 = le plus récent) auquel appartient l'instant `t`. */
const FACTEURS_SEMAINE = [1, 0.7, 1.3];

/** Pas de 30 min sur `jours` jours se terminant à `fin`. PURE, sauf `Date`. */
export function relevesFictifs({ fin = new Date(), jours = 6 } = {}) {
  const PAS = 30 * 60_000;
  const debut = fin.getTime() - jours * 86_400_000;
  const lignes = [];
  let soc = 88;
  let km = 12_000;

  const ajoute = (t, metricType, valeur, unite, extra = {}) =>
    lignes.push({ t, metricType, valeur, unite, ...extra });

  for (let t = debut; t <= fin.getTime(); t += PAS) {
    const heure = new Date(t).getUTCHours() - 4; // fuseau de l'Est, sans se soucier de l'heure d'été
    const h = (heure + 24) % 24;
    const enRoute = (h >= 7 && h < 9) || (h >= 17 && h < 19);
    const enCharge = h >= 22 || h < 1;

    if (enRoute) {
      const semaine = Math.floor((fin.getTime() - t) / (7 * 86_400_000));
      const parPas = KM_PAR_DEMI_HEURE * FACTEURS_SEMAINE[semaine % FACTEURS_SEMAINE.length];
      km += parPas;
      soc -= ((parPas * KWH_PAR_100_KM) / 100 / CAPACITE_KWH) * 100;
    } else if (enCharge) {
      soc = Math.min(90, soc + 6);
    }

    const date = new Date(t);
    ajoute(date, "battery_soc", Math.round(soc * 10) / 10, "%");
    ajoute(date, "odometer", km, "km");
    ajoute(date, "battery_range", Math.round(soc * 4.2), "km");
    ajoute(date, "outside_temperature", Math.round((6 + 5 * Math.sin(t / 5_400_000)) * 10) / 10, "°C");
  }

  ajoute(new Date(fin.getTime() - 60_000), "battery_capacity_nominal", null, null, {
    json: { capacity: CAPACITE_KWH, source: "essai" },
  });
  return lignes;
}

async function remplir(client, lignes) {
  for (const l of lignes) {
    await client.query(
      `INSERT INTO vehicle_snapshots
         (recorded_at, received_at, source, metric_type, signal_code, signal_status, value_numeric, value_json, unit)
       VALUES ($1, $1, 'smartcar', $2, $3, 'SUCCESS', $4, $5::jsonb, $6)`,
      [l.t.toISOString(), l.metricType, `essai-${l.metricType}`, l.valeur, l.json ? JSON.stringify(l.json) : null, l.unite],
    );
  }
}

/** Chaque type renvoyé tel quel (texte) : c'est ce que Neon fait avec `Neon-Raw-Text-Output`. */
const PARSERS_TEXTE = Object.fromEntries(Array.from({ length: 5000 }, (_, oid) => [oid, (v) => v]));

function resultat(r) {
  return {
    command: "SELECT",
    rowCount: r.affectedRows ?? r.rows.length,
    rows: r.rows,
    fields: r.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
    rowAsArray: true,
  };
}

async function executer(client, { query, params }) {
  const r = await client.query(query, params ?? [], { rowMode: "array", parsers: PARSERS_TEXTE });
  return resultat(r);
}

/** Démarre la base et son serveur HTTP. Rend `{ port, arreter }`. */
export async function demarrerBaseFictive({ port = 0, jours } = {}) {
  const client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: resolve(process.cwd(), "drizzle") });
  await remplir(client, relevesFictifs({ jours }));

  const serveur = http.createServer(async (req, rep) => {
    const morceaux = [];
    for await (const m of req) morceaux.push(m);
    try {
      const corps = JSON.parse(Buffer.concat(morceaux).toString("utf8"));
      let sortie;
      if (Array.isArray(corps.queries)) {
        sortie = { results: [] };
        await client.transaction(async (tx) => {
          for (const q of corps.queries) {
            const r = await tx.query(q.query, q.params ?? [], { rowMode: "array", parsers: PARSERS_TEXTE });
            sortie.results.push(resultat(r));
          }
        });
      } else {
        sortie = await executer(client, corps);
      }
      rep.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(sortie));
    } catch (e) {
      rep
        .writeHead(400, { "content-type": "application/json" })
        .end(JSON.stringify({ message: String(e?.message ?? e), severity: "ERROR", code: e?.code ?? "XX000" }));
    }
  });
  await new Promise((ok) => serveur.listen(port, "127.0.0.1", ok));

  return {
    port: serveur.address().port,
    arreter: async () => {
      await new Promise((ok) => serveur.close(ok));
      await client.close();
    },
  };
}
