// lib/vehicle/inventaire.ts — inventaire de ce que la base contient RÉELLEMENT.
//
// Répond à la question de Marc du 06/08/2026 : « vérifie qu'on a bien toutes les données ».
// Le tableau de bord montre la DERNIÈRE valeur de chaque métrique ; il ne peut pas montrer
// une ABSENCE. Une métrique jamais reçue n'y laisse aucune trace — précisément le genre de
// silence que cet inventaire rend visible, en comparant le contenu de la base à la liste des
// signaux que la bZ a confirmés (`SIGNAUX_CONFIRMES_BZ`).
//
// C'est aussi la fondation des graphiques à venir : les mêmes agrégats (nombre de mesures,
// première et dernière date par métrique) disent quelles séries sont assez fournies pour
// être tracées.

import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookDeliveries } from "@/lib/db/schema";
import { SIGNAUX_CONFIRMES_BZ } from "@/lib/smartcar/signals";

/** Une ligne d'inventaire : ce que la base sait d'une métrique pour une source. */
export interface LigneInventaire {
  source: string;
  metricType: string;
  signalCode: string | null;
  /** Nombre de MESURES conservées (pas de livraisons : la déduplication est passée avant). */
  nbMesures: number;
  premiere: Date;
  derniere: Date;
}

type Dbx = Pick<typeof db, "execute" | "select">;

/**
 * Agrégat par (source, métrique, code). Une seule requête, servie par l'index
 * `vehicle_snapshots_metric_date` — elle doit rester plate même après des années de lignes.
 */
export async function inventaireMesures(dbx: Dbx = db): Promise<LigneInventaire[]> {
  const resultat = await dbx.execute(sql`
    SELECT
      source,
      metric_type AS "metricType",
      signal_code AS "signalCode",
      COUNT(*)::int AS "nbMesures",
      MIN(recorded_at) AS premiere,
      MAX(recorded_at) AS derniere
    FROM vehicle_snapshots
    GROUP BY source, metric_type, signal_code
    ORDER BY source, metric_type, signal_code
  `);

  const lignes = ((resultat as { rows?: unknown[] }).rows ??
    (Array.isArray(resultat) ? resultat : [])) as Array<
    Omit<LigneInventaire, "premiere" | "derniere" | "nbMesures"> & {
      nbMesures: number | string;
      premiere: Date | string;
      derniere: Date | string;
    }
  >;

  return lignes.map((l) => ({
    source: l.source,
    metricType: l.metricType,
    signalCode: l.signalCode,
    // `COUNT(*)` remonte en `string` chez certains pilotes Postgres — on normalise ici
    // plutôt que de laisser chaque appelant redécouvrir ce piège.
    nbMesures: Number(l.nbMesures),
    premiere: l.premiere instanceof Date ? l.premiere : new Date(l.premiere),
    derniere: l.derniere instanceof Date ? l.derniere : new Date(l.derniere),
  }));
}

/** Une livraison de webhook telle que tracée — pour lire le rythme d'arrivée d'un coup d'œil. */
export interface LigneLivraison {
  eventId: string;
  eventType: string;
  receivedAt: Date;
  snapshotsWritten: number;
}

/** Les dernières livraisons, plus récentes d'abord. */
export async function journalLivraisons(
  limite = 30,
  dbx: Dbx = db,
): Promise<LigneLivraison[]> {
  const lignes = await dbx
    .select({
      eventId: webhookDeliveries.eventId,
      eventType: webhookDeliveries.eventType,
      receivedAt: webhookDeliveries.receivedAt,
      snapshotsWritten: webhookDeliveries.snapshotsWritten,
    })
    .from(webhookDeliveries)
    .orderBy(desc(webhookDeliveries.receivedAt))
    .limit(limite);

  return lignes.map((l) => ({
    ...l,
    receivedAt: l.receivedAt instanceof Date ? l.receivedAt : new Date(l.receivedAt),
  }));
}

/** Verdict de couverture : la base contre la liste des signaux confirmés. */
export interface BilanCouverture {
  /** Signaux confirmés dont AU MOINS une mesure est en base. */
  recus: string[];
  /** Signaux confirmés JAMAIS vus en base — c'est la ligne à lire en premier. */
  manquants: string[];
  /** Codes présents en base mais hors liste : rien d'anormal, mais ça se dit. */
  horsListe: string[];
}

/**
 * PURE : ne touche pas la base, se teste sans elle.
 *
 * Seule la source `smartcar` est comparée à la liste : les signaux confirmés viennent du
 * rapport Smartcar, une mesure Toyota ou manuelle ne prouve rien sur cette souscription-là.
 */
export function bilanCouverture(inventaire: LigneInventaire[]): BilanCouverture {
  const codesEnBase = new Set(
    inventaire
      .filter((l) => l.source === "smartcar" && l.signalCode)
      .map((l) => l.signalCode as string),
  );

  const attendus = new Set(SIGNAUX_CONFIRMES_BZ);
  return {
    recus: SIGNAUX_CONFIRMES_BZ.filter((code) => codesEnBase.has(code)),
    manquants: SIGNAUX_CONFIRMES_BZ.filter((code) => !codesEnBase.has(code)),
    horsListe: [...codesEnBase].filter((code) => !attendus.has(code)).sort(),
  };
}
