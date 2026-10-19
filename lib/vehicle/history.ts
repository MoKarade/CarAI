// lib/vehicle/history.ts — séries temporelles pour graphiques et tendances (Doc 4 §3.2).
//
// Objectif explicite de Marc, cité au Doc 1 §1 : « je veux récupérer toute l'info possible
// pour ensuite la transformer en graph estimations etc ». Ce module rend l'historique
// exploitable sans le déformer.
//
// La politique de rétention est ILLIMITÉE (Doc 1 §4.2). Sur plusieurs années, une métrique
// interrogée à la seconde produirait des centaines de milliers de points — d'où la
// granularité, qui agrège CÔTÉ BASE plutôt que de tout rapatrier pour le réduire ensuite.

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { vehicleSnapshots, type Source } from "@/lib/db/schema";

export const GRANULARITES = ["brut", "heure", "jour", "semaine"] as const;
export type Granularite = (typeof GRANULARITES)[number];

/**
 * Plafond de la lecture BRUTE d'une série (nombre de relevés rapatriés).
 *
 * ⚠️ POURQUOI IL EXISTE. La limite mensuelle de transfert Neon a été dépassée (CarAI#200) :
 * une lecture brute sans `LIMIT` relit TOUTE la table pour une métrique, et la table
 * grandit pour toujours (rétention illimitée, Doc 1 §4.2). Une requête sans borne sur une
 * table qui grandit est une bombe à retardement.
 *
 * ⚠️ 50 000 est DÉRIVÉ, pas choisi : Smartcar rafraîchit aux 30-60 min, soit 24 à 48
 * relevés par jour et par métrique — 50 000 couvrent 2,8 à 5,7 ANS de véhicule, au-delà du
 * bail. Même valeur que `LIMITE_HISTORIQUE_COMPLET` (lib/vehicle/analyse.ts, qui importe ce
 * module : la redéfinir ici évite l'import circulaire). La borne ne mord donc pas en usage
 * normal, mais quand elle mord, `Serie.tronquee` le DIT.
 */
export const LIMITE_SERIE_BRUTE = 50_000;

type Dbx = Pick<typeof db, "execute" | "select">;

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
  /**
   * Vrai si la lecture BRUTE a atteint son plafond : les relevés les plus VIEUX de la
   * fenêtre manquent. À dire, jamais à taire — un cumul amputé se présente comme une mesure.
   * Toujours faux hors granularité brute (l'agrégat SQL rend un point par tranche).
   */
  tronquee: boolean;
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
  /** Plafond de la lecture brute. Défaut : `LIMITE_SERIE_BRUTE`. */
  limite?: number;
  dbx?: Dbx;
}): Promise<Serie> {
  const {
    metricType,
    debut,
    fin,
    granularite = "brut",
    source,
    limite = LIMITE_SERIE_BRUTE,
    dbx = db,
  } = params;

  if (granularite === "brut") {
    const conditions = [eq(vehicleSnapshots.metricType, metricType)];
    if (debut) conditions.push(gte(vehicleSnapshots.recordedAt, debut));
    if (fin) conditions.push(lte(vehicleSnapshots.recordedAt, fin));
    // Le filtre vient d'un appel MCP, donc d'une chaîne libre. Une source inconnue ne
    // renverra simplement aucune ligne — c'est le bon comportement : mieux vaut un
    // résultat vide qu'une erreur de type sur une valeur que l'utilisateur a le droit
    // de se tromper en écrivant.
    if (source) conditions.push(eq(vehicleSnapshots.source, source as Source));

    // Fenêtre ancrée du côté RÉCENT : un `LIMIT` en ordre croissant garderait les plus
    // VIEUX relevés et la série se figerait en silence le jour où elle dépasse la borne.
    // On lit décroissant, puis on remet en ordre chronologique en mémoire. Une ligne de
    // plus que demandé rend `tronquee` EXACT (même raisonnement que `serieNumerique`).
    const lues = await dbx
      .select({
        instant: vehicleSnapshots.recordedAt,
        valeur: vehicleSnapshots.valueNumeric,
        source: vehicleSnapshots.source,
        unite: vehicleSnapshots.unit,
      })
      .from(vehicleSnapshots)
      .where(and(...conditions))
      .orderBy(desc(vehicleSnapshots.recordedAt), desc(vehicleSnapshots.id))
      .limit(limite + 1);
    const tronquee = lues.length > limite;
    const lignes = lues.slice(0, limite).reverse();

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
      tronquee,
    };
  }

  const unite = troncature(granularite);
  const agregat = AGREGATS_MAX.has(metricType) ? sql`MAX(value_numeric)` : sql`AVG(value_numeric)`;

  const resultat = await dbx.execute(sql`
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
    tronquee: false,
  };
}

/**
 * Historique d'odomètre.
 *
 * Ne prend que les valeurs numériques et les trie chronologiquement — la régression de
 * `lease.ts` suppose les deux.
 *
 * ⚠️ LA GRANULARITÉ N'EST PAS UN RÉGLAGE DE PERFORMANCE : elle change ce que le chiffre
 * veut dire. Par défaut `jour` — un point par journée, ce qui lisse le bruit de relevé et
 * borne le volume sur un bail de quatre ans. Parfait pour une TENDANCE.
 *
 * Mais ruineux pour les TRAJETS. Un trajet dure vingt minutes ; l'apparier à un agrégat
 * JOURNALIER ne trouve jamais de relevé assez proche de ses bornes, la distance retombe
 * alors sur la ligne droite entre points GPS, et elle sous-estime massivement. C'est
 * exactement ce que Marc a signalé le 12/08 (« le kilométrage est pas bon ») — et le
 * symptôme ne pointait pas vers la granularité, il pointait vers l'affichage.
 *
 * Tout appel qui a besoin de l'odomètre À UN INSTANT PRÉCIS doit passer
 * `granularite: "brut"`.
 */
/**
 * Un odomètre ne RECULE JAMAIS. Tout relevé supérieur à un relevé POSTÉRIEUR est donc
 * impossible sur ce véhicule — et il faut le retirer, pas le lisser.
 *
 * ⚠️ CAS RÉEL (19/08/2026, vu par Marc sur le graphique du bail) : la base contient encore
 * des relevés du VÉHICULE SIMULÉ de Smartcar, entrés avant que la garde `simulee` n'existe.
 * L'un d'eux vaut 78 432 km. Tracé sur une échelle de bail qui monte à 117 600 km, il
 * dessinait un pic bleu occupant les deux tiers de la hauteur — à côté d'un compteur réel
 * de 4 500 km. Le graphique avait l'air cassé, il était juste fidèle à des données fausses.
 *
 * La règle est délibérément CONSERVATRICE : on ne retire un point que si un relevé PLUS
 * TARD le contredit. Un point aberrant qui serait le DERNIER de la série est donc conservé
 * — on ne peut pas savoir, et inventer une borne haute reviendrait à décider à la place de
 * la voiture. Les trajets ont leur propre garde (vitesse impossible, lib/vehicle/trajets.ts) ;
 * celle-ci protège la trajectoire du BAIL, qui est la seule à porter des années d'échelle.
 *
 * PURE : testée sans base.
 */
export function filtrerOdometreMonotone<T extends { km: number; mesureLe: Date }>(
  points: T[],
): T[] {
  const tries = [...points].sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime());
  // Balayage à REBOURS : on garde le plus petit relevé vu « dans le futur », et tout point
  // au-dessus est impossible. Un seul passage, et il tolère plusieurs aberrations d'affilée.
  const garde: T[] = [];
  let minFutur = Number.POSITIVE_INFINITY;
  for (let i = tries.length - 1; i >= 0; i--) {
    const p = tries[i]!;
    if (p.km > minFutur) continue;
    minFutur = p.km;
    garde.push(p);
  }
  return garde.reverse();
}

export async function historiqueOdometre(
  params: { debut?: Date; granularite?: Granularite } = {},
): Promise<Array<{ km: number; mesureLe: Date }>> {
  const serie = await lireSerie({
    metricType: "odometer",
    debut: params.debut,
    granularite: params.granularite ?? "jour",
  });

  return filtrerOdometreMonotone(
    serie.points
      .filter((p): p is PointSerie & { valeur: number } => p.valeur !== null)
      .map((p) => ({ km: p.valeur, mesureLe: p.instant })),
  );
}
