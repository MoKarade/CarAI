// lib/vehicle/carte.ts — projection Web Mercator et composition d'une carte à tuiles.
//
// ══ POURQUOI DES TUILES PLUTÔT QU'UNE BIBLIOTHÈQUE DE CARTE ══════════════════════════
//
// Marc veut « les vraies rues, la carte de Maps mais dans l'app » (12/08/2026). Trois
// façons de le faire, et le choix n'est pas neutre :
//
//   • Google Maps embed — exige une clé d'API, donc un compte facturable. Contre la règle
//     « tout gratuit » de l'écosystème.
//   • Leaflet + OSM — pan/zoom complet, mais ~40 ko de JS et une dépendance de plus dans
//     un projet qui en compte neuf.
//   • Tuiles OSM en `<img>` + tracé SVG par-dessus — c'est ce qui est implémenté ici.
//     Rendu CÔTÉ SERVEUR, zéro JavaScript, zéro dépendance, et le navigateur ne demande
//     que les tuiles nécessaires au cadrage.
//
// La contrepartie, assumée et dite à l'écran : pas de pan/zoom à la souris. Le zoom se
// choisit par un lien (un `<a>`, donc une navigation, pas du JS), et le cadrage englobe
// TOUJOURS le trajet entier.
//
// ⚠️ CE QUI CHANGE POUR LA VIE PRIVÉE. Jusqu'ici, afficher une position n'émettait aucune
// requête vers un tiers. Avec un fond de carte, le navigateur demande des tuiles à
// openstreetmap.org, et les COORDONNÉES DES TUILES révèlent approximativement où on
// regarde. C'est le prix des vraies rues, et Marc l'a demandé en connaissance de cause —
// mais ça se dit à l'écran plutôt que de se découvrir plus tard.

export interface PointGeo {
  lat: number;
  lng: number;
}

/** Taille d'une tuile OSM, en pixels. Constante du format. */
export const TAILLE_TUILE = 256;

/** Zoom maximal servi par OSM. Au-delà, les tuiles n'existent pas (404 gris). */
export const ZOOM_MAX = 19;
export const ZOOM_MIN = 2;

/**
 * Projette une coordonnée en pixels MONDE au zoom donné. PURE, testée.
 *
 * Web Mercator, la projection de toutes les cartes à tuiles. La latitude passe par
 * `ln(tan + sec)` — ce n'est pas une mise à l'échelle linéaire, et c'est précisément ce qui
 * fait qu'une carte projetée naïvement décale le tracé par rapport aux rues.
 */
export function projeter(point: PointGeo, zoom: number): { x: number; y: number } {
  const n = TAILLE_TUILE * 2 ** zoom;
  const x = ((point.lng + 180) / 360) * n;
  // Bornée à la limite de Mercator (~85,05°) : au-delà, la formule diverge vers l'infini.
  const latBornee = Math.max(-85.05112878, Math.min(85.05112878, point.lat));
  const rad = (latBornee * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return { x, y };
}

/**
 * L'INVERSE de `projeter` : d'un pixel monde vers une latitude/longitude. PURE, testée.
 *
 * ⚠️ Ce n'est pas une division : la latitude de Web Mercator passe par `ln(tan + sec)`, et
 * revenir en arrière demande `atan(sinh())`. Une inversion linéaire « à peu près juste »
 * placerait le lieu à des centaines de mètres de l'endroit désigné — d'autant plus loin
 * qu'on s'éloigne de l'équateur, donc beaucoup, ici.
 */
export function deprojeter(pixel: { x: number; y: number }, zoom: number): PointGeo {
  const n = TAILLE_TUILE * 2 ** zoom;
  const lng = (pixel.x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * pixel.y) / n))) * 180) / Math.PI;
  return { lat, lng };
}

/**
 * Le lieu qu'on vient de désigner DANS le cadre : coordonnées d'écran → géographiques.
 * PURE, testée.
 *
 * `x` et `y` sont exprimés dans le repère de la vue (`vue.largeur` × `vue.hauteur`), pas en
 * pixels d'écran — l'appelant met à l'échelle depuis son `getBoundingClientRect`, comme
 * pour le glisser. Confondre les deux décale le point de tout le facteur d'affichage.
 */
export function pointDepuisCadre(
  point: { x: number; y: number },
  vue: Pick<VueCarte, "origine" | "zoom">,
): PointGeo {
  return deprojeter({ x: vue.origine.x + point.x, y: vue.origine.y + point.y }, vue.zoom);
}

/**
 * Combien de MÈTRES représente un pixel, à ce zoom et à cette latitude. PURE, testée.
 *
 * ⚠️ Le cosinus n'est pas un détail : Web Mercator étire les distances à mesure qu'on
 * s'éloigne de l'équateur. À Québec (46,8°) l'échelle réelle est de **32 % plus fine** que
 * la formule sans cosinus ne le laisserait croire — un rayon de 120 m dessiné sans elle
 * couvrirait 176 m sur le terrain, et apparierait des recharges faites chez le voisin.
 */
export function metresParPixel(latitude: number, zoom: number): number {
  const CIRCONFERENCE = 40_075_016.686;
  return (CIRCONFERENCE * Math.cos((latitude * Math.PI) / 180)) / (TAILLE_TUILE * 2 ** zoom);
}

/** Le rayon d'appariement d'un lieu, en pixels de la carte. PURE, testée. */
export function rayonEnPixels(rayonM: number, latitude: number, zoom: number): number {
  return rayonM / metresParPixel(latitude, zoom);
}

/**
 * Plus grand zoom auquel TOUT le trajet tient dans le cadre. PURE, testée.
 *
 * On cherche le plus grand — donc le plus détaillé — qui contienne encore l'ensemble :
 * une carte qui coupe la moitié du trajet ne montre pas le trajet.
 */
export function zoomPourCadrer(
  points: PointGeo[],
  largeur: number,
  hauteur: number,
  marge = 32,
): number {
  if (points.length === 0) return 13;

  const utileX = Math.max(1, largeur - marge * 2);
  const utileY = Math.max(1, hauteur - marge * 2);

  for (let zoom = ZOOM_MAX; zoom >= ZOOM_MIN; zoom -= 1) {
    const projetes = points.map((p) => projeter(p, zoom));
    const largeurReelle = Math.max(...projetes.map((p) => p.x)) - Math.min(...projetes.map((p) => p.x));
    const hauteurReelle = Math.max(...projetes.map((p) => p.y)) - Math.min(...projetes.map((p) => p.y));
    if (largeurReelle <= utileX && hauteurReelle <= utileY) return zoom;
  }
  return ZOOM_MIN;
}

export interface Tuile {
  /** URL de la tuile chez OpenStreetMap. */
  url: string;
  /** Position dans le cadre, en pixels. */
  gauche: number;
  haut: number;
  cle: string;
}

export interface VueCarte {
  zoom: number;
  largeur: number;
  hauteur: number;
  tuiles: Tuile[];
  /** Tracé du trajet, en coordonnées du cadre. */
  polyline: string;
  /** Points remarquables projetés, dans l'ordre départ → arrivée. */
  marqueurs: Array<{ x: number; y: number }>;
  /** Nombre de tuiles demandées — sert à borner et à le DIRE. */
  nbTuiles: number;
  /**
   * Coin haut-gauche du cadre, en PIXELS MONDE au zoom de la vue.
   *
   * Exposé pour rendre la projection RÉVERSIBLE : sans lui, un point du cadre ne peut pas
   * redevenir une latitude/longitude, et la carte ne sait que MONTRER — jamais recevoir un
   * lieu qu'on désigne (Marc, 21/08 : « je veux pouvoir choisir sur la map »).
   */
  origine: { x: number; y: number };
}

/**
 * Plafond de tuiles par carte.
 *
 * OSM est un service BÉNÉVOLE et sa politique d'usage interdit le téléchargement en masse.
 * 48 tuiles couvrent largement le cadre par défaut (au plus 6 colonnes × 4 rangées à
 * 1280×620) ; au-delà, c'est le signe d'un cadrage absurde (un zoom trop fin sur une zone
 * trop grande), pas d'un besoin réel.
 */
export const MAX_TUILES = 48;

/**
 * Taille de composition par défaut.
 *
 * ⚠️ Elle doit rester proche de la largeur d'AFFICHAGE réelle. La carte vit dans
 * `.carte-large` (84 rem ≈ 1344 px) et le cadre est étiré à 100 % : composé à 640, il était
 * agrandi ×2 — des tuiles de 256 px affichées sur 512, donc FLOUES, et c'est la moitié du
 * « la carte marche pas » de Marc (13/08). L'autre moitié était l'épaisseur des traits,
 * réglée par `non-scaling-stroke` côté composant.
 */
export const LARGEUR_DEFAUT = 1280;
export const HAUTEUR_DEFAUT = 620;

/**
 * Compose la vue : quelles tuiles demander, où les poser, et où passe le tracé. PURE.
 *
 * Le centre est le MILIEU de la boîte englobante du trajet, pas la dernière position :
 * centrer sur l'arrivée pousserait le départ hors cadre sur un trajet long.
 */
export function composerVue(params: {
  points: PointGeo[];
  largeur?: number;
  hauteur?: number;
  zoom?: number;
  /**
   * Décalage du cadre en PIXELS, appliqué après le centrage automatique.
   *
   * C'est le déplacement de la carte au doigt ou à la souris (Marc, 14/08 : « pour les
   * trajets je veux pouvoir zoomer, cliquer sur la carte »). Exprimé en pixels plutôt qu'en
   * coordonnées géographiques parce que c'est exactement ce qu'un glisser produit —
   * convertir en latitude/longitude pour reconvertir ensuite n'ajouterait que des arrondis.
   *
   * ⚠️ Le décalage vaut pour CE zoom. Changer de niveau double ou divise l'échelle du
   * monde : l'appelant qui veut garder le même point sous le curseur remet le décalage à
   * l'échelle lui-même.
   */
  decalage?: { x: number; y: number };
  urlTuile?: (z: number, x: number, y: number) => string;
}): VueCarte | null {
  const {
    points,
    largeur = LARGEUR_DEFAUT,
    hauteur = HAUTEUR_DEFAUT,
    urlTuile = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  } = params;

  if (points.length === 0) return null;

  const zoom = Math.max(
    ZOOM_MIN,
    Math.min(ZOOM_MAX, params.zoom ?? zoomPourCadrer(points, largeur, hauteur)),
  );

  const projetes = points.map((p) => projeter(p, zoom));
  const minX = Math.min(...projetes.map((p) => p.x));
  const maxX = Math.max(...projetes.map((p) => p.x));
  const minY = Math.min(...projetes.map((p) => p.y));
  const maxY = Math.max(...projetes.map((p) => p.y));

  // Coin haut-gauche du cadre, en pixels monde : le trajet est centré dedans, puis
  // déplacé du décalage demandé. Soustraction et non addition : glisser la carte vers la
  // droite fait reculer l'origine, sinon le contenu partirait à l'inverse du doigt.
  const decalage = params.decalage ?? { x: 0, y: 0 };
  const originX = (minX + maxX) / 2 - largeur / 2 - decalage.x;
  const originY = (minY + maxY) / 2 - hauteur / 2 - decalage.y;

  // Tuiles couvrant le cadre. `floor` des deux côtés : la tuile qui contient le bord
  // gauche doit être incluse, sinon une bande vide apparaît au bord.
  const tuileMinX = Math.floor(originX / TAILLE_TUILE);
  const tuileMaxX = Math.floor((originX + largeur) / TAILLE_TUILE);
  const tuileMinY = Math.floor(originY / TAILLE_TUILE);
  const tuileMaxY = Math.floor((originY + hauteur) / TAILLE_TUILE);

  const n = 2 ** zoom;
  const tuiles: Tuile[] = [];
  for (let ty = tuileMinY; ty <= tuileMaxY; ty += 1) {
    // Hors du monde en Y : ces tuiles n'existent pas (pas de bouclage vertical).
    if (ty < 0 || ty >= n) continue;
    for (let tx = tuileMinX; tx <= tuileMaxX; tx += 1) {
      if (tuiles.length >= MAX_TUILES) break;
      // En X le monde BOUCLE : une longitude au-delà de 180° revient de l'autre côté.
      const txMonde = ((tx % n) + n) % n;
      tuiles.push({
        url: urlTuile(zoom, txMonde, ty),
        gauche: tx * TAILLE_TUILE - originX,
        haut: ty * TAILLE_TUILE - originY,
        cle: `${zoom}/${txMonde}/${ty}`,
      });
    }
  }

  const arrondi = (v: number) => Math.round(v * 10) / 10;
  const dansLeCadre = projetes.map((p) => ({
    x: arrondi(p.x - originX),
    y: arrondi(p.y - originY),
  }));

  return {
    zoom,
    largeur,
    hauteur,
    tuiles,
    polyline: dansLeCadre.map((p) => `${p.x},${p.y}`).join(" "),
    marqueurs: dansLeCadre,
    nbTuiles: tuiles.length,
    origine: { x: originX, y: originY },
  };
}

/**
 * Remet le décalage à l'échelle lors d'un changement de zoom, en gardant un point FIXE.
 *
 * Sans ça, zoomer recentre brutalement sur le trajet et fait fuir l'endroit qu'on
 * regardait — le défaut qui rend un zoom inutilisable.
 *
 * ══ D'OÙ VIENT LA FORMULE ═══════════════════════════════════════════════════════════
 * L'origine du cadre vaut `centre(z) − taille/2 − décalage`. En passant de `z` à `z+dz`,
 * toutes les coordonnées monde sont multipliées par `s = 2^dz`, `centre` compris. On veut
 * que le point situé à l'abscisse `position` du cadre y reste. En posant l'égalité des
 * origines avant/après et en simplifiant, il reste :
 *
 *     décalage' = décalage × s + (s − 1) × (taille/2 − position)
 *
 * `position` est la coordonnée DANS le cadre (0 = bord gauche/haut). Au centre exact,
 * le second terme s'annule : zoomer au centre ne déplace rien, ce qui est le comportement
 * attendu des boutons.
 */
export function recalerDecalage(params: {
  decalage: number;
  taille: number;
  position: number;
  dz: number;
}): number {
  const { decalage, taille, position, dz } = params;
  const s = 2 ** dz;
  return decalage * s + (s - 1) * (taille / 2 - position);
}
