// lib/vehicle/ancresVoiture.ts — OÙ poser un état sur la carrosserie, en 3D.
//
// ══ POURQUOI DES ANCRES CALCULÉES, ET PAS DES PIÈCES DU MODÈLE ═══════════════════════
//
// Marc, 18/09/2026 : « je le veux beaucoup plus poussé, limite une interface 3D où je peux
// voir la voiture, tourner autour, et voir les états de chaque élément ».
//
// Le premier réflexe serait de colorier la pièce concernée — la portière qui s'ouvre, le
// pneu qui se dégonfle. ⚠️ **Le modèle ne le permet pas, et c'est mesuré** : il est fusionné
// par MATÉRIAU, pas par pièce. Les QUATRE roues partagent un seul maillage (étendue
// X −91,6 → +91,6 et Y −179,2 → +180,2 : toute l'empreinte du véhicule), toutes les vitres
// aussi, et la trappe de charge comme le capot n'existent sous aucun nom — zéro occurrence
// sur les 215 nœuds. Découper la géométrie serait un chantier à part, sans garantie.
//
// D'où ce module : la voiture reste un DÉCOR fidèle, et les états sont des points POSÉS
// dessus, à des coordonnées dérivées de ses vraies dimensions. C'est exactement le patron
// du schéma SVG actuel (`lib/vehicle/pointsVoiture.ts`), transposé en trois dimensions.
//
// ══ LE REPÈRE, ÉTABLI PAR LA MESURE ══════════════════════════════════════════════════
//
// Toutes ces valeurs sont lues dans le modèle livré (`public/modele/bz.glb`), pas dans une
// fiche technique — et elles CONCORDENT avec la bZ4X réelle, ce qui est la preuve que
// l'échelle et l'orientation sont bien celles-là :
//
//     1 unité = 1 cm          longueur mesurée 468,9 cm · bZ4X réelle 469 cm (écart 0,02 %)
//     X = largeur             étendue 211,6 cm, rétroviseurs dépliés compris
//     Y = longueur, POSITIF VERS L'AVANT   (pare-brise à Y +29 → +116, feux arrière à
//                             Y −235 → −175 : deux repères indépendants qui concordent)
//     Z = hauteur, POSITIF VERS LE BAS     (sol à Z ≈ +2,4 ; toit à Z ≈ −161,2)
//     essieux à Y ± 145       empattement 290 cm · bZ4X réelle 285 cm (écart 1,8 %)
//     rayon de roue 35 cm     soit 70 cm de diamètre · un 235/60R18 en fait 71
//
// **QUEL CÔTÉ EST LA GAUCHE.** Rien dans le modèle ne lève l'ambiguïté (il faudrait un
// élément asymétrique : le volant, la trappe de charge ; l'intérieur est fusionné et la
// trappe n'existe pas comme entité). La convention ci-dessous (`X` négatif = côté conducteur)
// a été posée en hypothèse puis **confirmée à l'œil par Marc le 28/10/2026** : voir
// `COTE_VERIFIE`. Afficher « avant-gauche » sur la roue de droite serait une donnée juste
// posée au mauvais endroit — donc un `no-fake-data` —, c'est pourquoi le drapeau existe.

/** Un point du repère du modèle, en centimètres. */
export interface Ancre3D {
  x: number;
  y: number;
  z: number;
}

/** Ce qu'un marqueur désigne. Un par élément RÉELLEMENT instrumenté, et rien d'autre. */
export type ElementVoiture =
  | "pneu-avant-gauche"
  | "pneu-avant-droit"
  | "pneu-arriere-gauche"
  | "pneu-arriere-droit"
  | "portieres"
  | "fenetres"
  | "verrouillage"
  | "capot"
  | "trappe-de-charge";

/** Dimensions du modèle livré, mesurées sur `public/modele/bz.glb`. */
export const MODELE = {
  /** Demi-largeur hors rétroviseurs — le flanc, là où se posent les marqueurs de roue. */
  demiLargeurFlanc: 80,
  /** Position des essieux sur l'axe longitudinal. Empattement mesuré : 290 cm. */
  essieuY: 145,
  /** Centre d'une roue, sous le seuil de caisse. */
  centreRoueZ: -37,
  /** Le toit. `Z` descend, donc c'est la valeur la plus NÉGATIVE de la carrosserie. */
  toitZ: -161.2,
  /** Le sol, sous les roues. */
  solZ: 2.4,
  /** Le nez et la poupe. */
  avantY: 234.4,
  arriereY: -234.5,
} as const;

/**
 * **Le côté conducteur est confirmé** : Marc a regardé la vue 3D le 28/10/2026 (réponse « oui »
 * dans la Tournée à l'écran, Hubperso#137 ligne 6) — les pressions tombent du bon côté, `X`
 * négatif = côté conducteur est donc une mesure à l'œil, plus une hypothèse.
 *
 * Le drapeau reste : si le modèle 3D change (autre fichier, autre repère), il faut le repasser
 * à `false` jusqu'à un nouveau coup d'œil, et l'interface remet alors sa réserve.
 */
export const COTE_VERIFIE = true;

/** Où chaque élément se pose sur la carrosserie. PURE. */
export const ANCRES: Readonly<Record<ElementVoiture, Ancre3D>> = {
  "pneu-avant-gauche": {
    x: -MODELE.demiLargeurFlanc,
    y: MODELE.essieuY,
    z: MODELE.centreRoueZ,
  },
  "pneu-avant-droit": {
    x: MODELE.demiLargeurFlanc,
    y: MODELE.essieuY,
    z: MODELE.centreRoueZ,
  },
  "pneu-arriere-gauche": {
    x: -MODELE.demiLargeurFlanc,
    y: -MODELE.essieuY,
    z: MODELE.centreRoueZ,
  },
  "pneu-arriere-droit": {
    x: MODELE.demiLargeurFlanc,
    y: -MODELE.essieuY,
    z: MODELE.centreRoueZ,
  },
  // Les portières se marquent à la poignée du conducteur : c'est l'endroit qu'on regarde
  // quand on se demande si la voiture est fermée.
  portieres: { x: -MODELE.demiLargeurFlanc, y: 40, z: -110 },
  // Les vitres, un cran plus haut que les portières pour ne pas se superposer à elles.
  fenetres: { x: -MODELE.demiLargeurFlanc, y: 40, z: -140 },
  // Le verrouillage vaut pour la voiture entière : il se pose sur le TOIT, au centre.
  verrouillage: { x: 0, y: 0, z: MODELE.toitZ },
  // `closure-enginecover` : le capot, donc le nez, à mi-hauteur.
  capot: { x: 0, y: MODELE.avantY - 30, z: -105 },
  // ⚠️ Position DÉDUITE de la bZ4X réelle (trappe à l'avant-droit, derrière le passage de
  // roue), PAS lue dans le modèle : elle n'y existe sous aucun nom. Elle hérite donc de la
  // même incertitude de côté que le reste, et d'une seconde par-dessus.
  "trappe-de-charge": { x: MODELE.demiLargeurFlanc, y: 105, z: -95 },
};

/**
 * Le marqueur d'un élément, ou `null` quand la voiture n'en dit rien.
 *
 * ⚠️ C'est LA règle du dépôt appliquée à la 3D. Un modèle complet affiche un hayon, un toit
 * ouvrant, des phares — la bZ ne publie leur état sur AUCUN d'eux (mesuré : 3 valeurs en
 * août, puis plus rien). Une carrosserie entièrement peinte en vert dirait « tout va bien »
 * de pièces dont personne ne sait rien. Un élément sans mesure n'a donc pas de marqueur du
 * tout : l'absence se voit, et elle est honnête.
 */
export function marqueurPour<T>(
  element: ElementVoiture,
  mesure: T | null | undefined,
): { element: ElementVoiture; ancre: Ancre3D; mesure: T } | null {
  if (mesure === null || mesure === undefined) return null;
  return { element, ancre: ANCRES[element], mesure };
}

/** Un point est-il DANS la carrosserie ? PURE — sert de garde, pas d'affichage. */
export function dansLaVoiture(p: Ancre3D): boolean {
  return (
    Math.abs(p.x) <= MODELE.demiLargeurFlanc + 27 &&
    p.y <= MODELE.avantY &&
    p.y >= MODELE.arriereY &&
    p.z <= MODELE.solZ &&
    p.z >= MODELE.toitZ
  );
}
