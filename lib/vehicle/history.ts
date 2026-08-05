// lib/vehicle/history.ts — séries temporelles pour graphiques et tendances (Doc 4 §3.2).
//
// Objectif explicite de Marc, cité au Doc 1 §1 : « je veux récupérer toute l'info possible
// pour ensuite la transformer en graph estimations etc ». Ce module rend l'historique
// exploitable sans le déformer.
//
// La politique de rétention est ILLIMITÉE (Doc 1 §4.2). Sur plusieurs années, une métrique
// interrogée à la seconde produirait des centaines de milliers de points — d'où la
// granularité, qui agrège CÔTÉ BASE plutôt que de tout rapatrier pour le réduire ensuite.

import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { vehicleSnapshots, type Source } from "@/lib/db/schema";

export const GRANULARITES = ["brut", "heure", "jour", "semaine"] as const;
export type Granularite = (typeof GRANULARITES)[number];

export interface PointSerie {
  instant: Date;
  valeur: number | null;
  source: string;
  /** Nombre de mesures agrégées dans ce point (1 en granularité brute). */
  echantillons: number;
}

export interface Serie {
  metricType: string;
  unite: string | null;
  granularite: Granularite;
  points: PointSerie[];
  /** Vrai si la fenêtre demandée ne contient aucune mesure — à DIRE, pas à masquer par une série vide. */
  vide: boolean;
}

/**
 * Série temporelle d'une métrique.
 *
 * ⚠️ L'agrégation porte sur la MOYENNE des valeurs numériques. C'est juste pour un état de
 * charge ou une vitesse ; ça ne l'est PAS pour un odomètre, dont seul le maximum de la
 * période a du sens (un odomètre ne fait que croître, sa moyenne horaire n'existe pas
 * physiquement). D'où le choix de l'agrégat PAR MÉTRIQUE ci-dessous plutôt qu'un `avg`
 * appliqué à tout — une moyenne d'odomètre produirait un kilométrage jamais parcouru, et
 * fausserait la projection du bail qui s'en nourrit.
 */
const AGREGATS_MAX = new Set(["odometer"]);

function troncature(granularite: Granularite): string {
  switch (granularite) {
    case "heure":
      return "hour";
    case "jour":
      return "day";
    case "semaine":
      return "week";
    default:
      return "";
  }
}

export async function lireSerie(params: {
  metricType: string;
  debut?: Date;
  fin?: Date;
  granularite?: Granularite;
  source?: string;
}): Promise<Serie> {
  const { metricType, debut, fin, granularite = "brut", source } = params;

  if (granularite === "brut") {
    const conditions = [eq(vehicleSnapshots.metricType, metricType)];
    if (debut) conditions.push(gte(vehicleSnapshots.recordedAt, debut));
    if (fin) conditions.push(lte(vehicleSnapshots.recordedAt, fin));
    // Le filtre vient d'un appel MCP, donc d'une chaîne libre. Une source inconnue ne
    // renverra simplement aucune ligne — c'est le bon comportement : mieux vaut un
    // résultat vide qu'une erreur de type sur une valeur que l'utilisateur a le droit
    // de se tromper en écrivant.
    if (source) conditions.push(eq(vehicleSnapshots.source, source as Source));

    const lignes = await db
      .select({
        instant: vehicleSnapshots.recordedAt,
        valeur: vehicleSnapshots.valueNumeric,
        source: vehicleSnapshots.source,
        unite: vehicleSnapshots.unit,
      })
      .from(vehicleSnapshots)
      .where(and(...conditions))
      .orderBy(asc(vehicleSnapshots.recordedAt));

    return {
      metricType,
      unite: lignes.find((l) => l.unite)?.unite ?? null,
      granularite,
      points: lignes.map((l) => ({
        instant: l.instant,
        valeur: l.valeur,
        source: l.source,
        echantillons: 1,
      })),
      vide: lignes.length === 0,
    };
  }

  const unite = troncature(granularite);
  const agregat = AGREGATS_MAX.has(metricType) ? sql`MAX(value_numeric)` : sql`AVG(value_numeric)`;

  const resultat = await db.execute(sql`
    SELECT
      DATE_TRUNC(${unite}, recorded_at) AS instant,
      ${agregat}                        AS valeur,
      source,
      MAX(unit)                         AS unite,
      COUNT(*)::int                     AS echantillons
    FROM vehicle_snapshots
    WHERE metric_type = ${metricType}
      AND value_numeric IS NOT NULL
      ${debut ? sql`AND recorded_at >= ${debut}` : sql``}
      ${fin ? sql`AND recorded_at <= ${fin}` : sql``}
      ${source ? sql`AND source = ${source}` : sql``}
    GROUP BY 1, source
    ORDER BY 1 ASC
  `);

  const lignes = (resultat.rows ?? resultat) as Array<{
    instant: string | Date;
    valeur: string | number | null;
    source: string;
    unite: string | null;
    echantillons: number;
  }>;

  return {
    metricType,
    unite: lignes.find((l) => l.unite)?.unite ?? null,
    granularite,
    points: lignes.map((l) => ({
      instant: l.instant instanceof Date ? l.instant : new Date(l.instant),
      // Postgres rend `AVG` en NUMERIC, que le pilote sérialise en chaîne. Sans cette
      // conversion, un graphique recevrait des chaînes et les trierait alphabétiquement —
      // « 100 » avant « 20 ». Bug silencieux classique.
      valeur: l.valeur === null ? null : Number(l.valeur),
      source: l.source,
      echantillons: l.echantillons,
    })),
    vide: lignes.length === 0,
  };
}

/**
 * Historique d'odomètre, pour la projection du bail.
 *
 * Ne prend que les valeurs numériques et les trie chronologiquement — la régression de
 * `lease.ts` suppose les deux. La granularité JOUR est délibérée : elle lisse le bruit de
 * relevé sans écraser la tendance, et borne le volume renvoyé même après plusieurs années.
 */
export async function historiqueOdometre(params: { debut?: Date } = {}): Promise<
  Array<{ km: number; mesureLe: Date }>
> {
  const serie = await lireSerie({
    metricType: "odometer",
    debut: params.debut,
    granularite: "jour",
  });

  return serie.points
    .filter((p): p is PointSerie & { valeur: number } => p.valeur !== null)
    .map((p) => ({ km: p.valeur, mesureLe: p.instant }))
    .sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime());
}
