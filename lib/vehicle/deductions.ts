// lib/vehicle/deductions.ts — ce que les données disent SANS le dire. PURE, testée.
//
// Marc, 13/08 : « je veux extrapoler, avec ces infos je veux déduire d'autres infos, vas
// beaucoup plus loin ».
//
// ══ LA RÈGLE QUI DÉCIDE DE CE QUI ENTRE ICI ═════════════════════════════════════════
//
// Une déduction est légitime quand elle rend LISIBLE une relation déjà contenue dans les
// mesures. Elle ne l'est pas quand elle comble un trou avec une hypothèse. La différence
// n'est pas de degré : dans le premier cas, un chiffre faux vient d'une donnée fausse ;
// dans le second, il vient de nous.
//
// Ce qui est DEDANS :
//   • l'autonomie que la voiture ANNONCE, confrontée à celle que sa consommation MESURÉE
//     implique — deux chiffres réels, et leur écart dit si la voiture est optimiste ;
//   • combien de jours il reste avant de devoir recharger, au rythme observé ;
//   • où partent les kilomètres, par jour de semaine ;
//   • la tendance d'un pneu qui se dégonfle, et quand il atteindra le seuil d'alerte.
//
// Ce qui est DEHORS, et pourquoi :
//   • estimer l'heure de départ d'un trajet depuis la distance et une vitesse plausible —
//     ce serait fabriquer la donnée manquante, pas la déduire ;
//   • un coût au kWh « moyen » quand le tarif n'est pas renseigné ;
//   • la santé de la batterie : la capacité nominale ne bouge pas d'un mois à l'autre, une
//     courbe de dégradation sur trois semaines ne mesurerait que le bruit.
//
// ⚠️ Chaque fonction rend `null` plutôt qu'un chiffre quand la donnée ne porte pas la
// déduction. C'est le point le plus important du fichier : une extrapolation est utile
// TANT QU'ELLE SAIT SE TAIRE.

import { ECART_PNEU_KPA } from "@/lib/vehicle/alertes";
import type { PointOdometre } from "@/lib/vehicle/lease";
import type { PointSerie } from "@/lib/vehicle/analyse";

// ══ RÉGRESSION LINÉAIRE ══════════════════════════════════════════════════════════════

export interface Tendance {
  /** Pente, en unité de la série PAR JOUR. */
  penteParJour: number;
  /** Valeur extrapolée à l'origine du temps de la série. */
  ordonnee: number;
  /**
   * Qualité de l'ajustement, entre 0 et 1.
   *
   * ⚠️ C'est LUI qui autorise à parler d'une tendance. Une droite passe par n'importe quel
   * nuage de points ; sans R², on annoncerait « −3 kPa/semaine » sur des mesures qui
   * montent et descendent au hasard. En dessous de `R2_MIN`, on ne conclut pas.
   */
  r2: number;
  nbPoints: number;
  /** Étendue observée, en jours — une pente mesurée sur deux heures n'extrapole rien. */
  dureeJours: number;
}

/** En dessous, le nuage n'a pas de direction : on refuse de parler de tendance. */
export const R2_MIN = 0.5;

/** Sous cette durée d'observation, une pente est du bruit extrapolé. */
export const DUREE_MIN_JOURS = 1;

/**
 * Droite des moindres carrés sur une série temporelle. PURE, testée.
 *
 * Le temps est ramené en JOURS depuis le premier point : une pente « par milliseconde »
 * serait exacte et illisible, et les erreurs d'unité sont la première cause de chiffres
 * absurdes affichés avec aplomb.
 */
export function regresser(points: PointSerie[]): Tendance | null {
  if (points.length < 3) return null;

  const t0 = points[0]!.t.getTime();
  const xs = points.map((p) => (p.t.getTime() - t0) / 86_400_000);
  const ys = points.map((p) => p.valeur);
  const n = points.length;

  const moyX = xs.reduce((a, b) => a + b, 0) / n;
  const moyY = ys.reduce((a, b) => a + b, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i]! - moyX) * (ys[i]! - moyY);
    sxx += (xs[i]! - moyX) ** 2;
  }
  // Tous les points au même instant : aucune pente n'existe (et la division exploserait).
  if (sxx === 0) return null;

  const pente = sxy / sxx;
  const ordonnee = moyY - pente * moyX;

  let residus = 0;
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    residus += (ys[i]! - (ordonnee + pente * xs[i]!)) ** 2;
    total += (ys[i]! - moyY) ** 2;
  }
  // Série parfaitement plate : la droite est exacte, mais elle n'explique rien non plus.
  const r2 = total === 0 ? 1 : 1 - residus / total;

  return {
    penteParJour: pente,
    ordonnee,
    r2,
    nbPoints: n,
    dureeJours: xs[xs.length - 1]!,
  };
}

/** La tendance est-elle assez nette ET assez longue pour qu'on l'annonce ? PURE. */
export function tendanceFiable(t: Tendance | null): boolean {
  return t !== null && t.r2 >= R2_MIN && t.dureeJours >= DUREE_MIN_JOURS;
}

/**
 * Quand la tendance atteindra-t-elle un seuil ? PURE, testée.
 *
 * `null` si la pente s'en éloigne (ou est nulle) : « jamais » est une réponse, et
 * l'inventer sous forme de date passée serait pire que se taire.
 */
export function projeterSeuil(
  tendance: Tendance,
  valeurActuelle: number,
  seuil: number,
  depuis: Date,
): Date | null {
  const ecart = seuil - valeurActuelle;
  if (ecart === 0) return depuis;
  // La pente doit aller VERS le seuil, sinon il ne sera jamais atteint.
  if (tendance.penteParJour === 0) return null;
  const jours = ecart / tendance.penteParJour;
  if (!Number.isFinite(jours) || jours <= 0) return null;
  return new Date(depuis.getTime() + jours * 86_400_000);
}

// ══ AUTONOMIE : CE QUE LA VOITURE ANNONCE CONTRE CE QU'ELLE CONSOMME ═════════════════

export interface AutonomieComparee {
  /** Ce que la voiture affiche, en km. */
  annonceeKm: number;
  /** Ce que la consommation MESURÉE implique, en km. */
  reelleKm: number;
  /** `reelle − annoncée`. Négatif = la voiture est optimiste. */
  ecartKm: number;
  /** Écart en % de l'annonce — la forme sur laquelle on peut décider. */
  ecartPourcent: number;
}

/**
 * Confronte l'autonomie annoncée à celle que la consommation mesurée implique. PURE, testée.
 *
 * Les deux chiffres sont RÉELS : l'un vient du tableau de bord de la bZ, l'autre de
 * l'odomètre et de l'état de charge. Leur écart est la seule chose ici qui soit déduite —
 * et c'est précisément l'information qu'aucun des deux ne donne seul : « quand la voiture
 * annonce 300 km, combien puis-je vraiment faire ? »
 *
 * `null` dès qu'un ingrédient manque. Une consommation nulle ou négative n'est pas une
 * autonomie infinie, c'est une mesure inexploitable.
 */
export function comparerAutonomie(params: {
  autonomieAnnonceeKm: number | null;
  socPourcent: number | null;
  capaciteKwh: number | null;
  consommationKwhPar100km: number | null;
}): AutonomieComparee | null {
  const { autonomieAnnonceeKm, socPourcent, capaciteKwh, consommationKwhPar100km } = params;
  if (
    autonomieAnnonceeKm === null ||
    socPourcent === null ||
    capaciteKwh === null ||
    consommationKwhPar100km === null ||
    !(consommationKwhPar100km > 0) ||
    !(capaciteKwh > 0) ||
    !(autonomieAnnonceeKm > 0)
  ) {
    return null;
  }

  const kwhDisponibles = (socPourcent / 100) * capaciteKwh;
  const reelleKm = (kwhDisponibles / consommationKwhPar100km) * 100;
  const ecartKm = reelleKm - autonomieAnnonceeKm;

  return {
    annonceeKm: autonomieAnnonceeKm,
    reelleKm,
    ecartKm,
    ecartPourcent: (ecartKm / autonomieAnnonceeKm) * 100,
  };
}

// ══ COMBIEN DE JOURS AVANT DE DEVOIR RECHARGER ══════════════════════════════════════

/**
 * Jours d'autonomie restants au rythme observé. PURE, testée.
 *
 * `null` si le rythme n'est pas mesurable ou nul — « à ce rythme tu ne rechargeras jamais »
 * est vrai et inutile, alors qu'un chiffre le ferait passer pour une prévision.
 */
export function joursAvantRecharge(
  autonomieRestanteKm: number | null,
  kmParJour: number | null,
): number | null {
  if (autonomieRestanteKm === null || kmParJour === null) return null;
  if (!(kmParJour > 0) || !(autonomieRestanteKm >= 0)) return null;
  return autonomieRestanteKm / kmParJour;
}

// ══ OÙ PARTENT LES KILOMÈTRES ═══════════════════════════════════════════════════════

export interface JourDeSemaine {
  /** 0 = lundi … 6 = dimanche. */
  index: number;
  libelle: string;
  /** Total parcouru ce jour-là sur toute la période. */
  totalKm: number;
  /** Nombre de journées observées — sans lui, une moyenne serait fausse. */
  nbJours: number;
  moyenneKm: number;
}

const LIBELLES_JOURS = [
  "lundi",
  "mardi",
  "mercredi",
  "jeudi",
  "vendredi",
  "samedi",
  "dimanche",
];

/**
 * Kilomètres par JOUR DE SEMAINE. PURE, testée.
 *
 * Ça répond à une question que ni l'odomètre ni le bail ne posent : le dépassement vient-il
 * des trajets de travail ou des fins de semaine ? La réponse change ce sur quoi on peut
 * agir — on ne renonce pas à aller travailler, on peut renoncer à un aller-retour.
 *
 * ⚠️ Le jour est calculé dans le fuseau de MARC. En UTC, tout ce qu'il roule après 20 h
 * bascule au lendemain — et le vendredi soir deviendrait du samedi.
 *
 * ⚠️ La moyenne se divise par le nombre de journées OBSERVÉES, pas par le nombre de
 * semaines : sur une période de dix jours il y a deux lundis et un seul mercredi, et
 * diviser tout par le même chiffre inventerait un creux le mercredi.
 */
export function kmParJourDeSemaine(
  historique: PointOdometre[],
  fuseau = "America/Toronto",
): JourDeSemaine[] {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Un relevé par JOUR local : le dernier connu, qui porte le compteur de fin de journée.
  const parJour = new Map<string, { min: number; max: number }>();
  for (const p of [...historique].sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime())) {
    const jour = format.format(p.mesureLe);
    const actuel = parJour.get(jour);
    if (!actuel) parJour.set(jour, { min: p.km, max: p.km });
    else {
      actuel.min = Math.min(actuel.min, p.km);
      actuel.max = Math.max(actuel.max, p.km);
    }
  }

  const totaux = new Map<number, { total: number; jours: number }>();
  for (const [jour, bornes] of parJour) {
    // Le jour de la semaine se lit à midi local : à minuit, un arrondi de fuseau peut
    // basculer d'un jour.
    const index = (new Date(`${jour}T12:00:00Z`).getUTCDay() + 6) % 7; // lundi = 0
    const actuel = totaux.get(index) ?? { total: 0, jours: 0 };
    actuel.total += Math.max(0, bornes.max - bornes.min);
    actuel.jours += 1;
    totaux.set(index, actuel);
  }

  return LIBELLES_JOURS.map((libelle, index) => {
    const t = totaux.get(index) ?? { total: 0, jours: 0 };
    return {
      index,
      libelle,
      totalKm: t.total,
      nbJours: t.jours,
      moyenneKm: t.jours > 0 ? t.total / t.jours : 0,
    };
  });
}

// ══ LE PNEU QUI SE DÉGONFLE, ET QUAND IL ATTEINDRA LE SEUIL ═════════════════════════

export interface ProjectionPneu {
  libelle: string;
  /** Perte, en kPa par semaine. Positif = il se dégonfle. */
  perteParSemaineKpa: number;
  r2: number;
  /** Quand l'écart aux autres roues atteindra le seuil d'alerte. `null` si jamais. */
  seuilAtteintLe: Date | null;
}

/**
 * Projette le dégonflage d'un pneu. PURE, testée.
 *
 * Le seuil visé n'est PAS une pression constructeur — on ne l'a pas. C'est le même seuil
 * que celui des alertes (`ECART_PNEU_KPA` sous la médiane des autres roues), ce qui garde
 * la projection cohérente avec ce que l'app signalera vraiment le jour venu.
 *
 * `null` dès que la tendance n'est pas fiable : une droite passe par n'importe quel nuage,
 * et annoncer « à plat le 3 septembre » sur du bruit serait une invention datée.
 */
export function projeterPneu(params: {
  libelle: string;
  serie: PointSerie[];
  pressionActuelleKpa: number;
  medianeAutresKpa: number;
  maintenant: Date;
}): ProjectionPneu | null {
  const { libelle, serie, pressionActuelleKpa, medianeAutresKpa, maintenant } = params;

  const tendance = regresser(serie);
  if (!tendanceFiable(tendance)) return null;
  // Une pression qui MONTE ou stagne n'a pas de date de seuil à annoncer.
  if (tendance!.penteParJour >= 0) return null;

  const seuil = medianeAutresKpa - ECART_PNEU_KPA;
  return {
    libelle,
    perteParSemaineKpa: -tendance!.penteParJour * 7,
    r2: tendance!.r2,
    seuilAtteintLe: projeterSeuil(tendance!, pressionActuelleKpa, seuil, maintenant),
  };
}
