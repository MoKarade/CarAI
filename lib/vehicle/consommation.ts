// lib/vehicle/consommation.ts — la consommation RÉELLE, en kWh/100 km.
//
// ══ POURQUOI C'EST LE CHIFFRE QUI MANQUAIT ═══════════════════════════════════════════
//
// Une électrique se juge sur sa consommation, et le tableau de bord de la bZ n'en donne
// qu'une moyenne remise à zéro on ne sait quand. CarAI a les deux ingrédients — l'odomètre
// et l'état de charge — et la capacité de la batterie. Il peut donc dire ce que la voiture
// consomme VRAIMENT, sur la période qu'on choisit, et le comparer à l'autonomie annoncée.
//
// ══ LA MÉTHODE, ET CE QU'ELLE REFUSE ═════════════════════════════════════════════════
//
// On ne travaille que sur les segments de DÉCHARGE : deux relevés consécutifs où l'état de
// charge BAISSE et où l'odomètre AVANCE. Un segment où la charge remonte est une recharge,
// pas une consommation — l'inclure inverserait le signe et fabriquerait une voiture qui
// produit de l'énergie en roulant.
//
// ⚠️ CE QUE ÇA SURESTIME, ET QUI EST DIT À L'ÉCRAN : la batterie se vide aussi À L'ARRÊT
// (préchauffage, veille des calculateurs, froid). Cette perte est comptée dans la
// consommation puisqu'on ne peut pas la distinguer — la voiture ne publie pas le détail.
// Sur un usage normal c'est quelques pourcents ; après trois jours de stationnement en
// hiver, ça peut être beaucoup. D'où le filtre : un segment dont la durée est longue pour
// la distance parcourue est ÉCARTÉ plutôt que d'empoisonner la moyenne.

import type { PointOdometre } from "@/lib/vehicle/lease";
import type { PointSoc } from "@/lib/vehicle/charges";

export interface SegmentConso {
  debut: Date;
  fin: Date;
  km: number;
  /** Points de pourcentage de batterie consommés. */
  socConsomme: number;
  kwh: number;
  kwhPar100km: number;
}

export interface Consommation {
  /** `null` si aucun segment exploitable — jamais un 0 qui aurait l'air d'une mesure. */
  kwhPar100km: number | null;
  kmTotal: number;
  kwhTotal: number;
  nbSegments: number;
  /** Segments écartés parce que trop longs pour leur distance (voiture à l'arrêt). */
  nbEcartes: number;
  /** Autonomie que cette consommation implique sur une batterie pleine, en km. */
  autonomieTheoriqueKm: number | null;
}

/**
 * Vitesse moyenne minimale pour qu'un segment compte, en km/h.
 *
 * En dessous, la voiture a passé l'essentiel du segment à l'ARRÊT : la baisse de charge
 * y est surtout de la veille, pas de la route, et l'inclure gonflerait la consommation.
 * 5 km/h est très permissif — il ne rejette que les segments manifestement statiques
 * (une heure pour deux kilomètres), pas un embouteillage.
 */
export const VITESSE_MIN_KMH = 5;

/** Distance minimale d'un segment. Sous ce seuil, l'arrondi de l'odomètre domine. */
export const KM_MIN_SEGMENT = 1;

const MS_PAR_HEURE = 3_600_000;

/**
 * Apparie odomètre et état de charge sur les mêmes instants. PURE.
 *
 * Les deux séries arrivent du même poll, donc à des horodatages voisins mais pas toujours
 * identiques. On ne fabrique aucune interpolation : on ne garde que les instants où les
 * DEUX sont connus à moins de `toleranceMinutes` l'un de l'autre. Interpoler donnerait des
 * chiffres plus « complets » et moins vrais.
 */
export function apparier(
  odo: PointOdometre[],
  socs: PointSoc[],
  toleranceMinutes = 10,
): Array<{ t: Date; km: number; soc: number }> {
  const borne = toleranceMinutes * 60_000;
  const socsTries = [...socs].sort((a, b) => a.t.getTime() - b.t.getTime());
  const apparies: Array<{ t: Date; km: number; soc: number }> = [];

  for (const p of [...odo].sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime())) {
    let meilleur: { ecart: number; soc: number } | null = null;
    for (const s of socsTries) {
      const ecart = Math.abs(s.t.getTime() - p.mesureLe.getTime());
      if (ecart > borne) continue;
      if (!meilleur || ecart < meilleur.ecart) meilleur = { ecart, soc: s.pourcent };
    }
    if (meilleur) apparies.push({ t: p.mesureLe, km: p.km, soc: meilleur.soc });
  }
  return apparies;
}

/**
 * Consommation sur une période. PURE, testée.
 *
 * `capaciteKwh` est requise : sans elle, aucun kWh n'existe. Elle vient de
 * `tractionbattery-nominalcapacity`, l'un des signaux que la bZ fournit vraiment.
 */
export function calculerConsommation(params: {
  odometre: PointOdometre[];
  socs: PointSoc[];
  capaciteKwh: number | null;
  vitesseMinKmh?: number;
  kmMinSegment?: number;
}): Consommation {
  const {
    odometre,
    socs,
    capaciteKwh,
    vitesseMinKmh = VITESSE_MIN_KMH,
    kmMinSegment = KM_MIN_SEGMENT,
  } = params;

  const vide: Consommation = {
    kwhPar100km: null,
    kmTotal: 0,
    kwhTotal: 0,
    nbSegments: 0,
    nbEcartes: 0,
    autonomieTheoriqueKm: null,
  };

  if (!capaciteKwh || capaciteKwh <= 0) return vide;

  const points = apparier(odometre, socs);
  if (points.length < 2) return vide;

  let kmTotal = 0;
  let kwhTotal = 0;
  let nbSegments = 0;
  let nbEcartes = 0;

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;

    const km = b.km - a.km;
    const socConsomme = a.soc - b.soc;

    // Recharge (la charge remonte) ou compteur immobile : ce n'est pas de la consommation.
    // Inclure une recharge inverserait le signe et fabriquerait une voiture qui produit de
    // l'énergie en roulant.
    if (km < kmMinSegment || socConsomme <= 0) continue;

    const heures = (b.t.getTime() - a.t.getTime()) / MS_PAR_HEURE;
    // Segment surtout PASSÉ À L'ARRÊT : la baisse de charge y est de la veille, pas de la
    // route. On l'écarte et on le COMPTE — un rejet silencieux ferait douter du total.
    if (heures > 0 && km / heures < vitesseMinKmh) {
      nbEcartes += 1;
      continue;
    }

    kmTotal += km;
    kwhTotal += (socConsomme / 100) * capaciteKwh;
    nbSegments += 1;
  }

  if (kmTotal <= 0 || kwhTotal <= 0) return { ...vide, nbEcartes };

  const kwhPar100km = (kwhTotal / kmTotal) * 100;

  return {
    kwhPar100km,
    kmTotal,
    kwhTotal,
    nbSegments,
    nbEcartes,
    // Ce que cette consommation donne sur une batterie pleine — le chiffre à comparer à
    // l'autonomie que la voiture affiche.
    autonomieTheoriqueKm: (capaciteKwh / kwhPar100km) * 100,
  };
}
