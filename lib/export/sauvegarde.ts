// lib/export/sauvegarde.ts — la SAUVEGARDE EXTERNE de la base (CarAI#13, [DATA-01]).
//
// ══ POURQUOI ═════════════════════════════════════════════════════════════════════════
//
// Neon gratuit n'offre qu'une restauration courte : des mois d'historique du véhicule peuvent
// se perdre. Marc a choisi (21/10/2026) la VOIE B : CarAI ne parle jamais à Google. CarAI
// SERT l'export chiffré par une route à jeton, et c'est le script DriveAI qui le vient chercher
// et le dépose dans le dossier Drive dédié. Aucun jeton Google ici, aucune autorisation de
// plus. Interface complète pour DriveAI : `docs/export-sauvegarde.md`.
//
// ══ CE QUI SORT, ET CE QUI RESTE ═════════════════════════════════════════════════════
//
// Sortent : `vehicle_snapshots` (l'historique, la raison d'être), `service_history`,
// `vehicle_commands_log`, `poll_runs`, `app_config` (termes du bail, identifiants de flux).
// Restent : `otp_codes` (secrets de quelques minutes), `webhook_deliveries` (journal
// d'idempotence dont le brut est déjà purgé), `geocode_cache` (se reconstruit seul).
//
// ══ LE FICHIER ═══════════════════════════════════════════════════════════════════════
//
// Un LOT = un fichier autonome : NDJSON (une ligne JSON par rangée), compressé (gzip), puis
// chiffré AES-256-GCM. Le déchiffrement échoue bruyamment à la moindre altération (étiquette
// GCM), jamais en rendant des données fausses. Disposition binaire :
//   « CARAIX » (6 octets) · version (1 octet, 0x01) · IV (12 octets) · chiffré · étiquette (16)
// L'en-tête (magie + version) est authentifié (AAD). La clé (`EXPORT_KEY`, 32 octets en
// base64) ne quitte jamais CarAI ni le coffre de Marc : DriveAI range des octets qu'il ne
// sait pas lire.
//
// ══ L'ORDRE ET LE CURSEUR ════════════════════════════════════════════════════════════
//
// Un appel rend UN lot : les rangées suivantes de la première table non épuisée (au plus
// `LIGNES_MAX_PAR_LOT`, ou `OCTETS_MAX_PAR_LOT` de clair), en ordre d'`id`. Le curseur
// (dernier `id` rendu par table, base64url) permet de reprendre, et de ne demander que le
// NOUVEAU la fois suivante. Quand toutes les tables sont à jour, le dernier lot porte
// `app_config` EN ENTIER (petite table qui se MODIFIE : un delta ne la représente pas) et
// annonce `termine`.
//
// ⚠️ Un `id` en série peut se valider dans le désordre sous écritures concurrentes : un export
// incrémental peut en rater une rangée. D'où l'export COMPLET périodique (sans curseur) que le
// spec demande à DriveAI.
//
// Ce fichier n'importe RIEN du projet : le script de restauration (`scripts/`) le charge
// directement par Node.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

/** Tables paginées par `id`, dans l'ordre où elles sont servies. */
export const TABLES_PAGINEES = [
  "vehicle_snapshots",
  "service_history",
  "vehicle_commands_log",
  "poll_runs",
] as const;
type TablePaginee = (typeof TABLES_PAGINEES)[number];

/** Table complète, servie dans le dernier lot. */
const TABLE_CONFIG = "app_config";

const LIGNES_MAX_PAR_LOT = 10_000;
/**
 * Clair maximal d'un lot. Une réponse Vercel plafonne à 4,5 Mo : le gzip d'un NDJSON de
 * mesures divise par dix ou plus, donc 4 Mo de clair laissent une grande marge.
 */
const OCTETS_MAX_PAR_LOT = 4_000_000;

const MAGIE = Buffer.from("CARAIX", "ascii");
const VERSION = 1;
const ENTETE = Buffer.concat([MAGIE, Buffer.from([VERSION])]);
const LONGUEUR_IV = 12;
const LONGUEUR_ETIQUETTE = 16;

/** `base de données → rangées` : ce que PGlite (tests) et Neon (production) savent faire. */
export type Executeur = (texte: string, params: unknown[]) => Promise<Array<Record<string, unknown>>>;

export type Curseur = Record<TablePaginee, number>;

export function curseurInitial(): Curseur {
  return { vehicle_snapshots: 0, service_history: 0, vehicle_commands_log: 0, poll_runs: 0 };
}

export function encoderCurseur(c: Curseur): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

/** `null` si le curseur n'a pas EXACTEMENT la forme attendue : rien d'inconnu n'est toléré. */
export function decoderCurseur(brut: string | null): Curseur | null {
  if (brut === null || brut === "") return curseurInitial();
  try {
    const obj: unknown = JSON.parse(Buffer.from(brut, "base64url").toString("utf8"));
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
    const cles = Object.keys(obj);
    if (cles.length !== TABLES_PAGINEES.length) return null;
    const c = curseurInitial();
    for (const t of TABLES_PAGINEES) {
      const v = (obj as Record<string, unknown>)[t];
      if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return null;
      c[t] = v;
    }
    return c;
  } catch {
    return null;
  }
}

/** La clé de chiffrement : 32 octets en base64. `null` si absente ou de mauvaise taille. */
export function cleDepuisEnv(valeur: string | undefined): Buffer | null {
  const v = valeur?.trim();
  if (!v) return null;
  const cle = Buffer.from(v, "base64");
  return cle.length === 32 ? cle : null;
}

export function chiffrer(clair: Buffer, cle: Buffer): Buffer {
  const iv = randomBytes(LONGUEUR_IV);
  const chiffre = createCipheriv("aes-256-gcm", cle, iv);
  chiffre.setAAD(ENTETE);
  const corps = Buffer.concat([chiffre.update(clair), chiffre.final()]);
  return Buffer.concat([ENTETE, iv, corps, chiffre.getAuthTag()]);
}

/** Lève si le fichier n'est pas un lot CarAI, si la clé est fausse ou si un octet a changé. */
export function dechiffrer(fichier: Buffer, cle: Buffer): Buffer {
  const minimum = ENTETE.length + LONGUEUR_IV + LONGUEUR_ETIQUETTE;
  if (fichier.length < minimum || !fichier.subarray(0, MAGIE.length).equals(MAGIE)) {
    throw new Error("Ce fichier n'est pas un lot d'export CarAI.");
  }
  if (fichier[MAGIE.length] !== VERSION) {
    throw new Error(`Version de lot inconnue (${fichier[MAGIE.length]}) : seule la version ${VERSION} est lue.`);
  }
  const iv = fichier.subarray(ENTETE.length, ENTETE.length + LONGUEUR_IV);
  const etiquette = fichier.subarray(fichier.length - LONGUEUR_ETIQUETTE);
  const corps = fichier.subarray(ENTETE.length + LONGUEUR_IV, fichier.length - LONGUEUR_ETIQUETTE);
  const dechiffre = createDecipheriv("aes-256-gcm", cle, iv);
  dechiffre.setAAD(ENTETE);
  dechiffre.setAuthTag(etiquette);
  try {
    return Buffer.concat([dechiffre.update(corps), dechiffre.final()]);
  } catch {
    throw new Error("Déchiffrement impossible : mauvaise clé, ou fichier altéré.");
  }
}

export interface Lot {
  /** Le fichier chiffré, prêt à être déposé tel quel. */
  fichier: Buffer;
  /** À repasser en `apres` pour le lot suivant ; à garder après le dernier pour l'incrémental. */
  curseur: string;
  termine: boolean;
  /** Rangées de données dans ce lot (hors ligne d'en-tête). */
  lignes: number;
  table: string;
}

function emballer(table: string, rangees: unknown[], genereLe: Date, cle: Buffer, curseur: Curseur, termine: boolean): Lot {
  const entete = JSON.stringify({
    type: "entete",
    version: VERSION,
    table,
    genere: genereLe.toISOString(),
    lignes: rangees.length,
    complet: table === TABLE_CONFIG,
  });
  const lignes = rangees.map((r) => JSON.stringify({ table, row: r }));
  const clair = Buffer.from([entete, ...lignes].join("\n") + "\n", "utf8");
  return {
    fichier: chiffrer(gzipSync(clair), cle),
    curseur: encoderCurseur(curseur),
    termine,
    lignes: rangees.length,
    table,
  };
}

/** Le prochain lot à partir du curseur. Lit la base ; ne l'écrit jamais. */
export async function lireLot(params: {
  executer: Executeur;
  curseur: Curseur;
  cle: Buffer;
  maintenant?: Date;
  lignesMax?: number;
  octetsMax?: number;
}): Promise<Lot> {
  const {
    executer,
    cle,
    maintenant = new Date(),
    lignesMax = LIGNES_MAX_PAR_LOT,
    octetsMax = OCTETS_MAX_PAR_LOT,
  } = params;
  const curseur: Curseur = { ...params.curseur };

  for (const table of TABLES_PAGINEES) {
    // `to_jsonb(t)` : les types (horodatages, jsonb, doubles) sortent de Postgres lui-même,
    // identiques quel que soit le pilote — et `jsonb_populate_recordset` les relit à l'envers.
    const rangees = await executer(
      `SELECT id, to_jsonb(t) AS rangee FROM ${table} t WHERE id > $1 ORDER BY id LIMIT $2`,
      [curseur[table], lignesMax],
    );
    if (rangees.length === 0) continue;

    const retenues: unknown[] = [];
    let octets = 0;
    for (const r of rangees) {
      const taille = JSON.stringify(r.rangee).length;
      // Au moins UNE rangée par lot, même énorme : sans ça, une rangée plus grosse que la
      // borne bloquerait l'export pour toujours.
      if (retenues.length > 0 && octets + taille > octetsMax) break;
      retenues.push(r.rangee);
      octets += taille;
      curseur[table] = Number(r.id);
    }
    return emballer(table, retenues, maintenant, cle, curseur, false);
  }

  const config = await executer(`SELECT to_jsonb(t) AS rangee FROM ${TABLE_CONFIG} t ORDER BY key`, []);
  return emballer(TABLE_CONFIG, config.map((r) => r.rangee), maintenant, cle, curseur, true);
}

// ══ RESTAURATION ═════════════════════════════════════════════════════════════════════

export interface BilanRestauration {
  /** Rangées lues dans le fichier, par table. */
  lues: Record<string, number>;
  /** Rangées réellement insérées (le reste existait déjà). */
  inserees: Record<string, number>;
}

const TAILLE_PAQUET_RESTAURATION = 500;
const TABLES_CONNUES: readonly string[] = [...TABLES_PAGINEES, TABLE_CONFIG];

/**
 * Relit des lots déchiffrés dans une base DÉJÀ migrée. Idempotente : une rangée déjà là est
 * laissée telle quelle (config : remplacée par la version sauvegardée). Les séquences `id`
 * sont recalées pour que les écritures suivantes ne rentrent pas en collision.
 *
 * ⚠️ À lancer sur une base d'ESSAI d'abord. Le script (`scripts/restaurer-sauvegarde.mjs`)
 * refuse une base qui contient déjà des mesures, sauf demande explicite.
 */
export async function restaurerLots(executer: Executeur, ndjson: string[]): Promise<BilanRestauration> {
  const lues: Record<string, number> = {};
  const inserees: Record<string, number> = {};

  for (const texte of ndjson) {
    const parTable = new Map<string, unknown[]>();
    for (const ligne of texte.split("\n")) {
      if (!ligne.trim()) continue;
      const obj = JSON.parse(ligne) as { type?: string; version?: number; table?: string; row?: unknown };
      if (obj.type === "entete") {
        if (obj.version !== VERSION) throw new Error(`Version de contenu inconnue : ${obj.version}.`);
        continue;
      }
      // Liste blanche : un nom de table n'entre JAMAIS dans une requête sans y figurer.
      if (!obj.table || !TABLES_CONNUES.includes(obj.table)) {
        throw new Error(`Table inconnue dans le lot : ${String(obj.table)}.`);
      }
      const liste = parTable.get(obj.table) ?? [];
      liste.push(obj.row);
      parTable.set(obj.table, liste);
    }

    for (const [table, rangees] of parTable) {
      for (let i = 0; i < rangees.length; i += TAILLE_PAQUET_RESTAURATION) {
        const paquet = rangees.slice(i, i + TAILLE_PAQUET_RESTAURATION);
        const conflit =
          table === TABLE_CONFIG
            ? "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at"
            : "ON CONFLICT DO NOTHING";
        const res = await executer(
          `WITH ins AS (INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(null::${table}, $1::jsonb) ${conflit} RETURNING 1) SELECT count(*)::int AS n FROM ins`,
          [JSON.stringify(paquet)],
        );
        lues[table] = (lues[table] ?? 0) + paquet.length;
        inserees[table] = (inserees[table] ?? 0) + Number(res[0]?.n ?? 0);
      }
    }
  }

  for (const table of TABLES_PAGINEES) {
    await executer(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT COALESCE(MAX(id), 0) + 1 FROM ${table}), false)`,
      [],
    );
  }
  return { lues, inserees };
}

/** Décode un fichier de lot en NDJSON clair. Lève si la clé est fausse ou le fichier altéré. */
export function lireFichier(fichier: Buffer, cle: Buffer): string {
  return gunzipSync(dechiffrer(fichier, cle)).toString("utf8");
}
