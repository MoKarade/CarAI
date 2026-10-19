// lib/vehicle/trajets.ts — reconstitution des TRAJETS à partir des positions enregistrées.
//
// ══ POURQUOI CE MODULE EXISTE ════════════════════════════════════════════════════════
//
// « Le lien Maps me donne juste un point, je veux un historique détaillé de trajet »
// (Marc, 12/08/2026). Un point est une donnée ; un trajet est une INFORMATION — d'où on
// est parti, quand, jusqu'où, combien de kilomètres. C'est aussi ce qui rend le suivi du
// bail compréhensible : « 3 500 km » ne dit pas si c'est le trajet du travail ou un voyage.
//
// ══ CE QUE LA VOITURE PUBLIE VRAIMENT (mesuré le 12/08, re-mesuré le 18/09/2026) ═════════════════════════
//
// Le poll `smartcar-poll.yml` rend la liste des signaux qui répondent. Sur 74 souscrits,
// quatre marchent en permanence : `location-preciselocation`, `odometer-traveleddistance`,
// `tractionbattery-nominalcapacity`, `wheel-tires`.
//
// ⚠️ Ces deux lignes ont affirmé jusqu'au 18/09/2026 que `motion-currentspeed` était
// refusé (ERROR PERMISSION) et que « la vitesse instantanée n'existe donc PAS ici ».
// C'était vrai le 12/08 au matin et faux dès le re-Connect élargi du même jour : mesuré le
// 18/09, ce signal porte **1 180 valeurs** et livre encore à la minute du relevé. Il n'a
// toujours aucun consommateur (`[SC-08]` au backlog), mais l'absence d'un CONSOMMATEUR et
// l'absence de la DONNÉE sont deux choses différentes — seule la seconde interdit de s'en
// servir, et c'est la première qui est vraie.
//
// Conséquence directe sur ce module : les positions ne décrivent pas une TRACE continue.
// Elles arrivent quand le véhicule republie sa localisation, c'est-à-dire pour l'essentiel
// à l'arrêt (`locationType: LAST_PARKED`). Entre deux relevés, la route suivie n'est PAS
// enregistrée : elle est inconnue, et le module le dit (`cheminInconnu`) au lieu de laisser
// croire qu'une ligne droite est le chemin parcouru.
//
// ══ LE DÉCOUPAGE : C'EST LE COMPTEUR QUI TRANCHE, PLUS L'HORLOGE ═════════════════════
//
// La version précédente groupait les relevés séparés de moins de 45 minutes et jetait tout
// groupe réduit à un seul point (`groupe.length < 2`). Sur des relevés de STATIONNEMENT,
// c'est exactement le mauvais modèle, et il se trompait dans les deux sens :
//
//   • il PERDAIT des trajets entiers — un aller le matin et un retour le soir sont deux
//     relevés distants de neuf heures, donc deux groupes d'un seul point, donc zéro trajet ;
//   • il en COMPTAIT en double — l'ancien appariement « odomètre encadrant » attribuait à
//     chaque trajet le delta de compteur de TOUTE la fenêtre qui l'entoure ; deux trajets
//     dans la même fenêtre recevaient chacun la totalité des kilomètres.
//
// C'est la cause du « les km sont pas bons » signalé par Marc le 12/08.
//
// Le modèle actuel part de la seule mesure EXACTE dont on dispose : l'odomètre du véhicule.
// Entre deux relevés de position consécutifs, la voiture a roulé si et seulement si le
// COMPTEUR a avancé. Un aller-retour qui revient se garer au même endroit est donc un vrai
// déplacement (la géométrie disait zéro, le compteur dit la vérité), et deux relevés au même
// endroit sans avancée du compteur sont une pause.
//
// ══ POURQUOI LES DISTANCES S'ADDITIONNENT MAINTENANT ═════════════════════════════════
//
// `odometreALinstant` est une FONCTION du seul instant : elle rend toujours le même
// kilométrage pour un instant donné. Les segments se suivent bout à bout, donc leurs deltas
// se télescopent — la somme des segments d'une fenêtre vaut exactement la différence de
// compteur entre ses deux bouts. Aucun kilomètre ne peut être compté deux fois, et
// `reconcilier` compare le total reconstitué au compteur brut pour que tout écart restant
// se VOIE plutôt que de se deviner.
//
// ══ « LES HEURES SONT JAMAIS LES BONNES » (Marc, 13/08/2026) ═════════════════════════
//
// `debut`/`fin` d'un trajet-fenêtre sont les instants des deux pings de stationnement qui
// l'encadrent — pas les vraies heures de départ et d'arrivée, qui ne sont enregistrées
// nulle part. `affinerFenetre` resserre cet encadrement avec tout relevé d'odomètre
// INTERMÉDIAIRE trouvé entre les deux : l'odomètre est figé tant que la voiture est garée,
// donc son dernier relevé encore à l'ancienne valeur borne le vrai départ bien mieux que le
// ping de stationnement de la veille. Sans relevé intermédiaire, rien ne change — la
// fonction ne peut que resserrer, jamais élargir.

import { distanceKm, lienCarte, type PointPosition } from "@/lib/vehicle/position";
import type { PointOdometre } from "@/lib/vehicle/lease";

export interface Trajet {
  /** Borne BASSE du départ : dernier instant connu où la voiture était encore là. */
  debut: Date;
  /** Borne HAUTE de l'arrivée : premier instant connu où elle était déjà garée. */
  fin: Date;
  /**
   * Borne HAUTE du départ — la voiture avait déjà bougé à cet instant.
   *
   * ⚠️ C'est CE champ qui manquait au premier correctif des heures (Marc, 13/08 : « les
   * heures sont toujours pas bonnes »). Voir `bornerFenetre` pour le détail.
   */
  departAuPlusTard: Date;
  /**
   * Largeur de l'encadrement du départ, en minutes. `0` quand l'heure est mesurée.
   *
   * Au-delà de `INCERTITUDE_MAX_MINUTES`, l'écran affiche un INTERVALLE plutôt qu'une heure :
   * une nuit sans aucun relevé ne permet pas de dire quand Marc est parti, et une heure
   * affichée là serait fausse.
   */
  departIncertitudeMinutes: number;
  /** Borne BASSE de l'arrivée : dernier instant connu où elle n'était pas encore arrivée. */
  arriveeAuPlusTot: Date;
  /** Largeur de l'encadrement de l'arrivée, en minutes. Presque toujours 0 (ping d'arrivée). */
  arriveeIncertitudeMinutes: number;
  depart: { lat: number; lng: number };
  arrivee: { lat: number; lng: number };
  /** Tous les relevés du trajet, dans l'ordre. */
  points: PointPosition[];
  /**
   * Écart entre le premier et le dernier relevé, en minutes.
   *
   * ⚠️ Ce n'est un TEMPS DE CONDUITE que si `dureeEstFenetre` est faux. Sur des relevés de
   * stationnement, l'horodatage marque l'ARRIVÉE : la durée englobe alors le temps garé au
   * point de départ, et n'a rien à voir avec le temps passé sur la route.
   */
  dureeMinutes: number;
  /** `true` quand la durée est une FENÊTRE (stationnement + route), pas un temps de conduite. */
  dureeEstFenetre: boolean;
  /** Distance retenue, en km. */
  distanceKm: number;
  /** `true` si la distance vient des POINTS (borne inférieure), `false` si de l'odomètre (exacte). */
  distanceEstimee: boolean;
  /**
   * `true` quand le chemin entre les relevés n'est PAS enregistré.
   *
   * La ligne qui relie les points est alors un raccourci de dessin, pas la route suivie —
   * et la carte doit le montrer autrement qu'un tracé plein (« ça devrait pas faire vol
   * d'oiseau », Marc, 12/08).
   */
  cheminInconnu: boolean;
  odoDebut: number | null;
  odoFin: number | null;
  /** Vitesse moyenne, km/h. `null` dès que la durée n'est pas un temps de conduite. */
  vitesseMoyenne: number | null;
}

/**
 * Durée maximale d'un segment encore considéré comme de la conduite continue.
 *
 * ⚠️ **Ce seuil a valu 45 minutes jusqu'au 18/09/2026, et il coupait TOUS les trajets.**
 * Sa justification d'alors — « le poll passe toutes les 30 minutes, deux relevés séparés de
 * plus de 45 minutes ne peuvent pas décrire un trajet suivi » — confondait deux cadences :
 * celle du POLL, et celle à laquelle **la voiture republie sa position**. Le poll ne crée
 * pas de relevé : il en LIT un, et la bZ ne rafraîchit sa position que de temps en temps.
 *
 * Mesuré le 18/09/2026 sur les 34 trajets réels des 7 jours précédents : les segments de
 * conduite continue durent **46 à 99 minutes** (un isolé à 149). Le seuil était donc
 * STRUCTURELLEMENT sous ce que la voiture produit, et aucun trajet ne pouvait jamais
 * enchaîner deux segments — les 34 avaient exactement 2 relevés. Un aller Maison → Travail
 * de 110 km sortait en TROIS trajets (6 + 91 + 13 km) séparés d'« arrêts » de 38 secondes,
 * et la carte, qui montre le dernier trajet, n'affichait que ses 13 derniers kilomètres.
 * C'est le « ça coupe à la moitié du trajet » de Marc (18/09).
 *
 * 120 minutes couvre tous les segments intermédiaires observés. Ce qu'un seuil plus large
 * coûte reste borné : un vrai stationnement ferme de toute façon par `bouge` (le compteur
 * n'avance pas) ou par `estArret` (relevé `LAST_PARKED`). Le seuil ne mord donc que sur un
 * intervalle où le compteur a AVANCÉ — où la voiture a réellement roulé.
 *
 * ⚠️ **Ce chiffre est une mesure DATÉE, pas une constante de la nature.** Il se re-mesure
 * le jour où la bZ change son rythme de publication : la bonne question n'est jamais « à
 * quelle cadence poll-on ? » mais « à quel intervalle la voiture republie-t-elle sa
 * position en roulant ? ».
 */
export const PAUSE_MINUTES = 120;

/**
 * Avancée minimale du compteur pour qu'un segment compte comme un déplacement.
 *
 * En dessous, c'est du bruit — dérive GPS autour d'une place, arrondi de l'odomètre. Un
 * « trajet de 40 m » dans la liste ferait douter de tous les autres.
 */
export const DISTANCE_MIN_KM = 0.3;

/**
 * Tolérance d'appariement entre un relevé de position et un relevé d'odomètre.
 *
 * Les deux viennent du même réveil du véhicule mais pas de la même milliseconde. 15 minutes
 * absorbent cet écart sans jamais pouvoir atteindre le poll suivant (30 min) — donc sans
 * jamais attribuer à un instant le compteur d'après le trajet suivant.
 */
export const TOLERANCE_ODO_MINUTES = 15;

/**
 * Âge maximal d'un relevé d'odomètre encore utilisable.
 *
 * Un compteur ne bouge que si la voiture roule : le dernier relevé connu reste valable tant
 * qu'aucun trajet ne s'est produit entre-temps. Mais si le flux a été coupé une semaine, ce
 * relevé ne dit plus rien de l'état courant — mieux vaut l'avouer que de fabriquer un delta
 * de zéro qui effacerait des trajets réels.
 */
export const AGE_ODO_MAX_JOURS = 7;

/**
 * Écart au-delà duquel un compteur immobile CONTREDIT la géométrie.
 *
 * Si deux relevés de position sont distants d'un kilomètre à vol d'oiseau mais que le
 * compteur n'a pas bougé, ce n'est pas que la voiture est restée garée : c'est que le
 * relevé d'odomètre n'a pas suivi. Faire confiance au compteur effacerait le trajet — et
 * un trajet effacé est exactement le défaut que Marc a signalé.
 *
 * 1 km est très au-dessus du bruit GPS (quelques dizaines de mètres) : la contradiction
 * doit être franche pour qu'on écarte la mesure la plus fiable des deux.
 */
export const SEUIL_INCOHERENCE_KM = 1;

/**
 * Vitesse moyenne au-delà de laquelle un segment n'est PAS une mesure. PURE.
 *
 * ⚠️ Ce garde vient d'un cas RÉEL (Marc, 19/08/2026). L'écran annonçait
 * « compteur : 1751 km · trajets : 91 930 km », soit 90 179 km de trop, avec des trajets
 * « Maison → The Mall, 75 042 km » et « → Boul. Exemple, 10 152 km ». Le point commun :
 * la coordonnée 51.5014, -0.1419 — Londres, la position du véhicule SIMULÉ de Smartcar —
 * et l'odomètre de ce même véhicule de test (une Tesla à 78 432 km, cf. `ingererLivraison`).
 * Quelques livraisons de test avaient été enregistrées avant que la garde `simulee`
 * n'existe.
 *
 * On ne supprime rien : ces lignes restent en base, honnêtes, consultables dans Données.
 * Mais un segment qui exigerait 1 700 km/h ne décrit aucun déplacement réel, et l'inclure
 * dans un total fausse le bail. 200 km/h laisse une marge confortable au-dessus de toute
 * autoroute — c'est un filet anti-absurdité, pas une mesure de vitesse.
 */
export const VITESSE_MAX_KMH = 200;

const MS_PAR_MINUTE = 60_000;

/**
 * Resserre les bornes d'un trajet-FENÊTRE en utilisant les relevés d'odomètre
 * INTERMÉDIAIRES, s'il y en a. PURE, testée.
 *
 * ══ POURQUOI CETTE FONCTION EXISTE (Marc, 13/08 : « les heures sont jamais les bonnes »)
 *
 * Sur un trajet ancré à un stationnement, `debut` est l'heure où la voiture s'est GARÉE la
 * fois D'AVANT — pas l'heure où elle est repartie. Marc partait à 6 h 50 un matin où l'app
 * affichait « 22 h 28 → 08 h 05 » : le compteur n'avait tout simplement aucun relevé entre
 * les deux bornes de position dans cet exemple précis, donc rien à resserrer.
 *
 * Mais quand il EXISTE un relevé d'odomètre entre les deux bornes, il en dit plus que la
 * position : l'odomètre est un ESCALIER — figé tant que la voiture est garée, monte dès
 * qu'elle roule. Le DERNIER relevé qui vaut encore `odoDebut` est donc le dernier instant
 * CONNU où la voiture était encore là ; le PREMIER qui vaut déjà `odoFin` est le premier
 * instant CONNU où elle était déjà arrivée. Le vrai départ (et la vraie arrivée) tombent
 * quelque part entre ces bornes resserrées — toujours un encadrement, jamais une mesure
 * directe, mais un encadrement bien plus étroit que les deux pings de stationnement.
 *
 * Sans relevé intermédiaire, les boucles ne trouvent rien et les bornes ressortent
 * INCHANGÉES : cette fonction ne peut jamais élargir une fenêtre, seulement la resserrer.
 */
export function affinerFenetre(
  historiqueOdometre: PointOdometre[],
  debut: Date,
  fin: Date,
  odoDebut: number | null,
  odoFin: number | null,
): { debut: Date; fin: Date } {
  const b = bornerFenetre(historiqueOdometre, debut, fin, odoDebut, odoFin);
  return { debut: b.departAuPlusTot, fin: b.arriveeAuPlusTard };
}

/**
 * Les QUATRE bornes d'un trajet-fenêtre. PURE, testée.
 *
 * ══ POURQUOI `affinerFenetre` NE SUFFISAIT PAS (Marc, 13/08 : « les heures sont toujours
 *    pas bonnes », après un premier correctif) ══════════════════════════════════════════
 *
 * Le premier correctif n'utilisait qu'UNE borne : le dernier relevé où le compteur n'avait
 * pas encore bougé. Sur une nuit ordinaire, la voiture ne publie RIEN entre le
 * stationnement du soir et celui du lendemain matin — elle dort. Il n'existe donc aucun
 * relevé intermédiaire, la boucle ne trouve rien, et le départ reste collé au ping de la
 * veille : « 22 h 28 → 08 h 05 » pour un départ réel à 6 h 50. Le correctif ne mordait que
 * les nuits de RECHARGE, c'est-à-dire précisément celles où il servait le moins.
 *
 * L'information qui manquait est la borne HAUTE : le PREMIER relevé où le compteur a déjà
 * bougé prouve que le départ a eu lieu AVANT lui. Avec les deux, on obtient un encadrement
 * honnête — « parti entre 22 h 28 et 07 h 00 » — au lieu d'une heure fausse qui a l'air
 * mesurée.
 *
 * ⚠️ LA LIMITE EST STRUCTURELLE, ET IL FAUT LA DIRE PLUTÔT QUE LA MASQUER. La bZ ne publie
 * sa position qu'à l'arrêt et ne se réveille pas pour un poll : quand rien n'est publié de
 * la nuit, l'heure de départ n'existe NULLE PART — ni en base, ni chez Smartcar. Aucun
 * calcul ne peut la retrouver. Ce qu'on peut faire, et qu'on fait ici, c'est donner le plus
 * petit intervalle que les données SUPPORTENT, et laisser l'écran le présenter comme un
 * intervalle. Inventer une heure plausible à partir de la distance et d'une vitesse moyenne
 * serait exactement la fausse donnée qu'on s'interdit.
 *
 * L'ARRIVÉE, elle, est presque toujours connue : un relevé `LAST_PARKED` est horodaté au
 * moment où la voiture s'est garée. C'est pour ça que l'écran met l'arrivée en avant.
 */
export interface BornesTrajet {
  /** Dernier instant CONNU où la voiture était encore au point de départ. */
  departAuPlusTot: Date;
  /** Premier instant CONNU où elle avait déjà bougé. Le départ est avant. */
  departAuPlusTard: Date;
  /** Dernier instant connu où elle n'était pas encore arrivée. */
  arriveeAuPlusTot: Date;
  /** Premier instant connu où elle était déjà arrivée. */
  arriveeAuPlusTard: Date;
}

export function bornerFenetre(
  historiqueOdometre: PointOdometre[],
  debut: Date,
  fin: Date,
  odoDebut: number | null,
  odoFin: number | null,
): BornesTrajet {
  const parDefaut: BornesTrajet = {
    departAuPlusTot: debut,
    departAuPlusTard: fin,
    arriveeAuPlusTot: debut,
    arriveeAuPlusTard: fin,
  };
  if (odoDebut === null || odoFin === null) return parDefaut;

  const dans = historiqueOdometre
    .filter((p) => p.mesureLe.getTime() > debut.getTime() && p.mesureLe.getTime() < fin.getTime())
    .sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime());

  const bornes = { ...parDefaut };

  // DÉPART — le dernier relevé encore à `odoDebut`, puis le premier qui l'a dépassé.
  for (const p of dans) {
    if (p.km > odoDebut) {
      bornes.departAuPlusTard = p.mesureLe;
      break;
    }
    bornes.departAuPlusTot = p.mesureLe;
  }

  // ARRIVÉE — le premier relevé déjà à `odoFin`, et le dernier qui ne l'était pas encore.
  for (let i = dans.length - 1; i >= 0; i -= 1) {
    const p = dans[i]!;
    if (p.km < odoFin) {
      bornes.arriveeAuPlusTot = p.mesureLe;
      break;
    }
    bornes.arriveeAuPlusTard = p.mesureLe;
  }

  // Un encadrement ne peut pas s'inverser : si les relevés sont incohérents (compteur qui
  // recule, horodatages désordonnés), on préfère la borne large à une borne absurde.
  if (bornes.departAuPlusTard.getTime() < bornes.departAuPlusTot.getTime()) {
    bornes.departAuPlusTard = fin;
  }
  if (bornes.arriveeAuPlusTot.getTime() > bornes.arriveeAuPlusTard.getTime()) {
    bornes.arriveeAuPlusTot = debut;
  }
  return bornes;
}

/**
 * L'incertitude d'un départ, en minutes. PURE.
 *
 * Sert à l'écran pour choisir entre « 06 h 50 » et « entre 06 h 30 et 07 h 00 » : une borne
 * serrée se dit comme une heure, une borne large doit se dire comme une plage.
 */
export function incertitudeMinutes(debut: Date, fin: Date): number {
  return Math.max(0, (fin.getTime() - debut.getTime()) / MS_PAR_MINUTE);
}

/**
 * Au-delà de cette incertitude, une borne ne se présente PLUS comme une heure.
 *
 * 20 minutes, soit moins que la cadence du poll (30 min) : en dessous, l'imprécision est du
 * même ordre que celle d'une montre qu'on regarde en partant, et écrire « 06 h 50 » ne
 * trompe personne. Au-delà, l'écran affiche l'intervalle — parce que c'est ce qu'on sait.
 */
export const INCERTITUDE_MAX_MINUTES = 20;


/** Distance cumulée le long d'une suite de points. PURE. */
export function longueurDuChemin(points: PointPosition[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distanceKm(points[i - 1]!, points[i]!);
  }
  return total;
}

/** Un relevé pris à l'arrêt (`LAST_PARKED`) : la voiture était garée là. PURE. */
export function estArret(point: PointPosition): boolean {
  return (point.type ?? "").toUpperCase() === "LAST_PARKED";
}

/**
 * Kilométrage au compteur à un instant donné. PURE, testée.
 *
 * ══ POURQUOI UNE FONCTION DE L'INSTANT SEUL ══════════════════════════════════════════
 *
 * C'est la propriété qui fait tenir tout le reste. `odometreALinstant(t)` ne dépend que de
 * `t` : deux segments qui se touchent partagent donc exactement la même valeur à leur
 * frontière, et leurs deltas se télescopent. La somme des segments d'une période vaut la
 * différence de compteur entre ses deux extrémités — ni doublon, ni trou.
 *
 * L'ancien appariement « encadrant » (dernier relevé avant le départ, premier après
 * l'arrivée) n'avait pas cette propriété : les fenêtres de deux trajets voisins se
 * CHEVAUCHAIENT, et les kilomètres de l'intervalle commun étaient comptés deux fois.
 *
 * On retient le relevé le PLUS PROCHE dans la tolérance — position et odomètre viennent du
 * même réveil du véhicule mais pas de la même milliseconde, et l'écart peut tomber des deux
 * côtés. À défaut, le dernier relevé antérieur fait foi : un odomètre est une fonction en
 * escalier CROISSANTE, donc entre deux relevés il vaut au moins le précédent.
 */
export function odometreALinstant(
  historique: PointOdometre[],
  instant: Date,
  options: { toleranceMinutes?: number; ageMaxJours?: number } = {},
): number | null {
  const { toleranceMinutes = TOLERANCE_ODO_MINUTES, ageMaxJours = AGE_ODO_MAX_JOURS } = options;
  const cible = instant.getTime();
  const tolerance = toleranceMinutes * MS_PAR_MINUTE;

  let proche: PointOdometre | null = null;
  let avant: PointOdometre | null = null;
  for (const p of historique) {
    const t = p.mesureLe.getTime();
    if (Math.abs(t - cible) <= tolerance) {
      // Égalité tranchée par le plus ancien : le résultat ne doit pas dépendre de l'ordre
      // dans lequel les lignes sont arrivées.
      if (!proche || Math.abs(t - cible) < Math.abs(proche.mesureLe.getTime() - cible)) proche = p;
    }
    if (t <= cible && (!avant || t > avant.mesureLe.getTime())) avant = p;
  }

  const retenu = proche ?? avant;
  if (!retenu) return null;

  // Relevé trop vieux : le flux a été coupé, on ne sait plus ce que vaut le compteur.
  // Se taire fait retomber la distance sur la géométrie, marquée comme estimée — c'est
  // moins précis, mais c'est vrai.
  const age = instant.getTime() - retenu.mesureLe.getTime();
  if (age > ageMaxJours * 24 * 60 * MS_PAR_MINUTE) return null;

  return retenu.km;
}

export interface SegmentTrajet {
  depart: PointPosition;
  arrivee: PointPosition;
  odoDepart: number | null;
  odoArrivee: number | null;
  /** Km au compteur sur le segment. `null` si l'odomètre manque à l'une des bornes. */
  deltaOdo: number | null;
  /** Ligne droite entre les deux relevés — borne INFÉRIEURE de la distance réelle. */
  distanceGps: number;
  dureeMinutes: number;
  /**
   * `false` quand le segment est physiquement IMPOSSIBLE (voir `VITESSE_MAX_KMH`) :
   * données de test ou relevé corrompu. Il ne compte dans aucun total.
   */
  plausible: boolean;
  /** La voiture a-t-elle roulé ? Tranché par le COMPTEUR dès qu'il est connu. */
  bouge: boolean;
  /** Le chemin entre les deux relevés est-il enregistré, ou seulement deviné ? */
  cheminConnu: boolean;
}

/**
 * Découpe la suite de positions en segments élémentaires. PURE, testée.
 *
 * Un segment relie deux relevés CONSÉCUTIFS. C'est la brique sur laquelle tout repose :
 * les segments couvrent toute la période sans se chevaucher, donc leurs kilomètres
 * s'additionnent sans se compter deux fois.
 */
export function decouperSegments(
  positions: PointPosition[],
  options: {
    historiqueOdometre?: PointOdometre[];
    distanceMinKm?: number;
    pauseMinutes?: number;
  } = {},
): SegmentTrajet[] {
  const {
    historiqueOdometre = [],
    distanceMinKm = DISTANCE_MIN_KM,
    pauseMinutes = PAUSE_MINUTES,
  } = options;

  const ordonnees = [...positions].sort((a, b) => a.t.getTime() - b.t.getTime());
  const segments: SegmentTrajet[] = [];

  for (let i = 1; i < ordonnees.length; i += 1) {
    const depart = ordonnees[i - 1]!;
    const arrivee = ordonnees[i]!;

    const odoDepart = odometreALinstant(historiqueOdometre, depart.t);
    const odoArrivee = odometreALinstant(historiqueOdometre, arrivee.t);
    // Un compteur ne recule pas : un delta négatif signale une donnée douteuse, pas un
    // trajet à reculons. On préfère ne rien affirmer et retomber sur la géométrie.
    const brut =
      odoDepart !== null && odoArrivee !== null && odoArrivee >= odoDepart
        ? odoArrivee - odoDepart
        : null;

    const distanceGps = distanceKm(depart, arrivee);
    const dureeMinutes = (arrivee.t.getTime() - depart.t.getTime()) / MS_PAR_MINUTE;

    // Compteur immobile alors que la voiture a franchement changé de place : c'est le
    // relevé d'odomètre qui manque, pas le trajet. On l'écarte plutôt que de l'imposer.
    const deltaOdo =
      brut !== null && brut < distanceMinKm && distanceGps >= SEUIL_INCOHERENCE_KM ? null : brut;

    // Un segment physiquement impossible n'est pas un trajet — voir `VITESSE_MAX_KMH`.
    // On regarde les DEUX distances : la pollution de test a touché la géométrie (Londres)
    // ET le compteur (l'odomètre du véhicule simulé).
    // ⚠️ Ne juge QUE ce qui a une durée. Deux relevés au MÊME instant sont un cas
    // distinct, déjà traité ailleurs : le trajet existe, mais aucune vitesse n'est
    // affirmée (`vitesseMoyenne` reste null, verrouillé par tests/trajets.test.ts). Y
    // étendre ce garde ferait disparaître ces trajets — une régression, pas un correctif.
    const trop = (km: number | null): boolean => {
      if (km === null || dureeMinutes <= 0) return false;
      return (km / dureeMinutes) * 60 > VITESSE_MAX_KMH;
    };
    const plausible = !trop(distanceGps) && !trop(deltaOdo);

    segments.push({
      depart,
      arrivee,
      odoDepart,
      odoArrivee,
      deltaOdo,
      distanceGps,
      dureeMinutes,
      plausible,
      // Le compteur fait foi quand il est là. C'est lui qui voit l'aller-retour qui revient
      // au même endroit — la géométrie, elle, y verrait une immobilité.
      bouge: deltaOdo !== null ? deltaOdo >= distanceMinKm : distanceGps >= distanceMinKm,
      // Le chemin n'est connu que si les deux relevés se suivent de près ET que le premier
      // n'est pas un stationnement : un relevé « garé » date de l'ARRIVÉE au point, pas du
      // départ, donc tout ce qui s'est passé ensuite est hors champ.
      cheminConnu: dureeMinutes <= pauseMinutes && !estArret(depart),
    });
  }

  return segments;
}

/**
 * Découpe une suite de positions en trajets. PURE, testée.
 *
 * Un trajet est une suite maximale de segments où la voiture a roulé sans étape connue.
 * On coupe à un relevé de STATIONNEMENT (la voiture s'est garée là, c'est une destination)
 * et à tout segment plus long que `pauseMinutes` (à la cadence du poll, un tel écart ne
 * peut pas décrire de la conduite continue).
 *
 * `historiqueOdometre` est optionnel : sans lui, les distances viennent des points et sont
 * signalées comme estimées. Avec lui, elles viennent du compteur et sont exactes.
 */
export function decouperTrajets(
  positions: PointPosition[],
  options: {
    historiqueOdometre?: PointOdometre[];
    pauseMinutes?: number;
    distanceMinKm?: number;
  } = {},
): Trajet[] {
  const { pauseMinutes = PAUSE_MINUTES, historiqueOdometre = [] } = options;
  const segments = decouperSegments(positions, options);

  const trajets: Trajet[] = [];
  let courant: SegmentTrajet[] = [];

  const cloturer = () => {
    if (courant.length === 0) return;
    trajets.push(assembler(courant, historiqueOdometre));
    courant = [];
  };

  for (const segment of segments) {
    // Un saut impossible n'est ni un trajet ni une continuité : il ferme ce qui précède
    // et n'est jamais assemblé. Sans ça, 90 179 km de données de test entraient dans les
    // totaux et dans la projection du bail (vécu le 19/08, cf. `VITESSE_MAX_KMH`).
    if (!segment.plausible) {
      cloturer();
      continue;
    }
    if (!segment.bouge) {
      cloturer();
      continue;
    }
    courant.push(segment);
    // La voiture s'est garée à l'arrivée, ou l'écart est trop grand pour que la suite
    // décrive le même trajet : on ferme ici.
    if (estArret(segment.arrivee) || segment.dureeMinutes > pauseMinutes) cloturer();
  }
  cloturer();

  return trajets;
}

function assembler(segments: SegmentTrajet[], historiqueOdometre: PointOdometre[]): Trajet {
  const premier = segments[0]!;
  const dernier = segments[segments.length - 1]!;
  const points = [premier.depart, ...segments.map((s) => s.arrivee)];

  // Distance EXACTE seulement si le compteur couvre TOUT le trajet. Mélanger des segments
  // au compteur et des segments à vol d'oiseau produirait un total dont personne ne saurait
  // dire ce qu'il vaut.
  const toutAuCompteur = segments.every((s) => s.deltaOdo !== null);
  const distanceKmTotal = toutAuCompteur
    ? segments.reduce((somme, s) => somme + (s.deltaOdo ?? 0), 0)
    : segments.reduce((somme, s) => somme + s.distanceGps, 0);

  const dureeEstFenetre = estArret(premier.depart);
  // Les QUATRE bornes (voir `bornerFenetre`) : sans relevé intermédiaire elles retombent sur
  // les deux pings de stationnement, avec relevés elles resserrent des DEUX côtés. C'est
  // `departIncertitudeMinutes` qui permet ensuite à l'écran de choisir entre une heure et
  // un intervalle, au lieu d'afficher une heure fausse qui a l'air mesurée.
  const bornes = bornerFenetre(
    historiqueOdometre,
    premier.depart.t,
    dernier.arrivee.t,
    premier.odoDepart,
    dernier.odoArrivee,
  );
  const debut = bornes.departAuPlusTot;
  const fin = bornes.arriveeAuPlusTard;
  const dureeMinutes = (fin.getTime() - debut.getTime()) / MS_PAR_MINUTE;

  return {
    debut,
    fin,
    departAuPlusTard: bornes.departAuPlusTard,
    departIncertitudeMinutes: dureeEstFenetre
      ? incertitudeMinutes(bornes.departAuPlusTot, bornes.departAuPlusTard)
      : 0,
    arriveeAuPlusTot: bornes.arriveeAuPlusTot,
    arriveeIncertitudeMinutes: dureeEstFenetre
      ? incertitudeMinutes(bornes.arriveeAuPlusTot, bornes.arriveeAuPlusTard)
      : 0,
    depart: { lat: premier.depart.lat, lng: premier.depart.lng },
    arrivee: { lat: dernier.arrivee.lat, lng: dernier.arrivee.lng },
    points,
    dureeMinutes,
    dureeEstFenetre,
    distanceKm: distanceKmTotal,
    distanceEstimee: !toutAuCompteur,
    cheminInconnu: segments.some((s) => !s.cheminConnu),
    odoDebut: premier.odoDepart,
    odoFin: dernier.odoArrivee,
    // Une « vitesse moyenne » calculée sur une fenêtre qui contient du stationnement est un
    // chiffre faux, et il a l'air d'une mesure. Mieux vaut ne rien dire — même resserrée,
    // la fenêtre reste un encadrement, pas un temps de conduite mesuré.
    vitesseMoyenne:
      dureeMinutes > 0 && !dureeEstFenetre ? distanceKmTotal / (dureeMinutes / 60) : null,
  };
}

export interface Reconciliation {
  /** Km parcourus d'après le COMPTEUR sur la fenêtre. `null` si moins de deux relevés. */
  kmCompteur: number | null;
  /** Somme des trajets reconstitués. */
  kmTrajets: number;
  /**
   * Km du compteur qu'aucun trajet n'explique. Positif = des kilomètres roulés sans qu'une
   * position les accompagne ; négatif = on a reconstitué plus que le compteur (anomalie).
   */
  ecartKm: number | null;
  odoDebut: number | null;
  odoFin: number | null;
  nbRelevesOdometre: number;
}

/**
 * Confronte le total des trajets au compteur de la voiture. PURE, testée.
 *
 * ══ POURQUOI CETTE FONCTION EXISTE ═══════════════════════════════════════════════════
 *
 * « Ça devrait concorder avec le nombre de km effectués » (Marc, 12/08/2026). Un total de
 * trajets est une RECONSTITUTION ; le compteur est une MESURE. Les afficher côte à côte
 * transforme un doute (« est-ce que ce chiffre est bon ? ») en fait vérifiable, et rend
 * visible le seul cas qui reste possible : des kilomètres roulés pendant que la voiture ne
 * publiait aucune position.
 *
 * Le compteur est lu sur les relevés BRUTS de la fenêtre, indépendamment des positions —
 * sinon la vérification partagerait les biais de ce qu'elle vérifie.
 */
export function reconcilier(
  trajets: Trajet[],
  historiqueOdometre: PointOdometre[],
  depuis?: Date | null,
): Reconciliation {
  const dansLaFenetre = historiqueOdometre
    .filter((p) => !depuis || p.mesureLe.getTime() >= depuis.getTime())
    .sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime());

  const kmTrajets = trajets.reduce((somme, t) => somme + t.distanceKm, 0);

  if (dansLaFenetre.length < 2) {
    return {
      kmCompteur: null,
      kmTrajets,
      ecartKm: null,
      odoDebut: dansLaFenetre[0]?.km ?? null,
      odoFin: dansLaFenetre[0]?.km ?? null,
      nbRelevesOdometre: dansLaFenetre.length,
    };
  }

  const odoDebut = dansLaFenetre[0]!.km;
  const odoFin = dansLaFenetre[dansLaFenetre.length - 1]!.km;
  const kmCompteur = Math.max(0, odoFin - odoDebut);

  return {
    kmCompteur,
    kmTrajets,
    ecartKm: kmCompteur - kmTrajets,
    odoDebut,
    odoFin,
    nbRelevesOdometre: dansLaFenetre.length,
  };
}

export interface ProfilReleves {
  total: number;
  /** Relevés pris à l'arrêt (`LAST_PARKED`). */
  stationnement: number;
  /** Relevés pris en roulant — ceux qui décrivent réellement une route. */
  enRoute: number;
  /** Relevés dont la source n'a pas précisé le type. */
  sansType: number;
}

/**
 * Ce que valent les relevés dont on dispose. PURE, testée.
 *
 * ⚠️ C'est un outil de DIAGNOSTIC, et un outil de diagnostic qui se tait ne diagnostique
 * rien (leçon JobAI). Il doit répondre même — surtout — quand tout est au stationnement :
 * c'est précisément ce cas qui explique qu'aucune carte ne puisse montrer la rue suivie, et
 * sans ce compte on ne saurait pas distinguer « la voiture ne publie que des arrêts » de
 * « le tracé est cassé ».
 */
export function profilerReleves(points: PointPosition[]): ProfilReleves {
  let stationnement = 0;
  let enRoute = 0;
  let sansType = 0;
  for (const p of points) {
    if (p.type === null || p.type === "") sansType += 1;
    else if (estArret(p)) stationnement += 1;
    else enRoute += 1;
  }
  return { total: points.length, stationnement, enRoute, sansType };
}

/**
 * Nombre maximal d'étapes intermédiaires dans une URL d'itinéraire Google Maps.
 *
 * L'API d'URL en accepte 9 au plus. Au-delà, Maps ignore la requête entière — donc un
 * trajet riche en relevés produirait un lien MORT, ce qui est pire qu'un lien approximatif.
 */
export const MAX_ETAPES = 9;

/**
 * Échantillonne les étapes intermédiaires en respectant le plafond de Maps. PURE.
 *
 * On prend des points RÉGULIÈREMENT espacés dans la suite plutôt que les premiers : garder
 * les 9 premiers relevés d'un trajet d'une heure décrirait ses cinq premières minutes et
 * laisserait Maps deviner le reste.
 */
export function etapesIntermediaires(
  points: PointPosition[],
  maximum = MAX_ETAPES,
): PointPosition[] {
  const milieu = points.slice(1, -1);
  if (milieu.length <= maximum) return milieu;

  const pas = milieu.length / maximum;
  const choisis: PointPosition[] = [];
  for (let i = 0; i < maximum; i += 1) {
    choisis.push(milieu[Math.min(milieu.length - 1, Math.floor(i * pas))]!);
  }
  return choisis;
}

/**
 * URL Google Maps de l'ITINÉRAIRE du trajet — départ, étapes, arrivée.
 *
 * Quand le chemin n'est pas enregistré (le cas courant : deux relevés de stationnement),
 * Maps propose SON itinéraire entre les deux bouts. C'est une supposition — mais elle est
 * faite chez Maps, sur demande explicite de Marc, et pas présentée par CarAI comme la route
 * qu'il a suivie.
 *
 * ⚠️ C'est un `href`, donc un CLIC. Rien n'est envoyé à Google tant que Marc ne l'a pas
 * décidé.
 */
export function lienItineraire(trajet: Trajet): string {
  const coord = (p: { lat: number; lng: number }) => `${p.lat},${p.lng}`;
  const etapes = etapesIntermediaires(trajet.points);

  const params = new URLSearchParams({
    api: "1",
    origin: coord(trajet.depart),
    destination: coord(trajet.arrivee),
    travelmode: "driving",
  });
  if (etapes.length > 0) {
    params.set("waypoints", etapes.map(coord).join("|"));
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Lien vers le point d'arrivée seul — utile quand on cherche « où est la voiture ». */
export function lienArrivee(trajet: Trajet): string {
  return lienCarte(trajet.arrivee);
}

export interface JourneeTrajets {
  /** `AAAA-MM-JJ` dans le fuseau de Marc. */
  jour: string;
  trajets: Trajet[];
  totalKm: number;
  totalMinutes: number;
}

/**
 * Marge de LECTURE à ajouter avant une fenêtre pour reconstituer ses trajets. PURE.
 *
 * ⚠️ Un trajet a besoin de son point de DÉPART, et ce point est le stationnement PRÉCÉDENT
 * — qui peut dater de la veille, ou d'avant-hier si la voiture n'a pas roulé. Filtrer les
 * positions à « depuis » supprimerait cette ancre, et le trajet du jour disparaîtrait :
 * il ne resterait qu'un relevé isolé, qui ne fait pas un segment.
 *
 * On lit donc plus large et on filtre les TRAJETS ensuite, sur leur date à eux. Même valeur
 * que l'âge maximal d'un relevé d'odomètre, et pour la même raison : au-delà, l'ancre ne
 * dit plus rien d'utile.
 */
export const MARGE_ANCRAGE_JOURS = AGE_ODO_MAX_JOURS;

/**
 * Instant qui DATE le trajet. PURE, testée.
 *
 * ⚠️ Ce n'est pas toujours `debut`, et c'est un piège qui a coûté un retour de Marc
 * (« ça ne met pas mon trajet d'aujourd'hui », 12/08). Quand le relevé de départ est un
 * STATIONNEMENT, son horodatage est celui de l'ARRIVÉE à ce point-là — donc l'heure à
 * laquelle la voiture s'est garée la fois d'avant, souvent la veille au soir. Dater le
 * trajet avec ça le classe au mauvais jour : on a roulé aujourd'hui, l'app l'affiche hier.
 *
 * L'ARRIVÉE, elle, est toujours un instant réellement observé et postérieur à la conduite.
 * C'est donc elle qui date le trajet dès que le départ n'est pas un vrai départ.
 */
export function instantDuTrajet(trajet: Trajet): Date {
  return trajet.dureeEstFenetre ? trajet.fin : trajet.debut;
}

/**
 * Ne garde que les trajets qui appartiennent à la fenêtre demandée. PURE, testée.
 *
 * Complément obligatoire de `MARGE_ANCRAGE_JOURS` : on a lu plus large pour trouver les
 * ancres, il faut refermer la fenêtre sur la DATE DU TRAJET, sinon le sélecteur « 24 h »
 * afficherait une semaine.
 */
export function trajetsDansLaFenetre(trajets: Trajet[], depuis?: Date | null): Trajet[] {
  if (!depuis) return trajets;
  return trajets.filter((t) => instantDuTrajet(t).getTime() >= depuis.getTime());
}

/**
 * Regroupe les trajets par JOUR, du plus récent au plus ancien.
 *
 * ⚠️ Le jour se calcule dans le fuseau de Marc, jamais en UTC : Vercel tourne en UTC et
 * un trajet de 20 h 30 un mardi serait classé au mercredi (leçon JobAI sur les dates
 * écrites par l'app).
 */
export function grouperParJour(trajets: Trajet[], fuseau = "America/Toronto"): JourneeTrajets[] {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parJour = new Map<string, Trajet[]>();
  for (const trajet of trajets) {
    const jour = format.format(instantDuTrajet(trajet));
    const liste = parJour.get(jour) ?? [];
    liste.push(trajet);
    parJour.set(jour, liste);
  }

  return [...parJour.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([jour, liste]) => ({
      jour,
      trajets: liste.sort(
        (a, b) => instantDuTrajet(b).getTime() - instantDuTrajet(a).getTime(),
      ),
      totalKm: liste.reduce((s, t) => s + t.distanceKm, 0),
      totalMinutes: liste.reduce((s, t) => s + t.dureeMinutes, 0),
    }));
}

/**
 * Ce que la réconciliation VEUT DIRE, en un verdict — sans une seule chaîne de texte.
 *
 * ══ POURQUOI UNE FONCTION PLUTÔT QU'UN TERNAIRE DANS LE JSX ═══════════════════════════
 *
 * Depuis le 14/09, la concordance s'affiche REPLIÉE sur l'écran Activité : son verdict
 * tient dans le résumé, l'explication dans le repli. Deux rendus du même fait — et deux
 * ternaires écrits côte à côte finissent TOUJOURS par diverger, c'est le défaut que ce
 * dépôt a déjà payé (deux implémentations d'une règle, c'est une règle et demie).
 *
 * Elle rend donc les FAITS, jamais le texte : le formatage des kilomètres appartient à
 * l'écran, le jugement appartient ici. Les deux rendus dérivent du MÊME `genre`, donc un
 * résumé ne peut plus annoncer « concorde » au-dessus d'une explication qui dit l'inverse.
 *
 * ⚠️ Le seuil de concordance reste 1 km : en dessous, c'est l'arrondi des distances GPS,
 * pas un kilomètre manquant.
 */
export type VerdictConcordance =
  | { genre: "sans-compteur"; nbReleves: number }
  | { genre: "concorde"; kmCompteur: number; kmTrajets: number }
  /** Le compteur en dit PLUS que les trajets : des km roulés sans position publiée. */
  | { genre: "manque"; kmCompteur: number; kmTrajets: number; ecartKm: number }
  /** Les trajets en disent plus que le compteur : anomalie, souvent des distances « min. ». */
  | { genre: "surplus"; kmCompteur: number; kmTrajets: number; ecartKm: number };

export function jugerConcordance(bilan: Reconciliation): VerdictConcordance {
  if (bilan.kmCompteur === null) {
    return { genre: "sans-compteur", nbReleves: bilan.nbRelevesOdometre };
  }
  const commun = { kmCompteur: bilan.kmCompteur, kmTrajets: bilan.kmTrajets };
  const ecart = bilan.ecartKm;
  // Un `ecartKm` nul avec un compteur connu ne devrait pas arriver, mais l'inventer à
  // zéro serait une affirmation : « concorde » n'ajoute aucun chiffre faux.
  if (ecart === null || Math.abs(ecart) < 1) return { genre: "concorde", ...commun };
  return ecart > 0
    ? { genre: "manque", ...commun, ecartKm: ecart }
    : { genre: "surplus", ...commun, ecartKm: Math.abs(ecart) };
}

/** Durée en clair : « 1 h 12 » plutôt que « 72 minutes ». */
export function formaterDuree(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}
