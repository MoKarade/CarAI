// lib/vehicle/vue3d.ts — la GÉOMÉTRIE de la vue 3D, sans une ligne de WebGL.
//
// ══ POURQUOI CE MODULE EXISTE ════════════════════════════════════════════════════════
//
// Marc, 18/09/2026 : « une interface 3D que je peux voir la voiture, tourner autour, et
// voir les états de chaque élément ». Le rendu lui-même (three.js, canvas, boucle
// d'animation) n'est pas testable ici : jsdom n'a pas de WebGL, et un test qui monterait
// le composant ne mesurerait que sa capacité à ne pas planter.
//
// Ce qui SE teste, c'est tout ce qui décide : dans quel repère on travaille, où est la
// caméra au premier affichage, et si un marqueur est devant la carrosserie ou derrière.
// Ce fichier porte donc exactement cette part — PURE, sans `three`, sans `window`.
//
// ══ LE MODÈLE PORTE DÉJÀ SA TRANSFORMATION — ET LE LOT 4b L'AVAIT MANQUÉ ═════════════
//
// ⚠️ **C'est le défaut que Marc a vu à l'écran le 18/09 : « marche pas elle est minus ».**
// La voiture était un point de quelques pixels au milieu de marqueurs correctement placés.
//
// `ancresVoiture.ts` décrit les positions telles qu'elles sont écrites dans les BUFFERS du
// fichier : Y vers l'avant, Z vers le bas, 1 unité = 1 cm. Mais ce n'est PAS là que le
// modèle est rendu. Les douze nœuds de la scène portent chacun, dans le glTF :
//
//     scale    : [0,01 · 0,01 · 0,01]                    → la scène est en MÈTRES
//     rotation : quaternion (0,7071 · 0 · 0 · 0,7071)    → +90° autour de X, DÉJÀ appliqué
//
// Mesuré en composant les deux sur les `min`/`max` des accesseurs de position : la boîte
// englobante de la scène fait **2,116 m de large, 1,510 m de haut, 4,689 m de long**,
// c'est-à-dire la bZ4X réelle, déjà debout et déjà dans le bon sens.
//
// Les deux conséquences, et ce sont exactement les deux bugs livrés :
//
//   1. **Re-tourner `gltf.scene` de +90° ajoutait une SECONDE rotation** — la voiture
//      partait couchée. Le rendu ne touche donc plus à son orientation.
//   2. **Les ancres, restées en unités de buffer, étaient 100 fois trop grandes.** Le
//      cadrage calculé pour un objet de 270 « unités » plaçait la caméra à des CENTAINES
//      DE MÈTRES d'une voiture qui en fait quatre. Rien ne plantait : les marqueurs, eux,
//      étaient à la même fausse échelle, donc parfaitement lisibles autour d'un point.
//
// **La leçon, et elle est générale** : lire les `min`/`max` d'un accesseur donne la
// géométrie dans l'espace LOCAL du maillage, jamais sa place dans la scène. Entre les deux
// il y a la chaîne des transformations de nœuds, et un fichier exporté par un outil en
// porte presque toujours une. `tests/modele3d.test.ts` lit désormais ces deux valeurs DANS
// le fichier livré et rougit si elles changent.

import { ANCRES, MODELE, type Ancre3D, type ElementVoiture } from "@/lib/vehicle/ancresVoiture";
import type { IdPoint } from "@/lib/vehicle/pointsVoiture";

/**
 * L'échelle que les nœuds du modèle appliquent à leur géométrie. LUE DANS LE FICHIER.
 *
 * Les positions des buffers sont en centimètres ; les nœuds les ramènent à des mètres.
 * Toute ancre doit donc traverser ce facteur pour atterrir au bon endroit dans la scène.
 */
export const ECHELLE_MODELE = 0.01;

/**
 * Le quart de tour qui redresse le modèle — **déjà appliqué par ses propres nœuds**.
 *
 * ⚠️ Exporté pour convertir les ANCRES, jamais pour tourner la carrosserie : elle l'est
 * déjà. C'est ici que le lot 4b s'est trompé, et le rendu s'en tient désormais à cette
 * seule règle — il ne touche plus à `gltf.scene.rotation`.
 */
export const ROTATION_X_RAD = Math.PI / 2;

/** Un point du repère de RENDU (Y vers le haut), en MÈTRES — les unités de la scène. */
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Une ancre du modèle, placée là où la SCÈNE la met : rotation ET échelle. PURE.
 *
 * ⚠️ Les deux, pas l'une des deux. Le lot 4b n'appliquait que la rotation, et les marqueurs
 * se retrouvaient cent fois plus loin du centre que la carrosserie — sans que rien ne
 * plante, puisqu'ils étaient cohérents ENTRE EUX. Un test compose la transformation des
 * nœuds telle qu'elle est écrite dans le fichier et la compare à cette fonction.
 */
export function versRepereRendu(a: Ancre3D): Point3D {
  return {
    x: a.x * ECHELLE_MODELE,
    y: -a.z * ECHELLE_MODELE,
    z: a.y * ECHELLE_MODELE,
  };
}

/** Le centre géométrique de la carrosserie, dans le repère de rendu (mètres). PURE. */
export const CENTRE_VOITURE: Point3D = versRepereRendu({
  x: 0,
  y: (MODELE.avantY + MODELE.arriereY) / 2,
  z: (MODELE.solZ + MODELE.toitZ) / 2,
});

/**
 * Le rayon de la sphère qui contient toute la voiture, DÉRIVÉ des mesures.
 *
 * ⚠️ Dérivé, jamais écrit en dur : le jour où le modèle change, un nombre figé cadrerait
 * une voiture qui n'est plus là — sans rien casser, donc sans rien signaler.
 */
export const RAYON_VOITURE =
  Math.hypot(
    (MODELE.avantY - MODELE.arriereY) / 2,
    (MODELE.solZ - MODELE.toitZ) / 2,
    MODELE.demiLargeurFlanc + 27,
  ) * ECHELLE_MODELE;

/**
 * À quelle distance placer la caméra pour que la voiture tienne ENTIÈRE dans le cadre.
 *
 * ⚠️ Le champ de vision d'une caméra three.js est VERTICAL. Sur un téléphone tenu debout,
 * c'est l'HORIZONTAL qui manque — il vaut `2·atan(tan(fov/2)·ratio)`, donc bien moins quand
 * le ratio est inférieur à 1. Cadrer sur le vertical seul couperait le nez et la poupe sur
 * l'écran de Marc, et pas du tout sur le mien. On prend donc le plus SERRÉ des deux. PURE.
 */
export function distanceCadrage(fovVerticalDeg: number, ratioLargeurHauteur: number): number {
  const fovV = (fovVerticalDeg * Math.PI) / 180;
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * Math.max(ratioLargeurHauteur, 0.01));
  const champLePlusServe = Math.min(fovV, fovH);
  return RAYON_VOITURE / Math.sin(champLePlusServe / 2);
}

/**
 * Jusqu'où on peut s'approcher et reculer, DÉRIVÉ du cadrage. PURE.
 *
 * ⚠️ Ces deux bornes étaient écrites en dur (200 et 1600) et exprimées dans la mauvaise
 * unité : en mètres, le plafond de 1600 laissait la caméra à **un kilomètre et demi** d'une
 * voiture de quatre mètres. C'est ce qui a rendu le premier jet inutilisable. Dérivées du
 * cadrage, elles suivent le modèle au lieu de le contredire.
 *
 * Le plancher laisse entrer jusqu'à frôler la carrosserie sans la traverser ; le plafond
 * autorise à reculer du double de ce qu'il faut pour tout voir, et pas plus — au-delà on
 * cherche une voiture dans le noir, ce qui est exactement le défaut qu'on vient de corriger.
 */
export function bornesOrbite(distanceDeCadrage: number): { min: number; max: number } {
  return { min: RAYON_VOITURE * 0.55, max: distanceDeCadrage * 2 };
}

/**
 * Combien un marqueur se voit, de 0 (franchement derrière la carrosserie) à 1 (face à
 * l'observateur). PURE.
 *
 * ══ POURQUOI UNE APPROXIMATION, ET POURQUOI ELLE SUFFIT ══════════════════════════════
 *
 * La question exacte — « ce point est-il caché par de la tôle ? » — se répondrait par un
 * lancer de rayon contre la géométrie, à chaque image et pour chaque marqueur. Sur un
 * maillage de 6 Mo, sur un téléphone, ce serait payer très cher un détail.
 *
 * Toutes les ancres sont POSÉES SUR la surface d'un volume à peu près convexe. Pour un tel
 * volume, le signe du produit scalaire entre « le point vu depuis le centre » et « la
 * caméra vue depuis le centre » répond déjà juste : positif, le point est du côté de
 * l'observateur. On rend le cosinus plutôt que son signe, pour que le marqueur s'ÉTEIGNE en
 * tournant au lieu de disparaître d'un coup — un clignotement se lit comme un bug.
 *
 * ⚠️ `MARGE_SILHOUETTE` fait qu'un marqueur exactement de PROFIL reste un peu visible : au
 * pied de la lettre, il serait à zéro pile au moment où on tourne autour de lui, et les
 * quatre pneus s'éteindraient tous les quarts de tour alors qu'on les voit très bien.
 */
export const MARGE_SILHOUETTE = 0.25;

export function visibiliteMarqueur(ancreRendu: Point3D, camera: Point3D): number {
  const n = depuisCentre(ancreRendu);
  const v = depuisCentre(camera);
  // Une ancre AU centre n'a pas de direction sortante : rien ne peut la cacher, elle vaut 1.
  if (n === null || v === null) return 1;
  const cos = n.x * v.x + n.y * v.y + n.z * v.z;
  return borner((cos + MARGE_SILHOUETTE) / (1 + MARGE_SILHOUETTE));
}

/**
 * Sous ce seuil, un marqueur n'est plus CLIQUABLE.
 *
 * ⚠️ Sinon on taperait au travers de la voiture : le marqueur du pneu arrière-droit,
 * fantôme à l'écran, resterait une cible de 44 px posée sur la portière qu'on regarde.
 * Un geste qui ouvre autre chose que ce qu'on voit est pire qu'un geste sans effet.
 */
export const SEUIL_MARQUEUR_ATTEIGNABLE = 0.2;

export function marqueurAtteignable(visibilite: number): boolean {
  return visibilite > SEUIL_MARQUEUR_ATTEIGNABLE;
}

/**
 * Le pont entre les DEUX vocabulaires du dépôt.
 *
 * ⚠️ `pointsVoiture.ts` dit `pneu-avant-droite` (le schéma 2D, depuis le 20/08) et
 * `ancresVoiture.ts` dit `pneu-avant-droit`. Les deux sont en place et employés ailleurs :
 * en renommer un pour « harmoniser » toucherait des tests et des données qui n'ont rien à
 * voir avec la 3D. On écrit donc la traduction UNE fois, ici, plutôt que de la laisser se
 * refaire à la main dans le composant — c'est là qu'un `droite` finirait par désigner la
 * roue d'en face sans que rien ne rougisse.
 *
 * ══ ET SURTOUT : CE QUI N'A PAS DE LIEU SUR LA TÔLE N'EN REÇOIT PAS ══════════════════
 *
 * Trois des dix informations du schéma ne désignent aucun organe. L'odomètre est un
 * compteur, la dernière synchro est un horodatage : les poser sur la carrosserie
 * inventerait un endroit. Elles valent `null` ici et s'affichent SOUS la vue, en clair.
 *
 * ⚠️ `Record` COMPLET, jamais un `?.` : TypeScript refuse alors d'ajouter une information
 * au schéma sans décider si elle se pose sur la voiture ou non. Une information oubliée
 * atterrirait sinon au centre du repère, c'est-à-dire dans le moteur.
 */
const ELEMENT_PAR_POINT: Record<IdPoint, ElementVoiture | null> = {
  // La charge se marque à la trappe : c'est là qu'on branche. Même choix qu'en 2D.
  charge: "trappe-de-charge",
  // L'autonomie au capot — le 2D la met déjà là, et deux écrans qui placent la même donnée
  // à deux endroits différents obligent à réapprendre la voiture d'une page à l'autre.
  autonomie: "capot",
  verrou: "verrouillage",
  ouvrants: "portieres",
  "pneu-avant-gauche": "pneu-avant-gauche",
  "pneu-avant-droite": "pneu-avant-droit",
  "pneu-arriere-gauche": "pneu-arriere-gauche",
  "pneu-arriere-droite": "pneu-arriere-droit",
  odometre: null,
  synchro: null,
};

/** L'élément de carrosserie qu'une information désigne, ou `null` si elle n'en désigne pas. */
export function elementPourPoint(id: IdPoint): ElementVoiture | null {
  return ELEMENT_PAR_POINT[id];
}

/**
 * Les informations posées SUR la voiture, avec leur ancre déjà dans le repère de rendu.
 * Les autres sont rendues à l'appelant telles quelles, pour qu'il les affiche ailleurs.
 * PURE — c'est elle qui décide de ce que le canvas montre, donc elle se teste.
 */
export function repartirPoints<P extends { id: IdPoint }>(
  points: readonly P[],
): { surLaVoiture: { point: P; element: ElementVoiture; ancre: Point3D }[]; horsVoiture: P[] } {
  const surLaVoiture: { point: P; element: ElementVoiture; ancre: Point3D }[] = [];
  const horsVoiture: P[] = [];
  for (const point of points) {
    const element = elementPourPoint(point.id);
    if (element === null) {
      horsVoiture.push(point);
      continue;
    }
    surLaVoiture.push({ point, element, ancre: versRepereRendu(ANCRES[element]) });
  }
  return { surLaVoiture, horsVoiture };
}

/** Ce qu'un marqueur annonce à l'écran et aux lecteurs d'écran. PURE. */
const LIBELLES: Record<ElementVoiture, string> = {
  "pneu-avant-gauche": "Pneu avant gauche",
  "pneu-avant-droit": "Pneu avant droit",
  "pneu-arriere-gauche": "Pneu arrière gauche",
  "pneu-arriere-droit": "Pneu arrière droit",
  portieres: "Portières",
  fenetres: "Vitres",
  verrouillage: "Verrouillage",
  capot: "Capot",
  "trappe-de-charge": "Trappe de charge",
};

export function libelleElement(element: ElementVoiture): string {
  return LIBELLES[element];
}

/**
 * La position de départ de la caméra : trois quarts avant, un peu au-dessus.
 *
 * C'est l'angle sous lequel on reconnaît une voiture — de face elle n'a pas de longueur,
 * de profil elle n'a pas de visage. PURE, et exprimée en fonction de la distance pour que
 * le cadrage et l'angle restent deux décisions séparées.
 */
export function positionCameraDepart(distance: number): Point3D {
  // Azimut 35° depuis l'axe longitudinal, élévation 18° au-dessus de l'horizon.
  const azimut = (35 * Math.PI) / 180;
  const elevation = (18 * Math.PI) / 180;
  const horizontal = distance * Math.cos(elevation);
  return {
    x: horizontal * Math.sin(azimut),
    y: CENTRE_VOITURE.y + distance * Math.sin(elevation),
    z: CENTRE_VOITURE.z + horizontal * Math.cos(azimut),
  };
}

function depuisCentre(p: Point3D): Point3D | null {
  const x = p.x - CENTRE_VOITURE.x;
  const y = p.y - CENTRE_VOITURE.y;
  const z = p.z - CENTRE_VOITURE.z;
  const norme = Math.hypot(x, y, z);
  if (norme < 1e-6) return null;
  return { x: x / norme, y: y / norme, z: z / norme };
}

function borner(v: number): number {
  return Math.max(0, Math.min(1, v));
}
