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
    /**
     * `false` = ne pas compter. Le `count(*)` balaie toute la sélection : le TABLEAU en a
     * besoin une fois par page affichée, mais l'export en boucle le recomptait à CHAQUE
     * page pour jeter le résultat — des millions de lignes re-scannées pour rien sur une
     * table qui grandit des années (revue du 06/08).
     */
    avecTotal?: boolean;
    dbx?: Dbx;
  } = {},
): Promise<{ lignes: VehicleSnapshot[]; total: number | null }> {
  const {
    filtres = {},
    limite = 100,
    offset = 0,
    curseur = null,
    avecTotal = true,
    dbx = db,
  } = options;
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
    avecTotal
      ? dbx.select({ total: sql<number>`count(*)::int` }).from(vehicleSnapshots).where(filtre)
      : Promise.resolve(null),
  ]);

  return {
    lignes: lignes.map(normaliserDates),
    total: comptes === null ? null : Number(comptes[0]?.total ?? 0),
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
 * Une mesure est-elle une POSITION ? Garde par CONTENU, jamais par identité seule.
 *
 * ══ POURQUOI (finding HIGH de la revue du 06/08/2026, prouvé par exécution) ══════════
 * Le pipeline stocke volontairement tout code INCONNU sous sa propre métrique, et le repli
 * « corps entier » conserve un body `{latitude, longitude, …}` quel que soit le code. Une
 * garde énumérative (`metricType === "location"`) est donc FAIL-OPEN : un
 * `location-approximatelocation` ajouté par Smartcar — ou une position du futur adaptateur
 * Toyota sous un code non catalogué — passerait au travers et afficherait ses coordonnées
 * en clair. Quatre signaux indépendants, il suffit qu'UN se déclenche :
 * métrique connue, préfixe du code source, type de position porté par la ligne, ou
 * coordonnées présentes dans le JSON lui-même.
 */
export function estPosition(mesure: VehicleSnapshot): boolean {
  if (mesure.metricType === "location") return true;
  if (mesure.signalCode?.toLowerCase().startsWith("location")) return true;
  if (mesure.locationType !== null) return true;
  if (mesure.valueJson && typeof mesure.valueJson === "object") {
    const cles = new Set(Object.keys(mesure.valueJson as object).map((c) => c.toLowerCase()));
    if (cles.has("latitude") || cles.has("longitude") || cles.has("lat") || cles.has("lng")) {
      return true;
    }
  }
  return false;
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
  if (estPosition(mesure)) {
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

/**
 * Normalise une période venue de l'URL vers une clé VALIDE. Tout ce qui n'est pas une clé
 * propre de PERIODES — valeur inconnue, signet périmé, et surtout un nom de la chaîne de
 * prototypes comme `constructor` (revue du 06/08 : il passait `in` et produisait une date
 * invalide) — retombe sur `tout`. L'appelant affiche la clé NORMALISÉE : le sélecteur ne
 * doit jamais dire « 24h » pendant que la table couvre tout l'historique.
 */
export function periodeValide(periode: string | null | undefined): Periode {
  return periode && Object.hasOwn(PERIODES, periode) ? (periode as Periode) : "tout";
}

export function depuisPourPeriode(periode: string | undefined, maintenant: Date): Date | null {
  const duree = PERIODES[periodeValide(periode)];
  if (duree === null) return null;
  return new Date(maintenant.getTime() - duree);
}

/**
 * Page réellement affichable : bornée à [1, nombre de pages]. Une page au-delà de la fin
 * (vieux lien, sélection qui a rétréci sous le rafraîchissement automatique) doit montrer
 * la DERNIÈRE page — pas « aucune mesure ne correspond » avec des milliers de mesures
 * présentes et plus aucun lien pour revenir (revue du 06/08).
 */
export function pageEffective(demandee: number, total: number, taillePage: number): number {
  const pages = Math.max(1, Math.ceil(total / taillePage));
  if (!Number.isInteger(demandee) || demandee < 1) return 1;
  return Math.min(demandee, pages);
}
