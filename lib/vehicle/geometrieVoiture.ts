// lib/vehicle/geometrieVoiture.ts — OÙ se trouve chaque organe sur l'image de la voiture.
//
// ══ D'OÙ VIENT L'IMAGE ══════════════════════════════════════════════════════════════════
// `public/bz4x-dessus.webp` est un RENDU 3D du vrai modèle de la bZ4X (fichier `.glb`
// fourni par Marc), produit dans la session du 20/08 :
//   • caméra ORTHOGRAPHIQUE zénithale — aucune perspective, donc les quatre roues ont
//     rigoureusement la même taille à l'écran ; c'est la condition pour qu'une pastille de
//     pression tombe sur la bonne roue, et ce qu'une capture d'écran ne peut pas garantir ;
//   • fond transparent d'origine (aucun détourage, aucun artefact de contour) ;
//   • studio sombre construit dans la scène, lampes RASANTES — une lampe zénithale se
//     réfléchit droit dans l'objectif sur un pavillon horizontal et noie le vitrage ;
//   • rendu à 812 px de large puis réduit une fois à 760, JAMAIS recadré (voir ci-dessous).
//
// ⚠️ NE JAMAIS ROGNER L'IMAGE. Les coordonnées ci-dessous sont des POURCENTAGES du cadre
// tel que rendu, marge comprise. Un recadrage déplacerait l'origine et décalerait les
// quatre pastilles de pression de la roue qu'elles désignent — exactement le défaut trouvé
// au banc le 20/08. Toute nouvelle image doit être produite avec le MÊME cadrage, ou ces
// constantes doivent être re-mesurées avec elle.
//
// ⚠️ MESURÉES, PAS ESTIMÉES. Les boîtes des roues viennent d'un rendu où SEULES les roues
// étaient visibles (matériaux `M_TYRE_*`), dont on a lu les boîtes englobantes au pixel.
// Un premier motif plus large (`rubber|wheel|rim`) attrapait des pièces de liaison au sol
// et donnait des « roues » de 41 % de large — impossible pour un pneu de 235 mm sur une
// voie de 2 117 mm, ce qui a permis de rejeter la mesure au lieu de la croire.

import type { Position } from "@/lib/vehicle/schemaVehicule";

/** Largeur ÷ hauteur de l'image. Le conteneur doit adopter ce rapport exactement. */
export const RATIO_IMAGE = 760 / 1685;

/** Chemin de l'image, unique et servi tel quel. */
export const IMAGE_VOITURE = "/bz4x-dessus.webp";

export interface Boite {
  /** Centre, en % de la largeur / de la hauteur du cadre. */
  x: number;
  y: number;
  /** Dimensions, dans les mêmes unités. */
  largeur: number;
  hauteur: number;
}

/**
 * Les quatre roues, mesurées sur le rendu (cadre 619 × 1373 lors de la mesure ; les
 * pourcentages restent valables à toute résolution puisque le cadrage est identique).
 */
export const ROUES: Record<Position, Boite> = {
  "avant-gauche": { x: 13.8, y: 21.2, largeur: 10.5, hauteur: 14.9 },
  "avant-droite": { x: 85.1, y: 21.2, largeur: 10.7, hauteur: 14.9 },
  "arriere-gauche": { x: 13.8, y: 78.5, largeur: 10.5, hauteur: 14.9 },
  "arriere-droite": { x: 85.1, y: 78.5, largeur: 10.7, hauteur: 14.9 },
};

/**
 * Les quatre ouvrants, le long des flancs. ⚠️ Contrairement aux roues, ceux-ci sont posés
 * par PROPORTION et non mesurés : les portières partagent le matériau de la carrosserie,
 * un rendu-masque ne sait donc pas les isoler. C'est acceptable ici — un repère d'ouvrant
 * indique un CÔTÉ, il n'a pas besoin de la précision qu'exige une pression de pneu — mais
 * la différence est dite, pour qu'on ne les croie pas mesurés au même titre.
 */
export const OUVRANTS: Record<Position, Boite> = {
  "avant-gauche": { x: 12.2, y: 39, largeur: 1.6, hauteur: 9 },
  "avant-droite": { x: 87.8, y: 39, largeur: 1.6, hauteur: 9 },
  "arriere-gauche": { x: 12.2, y: 52, largeur: 1.6, hauteur: 9 },
  "arriere-droite": { x: 87.8, y: 52, largeur: 1.6, hauteur: 9 },
};

/** Vrai si la boîte tient entièrement dans le cadre. PURE. */
export function tientDansLeCadre(b: Boite): boolean {
  return (
    b.x - b.largeur / 2 >= 0 &&
    b.x + b.largeur / 2 <= 100 &&
    b.y - b.hauteur / 2 >= 0 &&
    b.y + b.hauteur / 2 <= 100
  );
}

/**
 * Vrai quand les quatre boîtes sont disposées en MIROIR autour des deux axes, à `marge`
 * près. C'est l'invariant que doit respecter une vue orthographique zénithale : gauche et
 * droite à la même hauteur, avant et arrière à la même abscisse. Une perspective résiduelle
 * ou un cadrage de travers le casse — et c'est précisément ce qu'on ne veut pas laisser
 * passer, puisque tout le placement en dépend. PURE.
 */
export function estSymetrique(boites: Record<Position, Boite>, marge = 1.2): boolean {
  const g = boites["avant-gauche"];
  const d = boites["avant-droite"];
  const ag = boites["arriere-gauche"];
  const ad = boites["arriere-droite"];
  return (
    Math.abs(g.y - d.y) <= marge &&
    Math.abs(ag.y - ad.y) <= marge &&
    Math.abs(g.x - ag.x) <= marge &&
    Math.abs(d.x - ad.x) <= marge &&
    Math.abs((g.x + d.x) / 2 - 50) <= marge &&
    Math.abs((g.y + ag.y) / 2 - 50) <= marge
  );
}
