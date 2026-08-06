// lib/vehicle/mesures.ts — requête FILTRÉE des mesures : le moteur du tableau et de
// l'export CSV de l'onglet Base de données.
//
// Une seule implémentation pour les deux consommateurs : un tableau qui filtre d'un côté
// et un export qui filtre de l'autre finiraient par diverger, et l'export « complet »
// omettrait ce que le tableau montre (leçon JobAI sur les listes recopiées).

import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { vehicleSnapshots, type Source, type VehicleSnapshot } from "@/lib/db/schema";

export interface FiltresMesures {
  /** Restreint à une métrique (`battery_soc`, …). `null`/absent = toutes. */
  metricType?: string | null;
  /** Restreint à une source (`smartcar`, …). `null`/absent = toutes. */
  source?: string | null;
  /** Ne garde que les mesures dont l'instant de MESURE est ≥ cette date. */
  depuis?: Date | null;
}

type Dbx = Pick<typeof db, "select">;

function conditions(filtres: FiltresMesures): SQL | undefined {
  const clauses: SQL[] = [];
  if (filtres.metricType) clauses.push(eq(vehicleSnapshots.metricType, filtres.metricType));
  // Le filtre vient de l'URL : une valeur hors de l'union `Source` est simplement une
  // sélection VIDE (paramétrée par Drizzle, donc sans risque d'injection) — pas une erreur.
  if (filtres.source) clauses.push(eq(vehicleSnapshots.source, filtres.source as Source));
  if (filtres.depuis) clauses.push(gte(vehicleSnapshots.recordedAt, filtres.depuis));
  return clauses.length > 0 ? and(...clauses) : undefined;
}

/** Curseur de pagination STABLE : la position exacte de la dernière ligne servie. */
export interface CurseurMesures {
  recordedAt: Date;
  id: number;
}

/**
 * Liste paginée + TOTAL de la sélection. Le total accompagne toujours la page : « 100
 * lignes affichées » sans « sur 8 412 » laisserait croire que la base s'arrête là — le
 * malentendu exact qui a fait dire « j'ai pas toutes les données ».
 *
 * Deux paginations, deux usages :
 * - `offset` pour le TABLEAU interactif (pages numérotées, sélection re-requêtée à
 *   chaque affichage — un décalage ponctuel se corrige au rafraîchissement suivant) ;
 * - `curseur` pour l'EXPORT : sur une table alimentée en continu, un offset se décale à
 *   chaque insert entre deux pages et DUPLIQUE des lignes en silence (leçon DriveAI sur
 *   les files mouvantes). Le curseur fige la position — stable par construction.
 */
export async function listerMesures(
  options: {
    filtres?: FiltresMesures;
    limite?: number;
    offset?: number;
    curseur?: CurseurMesures | null;
    dbx?: Dbx;
  } = {},
): Promise<{ lignes: VehicleSnapshot[]; total: number }> {
  const { filtres = {}, limite = 100, offset = 0, curseur = null, dbx = db } = options;
  const filtre = conditions(filtres);

  const apresCurseur = curseur
    ? or(
        lt(vehicleSnapshots.recordedAt, curseur.recordedAt),
        and(
          eq(vehicleSnapshots.recordedAt, curseur.recordedAt),
          lt(vehicleSnapshots.id, curseur.id),
        ),
      )
    : undefined;
  const ou = apresCurseur ? (filtre ? and(filtre, apresCurseur) : apresCurseur) : filtre;

  const [lignes, comptes] = await Promise.all([
    dbx
      .select()
      .from(vehicleSnapshots)
      .where(ou)
      .orderBy(desc(vehicleSnapshots.recordedAt), desc(vehicleSnapshots.id))
      .limit(limite)
      .offset(curseur ? 0 : offset),
    // Le total reste celui du FILTRE (pas du curseur) : c'est le « sur N » de l'écran.
    dbx.select({ total: sql<number>`count(*)::int` }).from(vehicleSnapshots).where(filtre),
  ]);

  return {
    lignes: lignes.map(normaliserDates),
    total: Number(comptes[0]?.total ?? 0),
  };
}

/** Certains pilotes rendent les timestamps en chaînes : on normalise UNE fois, ici. */
function normaliserDates(l: VehicleSnapshot): VehicleSnapshot {
  return {
    ...l,
    recordedAt: l.recordedAt instanceof Date ? l.recordedAt : new Date(l.recordedAt),
    receivedAt: l.receivedAt instanceof Date ? l.receivedAt : new Date(l.receivedAt),
  };
}

/**
 * Valeur d'une mesure pour l'AFFICHAGE du tableau. PURE, testée.
 *
 * Règle de vie privée : le contenu d'une POSITION ne s'affiche jamais à l'écran — les
 * coordonnées restent en base et sortent par l'export CSV (téléchargement authentifié),
 * pas dans une page ouverte sur un coin de bureau. Les autres détails JSON (pressions des
 * quatre pneus, minuteries de charge…) s'affichent : c'est pour les voir que le tableau
 * existe.
 */
export function valeurAffichable(mesure: VehicleSnapshot): string {
  if (mesure.metricType === "location" || mesure.signalCode === "location-preciselocation") {
    return "position (voir export CSV)";
  }
  if (mesure.valueNumeric !== null) {
    return `${mesure.valueNumeric}${mesure.unit ? ` ${mesure.unit}` : ""}`;
  }
  if (mesure.valueText !== null) return mesure.valueText;
  if (mesure.valueJson !== null && mesure.valueJson !== undefined) {
    const texte = JSON.stringify(mesure.valueJson);
    return texte.length > 120 ? `${texte.slice(0, 117)}…` : texte;
  }
  return "non communiqué";
}

/** Fenêtres de temps proposées par le filtre. `null` = tout l'historique. */
export const PERIODES = {
  "24h": 24 * 3_600_000,
  "7j": 7 * 86_400_000,
  "30j": 30 * 86_400_000,
  tout: null,
} as const;
export type Periode = keyof typeof PERIODES;

export function depuisPourPeriode(periode: string | undefined, maintenant: Date): Date | null {
  const duree = PERIODES[(periode ?? "tout") as Periode];
  if (duree === null || duree === undefined) return null;
  return new Date(maintenant.getTime() - duree);
}
