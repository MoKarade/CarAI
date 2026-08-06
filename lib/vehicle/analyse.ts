// lib/vehicle/analyse.ts — le moteur de l'onglet Analyse.
//
// Deux besoins de Marc (06/08/2026) :
//   1. « liste-moi toutes celles qui marchent pas et surtout toutes celles qui marchent »
//      → `etatDesSignaux` : le DERNIER statut connu de chaque signal, vivant — la liste se
//      met à jour toute seule à chaque livraison, personne n'a à la retranscrire.
//   2. « un onglet d'analyse de toutes les données » → `serieNumerique` +
//      `sousEchantillonner` + `traceSvg` : des séries temporelles rendues côté SERVEUR en
//      SVG pur. Aucune bibliothèque de graphiques, aucun octet de données brutes envoyé au
//      navigateur au-delà du dessin — cohérent avec « server-side only ».

import { and, asc, gte, isNotNull, sql, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { vehicleSnapshots } from "@/lib/db/schema";

type Dbx = Pick<typeof db, "execute" | "select">;

/** Le dernier état connu d'un signal : statut, valeur, fraîcheur, volume. */
export interface EtatSignal {
  signalCode: string;
  metricType: string;
  source: string;
  /** Statut de la ligne LA PLUS RÉCENTE (`SUCCESS`, `ERROR`, `UNKNOWN`, ou null si non déclaré). */
  dernierStatut: string | null;
  derniereMesure: Date;
  /** La dernière ligne porte-t-elle une VALEUR (numérique, texte ou JSON) ? */
  porteValeur: boolean;
  nbMesures: number;
}

/**
 * Dernier état de CHAQUE signal, plus volumineux d'abord.
 *
 * `DISTINCT ON (signal_code)` trié par date décroissante = la ligne la plus récente par
 * code — donc le statut COURANT : un signal qui passait `SUCCESS` hier et `ERROR` depuis
 * ce matin est classé dans les refus, et réciproquement (une bascule OEM se voit au
 * prochain rafraîchissement de la page, pas à la prochaine session de code).
 */
export async function etatDesSignaux(dbx: Dbx = db): Promise<EtatSignal[]> {
  const resultat = await dbx.execute(sql`
    WITH dernieres AS (
      SELECT DISTINCT ON (signal_code)
        signal_code   AS "signalCode",
        metric_type   AS "metricType",
        source,
        signal_status AS "dernierStatut",
        recorded_at   AS "derniereMesure",
        (value_numeric IS NOT NULL OR value_text IS NOT NULL OR value_json IS NOT NULL)
                      AS "porteValeur"
      FROM vehicle_snapshots
      WHERE signal_code IS NOT NULL
      ORDER BY signal_code, recorded_at DESC, id DESC
    ),
    volumes AS (
      SELECT signal_code AS "signalCode", COUNT(*)::int AS "nbMesures"
      FROM vehicle_snapshots
      WHERE signal_code IS NOT NULL
      GROUP BY signal_code
    )
    SELECT d.*, v."nbMesures"
    FROM dernieres d
    JOIN volumes v ON v."signalCode" = d."signalCode"
    ORDER BY v."nbMesures" DESC, d."signalCode"
  `);

  const lignes = ((resultat as { rows?: unknown[] }).rows ??
    (Array.isArray(resultat) ? resultat : [])) as Array<
    Omit<EtatSignal, "derniereMesure" | "nbMesures" | "porteValeur"> & {
      derniereMesure: Date | string;
      nbMesures: number | string;
      porteValeur: boolean | string;
    }
  >;

  return lignes.map((l) => ({
    ...l,
    derniereMesure:
      l.derniereMesure instanceof Date ? l.derniereMesure : new Date(l.derniereMesure),
    nbMesures: Number(l.nbMesures),
    // Certains pilotes rendent les booléens SQL en texte (« t »/« f », « true »).
    porteValeur: l.porteValeur === true || l.porteValeur === "t" || l.porteValeur === "true",
  }));
}

/** Classement d'un signal pour l'affichage — PURE, testée. */
export type ClasseSignal = "fonctionne" | "refuse" | "sans_valeur";

/**
 * « Marche » = la dernière ligne est un SUCCESS (ou sans statut déclaré) ET porte une
 * valeur. « Refusé » = le dernier statut est un échec déclaré par la source. Le reste —
 * SUCCESS sans valeur — est dit tel quel : la source a répondu sans donnée exploitable,
 * ni un refus ni une mesure.
 */
export function classerSignal(etat: EtatSignal): ClasseSignal {
  const statut = etat.dernierStatut?.toUpperCase() ?? null;
  if (statut !== null && statut !== "SUCCESS") return "refuse";
  return etat.porteValeur ? "fonctionne" : "sans_valeur";
}

/** Un point d'une série temporelle numérique. */
export interface PointSerie {
  t: Date;
  valeur: number;
}

/**
 * Série numérique d'une métrique, du plus ANCIEN au plus récent, bornée.
 *
 * Bornée parce que la table est conçue pour croître des années sans purge : un graphique
 * n'a pas besoin de plus de points que son écran n'a de pixels — le sous-échantillonnage
 * (`sousEchantillonner`) fait le reste.
 */
export async function serieNumerique(
  metricType: string,
  options: { depuis?: Date | null; limite?: number; dbx?: Dbx } = {},
): Promise<{ points: PointSerie[]; unite: string | null }> {
  const { depuis = null, limite = 4_000, dbx = db } = options;

  const clauses = [
    eq(vehicleSnapshots.metricType, metricType),
    isNotNull(vehicleSnapshots.valueNumeric),
  ];
  if (depuis) clauses.push(gte(vehicleSnapshots.recordedAt, depuis));

  const lignes = await dbx
    .select({
      recordedAt: vehicleSnapshots.recordedAt,
      valueNumeric: vehicleSnapshots.valueNumeric,
      unit: vehicleSnapshots.unit,
    })
    .from(vehicleSnapshots)
    .where(and(...clauses))
    .orderBy(asc(vehicleSnapshots.recordedAt), asc(vehicleSnapshots.id))
    .limit(limite);

  return {
    points: lignes.map((l) => ({
      t: l.recordedAt instanceof Date ? l.recordedAt : new Date(l.recordedAt),
      valeur: l.valueNumeric as number,
    })),
    // L'unité de la série = celle déclarée par la source (première ligne qui en porte une).
    unite: lignes.find((l) => l.unit)?.unit ?? null,
  };
}

/**
 * Réduit une série à ~`cible` points en gardant TOUJOURS le premier et le dernier.
 * PURE. Un graphique de 600 px n'affiche pas mieux avec 4 000 points qu'avec 300 — mais
 * perdre le DERNIER point mentirait sur la fraîcheur.
 */
export function sousEchantillonner(points: PointSerie[], cible = 300): PointSerie[] {
  if (points.length <= cible || cible < 2) return points;
  const pas = (points.length - 1) / (cible - 1);
  const sortie: PointSerie[] = [];
  for (let i = 0; i < cible - 1; i++) {
    sortie.push(points[Math.round(i * pas)]!);
  }
  sortie.push(points[points.length - 1]!);
  return sortie;
}

export interface TraceSvg {
  /** Attribut `points` d'une `<polyline>` SVG, coordonnées dans la viewBox. */
  polyline: string;
  min: number;
  max: number;
  premier: Date;
  dernier: Date;
  largeur: number;
  hauteur: number;
}

/**
 * Projette une série dans une viewBox SVG. PURE — c'est elle qui rend les graphiques
 * testables sans navigateur : les coordonnées se vérifient au pixel près.
 *
 * L'axe Y est calé sur [min, max] RÉELS de la série (avec une marge de 5 %) : un axe qui
 * partirait de zéro écraserait les variations d'un état de charge entre 60 et 80 %.
 * Min et max sont AFFICHÉS par l'appelant — un axe sans étiquettes serait trompeur.
 */
export function traceSvg(
  points: PointSerie[],
  options: { largeur?: number; hauteur?: number } = {},
): TraceSvg | null {
  if (points.length === 0) return null;
  const { largeur = 600, hauteur = 160 } = options;

  const valeurs = points.map((p) => p.valeur);
  const brutMin = Math.min(...valeurs);
  const brutMax = Math.max(...valeurs);
  const marge = (brutMax - brutMin) * 0.05;
  // Série PLATE (un seul point, ou valeur constante) : une fenêtre artificielle de ±1
  // évite la division par zéro et dessine une ligne au centre.
  const min = brutMax === brutMin ? brutMin - 1 : brutMin - marge;
  const max = brutMax === brutMin ? brutMax + 1 : brutMax + marge;

  const t0 = points[0]!.t.getTime();
  const t1 = points[points.length - 1]!.t.getTime();
  const dureeMs = Math.max(1, t1 - t0);

  const polyline = points
    .map((p) => {
      const x = ((p.t.getTime() - t0) / dureeMs) * largeur;
      const y = hauteur - ((p.valeur - min) / (max - min)) * hauteur;
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(" ");

  return {
    polyline,
    min: brutMin,
    max: brutMax,
    premier: points[0]!.t,
    dernier: points[points.length - 1]!.t,
    largeur,
    hauteur,
  };
}

/**
 * Les séries proposées par l'onglet Analyse. La liste est FERMÉE et locale : chaque
 * entrée est une métrique numérique dont le graphique a un sens direct. Les métriques à
 * valeur JSON (pneus, portières, minuteries) viendront quand elles auront leur extraction
 * dédiée — tracer un JSON n'a pas de sens.
 */
export const SERIES_ANALYSE: ReadonlyArray<{ metricType: string; decimales: number }> = [
  { metricType: "battery_soc", decimales: 0 },
  { metricType: "battery_range", decimales: 0 },
  { metricType: "odometer", decimales: 0 },
  { metricType: "outside_temperature", decimales: 1 },
  { metricType: "inside_temperature", decimales: 1 },
  { metricType: "charge_wattage", decimales: 1 },
  { metricType: "charge_amperage", decimales: 0 },
  { metricType: "charge_voltage", decimales: 0 },
  { metricType: "low_voltage_battery", decimales: 0 },
  { metricType: "charge_time_remaining", decimales: 0 },
];
