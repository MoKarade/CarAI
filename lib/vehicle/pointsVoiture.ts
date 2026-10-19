// lib/vehicle/pointsVoiture.ts — OÙ chaque information se pose sur la voiture. PUR, testé.
//
// Marc, 20/08 : « toutes ces infos je veux qu'elles soient sur la voiture d'une manière ou
// d'une autre, avec toutes les infos dessus, cliquables ».
//
// ══ POURQUOI DES POURCENTAGES, ET POURQUOI DANS UN FICHIER À PART ═══════════════════════
// Les ancres sont exprimées en POURCENTAGE de la boîte de l'image, jamais en unités du SVG.
// C'est ce qui rend l'illustration REMPLAÇABLE : le jour où un vrai rendu 3D prend la place
// du dessin, on re-règle des nombres ICI et rien d'autre ne bouge — ni les composants, ni
// les pages, ni les tests de contenu. Une ancre écrite dans le SVG aurait soudé la donnée
// au dessin, et le remplacement aurait été une refonte.
//
// ⚠️ Les valeurs ne sont PAS dessinées dans le SVG non plus (elles l'étaient avant, pour
// les pneus). Une valeur en `<text>` SVG ne se sélectionne pas, ne se lit pas correctement
// au lecteur d'écran quand elle est décorative, et ne peut pas porter de bouton. Le patron
// est donc : l'image en dessous, TOUTE la donnée en HTML par-dessus.

/** Une ancre, en pourcentage de la largeur et de la hauteur de la boîte de l'image. */
export interface Ancre {
  x: number;
  y: number;
}

/**
 * Les identités possibles d'un point. Fermé volontairement : un point sans ancre serait
 * rendu au coin supérieur gauche, et personne ne le remarquerait à la revue.
 */
export type IdPoint =
  | "charge"
  | "autonomie"
  | "verrou"
  | "odometre"
  | "ouvrants"
  | "synchro"
  | "pneu-avant-gauche"
  | "pneu-avant-droite"
  | "pneu-arriere-gauche"
  | "pneu-arriere-droite";

/**
 * Où chaque information se pose sur la carrosserie — réglé sur le dessin de
 * `SchemaVehicule` (viewBox 300 × 560, capot en haut).
 *
 * Le placement n'est pas décoratif : il DIT quelque chose. La charge est à la trappe,
 * l'autonomie au capot, le verrou au toit (c'est l'état de la voiture entière, pas d'un
 * coin), l'odomètre au hayon, et chaque pression est SUR sa roue — c'est ce qui permet de
 * lire « c'est celle-là qui se dégonfle » sans lire un mot.
 */
export const ANCRES: Record<IdPoint, Ancre> = {
  // ⚠️ RECALÉES SUR LE RENDU (20/08). Le dessin au trait tenait dans un cadre de rapport
  // 0,60 ; le rendu fait 0,451 — nettement plus HAUT. La largeur est donc devenue la
  // ressource rare et la hauteur l'abondante : les points qui ne désignent aucun organe
  // précis descendent en COLONNE au centre, où ils ne peuvent plus se gêner.
  //
  // ⚠️ LA CHARGE EST À L'AVANT DROIT — c'est là que la bZ de Marc se branche (« mets la
  // charge à l'endroit où se charge la voiture »). Un point qui COMMANDE quelque chose de
  // physique doit désigner l'endroit physique : viser la trappe apprend où brancher, une
  // pastille au milieu du capot n'apprend rien.
  //
  // ⚠️ Son abscisse est 68 et non 75 : à 75, la pastille (45 % de large, c'est une vedette)
  // dépassait le flanc droit et flottait dans le vide, détachée de la tôle qu'elle désigne.
  // Une pastille posée sur une photo doit rester SUR l'objet ; à défaut elle se lit comme
  // une étiquette qui a glissé. Vérifié au banc, pas au jugé.
  //
  // Les quatre pressions ne sont pas posées au jugé : leur ABSCISSE est celle des roues
  // MESURÉES (`geometrieVoiture.ts` → `ROUES`). Leur ordonnée peut glisser LE LONG de la
  // roue — la boîte fait 14,9 % de haut — et c'est ce qui a libéré la place de la trappe :
  // les deux pastilles avant descendent au bas de leur roue au lieu d'en occuper le centre.
  // Un test vérifie qu'elles restent DANS leur roue, ce qui est l'invariant réel ; exiger
  // le centre exact aurait interdit ce glissement sans rien protéger de plus.
  autonomie: { x: 50, y: 6 },
  charge: { x: 68, y: 13 },
  "pneu-avant-gauche": { x: 13.8, y: 26 },
  "pneu-avant-droite": { x: 85.1, y: 26 },
  verrou: { x: 50, y: 46 },
  ouvrants: { x: 50, y: 56 },
  odometre: { x: 50, y: 66 },
  "pneu-arriere-gauche": { x: 13.8, y: 78.5 },
  "pneu-arriere-droite": { x: 85.1, y: 78.5 },
  synchro: { x: 50, y: 89 },
};

/**
 * ⚠️ CE QUI SE CHEVAUCHE, CE SONT DES BOÎTES, PAS DES POINTS — ET ELLES N'ONT PAS TOUTES
 * LA MÊME LARGEUR.
 *
 * Première version : distance entre CENTRES contre un seuil unique. Vert au test, et au
 * banc les pastilles se recouvraient de moitié.
 *
 * Deuxième version : une boîte, mais d'une largeur UNIQUE prise sur la plus large. Elle
 * tenait tant que les pastilles se ressemblaient — puis la charge a gagné son heure de fin
 * (« 84 % · 15 h 35 ») et est passée à 44 % de large. Prendre 44 pour tout le monde aurait
 * déclaré en conflit deux étroites pourtant séparées de 40 points. Un garde trop strict ne
 * vaut pas mieux qu'un garde trop laxiste : les deux mentent.
 *
 * Version actuelle : chaque point déclare sa CLASSE de largeur, et deux points se gênent
 * quand leur écart horizontal est inférieur à la DEMI-SOMME de leurs largeurs — la vraie
 * condition de recouvrement de deux boîtes. Les valeurs viennent d'une mesure au banc
 * Chromium (cadre 272 × 508 px).
 */
export type ClasseLargeur = "etroite" | "normale" | "large";

/** Largeurs mesurées au banc, en % de la largeur du cadre. */
export const LARGEURS_PCT: Record<ClasseLargeur, number> = {
  /** Un nombre seul, sans unité — les quatre pressions. Mesuré 16,9 à 19,9 %. */
  etroite: 21,
  /** Un nombre et son unité, ou un mot court. Mesuré 25 à 29 %. */
  normale: 30,
  /** Les deux VEDETTES (charge, verrou) : police plus grande. Mesuré 43 à 43,4 %. */
  large: 45,
};

/**
 * La hauteur d'une pastille, en % du cadre. ⚠️ Elle a CHANGÉ avec l'image : une pastille
 * fait toujours une ligne (34 px), mais le cadre a changé de forme.
 *
 * ⚠️ MESURÉE AU BANC, et il a fallu S'Y REPRENDRE À TROIS FOIS — l'histoire vaut d'être
 * écrite, parce que chaque erreur donnait un nombre d'apparence raisonnable :
 *   1. 2,4 % — obtenu en divisant 34 px par la hauteur de l'IMAGE (1 685 px) au lieu de
 *      celle du cadre RENDU (603 px). Diviser par la mauvaise référence donne un garde
 *      deux fois trop laxiste, c'est-à-dire un garde qui ne garde rien ;
 *   2. 5,8 % — mesuré, mais sur un banc où les pastilles n'avaient PAS leur classe
 *      d'apparence : le navigateur rendait des boutons par défaut, plus hauts et plus
 *      larges que les vraies. Un banc infidèle ne corrige pas une erreur, il en fabrique
 *      une autre avec l'autorité d'une mesure ;
 *   3. 4,7 % — mesuré sur le rendu fidèle. Les vedettes (charge, verrou) font 4,5 %, les
 *      autres 3,3 % ; on retient la plus haute, un garde se calant sur le pire cas.
 * Les largeurs ci-dessus viennent de cette même troisième mesure.
 */
export const HAUTEUR_PASTILLE_PCT = 4.7;

/**
 * ⚠️ SUR TÉLÉPHONE, LES PASTILLES NE FONT PAS LA MÊME TAILLE — et les pourcentages
 * ci-dessus n'y valent donc rien.
 *
 * Marc, 13/09 : « fais les boutons et tout plus gros ». Mesuré au banc à 390 × 844, les
 * dix cibles de l'accueil passaient sous 44 px (la plus grosse 26,5 px). Le bloc
 * `@media (max-width: 700px)` de `globals.css` les porte à 44 px minimum ET élargit la
 * carrosserie à 20rem — les deux ensemble, parce qu'agrandir les pastilles seules fait se
 * toucher l'autonomie et la charge (mesuré : 32 × 1 px de recouvrement à 17rem).
 *
 * Deux changements qui NE SE COMPENSENT PAS : la pastille grandit plus vite que le cadre,
 * donc elle pèse plus lourd en pourcentage. D'où ce second jeu, mesuré sur le rendu mobile
 * réel (cadre 320 × 709 px) au PIRE CAS de contenu — charge affichant son heure de fin,
 * verrou affichant « Verrouillée », odomètre à six chiffres :
 *   • étroite 20,6 % · normale 39,7 % (« Tous fermés ») · large 45,8 % (la charge) ;
 *   • hauteur 6,61 % pour les vedettes, 6,23 % pour les autres — on retient la plus haute,
 *     un garde se calant sur le pire cas (même règle que le 4,7 % du desktop).
 */
export const LARGEURS_PCT_MOBILE: Record<ClasseLargeur, number> = {
  etroite: 21,
  normale: 40,
  large: 46,
};

export const HAUTEUR_PASTILLE_PCT_MOBILE = 6.7;

/**
 * Les dimensions d'une pastille, pour un rendu donné. Elles sont un PARAMÈTRE et non une
 * constante depuis que le téléphone et l'ordinateur n'ont plus les mêmes : un garde qui
 * lirait les constantes du desktop déclarerait « ça tient » sur une disposition mobile
 * qu'il n'a jamais mesurée.
 */
export interface MetriquesPastille {
  largeurs: Record<ClasseLargeur, number>;
  hauteur: number;
}

export const METRIQUES_DESKTOP: MetriquesPastille = {
  largeurs: LARGEURS_PCT,
  hauteur: HAUTEUR_PASTILLE_PCT,
};

export const METRIQUES_MOBILE: MetriquesPastille = {
  largeurs: LARGEURS_PCT_MOBILE,
  hauteur: HAUTEUR_PASTILLE_PCT_MOBILE,
};

export const CLASSE_PAR_POINT: Record<IdPoint, ClasseLargeur> = {
  autonomie: "normale",
  // ⚠️ `large` même hors charge : la classe décrit le PIRE cas, pas l'affichage du moment.
  // Sinon la disposition serait valide batterie pleine et cassée en cours de charge — un
  // défaut qui n'apparaîtrait que branché, c'est-à-dire quand on regarde justement l'écran.
  charge: "large",
  synchro: "normale",
  // ⚠️ VEDETTE elle aussi : « Verrouillée » en grande police fait 43 % — la même largeur
  // que la charge. La classe suit ce que la pastille MESURE, pas le rôle qu'on lui prête.
  verrou: "large",
  ouvrants: "normale",
  odometre: "normale",
  "pneu-avant-gauche": "etroite",
  "pneu-avant-droite": "etroite",
  "pneu-arriere-gauche": "etroite",
  "pneu-arriere-droite": "etroite",
};

/**
 * De quel CÔTÉ une bulle d'explication doit s'accrocher pour rester à l'écran.
 *
 * ⚠️ CE DÉFAUT EXISTAIT AVANT LE TÉLÉPHONE, et mon lot précédent l'a AGGRAVÉ. Mesuré au
 * banc à 390 px : les quatre bulles des pressions sortaient déjà du cadre de **36 px**
 * quand la voiture faisait 17rem, et de **53 px** une fois élargie à 20rem. Le texte de
 * l'explication était donc coupé — sur les points les plus excentrés, c'est-à-dire ceux
 * qui en avaient le plus besoin.
 *
 * La bulle est CENTRÉE sur son point (`left: 50%; translateX(-50%)`) et large de `68vw`.
 * Elle sort donc par la gauche dès que
 *   `cadreGauche + x/100 × cadreLargeur − 0,34 × vw < 0`.
 * Avec la voiture centrée, `cadreGauche = (vw − cadreLargeur) / 2`. Résolu aux trois
 * largeurs de téléphone courantes (cadre 20rem = 320 px) :
 *   360 px → coupe sous x = 32,0 · 390 px → sous 30,5 · 430 px → sous 28,4.
 * Le seuil retenu est **33**, au-dessus des trois : il attrape tout ce qui coupe
 * réellement, avec de la marge, et le symétrique vaut à droite (100 − 33 = 67).
 *
 * ⚠️ La règle porte sur la POSITION, jamais sur l'identité des points. Une liste
 * (« les quatre pressions ») serait fausse au premier point ajouté près d'un bord, et
 * personne ne le verrait — le texte serait simplement coupé, sans erreur. PURE.
 */
export type CotePastille = "gauche" | "droite" | "centre";

/** Au-delà de ce pourcentage d'un bord, une bulle centrée sort de l'écran. Mesuré. */
export const SEUIL_BORD_PCT = 33;

export function cotePastille(ancre: Ancre): CotePastille {
  if (ancre.x < SEUIL_BORD_PCT) return "gauche";
  if (ancre.x > 100 - SEUIL_BORD_PCT) return "droite";
  return "centre";
}

/** Distance entre deux ancres, dans l'espace des pourcentages. PURE. */
export function ecartAncres(a: Ancre, b: Ancre): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Deux pastilles de ces classes, centrées sur ces ancres, se recouvrent-elles ? PURE. */
export function seChevauchent(
  a: Ancre,
  b: Ancre,
  classeA: ClasseLargeur = "normale",
  classeB: ClasseLargeur = "normale",
  metriques: MetriquesPastille = METRIQUES_DESKTOP,
): boolean {
  const demiSomme = (metriques.largeurs[classeA] + metriques.largeurs[classeB]) / 2;
  return Math.abs(a.x - b.x) < demiSomme && Math.abs(a.y - b.y) < metriques.hauteur;
}

/**
 * La marge VERTICALE la plus faible entre deux pastilles qui se croisent horizontalement,
 * en points de pourcentage. Négative = elles se recouvrent.
 *
 * ⚠️ Pourquoi cette fonction en plus du booléen : sur téléphone, autonomie et charge ne se
 * touchent pas, mais il ne reste que 0,3 point entre elles (4 px mesurés au banc). Un
 * booléen dit « ça tient » aussi bien à 0,3 point qu'à 20 — et c'est précisément la
 * différence entre une disposition robuste et une disposition qui cassera au premier
 * libellé plus long. Ce que le test surveille, c'est cette marge, pas seulement le vert.
 * PURE.
 */
export function margeVerticaleMin(
  ancres: Record<IdPoint, Ancre> = ANCRES,
  classes: Record<IdPoint, ClasseLargeur> = CLASSE_PAR_POINT,
  metriques: MetriquesPastille = METRIQUES_DESKTOP,
): { marge: number; paire: [IdPoint, IdPoint] | null } {
  const ids = Object.keys(ancres) as IdPoint[];
  let marge = Infinity;
  let paire: [IdPoint, IdPoint] | null = null;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!;
      const b = ids[j]!;
      const demiSomme = (metriques.largeurs[classes[a]] + metriques.largeurs[classes[b]]) / 2;
      // Elles ne se gênent que si elles se croisent en X : deux pastilles de part et
      // d'autre de la carrosserie peuvent partager la même hauteur sans se toucher.
      if (Math.abs(ancres[a].x - ancres[b].x) >= demiSomme) continue;
      const ecart = Math.abs(ancres[a].y - ancres[b].y) - metriques.hauteur;
      if (ecart < marge) {
        marge = ecart;
        paire = [a, b];
      }
    }
  }
  return { marge, paire };
}

/**
 * Les paires d'ancres dont les pastilles se recouvrent. Vide = la disposition tient. PURE.
 * Retourne les paires plutôt qu'un booléen : un test qui échoue doit DIRE lesquelles.
 */
export function ancresQuiSeChevauchent(
  ancres: Record<IdPoint, Ancre> = ANCRES,
  classes: Record<IdPoint, ClasseLargeur> = CLASSE_PAR_POINT,
  metriques: MetriquesPastille = METRIQUES_DESKTOP,
): Array<[IdPoint, IdPoint]> {
  const ids = Object.keys(ancres) as IdPoint[];
  const paires: Array<[IdPoint, IdPoint]> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!;
      const b = ids[j]!;
      if (seChevauchent(ancres[a], ancres[b], classes[a], classes[b], metriques)) paires.push([a, b]);
    }
  }
  return paires;
}

/**
 * Une ancre hors de la boîte ne se voit pas — et un point invisible ne se déboguerait que
 * par hasard. Une pastille est CENTRÉE sur son ancre, donc la marge vaut sa DEMI-dimension
 * — et comme la pastille est large et plate, la marge horizontale n'est pas la verticale.
 * Une marge unique forcerait à repousser les valeurs du capot et du hayon vers le centre
 * pour rien.
 */
export const MARGE_Y = HAUTEUR_PASTILLE_PCT / 2;

/** Les ancres qui sortent de la boîte (marge comprise). Vide = tout est visible. PURE. */
export function ancresHorsCadre(
  ancres: Record<IdPoint, Ancre> = ANCRES,
  metriques: MetriquesPastille = METRIQUES_DESKTOP,
): IdPoint[] {
  const margeY = metriques.hauteur / 2;
  return (Object.keys(ancres) as IdPoint[]).filter((id) => {
    const a = ancres[id];
    // La marge horizontale est la DEMI-largeur du point lui-même : une étroite peut
    // s'approcher du bord là où une large déborderait.
    const margeX = metriques.largeurs[CLASSE_PAR_POINT[id]] / 2;
    return a.x < margeX || a.x > 100 - margeX || a.y < margeY || a.y > 100 - margeY;
  });
}

/** Le ton d'un point — il colore la pastille et rien d'autre. */
export type TonPoint = "ok" | "attention" | "danger" | "neutre" | "inconnu";

/**
 * Une information posée sur la carrosserie.
 *
 * ⚠️ DONNÉES SEULEMENT, aucune icône ni JSX : ce type traverse la frontière serveur →
 * client. Les icônes sont choisies par `id` du côté client, où elles vivent déjà.
 */
export interface PointVoiture {
  id: IdPoint;
  /** Ce qui s'affiche sur la pastille. `"—"` quand il n'y a pas de mesure — jamais un 0. */
  valeur: string;
  /** L'unité, séparée pour pouvoir la composer plus petite que le nombre. */
  unite?: string;
  libelle: string;
  ton: TonPoint;
  /** Le détail, en paragraphes, montré quand on ouvre le point. */
  detail: string[];
  /** `true` pour les deux valeurs vitales (charge, autonomie) : pastille plus grande. */
  vedette?: boolean;
  /**
   * Ce point OUVRE une commande au lieu d'une simple bulle. Les seuls qui agissent sur la
   * voiture — tout le reste est en lecture, et ça doit se voir dans le type.
   */
  commande?: "verrou" | "charge";
}
