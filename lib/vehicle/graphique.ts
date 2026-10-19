// lib/vehicle/graphique.ts — la géométrie des courbes. PURE, testable sans navigateur.
//
// ══ POURQUOI CE MODULE EXISTE À CÔTÉ DE `analyse.ts` ═════════════════════════════════
// `analyse.ts` sait projeter UNE série dans une viewBox, chacune calée sur SES propres
// bornes de temps. C'était juste tant que les courbes se lisaient une par une.
//
// Demande de Marc (14/08) : « je veux qu'ils aient une échelle identique, même quand je
// zoome ». Deux courbes calées chacune sur son propre intervalle sont INCOMPARABLES —
// un creux au même instant n'apparaît pas à la même abscisse. Il faut donc une FENÊTRE
// DE TEMPS EXPLICITE, commune à tous les graphiques, et que le zoom déplace ensemble.
//
// ⚠️ « Échelle identique » ne peut PAS vouloir dire même axe Y : des pourcentages, des
// kilomètres et des kilopascals ne se superposent pas. C'est l'axe du TEMPS qui est
// partagé ; chaque courbe garde son échelle verticale, étiquetée.

import type { PointSerie } from "./analyse";

/** Fenêtre de temps en millisecondes epoch. `t0 < t1` toujours. */
export interface FenetreTemps {
  t0: number;
  t1: number;
}

/** Durée minimale d'une fenêtre : 5 minutes. En deçà, le zoom n'a plus de sens et les
    repères de temps se dédoublent (deux graduations sur la même minute affichée). */
export const DUREE_MIN_MS = 5 * 60_000;

/**
 * Fenêtre englobant TOUTES les séries — le domaine commun.
 *
 * Rend `null` si aucune série ne porte de point : il n'y a alors pas d'axe à dessiner, et
 * inventer un intervalle afficherait une grille de temps sous des courbes inexistantes.
 */
export function fenetreCommune(series: PointSerie[][]): FenetreTemps | null {
  let t0 = Number.POSITIVE_INFINITY;
  let t1 = Number.NEGATIVE_INFINITY;

  for (const serie of series) {
    for (const p of serie) {
      const t = p.t.getTime();
      if (!Number.isFinite(t)) continue;
      if (t < t0) t0 = t;
      if (t > t1) t1 = t;
    }
  }

  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return null;
  // Série d'un seul instant : on ouvre une fenêtre d'une heure autour, sinon la division
  // par la durée explose et le point n'a nulle part où se poser.
  if (t1 - t0 < DUREE_MIN_MS) {
    const centre = (t0 + t1) / 2;
    return { t0: centre - DUREE_MIN_MS / 2, t1: centre + DUREE_MIN_MS / 2 };
  }
  return { t0, t1 };
}

/**
 * État de zoom, exprimé en FRACTIONS de la fenêtre totale (0 = début, 1 = fin).
 *
 * Volontairement relatif et non en millisecondes : quand de nouvelles mesures arrivent et
 * que la fenêtre totale s'allonge, un zoom en absolu pointerait hors domaine. En fractions,
 * « je regarde le dernier quart » reste vrai.
 */
export interface Zoom {
  debut: number;
  fin: number;
}

export const ZOOM_COMPLET: Zoom = { debut: 0, fin: 1 };

/** Applique un zoom à la fenêtre totale. Borné : jamais hors [0,1], jamais sous DUREE_MIN_MS. */
export function appliquerZoom(totale: FenetreTemps, zoom: Zoom): FenetreTemps {
  const duree = totale.t1 - totale.t0;
  const debut = Math.min(Math.max(zoom.debut, 0), 1);
  const fin = Math.min(Math.max(zoom.fin, 0), 1);
  const [a, b] = debut <= fin ? [debut, fin] : [fin, debut];

  let t0 = totale.t0 + a * duree;
  let t1 = totale.t0 + b * duree;

  if (t1 - t0 < DUREE_MIN_MS) {
    const centre = (t0 + t1) / 2;
    t0 = centre - DUREE_MIN_MS / 2;
    t1 = centre + DUREE_MIN_MS / 2;
    // Recadrage si le minimum déborde du domaine total.
    if (t0 < totale.t0) {
      t0 = totale.t0;
      t1 = Math.min(totale.t1, t0 + DUREE_MIN_MS);
    }
    if (t1 > totale.t1) {
      t1 = totale.t1;
      t0 = Math.max(totale.t0, t1 - DUREE_MIN_MS);
    }
  }
  return { t0, t1 };
}

/**
 * Zoom autour d'un point d'ancrage (la molette sous le curseur).
 *
 * `ancre` est la position du curseur dans la fenêtre VISIBLE (0 = bord gauche, 1 = droit).
 * Le facteur < 1 rapproche, > 1 éloigne. L'instant sous le curseur ne bouge pas — c'est ce
 * qui distingue un zoom utilisable d'un zoom qui fait fuir ce qu'on regarde.
 */
export function zoomerAutour(zoom: Zoom, ancre: number, facteur: number): Zoom {
  const largeur = zoom.fin - zoom.debut;
  const point = zoom.debut + Math.min(Math.max(ancre, 0), 1) * largeur;
  const nouvelle = Math.min(Math.max(largeur * facteur, 0.001), 1);

  let debut = point - (point - zoom.debut) * (nouvelle / largeur);
  let fin = debut + nouvelle;

  if (debut < 0) {
    debut = 0;
    fin = nouvelle;
  }
  if (fin > 1) {
    fin = 1;
    debut = 1 - nouvelle;
  }
  return { debut, fin };
}

/** Déplace la fenêtre sans changer sa largeur. `delta` en fraction du domaine total. */
export function deplacerZoom(zoom: Zoom, delta: number): Zoom {
  const largeur = zoom.fin - zoom.debut;
  let debut = zoom.debut + delta;
  if (debut < 0) debut = 0;
  if (debut + largeur > 1) debut = 1 - largeur;
  return { debut, fin: debut + largeur };
}

// ══ GRADUATIONS DE TEMPS ════════════════════════════════════════════════════════════

export interface RepereTemps {
  /** Abscisse dans la viewBox. */
  x: number;
  /** Instant représenté. */
  t: number;
  /** Étiquette déjà formatée dans le fuseau de Marc. */
  libelle: string;
  /** Vrai pour la première graduation d'une journée — celle qui porte la date. */
  jour: boolean;
}

/** Pas de graduation candidats, du plus fin au plus grossier. */
const PAS_MS = [
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  3_600_000,
  2 * 3_600_000,
  3 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  86_400_000,
  2 * 86_400_000,
  7 * 86_400_000,
  14 * 86_400_000,
  30 * 86_400_000,
];

/**
 * Choisit un pas de graduation lisible pour la fenêtre visible.
 *
 * Le pas est choisi pour tenir ~`cible` graduations : trop peu et l'axe ne situe rien,
 * trop et les étiquettes se chevauchent. C'est ce qui fait qu'en zoomant on passe
 * naturellement des jours aux heures — la demande « je veux voir les heures » n'est pas
 * un format figé, c'est une graduation qui suit l'échelle.
 */
export function pasDeTemps(dureeMs: number, cible = 6): number {
  const ideal = dureeMs / Math.max(1, cible);
  for (const pas of PAS_MS) {
    if (pas >= ideal) return pas;
  }
  return PAS_MS[PAS_MS.length - 1]!;
}

/**
 * Graduations de l'axe du temps, alignées sur des instants RONDS.
 *
 * ⚠️ L'alignement se fait dans le FUSEAU DE MARC, pas en UTC : `Math.ceil(t / pas) * pas`
 * arrondit sur l'epoch, donc sur minuit UTC — à Québec (UTC−4) les graduations
 * quotidiennes tomberaient à 20 h la veille. Le décalage est retiré avant l'arrondi puis
 * remis, ce qui fait tomber les graduations sur des heures rondes LOCALES.
 */
export function reperesTemps(
  fenetre: FenetreTemps,
  largeur: number,
  options: { cible?: number; fuseau?: string } = {},
): RepereTemps[] {
  const { cible = 6, fuseau = "America/Toronto" } = options;
  const duree = fenetre.t1 - fenetre.t0;
  if (duree <= 0 || largeur <= 0) return [];

  const pas = pasDeTemps(duree, cible);
  const decalage = decalageFuseauMs(fenetre.t0, fuseau);
  const premier = Math.ceil((fenetre.t0 + decalage) / pas) * pas - decalage;

  const date = new Intl.DateTimeFormat("fr-CA", {
    timeZone: fuseau,
    month: "short",
    day: "numeric",
  });

  const reperes: RepereTemps[] = [];
  // Borne dure : un pas mal choisi ne doit jamais produire une boucle interminable.
  for (let t = premier, garde = 0; t <= fenetre.t1 && garde < 64; t += pas, garde++) {
    const x = ((t - fenetre.t0) / duree) * largeur;
    const { h, m } = heureLocale(t, fuseau);
    const estMinuit = h === 0 && m === 0;
    // Au pas quotidien ou plus large, l'heure n'apporte rien : on étiquette la date.
    const libelle =
      pas >= 86_400_000 || estMinuit
        ? date.format(t)
        : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    reperes.push({ x, t, libelle, jour: pas >= 86_400_000 || estMinuit });
  }
  return reperes;
}

/**
 * Heure et minute LOCALES, composées depuis `formatToParts`.
 *
 * ⚠️ Ne pas passer par `format()` d'une locale : `fr-CA` rend « 08 h 00 » — correct en
 * français, mais deux fois trop large pour une graduation d'axe — et un champ `minute`
 * demandé seul n'est même pas complété à deux chiffres (« 0 »). Lire les PARTIES et
 * composer soi-même donne un résultat stable quelle que soit la locale du moteur.
 */
export function heureLocale(t: number, fuseau: string): { h: number; m: number } {
  const parties = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(t);

  const lire = (type: string) =>
    Number(parties.find((p) => p.type === type)?.value ?? Number.NaN);
  const h = lire("hour");
  const m = lire("minute");
  // `h23` peut rendre 24 sur certains moteurs pour minuit : on le ramène à 0.
  return { h: Number.isFinite(h) ? h % 24 : 0, m: Number.isFinite(m) ? m : 0 };
}

/** Décalage du fuseau à cet instant, en ms (négatif à l'ouest de Greenwich). */
export function decalageFuseauMs(t: number, fuseau: string): number {
  // `en-CA` + `timeZoneName: longOffset` rend « GMT-04:00 ». On le lit plutôt que de
  // coder −4 en dur : l'heure avancée déplace le décalage deux fois par an.
  const partie = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    timeZoneName: "longOffset",
  })
    .formatToParts(t)
    .find((p) => p.type === "timeZoneName")?.value;

  const m = partie?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0;
  const signe = m[1] === "-" ? -1 : 1;
  return signe * (Number(m[2]) * 3_600_000 + Number(m[3]) * 60_000);
}

// ══ PROJECTION DANS UNE FENÊTRE IMPOSÉE ═════════════════════════════════════════════

export interface PointTrace {
  x: number;
  y: number;
  t: number;
  valeur: number;
}

export interface TraceFenetree {
  /** Points VISIBLES, déjà projetés. Vide si la fenêtre ne couvre aucune mesure. */
  points: PointTrace[];
  polyline: string;
  /** Bornes de l'axe vertical, marge comprise — à ÉTIQUETER. */
  minY: number;
  maxY: number;
  reperes: Array<{ y: number; valeur: number }>;
  largeur: number;
  hauteur: number;
}

/**
 * Projette une série dans une fenêtre de temps IMPOSÉE.
 *
 * Différence de fond avec `traceSvg` : l'axe X ne vient pas de la série mais du dehors.
 * C'est ce qui permet à cinq courbes de partager exactement la même abscisse.
 *
 * L'axe Y, lui, reste calé sur les valeurs VISIBLES : en zoomant sur une plage où la
 * charge varie de 78 à 81 %, on veut voir cette variation, pas une ligne plate écrasée par
 * les 20 % du mois dernier. Les bornes sont rendues pour être écrites à l'écran.
 */
export function projeter(
  points: PointSerie[],
  fenetre: FenetreTemps,
  options: { largeur?: number; hauteur?: number; nbReperes?: number } = {},
): TraceFenetree | null {
  const { largeur = 800, hauteur = 220, nbReperes = 5 } = options;
  const duree = fenetre.t1 - fenetre.t0;
  if (duree <= 0) return null;

  const visibles = points
    .map((p) => ({ t: p.t.getTime(), valeur: p.valeur }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.valeur))
    .filter((p) => p.t >= fenetre.t0 && p.t <= fenetre.t1)
    .sort((a, b) => a.t - b.t);

  if (visibles.length === 0) return null;

  const valeurs = visibles.map((p) => p.valeur);
  const brutMin = Math.min(...valeurs);
  const brutMax = Math.max(...valeurs);
  const marge = (brutMax - brutMin) * 0.08;
  const minY = brutMax === brutMin ? brutMin - 1 : brutMin - marge;
  const maxY = brutMax === brutMin ? brutMax + 1 : brutMax + marge;
  const etendue = maxY - minY;

  const projetes: PointTrace[] = visibles.map((p) => ({
    x: arrondi(((p.t - fenetre.t0) / duree) * largeur),
    y: arrondi(hauteur - ((p.valeur - minY) / etendue) * hauteur),
    t: p.t,
    valeur: p.valeur,
  }));

  const reperes = Array.from({ length: nbReperes }, (_, i) => {
    const fraction = i / (nbReperes - 1);
    return {
      y: arrondi(hauteur - fraction * hauteur),
      valeur: minY + fraction * etendue,
    };
  });

  return {
    points: projetes,
    polyline: projetes.map((p) => `${p.x},${p.y}`).join(" "),
    minY,
    maxY,
    reperes,
    largeur,
    hauteur,
  };
}

function arrondi(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Point le plus proche d'une abscisse — le survol lit une VRAIE mesure, jamais une
    interpolation : afficher « 78,4 % » à un instant où rien n'a été mesuré serait
    exactement la donnée inventée qu'on s'interdit. */
export function pointLePlusProche(trace: TraceFenetree, x: number): PointTrace | null {
  if (trace.points.length === 0) return null;
  let meilleur = trace.points[0]!;
  let ecart = Math.abs(meilleur.x - x);
  for (const p of trace.points) {
    const e = Math.abs(p.x - x);
    if (e < ecart) {
      ecart = e;
      meilleur = p;
    }
  }
  return meilleur;
}

// ══ ANALYSE TEXTUELLE ═══════════════════════════════════════════════════════════════

export type Tendance = "hausse" | "baisse" | "stable" | "indeterminee";

export interface AnalyseSerie {
  tendance: Tendance;
  /** Écart entre la première et la dernière mesure VISIBLE. `null` si indéterminable. */
  delta: number | null;
  min: number;
  max: number;
  /** Moyenne ARITHMÉTIQUE des mesures visibles — pas une intégrale pondérée par le temps :
      les mesures ne sont pas équidistantes, et prétendre le contraire serait faux. */
  moyenne: number;
  amplitude: number;
  nbPoints: number;
  premier: number;
  dernier: number;
}

/**
 * Décrit ce que la fenêtre visible contient. PURE.
 *
 * ⚠️ Une tendance sur DEUX points n'est pas une tendance, c'est un segment. En dessous de
 * trois mesures, `tendance` vaut `indeterminee` et l'écran le dit — annoncer « en hausse »
 * sur deux relevés espacés d'une heure serait une affirmation que la donnée ne porte pas.
 *
 * Le seuil de « stable » est relatif à l'amplitude observée (5 %), pas à une constante :
 * 0,5 % d'écart est du bruit sur un état de charge, une dérive nette sur une pression.
 */
export function analyserSerie(points: PointSerie[]): AnalyseSerie | null {
  const valides = points
    .map((p) => ({ t: p.t.getTime(), v: p.valeur }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);

  if (valides.length === 0) return null;

  const valeurs = valides.map((p) => p.v);
  const min = Math.min(...valeurs);
  const max = Math.max(...valeurs);
  const moyenne = valeurs.reduce((s, v) => s + v, 0) / valeurs.length;
  const amplitude = max - min;
  const premier = valides[0]!;
  const dernier = valides[valides.length - 1]!;

  if (valides.length < 3) {
    return {
      tendance: "indeterminee",
      delta: valides.length === 2 ? dernier.v - premier.v : null,
      min,
      max,
      moyenne,
      amplitude,
      nbPoints: valides.length,
      premier: premier.t,
      dernier: dernier.t,
    };
  }

  const delta = dernier.v - premier.v;
  const seuil = amplitude * 0.05;
  const tendance: Tendance =
    Math.abs(delta) <= seuil ? "stable" : delta > 0 ? "hausse" : "baisse";

  return {
    tendance,
    delta,
    min,
    max,
    moyenne,
    amplitude,
    nbPoints: valides.length,
    premier: premier.t,
    dernier: dernier.t,
  };
}
