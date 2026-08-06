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

import { and, desc, gte, isNotNull, sql, eq } from "drizzle-orm";
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
  // DISTINCT ON (source, signal_code) — la SOURCE fait partie de l'identité : si le
  // futur poll Toyota publiait un code que Smartcar publie aussi, l'un masquerait l'état
  // de l'autre (revue du 06/08).
  const resultat = await dbx.execute(sql`
    WITH dernieres AS (
      SELECT DISTINCT ON (source, signal_code)
        signal_code   AS "signalCode",
        metric_type   AS "metricType",
        source,
        signal_status AS "dernierStatut",
        recorded_at   AS "derniereMesure",
        (value_numeric IS NOT NULL OR value_text IS NOT NULL OR value_json IS NOT NULL)
                      AS "porteValeur"
      FROM vehicle_snapshots
      WHERE signal_code IS NOT NULL
      ORDER BY source, signal_code, recorded_at DESC, id DESC
    ),
    volumes AS (
      SELECT source, signal_code AS "signalCode", COUNT(*)::int AS "nbMesures"
      FROM vehicle_snapshots
      WHERE signal_code IS NOT NULL
      GROUP BY source, signal_code
    )
    SELECT d.*, v."nbMesures"
    FROM dernieres d
    JOIN volumes v ON v."signalCode" = d."signalCode" AND v.source = d.source
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
 * valeur. « Refusé » = un échec DÉCLARÉ par la source (`ERROR…`). `UNKNOWN` n'est PAS un
 * refus — c'est « le véhicule gère la donnée mais n'en a pas fourni de valide cette
 * fois-ci » (Doc 2 §5.3, même sémantique que dans l'ingestion) : il va dans « sans
 * valeur », dit tel quel.
 */
export function classerSignal(etat: EtatSignal): ClasseSignal {
  const statut = etat.dernierStatut?.toUpperCase() ?? null;
  if (statut !== null && statut !== "SUCCESS" && statut !== "UNKNOWN") return "refuse";
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

  // Défense en profondeur : une POSITION ne se trace pas. Les courbes ne lisent que
  // `value_numeric` (jamais les coordonnées, qui vivent en JSON), mais la liste
  // SERIES_ANALYSE ne doit pas rester le SEUL rempart (revue du 06/08).
  if (metricType === "location" || metricType.toLowerCase().startsWith("location")) {
    return { points: [], unite: null };
  }

  const clauses = [
    eq(vehicleSnapshots.metricType, metricType),
    isNotNull(vehicleSnapshots.valueNumeric),
  ];
  if (depuis) clauses.push(gte(vehicleSnapshots.recordedAt, depuis));

  // Fenêtre ancrée du côté RÉCENT : `LIMIT` en ordre croissant aurait gardé les 4 000
  // plus VIEUX points — la courbe se serait figée en silence le jour où une série
  // dépasse la borne, en pleine croissance de la table (finding HIGH de la revue du
  // 06/08, la leçon DriveAI des bornes de tête sous un autre visage). On requête
  // décroissant, puis on remet en ordre chronologique en mémoire.
  const lignes = await dbx
    .select({
      recordedAt: vehicleSnapshots.recordedAt,
      valueNumeric: vehicleSnapshots.valueNumeric,
      unit: vehicleSnapshots.unit,
    })
    .from(vehicleSnapshots)
    .where(and(...clauses))
    .orderBy(desc(vehicleSnapshots.recordedAt), desc(vehicleSnapshots.id))
    .limit(limite);
  lignes.reverse();

  return {
    points: lignes.map((l) => ({
      t: l.recordedAt instanceof Date ? l.recordedAt : new Date(l.recordedAt),
      valeur: l.valueNumeric as number,
    })),
    // L'unité affichée = celle de la ligne la plus RÉCENTE qui en porte une.
    unite: [...lignes].reverse().find((l) => l.unit)?.unit ?? null,
  };
}

/**
 * Réduit une série à ≤ 2·`cible` points PAR SEAUX, en gardant le MIN et le MAX de chaque
 * seau — plus le premier et le dernier point. PURE.
 *
 * Un stride naïf (un point sur N) perdait les PICS : le min–max affiché en légende (et
 * dans l'aria-label) était alors calculé sur la série décimée et MENTAIT sur la période
 * (finding de la revue du 06/08). Garder les extrêmes de chaque seau rend la décimation
 * incapable d'effacer un pic — la ligne et la légende disent la même chose. Et perdre le
 * DERNIER point mentirait sur la fraîcheur.
 */
export function sousEchantillonner(points: PointSerie[], cible = 300): PointSerie[] {
  if (points.length <= cible || cible < 2) return points;

  const sortie: PointSerie[] = [points[0]!];
  const taille = (points.length - 2) / (cible - 2);
  for (let seau = 0; seau < cible - 2; seau++) {
    const debut = 1 + Math.floor(seau * taille);
    const fin = Math.min(1 + Math.floor((seau + 1) * taille), points.length - 1);
    if (debut >= fin) continue;
    let iMin = debut;
    let iMax = debut;
    for (let i = debut; i < fin; i++) {
      if (points[i]!.valeur < points[iMin]!.valeur) iMin = i;
      if (points[i]!.valeur > points[iMax]!.valeur) iMax = i;
    }
    // Ordre CHRONOLOGIQUE dans le seau, sans doublon quand min = max.
    for (const i of iMin === iMax ? [iMin] : [Math.min(iMin, iMax), Math.max(iMin, iMax)]) {
      sortie.push(points[i]!);
    }
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

  let polyline = points
    .map((p) => {
      const x = ((p.t.getTime() - t0) / dureeMs) * largeur;
      const y = hauteur - ((p.valeur - min) / (max - min)) * hauteur;
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(" ");

  // Un point UNIQUE ne dessine rien (une polyline exige deux sommets) : on tire une
  // ligne plate sur toute la largeur — « la valeur n'a pas bougé sur la période » — au
  // lieu d'un cadre vide qui a l'air cassé (revue du 06/08).
  if (points.length === 1) {
    const y = polyline.split(",")[1]!;
    polyline = `0,${y} ${largeur},${y}`;
  }

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
