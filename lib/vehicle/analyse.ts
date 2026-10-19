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
import { filtrerOdometreMonotone, lireSerie } from "./history";
import { vehicleSnapshots, type Source } from "@/lib/db/schema";
import type { EtatBail, PointOdometre } from "@/lib/vehicle/lease";

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
/**
 * Le MOTIF d'un refus — la distinction qui commande une action, pas une nuance d'affichage.
 *
 *   • `compatibilite` — la bZ ne sait pas produire ce signal. Il ne marchera jamais : à
 *     DÉCOCHER de la souscription Smartcar (52 cas au 12/08/2026).
 *   • `permission` — le véhicule sait faire, le scope Connect manque. Débloquable par un
 *     re-Connect. Décocher ces signaux fermerait la porte pour rien (15 cas).
 *   • `amont` — panne temporaire côté OEM (`UPSTREAM`). Ne rien toucher, ça revient seul.
 *   • `autre` — refus dont la source n'a pas donné le type. À surveiller, pas à trancher.
 *
 * Les trois premiers appellent trois gestes OPPOSÉS ; les mélanger dans une seule liste
 * « refusés » revient à ne rien dire d'exploitable.
 */
export type MotifRefus = "compatibilite" | "permission" | "amont" | "autre";

export function motifDuRefus(etat: EtatSignal): MotifRefus {
  const statut = etat.dernierStatut?.toUpperCase() ?? "";
  if (statut.includes("COMPATIBILITY")) return "compatibilite";
  if (statut.includes("PERMISSION")) return "permission";
  if (statut.includes("UPSTREAM")) return "amont";
  return "autre";
}

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
 *
 * ⚠️ `source` existe pour que la courbe de l'onglet Données porte EXACTEMENT la même
 * sélection que le tableau qu'elle surplombe. Sans elle, filtrer par source rétrécirait
 * la table pendant que la courbe garderait toutes les sources : deux vérités sur le même
 * écran, et rien ne dirait laquelle est la bonne.
 */
/**
 * Combien de relevés on accepte de lire quand on demande TOUT l'historique.
 *
 * ⚠️ UNE SEULE DÉFINITION, importée par l'écran Activité ET par le connecteur MCP. Deux
 * copies feraient répondre à Claude un cumul qui n'est pas celui de l'écran — précisément
 * ce que le connecteur promet de ne jamais faire. J'ai d'abord écrit la constante aux deux
 * endroits avec un commentaire rappelant de les garder identiques : un commentaire qui
 * réclame de la vigilance est l'aveu qu'il manque une source unique.
 *
 * ⚠️ DÉRIVÉE, pas choisie : Smartcar rafraîchit aux 30-60 min (`CLAUDE.md`), donc 24 à 48
 * points par jour. 50 000 couvrent entre 2,8 et 5,7 ANS de véhicule, au-delà du bail. La
 * borne reste (une requête sans borne sur une table qui grandit pour toujours est une
 * bombe à retardement) mais elle ne peut plus mordre en silence : `tronquee` le dit.
 */
export const LIMITE_HISTORIQUE_COMPLET = 50_000;

export async function serieNumerique(
  metricType: string,
  options: { depuis?: Date | null; source?: string | null; limite?: number; dbx?: Dbx } = {},
): Promise<{ points: PointSerie[]; unite: string | null; tronquee: boolean }> {
  const { depuis = null, source = null, limite = 4_000, dbx = db } = options;

  // Une POSITION ne se trace pas EN SÉRIE TEMPORELLE : « latitude au fil du temps » est
  // une courbe qui ne veut rien dire. Elle a son rendu propre — lat contre lng, à
  // l'échelle (`traceTrajet`). Le refus reste donc pertinent après la levée du masquage
  // du 12/08 : ce n'est plus de la confidentialité, c'est du sens.
  if (metricType === "location" || metricType.toLowerCase().startsWith("location")) {
    return { points: [], unite: null, tronquee: false };
  }

  const clauses = [
    eq(vehicleSnapshots.metricType, metricType),
    isNotNull(vehicleSnapshots.valueNumeric),
  ];
  if (depuis) clauses.push(gte(vehicleSnapshots.recordedAt, depuis));
  // Même cast que `listerMesures` : la source vient d'une URL, donc d'une chaîne libre.
  // Une valeur inconnue ne matche simplement rien — la courbe disparaît en même temps que
  // les lignes du tableau, ce qui est le comportement honnête.
  if (source) clauses.push(eq(vehicleSnapshots.source, source as Source));

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
    // ⚠️ UNE LIGNE DE PLUS QUE DEMANDÉ, et c'est ce qui rend `tronquee` EXACT. Avec
    // `.limit(limite)`, une table qui contient pile `limite` lignes est indiscernable
    // d'une table qui en contient davantage : il faudrait répondre « peut-être tronquée »,
    // donc crier à chaque lecture pleine. Un avertissement permanent est un avertissement
    // mort — le dépôt l'a déjà payé. La ligne excédentaire coûte une ligne et transforme
    // la question en fait : elle existe, donc il en manque ; elle n'existe pas, donc non.
    .limit(limite + 1);
  const tronquee = lignes.length > limite;
  if (tronquee) lignes.length = limite;
  lignes.reverse();

  const bruts: PointSerie[] = lignes.map((l) => ({
    t: l.recordedAt instanceof Date ? l.recordedAt : new Date(l.recordedAt),
    valeur: l.valueNumeric as number,
  }));

  return {
    points: filtrerPlausible(metricType, bruts),
    // L'unité affichée = celle de la ligne la plus RÉCENTE qui en porte une.
    unite: [...lignes].reverse().find((l) => l.unit)?.unit ?? null,
    // ⚠️ LA TRONCATURE SE DIT, elle ne se devine pas. La fenêtre est ancrée du côté
    // récent (§ ci-dessus) : quand la borne mord, ce sont les points les plus VIEUX qui
    // manquent — donc un total « depuis le début » bâti là-dessus sous-compte en silence,
    // et personne ne peut le voir depuis le résultat. Marc, 14/09 : « je veux que ça fasse
    // tout l'historique » ; un chiffre tronqué qui se présente comme un cumul serait
    // exactement le contraire. C'est la classe de défaut que ce dépôt nomme « une borne
    // HAUTE sur une source qui CROÎT fige l'UI EN SILENCE ».
    //
    // On compare au nombre de lignes LUES, jamais aux points rendus : `filtrerPlausible`
    // en écarte (sur `odometer`), donc `points.length < limite` serait vrai sans qu'aucune
    // troncature n'ait eu lieu.
    tronquee,
  };
}

/**
 * Écarte d'une SÉRIE les points qu'aucun véhicule ne peut produire. PURE, testée.
 *
 * ⚠️ CE FILTRE MANQUAIT ICI — demi-correctif du 19/08. J'avais posé la règle « un odomètre
 * ne recule jamais » dans `historiqueOdometre`, donc sur le graphique du BAIL, qui s'est
 * bien nettoyé. Mais l'onglet Tendances ne passe PAS par là : il lit `serieNumerique`. La
 * courbe « Odomètre » continuait d'afficher deux pics à 78 432 km (le véhicule simulé),
 * sur une échelle montant à 84 000 km pour une voiture qui en a 4 500 — capture de Marc.
 *
 * Leçon : corriger UNE voie de lecture d'une donnée ne corrige pas les autres. Quand on
 * pose une règle de plausibilité, il faut chercher TOUS les chemins qui lisent la même
 * métrique — ici deux, et le plus visible n'était pas celui que j'avais corrigé.
 */
export function filtrerPlausible(metricType: string, points: PointSerie[]): PointSerie[] {
  if (metricType !== "odometer") return points;
  // On RÉUTILISE la règle, on ne la réécrit pas : deux implémentations d'un même invariant
  // divergent toujours, et c'est la plus grossière qui finit par gagner.
  const filtres = filtrerOdometreMonotone(points.map((p) => ({ km: p.valeur, mesureLe: p.t })));
  return filtres.map((f) => ({ t: f.mesureLe, valeur: f.km }));
}

/** Au-delà de cette durée, une courbe de Tendances ne lit plus les relevés bruts (CarAI#254). */
export const SEUIL_COURBE_BRUTE_MS = 7 * 86_400_000 + 2 * 3_600_000;
/** Au-delà de cette durée, ou sans borne basse, l'agrégat passe de l'heure au jour. */
export const SEUIL_COURBE_HORAIRE_MS = 45 * 86_400_000;

export type GranulariteCourbe = "brut" | "heure" | "jour";

/**
 * Comment lire une courbe de Tendances selon la durée de la fenêtre. PURE, testée.
 *
 * ⚠️ POURQUOI (CarAI#254). La limite mensuelle de transfert Neon a été dépassée. À 30 jours
 * ou « tout », la page lisait jusqu'à 4 000 relevés BRUTS par métrique pour n'en dessiner
 * que ~300 : on payait le transfert de ce qu'on jetait aussitôt. Une courbe de 300 points
 * n'a pas besoin de plus de ~720 points (30 j à l'heure) ; la base sait les produire.
 *
 *   • jusqu'à 7 jours (+ 2 h de tolérance : un changement d'heure dans une plage ne doit
 *     pas faire basculer une semaine) → relevés bruts, détail exact ;
 *   • jusqu'à 45 jours → moyenne à l'heure ;
 *   • au-delà, ou « depuis toujours » (durée inconnue, la table grandit) → moyenne au jour.
 *
 * Le seuil de 7 jours est celui du défaut de l'écran (CarAI#200) : l'ouverture par défaut
 * reste en brut, donc inchangée.
 */
export function granulariteCourbe(
  depuis: Date | null,
  jusqu: Date | null,
  maintenant: Date,
): GranulariteCourbe {
  if (depuis === null) return "jour";
  const duree = (jusqu ?? maintenant).getTime() - depuis.getTime();
  if (duree <= SEUIL_COURBE_BRUTE_MS) return "brut";
  if (duree <= SEUIL_COURBE_HORAIRE_MS) return "heure";
  return "jour";
}

/** Une position ne se trace pas en série temporelle (voir `serieNumerique`). */
function estPosition(metricType: string): boolean {
  return metricType === "location" || metricType.toLowerCase().startsWith("location");
}

/**
 * La série d'une COURBE de Tendances, à la granularité que sa fenêtre justifie
 * (`granulariteCourbe`). Du plus ancien au plus récent.
 *
 * En brut, c'est `serieNumerique` (plafond ancré du côté récent, `tronquee` dit). Sinon,
 * c'est un agrégat SQL (`lireSerie`) : la base rend UN point par tranche et par source —
 * MAX pour l'odomètre, moyenne sinon — et rien d'autre ne traverse le réseau.
 *
 * ⚠️ Par SOURCE, comme `lireSerie` : deux sources qui se contredisent sont montrées toutes
 * les deux, jamais moyennées entre elles (règle du dépôt). La courbe brute les mêlait déjà
 * sur le même axe ; l'agrégat garde cette présentation.
 *
 * ⚠️ La borne HAUTE est appliquée en SQL (`jusqu` est EXCLUE, d'où le -1 ms) : une tranche
 * est datée de son DÉBUT, donc la couper après coup sur `depuis` écarterait la première
 * tranche, partielle. L'appelant ne rappelle PAS `dansLaFenetre` sur un agrégat.
 */
export async function serieCourbe(
  metricType: string,
  options: {
    depuis: Date | null;
    jusqu?: Date | null;
    maintenant: Date;
    dbx?: Dbx;
  },
): Promise<{
  points: PointSerie[];
  unite: string | null;
  tronquee: boolean;
  granularite: GranulariteCourbe;
}> {
  const { depuis, jusqu = null, maintenant, dbx = db } = options;
  const granularite = granulariteCourbe(depuis, jusqu, maintenant);

  if (granularite === "brut") {
    return { ...(await serieNumerique(metricType, { depuis, dbx })), granularite };
  }
  if (estPosition(metricType)) {
    return { points: [], unite: null, tronquee: false, granularite };
  }

  const serie = await lireSerie({
    metricType,
    debut: depuis ?? undefined,
    fin: jusqu ? new Date(jusqu.getTime() - 1) : undefined,
    granularite,
    dbx,
  });
  const bruts: PointSerie[] = [];
  for (const p of serie.points) {
    if (p.valeur !== null && Number.isFinite(p.valeur)) bruts.push({ t: p.instant, valeur: p.valeur });
  }
  return {
    points: filtrerPlausible(metricType, bruts),
    unite: serie.unite,
    tronquee: serie.tronquee,
    granularite,
  };
}

/**
 * Ce que dit l'en-tête d'un relevé détaillé selon la granularité de la courbe. PURE.
 *
 * ⚠️ « relevés » serait FAUX sur un agrégat : chaque ligne y résume une heure ou un jour.
 * Un chiffre qui se présente comme une mesure alors que c'est une moyenne est exactement
 * le défaut que ce dépôt refuse.
 */
export function libelleReleves(
  granularite: GranulariteCourbe,
  metricType: string,
  nb: number,
): string {
  if (granularite === "brut") return `${nb} relevés`;
  const agregat = metricType === "odometer" ? "maximum" : "moyenne";
  const tranche = granularite === "heure" ? "de l’heure" : "du jour";
  return `${nb} points — ${agregat} ${tranche}`;
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

export interface RepereY {
  /** Ordonnée dans la viewBox. */
  y: number;
  /** Valeur réelle correspondante, à ÉTIQUETER — une grille sans chiffres ne dit rien. */
  valeur: number;
}

/**
 * Une zone de SURVOL : « quand la souris est ici, la valeur est celle-là ».
 *
 * ══ POURQUOI DES BANDES PLUTÔT QUE DES POINTS (Marc, 13/08 : « je veux pouvoir glisser la
 *    souris sur le graph pour voir les valeurs ») ═══════════════════════════════════════
 *
 * Viser un point de 3 px à la souris est un exercice d'adresse. On découpe donc la largeur
 * en bandes VERTICALES, chacune rattachée à son relevé : n'importe quel pixel de la colonne
 * révèle la valeur. C'est ce qui fait qu'un survol « glissé » lit toute la courbe sans
 * jamais rien rater.
 *
 * ⚠️ Les bandes ne sont PAS de largeur égale. Les relevés ne tombent pas à intervalle
 * régulier (le poll passe aux 30 min, le webhook quand ça bouge) : des bandes égales
 * décaleraient l'infobulle par rapport au point qu'elle décrit — la souris serait sur un
 * creux et la bulle annoncerait la valeur du voisin. Chaque bande couvre donc de la
 * mi-distance avec le relevé précédent à la mi-distance avec le suivant.
 *
 * Tout est en POURCENTAGE de la largeur : le SVG est étiré (`preserveAspectRatio="none"`),
 * donc les repères de survol vivent en HTML par-dessus, où le texte n'est pas déformé.
 */
export interface BandeSurvol {
  /** Bord gauche de la bande, en % de la largeur. */
  gauchePct: number;
  /** Largeur de la bande, en %. */
  largeurPct: number;
  /** Abscisse du relevé lui-même, en % — c'est là que se pose la pastille. */
  xPct: number;
  /** Ordonnée du relevé, en % de la hauteur (0 = haut). */
  yPct: number;
  valeur: number;
  t: Date;
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
  /** Lignes horizontales de repère, avec la valeur qu'elles représentent. */
  reperes: RepereY[];
  /** Zones de survol, une par relevé affiché. Vide si la série n'a qu'un point. */
  bandes: BandeSurvol[];
}

/**
 * Découpe une série en bandes de survol. PURE, testée.
 *
 * Les bornes de chaque bande sont les MI-DISTANCES avec les voisins ; la première commence
 * à 0 et la dernière finit à 100, pour qu'aucun pixel du graphique ne soit mort.
 */
export function bandesSurvol(
  points: PointSerie[],
  bornes: { t0: number; dureeMs: number; min: number; max: number },
): BandeSurvol[] {
  if (points.length < 2) return [];
  const { t0, dureeMs, min, max } = bornes;
  const etendue = max - min || 1;

  const xs = points.map((p) => ((p.t.getTime() - t0) / dureeMs) * 100);
  const arrondi = (n: number) => Math.round(n * 100) / 100;

  return points.map((p, i) => {
    const x = xs[i]!;
    const gauche = i === 0 ? 0 : (xs[i - 1]! + x) / 2;
    const droite = i === points.length - 1 ? 100 : (x + xs[i + 1]!) / 2;
    return {
      gauchePct: arrondi(Math.max(0, gauche)),
      largeurPct: arrondi(Math.max(0, Math.min(100, droite) - Math.max(0, gauche))),
      xPct: arrondi(Math.min(100, Math.max(0, x))),
      yPct: arrondi(100 - ((p.valeur - min) / etendue) * 100),
      valeur: p.valeur,
      t: p.t,
    };
  });
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

  // Trois repères horizontaux (bas, milieu, haut) placés sur la fenêtre AFFICHÉE. Ils
  // portent leur valeur : une grille sans étiquette décore, elle n'informe pas.
  const reperes: RepereY[] = [0, 0.5, 1].map((fraction) => ({
    y: Math.round((hauteur - fraction * hauteur) * 10) / 10,
    valeur: min + fraction * (max - min),
  }));

  return {
    polyline,
    min: brutMin,
    max: brutMax,
    premier: points[0]!.t,
    dernier: points[points.length - 1]!.t,
    largeur,
    hauteur,
    reperes,
    bandes: bandesSurvol(points, { t0, dureeMs, min, max }),
  };
}

/**
 * Referme une `polyline` en une AIRE — pour le dégradé sous la courbe. PURE, testée.
 *
 * Simple ajout des deux coins bas (droite puis gauche) : ça referme le tracé sur la ligne
 * de base sans toucher aux points d'origine, donc sans jamais pouvoir contredire la courbe
 * qu'il habille. Purement décoratif — l'axe reste étiqueté par `reperes`, une aire ne
 * remplace jamais un chiffre.
 */
export function aireSvg(trace: TraceSvg): string {
  return `${trace.polyline} ${trace.largeur},${trace.hauteur} 0,${trace.hauteur}`;
}

/** Un des deux axes d'une `TraceDouble` : sa série, son échelle, ses étiquettes. */
export interface AxeDouble {
  libelle: string;
  unite: string | null;
  /** Min et max RÉELS de la série (avant la marge d'affichage). */
  min: number;
  max: number;
  polyline: string;
  bandes: BandeSurvol[];
  derniereValeur: number;
  decimales: number;
  /** Les valeurs des trois repères SUR CETTE ÉCHELLE, du bas vers le haut. */
  reperes: number[];
}

export interface TraceDouble {
  largeur: number;
  hauteur: number;
  gauche: AxeDouble;
  droite: AxeDouble;
  /** Ordonnées des trois repères — partagées par les deux axes. */
  reperesY: number[];
  premier: Date;
  dernier: Date;
}

/**
 * DEUX séries d'unités DIFFÉRENTES sur un axe des temps commun. PURE, testée.
 *
 * Marc, 13/08 : « combine les graphs autonomie et charge restante ». Les deux racontent la
 * même chose — ce qu'il reste — mais l'une est en kilomètres et l'autre en pourcentage.
 *
 * ══ POURQUOI DEUX ÉCHELLES ET PAS UNE ════════════════════════════════════════════════
 *
 * Les empiler sur un axe commun est précisément ce que le projet s'interdit : « jamais
 * d'agrégat entre unités incomparables ». À échelle unique, 62 % et 240 km se dessineraient
 * comme si 240 était quatre fois « plus » que 62, ce qui ne veut rien dire. Chaque série
 * garde donc SON échelle, et chaque échelle porte son unité à son bord — gauche et droite.
 *
 * ⚠️ La conséquence se dit à l'écran : deux courbes qui se croisent ne signifient RIEN. Ce
 * qu'on lit ici, ce sont les FORMES — quand l'autonomie décroche alors que la charge tient,
 * c'est le froid ou la conduite qui coûtent, et ça, ça se voit d'un coup d'œil.
 *
 * ⚠️ L'axe des TEMPS est commun, calculé sur la réunion des deux séries. Projeter chacune
 * sur son propre intervalle les étirerait différemment : deux points côte à côte à l'écran
 * n'auraient alors pas le même instant, et toute lecture conjointe serait fausse.
 */
export function traceDouble(params: {
  gauche: { libelle: string; unite: string | null; points: PointSerie[] };
  droite: { libelle: string; unite: string | null; points: PointSerie[] };
  largeur?: number;
  hauteur?: number;
}): TraceDouble | null {
  const { largeur = 600, hauteur = 180 } = params;
  if (params.gauche.points.length === 0 || params.droite.points.length === 0) return null;

  // L'intervalle de temps COMMUN : la réunion des deux séries.
  const instants = [...params.gauche.points, ...params.droite.points].map((p) => p.t.getTime());
  const t0 = Math.min(...instants);
  const t1 = Math.max(...instants);
  const dureeMs = Math.max(1, t1 - t0);

  const FRACTIONS = [0, 0.5, 1];
  const reperesY = FRACTIONS.map((f) => Math.round((hauteur - f * hauteur) * 10) / 10);

  const projeterAxe = (serie: {
    libelle: string;
    unite: string | null;
    points: PointSerie[];
  }): AxeDouble => {
    const valeurs = serie.points.map((p) => p.valeur);
    const brutMin = Math.min(...valeurs);
    const brutMax = Math.max(...valeurs);
    const marge = (brutMax - brutMin) * 0.05;
    // Série plate : fenêtre artificielle de ±1, comme `traceSvg` — pas de division par zéro.
    const min = brutMax === brutMin ? brutMin - 1 : brutMin - marge;
    const max = brutMax === brutMin ? brutMax + 1 : brutMax + marge;

    const xy = serie.points.map((p) => ({
      x: ((p.t.getTime() - t0) / dureeMs) * largeur,
      y: hauteur - ((p.valeur - min) / (max - min)) * hauteur,
    }));
    let polyline = xy
      .map((p) => `${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`)
      .join(" ");
    // Un point unique ne dessine aucune polyline : ligne plate plutôt qu'un cadre vide.
    if (xy.length === 1) polyline = `0,${Math.round(xy[0]!.y * 10) / 10} ${largeur},${Math.round(xy[0]!.y * 10) / 10}`;

    return {
      libelle: serie.libelle,
      unite: serie.unite,
      min: brutMin,
      max: brutMax,
      polyline,
      bandes: bandesSurvol(serie.points, { t0, dureeMs, min, max }),
      derniereValeur: serie.points[serie.points.length - 1]!.valeur,
      decimales: decimalesPour(brutMin, brutMax),
      reperes: FRACTIONS.map((f) => min + f * (max - min)),
    };
  };

  return {
    largeur,
    hauteur,
    gauche: projeterAxe(params.gauche),
    droite: projeterAxe(params.droite),
    reperesY,
    premier: new Date(t0),
    dernier: new Date(t1),
  };
}

/** Une série projetée dans une `TraceMulti`, avec de quoi l'étiqueter. */
export interface SerieTracee {
  libelle: string;
  polyline: string;
  /** Dernière valeur RÉELLE de la série — l'étiquette de fin de courbe. */
  derniereValeur: number;
  /** Ordonnée du dernier point, pour poser la pastille au bon endroit. */
  derniereY: number;
  /** Zones de survol de CETTE série. */
  bandes: BandeSurvol[];
}

export interface TraceMulti {
  series: SerieTracee[];
  min: number;
  max: number;
  premier: Date;
  dernier: Date;
  largeur: number;
  hauteur: number;
  reperes: RepereY[];
}

/**
 * Projette PLUSIEURS séries dans une MÊME viewBox. PURE, testée.
 *
 * ══ POURQUOI PAS QUATRE GRAPHIQUES SÉPARÉS ══════════════════════════════════════════
 *
 * Les quatre pneus étaient tracés séparément, chacun avec son axe calé sur SON min–max.
 * Deux roues à 230 et 205 kPa donnaient donc deux courbes d'allure identique : l'axe
 * indépendant EFFAÇAIT l'écart, c'est-à-dire précisément la seule chose qu'on regarde sur
 * des pneus. Quatre séries sur un axe COMMUN rendent l'écart lisible sans lire un chiffre.
 *
 * L'axe X est commun lui aussi (premier et dernier instant toutes séries confondues) :
 * sinon une série plus courte serait étirée sur toute la largeur et paraîtrait contemporaine
 * des autres.
 */
export function traceMulti(
  series: Array<{ libelle: string; points: PointSerie[] }>,
  options: { largeur?: number; hauteur?: number } = {},
): TraceMulti | null {
  const { largeur = 600, hauteur = 200 } = options;

  const nonVides = series.filter((s) => s.points.length > 0);
  if (nonVides.length === 0) return null;

  const toutes = nonVides.flatMap((s) => s.points);
  const valeurs = toutes.map((p) => p.valeur);
  const brutMin = Math.min(...valeurs);
  const brutMax = Math.max(...valeurs);
  const marge = (brutMax - brutMin) * 0.08;
  const min = brutMax === brutMin ? brutMin - 1 : brutMin - marge;
  const max = brutMax === brutMin ? brutMax + 1 : brutMax + marge;

  const instants = toutes.map((p) => p.t.getTime());
  const t0 = Math.min(...instants);
  const t1 = Math.max(...instants);
  const dureeMs = Math.max(1, t1 - t0);

  const y = (valeur: number) => hauteur - ((valeur - min) / (max - min)) * hauteur;
  const arrondi = (n: number) => Math.round(n * 10) / 10;

  const tracees: SerieTracee[] = nonVides.map((s) => {
    const ordonnes = [...s.points].sort((a, b) => a.t.getTime() - b.t.getTime());
    const coords = ordonnes.map((p) => ({
      x: arrondi(((p.t.getTime() - t0) / dureeMs) * largeur),
      y: arrondi(y(p.valeur)),
    }));
    // Un point unique ne dessine rien (une polyline exige deux sommets) : on tire une
    // ligne plate — « cette série n'a qu'un relevé », pas un cadre vide qui a l'air cassé.
    const points =
      coords.length === 1
        ? [
            { x: 0, y: coords[0]!.y },
            { x: largeur, y: coords[0]!.y },
          ]
        : coords;
    const dernier = ordonnes[ordonnes.length - 1]!;
    return {
      libelle: s.libelle,
      polyline: points.map((c) => `${c.x},${c.y}`).join(" "),
      derniereValeur: dernier.valeur,
      derniereY: arrondi(y(dernier.valeur)),
      bandes: bandesSurvol(ordonnes, { t0, dureeMs, min, max }),
    };
  });

  const reperes: RepereY[] = [0, 0.5, 1].map((fraction) => ({
    y: Math.round((hauteur - fraction * hauteur) * 10) / 10,
    valeur: min + fraction * (max - min),
  }));

  return {
    series: tracees,
    min: brutMin,
    max: brutMax,
    premier: new Date(t0),
    dernier: new Date(t1),
    largeur,
    hauteur,
    reperes,
  };
}

// ══ DÉCOUVERTE : ce qu'on AFFICHE vient de ce qu'on A, pas d'une liste écrite d'avance ══
//
// L'onglet portait jusqu'ici une liste FERMÉE de dix métriques à tracer. Le verdict des 84
// signaux l'a condamnée : six de ces dix (températures, ampérage, tension, puissance de
// charge, batterie 12 V) sont refusées par la bZ — l'app réservait des graphiques à des
// données qui n'arriveront jamais, pendant que `wheel-tires`, `closure-doors`,
// `charge-detailedchargingstatus` et les autres n'avaient aucune place.
//
// Une liste écrite à la main a toujours deux défauts au même moment : elle promet ce qui
// n'existe pas, et elle ignore ce qui existe. On interroge donc la base — « quelles
// métriques as-tu, et de quelle FORME ? » — et le visuel se choisit sur la forme.

/**
 * La forme d'une métrique décide de sa représentation :
 *   • `numerique`  — une suite de nombres → une COURBE ;
 *   • `etat`       — du texte/booléen qui change rarement → une FRISE de changements
 *                    (une courbe sur « verrouillé/déverrouillé » ne voudrait rien dire) ;
 *   • `structure`  — du JSON → les feuilles NUMÉRIQUES en courbes (pression par pneu),
 *                    le reste en tableau du dernier état (portières, minuteries).
 */
export type FormeMetrique = "numerique" | "etat" | "structure";

export interface MetriqueDisponible {
  metricType: string;
  nbTotal: number;
  nbNumerique: number;
  nbTexte: number;
  nbJson: number;
  unite: string | null;
  derniere: Date;
  forme: FormeMetrique;
}

/**
 * Une POSITION est écartée de la découverte GÉNÉRIQUE — non pour être cachée, mais parce
 * qu'elle a mieux : un rendu DÉDIÉ (`lib/vehicle/position.ts`, section « Trajet » de
 * l'onglet Analyse) qui la trace sur un plan à l'échelle.
 *
 * ⚠️ Ce n'était pas la raison d'origine : jusqu'au 12/08/2026 les coordonnées étaient
 * volontairement masquées à l'écran. Marc a levé cette réserve — c'est sa voiture, dans
 * son app privée derrière son login mono-adresse. La fonction reste, sa JUSTIFICATION a
 * changé, et la dire exactement évite qu'une prochaine session croie protéger quelque
 * chose en la gardant.
 *
 * Ce qui n'a pas bougé : les coordonnées ne sortent jamais vers le hub ni vers un tiers,
 * et l'affichage n'émet aucune requête vers un service de cartographie.
 */
export function estMetriquePosition(metricType: string): boolean {
  const m = metricType.toLowerCase();
  return m === "location" || m.startsWith("location") || m.includes("position");
}

/**
 * PURE : la forme se déduit des comptes, jamais du nom de la métrique.
 *
 * ⚠️ LE PIÈGE DES BOOLÉENS. `signalVersSnapshot` écrit un booléen dans les DEUX colonnes —
 * `value_text` (« true »/« false », lisible à l'œil en base) ET `value_numeric` (1/0,
 * traçable). Un test naïf « du numérique ⇒ une courbe » classait donc « verrouillé » et
 * « en charge » comme des séries numériques, et l'écran traçait une courbe en créneaux
 * entre 0 et 1 — un graphique qui n'apprend rien là où une frise de bascules dit tout.
 *
 * Le discriminant : un booléen a AUTANT de texte que de numérique (les deux colonnes sont
 * remplies ensemble), alors qu'une vraie mesure numérique n'a pas de texte du tout.
 */
export function formeDeMetrique(m: {
  nbNumerique: number;
  nbTexte: number;
  nbJson: number;
}): FormeMetrique {
  if (m.nbTexte > 0 && m.nbTexte >= m.nbNumerique) return "etat";
  if (m.nbNumerique > 0) return "numerique";
  if (m.nbJson > 0) return "structure";
  return "etat";
}

/**
 * Une métrique n'a-t-elle JAMAIS rien livré ? PURE, testée.
 *
 * ⚠️ Les TROIS colonnes, toujours. `value_json` est celle qu'on oublie — elle porte les
 * positions, les pressions et l'état des ouvrants, et l'omettre classerait « muettes » des
 * métriques parfaitement vivantes. C'est l'erreur exacte de la migration 0005.
 *
 * Décision de Marc (18/08 puis 19/08) : ces métriques ne s'affichent NULLE PART. La
 * souscription élargie du 06/08 a abonné CarAI à des signaux que la bZ refuse
 * (`VEHICLE_NOT_CAPABLE`) : une ligne s'écrit à chaque livraison, sans jamais aucune
 * valeur. Elles remplissaient les listes et les comptes sans rien apprendre.
 *
 * La règle est DÉRIVÉE DES DONNÉES, jamais une liste de noms écrite à la main : le jour où
 * la voiture se met à répondre, la métrique réapparaît toute seule. Une liste figée, elle,
 * aurait continué de la cacher.
 */
export function estMuette(m: { nbNumerique: number; nbTexte: number; nbJson: number }): boolean {
  return m.nbNumerique === 0 && m.nbTexte === 0 && m.nbJson === 0;
}

/**
 * Plancher physique d'un pneu MONTÉ, en kPa.
 *
 * Une bZ roule autour de 250–270 kPa. Sous 50 kPa (≈ 7 psi) le pneu est à plat sur la
 * jante : la voiture n'est pas conduisible, et le relevé du 11/08 signalé par Marc annonçait
 * 32 kPa (4,6 psi) un jour où la voiture a roulé. Ce n'est pas une crevaison, c'est une
 * mesure fausse — probablement une valeur en psi rangée comme des kPa.
 */
export const PRESSION_PLANCHER_KPA = 50;

/**
 * Un relevé de pression est-il IMPOSSIBLE ? PURE, testée.
 *
 * ⚠️ La condition est « TOUS les pneus sous le plancher », jamais « au moins un ». Un SEUL
 * pneu très bas est exactement ce à quoi ressemble une vraie crevaison — le supprimer
 * effacerait l'événement de sécurité qu'on veut surtout garder. Quatre pneus à plat
 * simultanément n'est pas une crevaison : c'est une erreur systématique de la source.
 */
export function pressionImpossible(valueJson: unknown): boolean {
  const roues = rouesDuJson(valueJson);
  if (roues.length === 0) return false;
  return roues.every((r) => r.pression < PRESSION_PLANCHER_KPA);
}

/**
 * Toutes les métriques présentes en base, avec de quoi choisir leur affichage.
 *
 * Trié par volume décroissant : ce qui arrive le plus souvent est ce qu'on regarde le plus.
 */
export async function metriquesDisponibles(
  options: { depuis?: Date | null; dbx?: Dbx } = {},
): Promise<MetriqueDisponible[]> {
  const { depuis = null, dbx = db } = options;

  const resultat = await dbx.execute(sql`
    SELECT
      metric_type AS "metricType",
      COUNT(*)::int                                         AS "nbTotal",
      COUNT(value_numeric)::int                             AS "nbNumerique",
      COUNT(value_text)::int                                AS "nbTexte",
      COUNT(value_json)::int                                AS "nbJson",
      MAX(recorded_at)                                      AS "derniere",
      (ARRAY_REMOVE(ARRAY_AGG(unit ORDER BY recorded_at DESC), NULL))[1] AS "unite"
    FROM vehicle_snapshots
    WHERE (${depuis}::timestamptz IS NULL OR recorded_at >= ${depuis}::timestamptz)
    GROUP BY metric_type
    ORDER BY COUNT(*) DESC, metric_type
  `);

  const lignes = ((resultat as { rows?: unknown[] }).rows ??
    (Array.isArray(resultat) ? resultat : [])) as Array<{
    metricType: string;
    nbTotal: number | string;
    nbNumerique: number | string;
    nbTexte: number | string;
    nbJson: number | string;
    derniere: Date | string;
    unite: string | null;
  }>;

  return lignes
    .filter((l) => !estMetriquePosition(l.metricType))
    .map((l) => {
      const comptes = {
        nbTotal: Number(l.nbTotal),
        nbNumerique: Number(l.nbNumerique),
        nbTexte: Number(l.nbTexte),
        nbJson: Number(l.nbJson),
      };
      return {
        metricType: l.metricType,
        ...comptes,
        unite: l.unite ?? null,
        derniere: l.derniere instanceof Date ? l.derniere : new Date(l.derniere),
        forme: formeDeMetrique(comptes),
      };
    });
}

/**
 * Nombre de décimales à afficher, DÉDUIT de l'amplitude au lieu d'être écrit métrique par
 * métrique. Une table de décimales à la main vieillit exactement comme la liste de séries
 * qu'on vient de retirer : elle ne connaît que ce qui existait le jour où on l'a écrite.
 */
export function decimalesPour(min: number, max: number): number {
  const amplitude = Math.abs(max - min);
  const echelle = Math.max(Math.abs(min), Math.abs(max));
  if (amplitude >= 10 || echelle >= 1000) return 0;
  if (amplitude >= 1 || echelle >= 10) return 1;
  return 2;
}

/** Un changement d'état, avec l'instant où il s'est produit. */
export interface ChangementEtat {
  t: Date;
  valeur: string;
}

/**
 * FRISE d'une métrique d'état : uniquement les CHANGEMENTS, pas chaque relevé.
 *
 * « Verrouillé » répété 300 fois n'apprend rien ; c'est le moment où ça devient
 * « déverrouillé » qui est l'information. On replie donc les répétitions consécutives —
 * en gardant le PREMIER instant de chaque palier, qui est celui où le changement a eu lieu.
 */
export async function serieEtat(
  metricType: string,
  options: { depuis?: Date | null; limite?: number; dbx?: Dbx } = {},
): Promise<{ changements: ChangementEtat[]; nbReleves: number }> {
  const { depuis = null, limite = 4_000, dbx = db } = options;
  if (estMetriquePosition(metricType)) return { changements: [], nbReleves: 0 };

  const clauses = [eq(vehicleSnapshots.metricType, metricType), isNotNull(vehicleSnapshots.valueText)];
  if (depuis) clauses.push(gte(vehicleSnapshots.recordedAt, depuis));

  // Même ancrage côté RÉCENT que `serieNumerique` : une borne en ordre croissant figerait
  // la frise sur le passé le jour où la série dépasse la limite.
  const lignes = await dbx
    .select({
      recordedAt: vehicleSnapshots.recordedAt,
      valueText: vehicleSnapshots.valueText,
    })
    .from(vehicleSnapshots)
    .where(and(...clauses))
    .orderBy(desc(vehicleSnapshots.recordedAt), desc(vehicleSnapshots.id))
    .limit(limite);
  lignes.reverse();

  const changements: ChangementEtat[] = [];
  let precedent: string | null = null;
  for (const ligne of lignes) {
    const valeur = ligne.valueText ?? "";
    if (valeur === precedent) continue;
    changements.push({
      t: ligne.recordedAt instanceof Date ? ligne.recordedAt : new Date(ligne.recordedAt),
      valeur,
    });
    precedent = valeur;
  }

  return { changements, nbReleves: lignes.length };
}

/** Une feuille d'un JSON, désignée par son chemin. */
export interface FeuilleJson {
  chemin: string;
  valeur: string;
  nombre: number | null;
}

/**
 * Déplie un JSON en feuilles `chemin → valeur`. PURE, bornée en profondeur ET en nombre.
 *
 * Les bornes ne sont pas décoratives : la structure vient d'une source externe, et une
 * page qui déplie sans limite ce qu'un tiers lui envoie se fige au premier objet profond.
 */
export function aplatirJson(valeur: unknown, maxFeuilles = 60, maxProfondeur = 4): FeuilleJson[] {
  const sorties: FeuilleJson[] = [];

  const descendre = (v: unknown, chemin: string, profondeur: number): void => {
    if (sorties.length >= maxFeuilles) return;
    if (v === null || v === undefined) {
      sorties.push({ chemin, valeur: "—", nombre: null });
      return;
    }
    if (Array.isArray(v)) {
      if (profondeur >= maxProfondeur) return;
      v.forEach((element, i) => descendre(element, chemin ? `${chemin}.${i}` : String(i), profondeur + 1));
      return;
    }
    if (typeof v === "object") {
      if (profondeur >= maxProfondeur) return;
      for (const [cle, sous] of Object.entries(v as Record<string, unknown>)) {
        descendre(sous, chemin ? `${chemin}.${cle}` : cle, profondeur + 1);
      }
      return;
    }
    const nombre = typeof v === "number" && Number.isFinite(v) ? v : null;
    sorties.push({ chemin, valeur: String(v), nombre });
  };

  descendre(valeur, "", 0);
  return sorties;
}

/**
 * Dernier état connu d'une métrique STRUCTURÉE, déplié en lignes lisibles.
 *
 * C'est ce qui donne enfin un écran aux portières, aux vitres et aux minuteries de charge :
 * elles vivent en JSON, donc aucune courbe ne les montrait — et elles restaient invisibles
 * alors que la donnée était là depuis le début.
 */
export async function dernierEtatStructure(
  metricType: string,
  options: { dbx?: Dbx } = {},
): Promise<{ feuilles: FeuilleJson[]; mesureLe: Date } | null> {
  const { dbx = db } = options;
  if (estMetriquePosition(metricType)) return null;

  const lignes = await dbx
    .select({
      recordedAt: vehicleSnapshots.recordedAt,
      valueJson: vehicleSnapshots.valueJson,
    })
    .from(vehicleSnapshots)
    .where(and(eq(vehicleSnapshots.metricType, metricType), isNotNull(vehicleSnapshots.valueJson)))
    .orderBy(desc(vehicleSnapshots.recordedAt), desc(vehicleSnapshots.id))
    .limit(1);

  const ligne = lignes[0];
  if (!ligne) return null;

  return {
    feuilles: aplatirJson(ligne.valueJson),
    mesureLe: ligne.recordedAt instanceof Date ? ligne.recordedAt : new Date(ligne.recordedAt),
  };
}

/**
 * Le graphique du BAIL : ton kilométrage réel contre ce que le contrat autorise.
 *
 * ══ POURQUOI C'EST LE GRAPHIQUE QUI COMPTE ══════════════════════════════════════════
 * CarAI existe d'abord pour ça (Doc 4 §3.4) : le bail autorise un kilométrage fixe, et
 * l'usage projeté au cadrage le dépassait. L'écart est le sujet, et il se
 * décide TÔT — rouler moins, renégocier, racheter. Deux droites qui divergent le disent
 * d'un coup d'œil, là où un pourcentage demande à être interprété.
 *
 * Trois tracés, et c'est leur SUPERPOSITION qui informe :
 *   • `reel`       — les mesures d'odomètre effectivement enregistrées ;
 *   • `alloue`     — la droite du contrat, de 0 au début à l'allocation à l'échéance ;
 *   • `projection` — le prolongement du rythme OBSERVÉ jusqu'à l'échéance (pointillé,
 *                    parce que c'est une hypothèse, pas une mesure).
 *
 * ⚠️ L'axe X couvre TOUT le bail (début → fin), pas seulement la période mesurée : voir
 * qu'on a consommé 8 % de l'allocation en 4 % du temps n'a de sens que si les deux
 * s'affichent sur la même échelle. Et l'axe Y part de ZÉRO — contrairement aux autres
 * courbes — parce qu'ici la comparaison est ABSOLUE : deux droites qu'on rapprocherait
 * artificiellement en tronquant l'axe mentiraient sur l'ampleur de l'écart.
 *
 * PURE : tout entre en paramètre, rien n'est lu. La projection d'un bail de quatre ans se
 * teste ainsi sans attendre quatre ans.
 */
export interface TraceBail {
  /** Odomètre mesuré, dans la viewBox. Vide si aucune mesure. */
  reel: string;
  /** Droite d'allocation du contrat. */
  alloue: string;
  /** Prolongement au rythme observé. `null` si le rythme n'est pas mesurable. */
  projection: string | null;
  largeur: number;
  hauteur: number;
  /** Bornes de l'axe Y (0 → plafond affiché), pour les étiquettes. */
  maxY: number;
  reperes: RepereY[];
}

export function traceBail(params: {
  etat: EtatBail;
  historique: PointOdometre[];
  largeur?: number;
  hauteur?: number;
}): TraceBail | null {
  const { etat, historique, largeur = 600, hauteur = 200 } = params;

  const t0 = etat.debutBail.getTime();
  const t1 = etat.finBail.getTime();
  const dureeMs = t1 - t0;
  if (dureeMs <= 0) return null;

  // Le plafond de l'axe : le plus haut des trois tracés, jamais moins que l'allocation —
  // sinon la droite du contrat sortirait du cadre et l'écart deviendrait invisible.
  const candidats = [etat.allocationTotale, etat.projectionFinBail ?? 0];
  for (const p of historique) candidats.push(p.km);
  const maxY = Math.max(...candidats) * 1.05 || 1;

  const x = (d: Date) => ((d.getTime() - t0) / dureeMs) * largeur;
  const y = (km: number) => hauteur - (km / maxY) * hauteur;
  const pt = (d: Date, km: number) =>
    `${Math.round(x(d) * 10) / 10},${Math.round(y(km) * 10) / 10}`;

  const points = [...historique].sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime());
  const reel = points.map((p) => pt(p.mesureLe, p.km)).join(" ");

  const alloue = `${pt(etat.debutBail, 0)} ${pt(etat.finBail, etat.allocationTotale)}`;

  const dernier = points[points.length - 1];
  const projection =
    etat.projectionFinBail !== null && dernier
      ? `${pt(dernier.mesureLe, dernier.km)} ${pt(etat.finBail, etat.projectionFinBail)}`
      : null;

  const reperes: RepereY[] = [0, 0.5, 1].map((fraction) => ({
    y: Math.round((hauteur - fraction * hauteur) * 10) / 10,
    valeur: fraction * maxY,
  }));

  return { reel, alloue, projection, largeur, hauteur, maxY, reperes };
}

/**
 * Séries de PRESSION par pneu, extraites du JSON de `wheel-tires`.
 *
 * La pression est l'un des rares signaux que la bZ fournit vraiment, et il était jusqu'ici
 * intraçable : la valeur vit dans `value_json` (une entrée par roue), pas dans
 * `value_numeric`. On la déplie ici en quatre séries — une par position — plutôt que de
 * tracer une moyenne, qui masquerait justement le pneu qui se dégonfle.
 */
export async function seriesPneus(
  options: { depuis?: Date | null; limite?: number; dbx?: Dbx } = {},
): Promise<{ series: Array<{ libelle: string; points: PointSerie[] }>; unite: string | null }> {
  const { depuis = null, limite = 2_000, dbx = db } = options;

  const clauses = [
    eq(vehicleSnapshots.metricType, "tire_pressure"),
    isNotNull(vehicleSnapshots.valueJson),
  ];
  if (depuis) clauses.push(gte(vehicleSnapshots.recordedAt, depuis));

  const lignes = await dbx
    .select({
      recordedAt: vehicleSnapshots.recordedAt,
      valueJson: vehicleSnapshots.valueJson,
      unit: vehicleSnapshots.unit,
    })
    .from(vehicleSnapshots)
    .where(and(...clauses))
    .orderBy(desc(vehicleSnapshots.recordedAt), desc(vehicleSnapshots.id))
    .limit(limite);
  lignes.reverse();

  const parRoue = new Map<string, PointSerie[]>();
  let unite: string | null = null;

  for (const ligne of lignes) {
    const t = ligne.recordedAt instanceof Date ? ligne.recordedAt : new Date(ligne.recordedAt);
    // ⚠️ Un relevé où les QUATRE roues sont sous le plancher physique n'est pas une
    // crevaison, c'est une mesure fausse — la courbe de Marc descendait à 11 kPa puis 32.
    // On le saute AU TRACÉ, en plus de le proposer à la purge : un graphique ne doit pas
    // attendre qu'une suppression soit exécutée pour cesser de mentir.
    if (pressionImpossible(ligne.valueJson)) continue;
    for (const roue of rouesDuJson(ligne.valueJson)) {
      const liste = parRoue.get(roue.libelle) ?? [];
      liste.push({ t, valeur: roue.pression });
      parRoue.set(roue.libelle, liste);
    }
    unite = unite ?? ligne.unit ?? null;
  }

  return {
    series: [...parRoue.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([libelle, points]) => ({ libelle, points })),
    unite,
  };
}

/**
 * Déplie le corps de `wheel-tires` en pressions par roue. PURE, testée.
 *
 * Forme RÉELLE de la bZ (06/08/2026) : `{ values: [{ row, column, tirePressure }], … }`.
 * `row`/`column` donnent la position : rangée 0 = avant, colonne 0 = gauche. Un corps
 * d'une autre forme rend une liste VIDE plutôt qu'une position inventée.
 */
export function rouesDuJson(valueJson: unknown): Array<{ libelle: string; pression: number }> {
  // ⚠️ TROIS formes, et l'ordre compte. Le commentaire précédent annonçait gérer « le
  // tableau direct » — le code ne le faisait PAS : il lisait `corps.values` sur un tableau,
  // ce qui vaut `undefined`, et rendait une liste vide. Or c'est EXACTEMENT la forme que la
  // bZ envoie aujourd'hui :
  //
  //     [ { row: 0, column: 0, tirePressure: 268.9 }, … ]
  //
  // Résultat mesuré le 19/08/2026 : zéro roue extraite de chaque relevé, donc aucune
  // pression nulle part — schéma, courbes, alertes, MCP. Toute la fonctionnalité pneus
  // était morte, sans une seule erreur, sur une donnée parfaitement valide en base. Marc
  // l'a signalé par « les pneus ça marche pas » et demandait de tout supprimer.
  //
  // Leçon : un commentaire qui affirme couvrir un cas n'est pas une preuve qu'il le couvre.
  // Les trois formes sont désormais testées une par une, avec la charge réelle.
  const corps = (valueJson ?? {}) as Record<string, unknown>;
  const liste: unknown[] = Array.isArray(valueJson)
    ? valueJson
    : Array.isArray(corps.values)
      ? (corps.values as unknown[])
      : Array.isArray((corps.values as Record<string, unknown> | undefined)?.values)
        ? ((corps.values as Record<string, unknown>).values as unknown[])
        : [];

  const sorties: Array<{ libelle: string; pression: number }> = [];
  for (const entree of liste) {
    const roue = (entree ?? {}) as Record<string, unknown>;
    // ⚠️ `Number(null)` vaut 0, et `Number.isFinite(0)` vaut true : une pression ABSENTE
    // devenait « 0 kPa » — un pneu à plat parfaitement crédible, qui déclenche l'alerte de
    // sous-gonflage. C'est le patron « une valeur non finie ne devient jamais un défaut
    // numérique » : un 0 affirme, une absence admet. Le type est donc vérifié AVANT la
    // conversion, jamais après (trouvé par le test, 19/08/2026).
    const brutPression = roue.tirePressure;
    if (typeof brutPression !== "number" && typeof brutPression !== "string") continue;
    const pression = Number(brutPression);
    if (!Number.isFinite(pression) || pression <= 0) continue;
    const rangee = Number(roue.row) === 1 ? "arrière" : "avant";
    const cote = Number(roue.column) === 1 ? "droite" : "gauche";
    sorties.push({ libelle: `${rangee} ${cote}`, pression });
  }
  return sorties;
}
