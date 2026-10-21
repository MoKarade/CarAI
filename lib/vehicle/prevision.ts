// lib/vehicle/prevision.ts — la PRÉVISION DE FIN DE MOIS (CarAI#31) : combien de kilomètres et de
// kWh d'ici la fin du mois, si le rythme des 30 derniers jours se poursuit.
//
// ══ CE QUE C'EST, ET CE QUE ÇA REFUSE D'ÊTRE ═════════════════════════════════════════
//
// Une ESTIMATION, dite comme telle à l'écran : on prolonge un rythme observé, on ne sait rien du
// mois qui vient (un voyage, une semaine de vacances). D'où une FOURCHETTE et pas un chiffre
// unique : le bas est la semaine la plus calme de la fenêtre, le haut la plus chargée. Un chiffre
// seul aurait l'air plus sûr qu'il n'est.
//
// Pas de coût en dollars : aucun prix du kWh n'est mesuré (voir `lib/vehicle/charges.ts`), en
// écrire un produirait un montant faux qui a l'air juste.
//
// ══ QUAND ELLE SE TAIT ═══════════════════════════════════════════════════════════════
//
// `disponible: false` AVEC la raison, jamais une ligne vide ni un 0 : moins de 14 jours de
// relevés (une semaine ne dit rien du rythme), dernier relevé trop ancien (la collecte s'est
// arrêtée, le « rythme actuel » n'existe plus), aucun kilomètre parcouru, ou aucune consommation
// mesurée (sans elle, aucun kWh n'existe). Les relevés incohérents (odomètre qui recule, vitesse
// impossible entre deux relevés) sont ÉCARTÉS et comptés, pas moyennés.
//
// ⚠️ L'énergie vient de la consommation MESURÉE (kWh/100 km, `calculerConsommation`), pas des
// recharges : la bZ ne publie aucune énergie ajoutée, et une recharge n'est jamais comptée
// comme une consommation.

import { jourLocalIso, minuitLocal, FUSEAU_MARC } from "@/lib/vehicle/fenetre";
import type { PointOdometre } from "@/lib/vehicle/lease";

/** Fenêtre d'observation du rythme, en jours. */
export const FENETRE_PREVISION_JOURS = 30;

/** Sous ce nombre de jours de relevés, aucune prévision : une semaine ne fait pas un rythme. */
export const JOURS_MIN_PREVISION = 14;

/** Au-delà, le dernier relevé est trop vieux pour parler du rythme « actuel ». */
export const AGE_MAX_DERNIER_RELEVE_JOURS = 3;

/** Vitesse moyenne impossible entre deux relevés : c'est un saut d'odomètre, pas du roulage. */
export const VITESSE_MAX_PLAUSIBLE_KMH = 250;

const MS_PAR_JOUR = 86_400_000;
const MS_PAR_HEURE = 3_600_000;
const JOURS_PAR_BLOC = 7;

export interface PrevisionDisponible {
  disponible: true;
  /** Jours entre `maintenant` et minuit (heure du Québec) du 1er du mois suivant. */
  joursRestants: number;
  /** Kilomètres d'ici la fin du mois : semaine la plus calme, rythme moyen, semaine la plus chargée. */
  kmMin: number;
  kmCentral: number;
  kmMax: number;
  kwhMin: number;
  kwhCentral: number;
  kwhMax: number;
  /** La consommation (kWh/100 km) qui a converti les kilomètres en énergie. */
  kwhPar100km: number;
  /** Durée réellement couverte par les relevés retenus, en jours. */
  joursMesures: number;
  /** Nombre de blocs de 7 jours qui ont servi à la fourchette. */
  nbBlocs: number;
  /** Segments d'odomètre incohérents, écartés. */
  nbRejetes: number;
}

export interface PrevisionAbsente {
  disponible: false;
  /** Pourquoi, en français, prêt à afficher. */
  raison: string;
}

export type PrevisionFinDeMois = PrevisionDisponible | PrevisionAbsente;

const absente = (raison: string): PrevisionAbsente => ({ disponible: false, raison });

/** Le 1er du mois suivant, à minuit heure du Québec. `null` si le calcul de date échoue. */
function debutDuMoisSuivant(maintenant: Date, fuseau: string): Date | null {
  const [annee, mois] = jourLocalIso(maintenant, fuseau).split("-").map(Number);
  if (!annee || !mois) return null;
  const suivant = mois === 12 ? { a: annee + 1, m: 1 } : { a: annee, m: mois + 1 };
  return minuitLocal(`${suivant.a}-${String(suivant.m).padStart(2, "0")}-01`, fuseau);
}

/**
 * Prévision de fin de mois. PURE, testée.
 *
 * `odometre` : les relevés des 30 derniers jours (le filtre de l'écran n'y est pour rien : la
 * fenêtre est fixe). `kwhParCentKm` : la consommation mesurée sur ces mêmes 30 jours, ou `null`.
 */
export function previsionFinDeMois(params: {
  odometre: PointOdometre[];
  kwhParCentKm: number | null;
  maintenant: Date;
  fuseau?: string;
}): PrevisionFinDeMois {
  const { odometre, kwhParCentKm, maintenant, fuseau = FUSEAU_MARC } = params;

  const debutFenetre = maintenant.getTime() - FENETRE_PREVISION_JOURS * MS_PAR_JOUR;
  const points = odometre
    .filter(
      (p) =>
        Number.isFinite(p.km) &&
        !Number.isNaN(p.mesureLe.getTime()) &&
        p.mesureLe.getTime() >= debutFenetre &&
        p.mesureLe.getTime() <= maintenant.getTime(),
    )
    .sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime());

  if (points.length < 2) {
    return absente("Pas de prévision de fin de mois : moins de 14 jours de relevés d’odomètre.");
  }

  const premier = points[0]!.mesureLe.getTime();
  const dernier = points[points.length - 1]!.mesureLe.getTime();
  const joursMesures = (dernier - premier) / MS_PAR_JOUR;

  if (joursMesures < JOURS_MIN_PREVISION) {
    return absente(
      `Pas de prévision de fin de mois : ${Math.floor(joursMesures)} jour(s) de relevés, il en faut au moins ${JOURS_MIN_PREVISION} pour parler d’un rythme.`,
    );
  }
  if ((maintenant.getTime() - dernier) / MS_PAR_JOUR > AGE_MAX_DERNIER_RELEVE_JOURS) {
    return absente(
      `Pas de prévision de fin de mois : le dernier relevé date de plus de ${AGE_MAX_DERNIER_RELEVE_JOURS} jours, le rythme actuel n’est pas connu.`,
    );
  }
  if (kwhParCentKm === null || !(kwhParCentKm > 0)) {
    return absente(
      "Pas de prévision de fin de mois : aucune consommation mesurée sur 30 jours, donc aucun kWh à projeter.",
    );
  }

  // Blocs de 7 jours comptés depuis le dernier relevé : le plus récent colle au présent, le
  // reste de début de fenêtre (moins de 7 jours) est ignoré plutôt que gonflé.
  const nbBlocs = Math.floor(joursMesures / JOURS_PAR_BLOC);
  const kmParBloc = new Array<number>(nbBlocs).fill(0);
  let nbRejetes = 0;

  // On compare chaque relevé au dernier relevé RETENU, pas à son voisin : un relevé faux (saut ou
  // recul) est écarté seul, et le suivant — bon — se mesure à la dernière valeur saine. Comparé
  // à son voisin, le retour à la normale après un recul passerait pour des kilomètres roulés.
  let reference = points[0]!;
  for (let i = 1; i < points.length; i += 1) {
    const b = points[i]!;
    const km = b.km - reference.km;
    const heures = (b.mesureLe.getTime() - reference.mesureLe.getTime()) / MS_PAR_HEURE;
    // Le même relevé deux fois (même instant, même compteur) : un doublon, pas un doute.
    if (heures === 0 && km === 0) continue;
    // Odomètre qui recule, ou vitesse impossible : ÉCARTÉ et compté, jamais moyenné.
    if (km < 0 || heures <= 0 || km / heures > VITESSE_MAX_PLAUSIBLE_KMH) {
      nbRejetes += 1;
      continue;
    }
    // Un segment appartient au bloc de sa FIN : pas d'étalement, donc pas d'invention.
    const bloc = Math.floor((dernier - b.mesureLe.getTime()) / (JOURS_PAR_BLOC * MS_PAR_JOUR));
    if (bloc < nbBlocs) kmParBloc[bloc]! += km;
    reference = b;
  }

  // Plus d'un relevé sur dix incohérent : l'odomètre n'est pas digne de confiance sur la fenêtre
  // (remplacement, changement d'unité). Se taire vaut mieux que projeter la part qui reste.
  if (nbRejetes * 10 > points.length) {
    return absente(
      `Pas de prévision de fin de mois : ${nbRejetes} relevé(s) d’odomètre incohérent(s) sur ${points.length}, trop pour s’y fier.`,
    );
  }

  const kmTotal = kmParBloc.reduce((n, k) => n + k, 0);
  if (!(kmTotal > 0)) {
    return absente("Pas de prévision de fin de mois : aucun kilomètre parcouru sur la fenêtre.");
  }

  const fin = debutDuMoisSuivant(maintenant, fuseau);
  if (!fin) return absente("Pas de prévision de fin de mois : la fin du mois n’a pas pu être calculée.");
  const joursRestants = (fin.getTime() - maintenant.getTime()) / MS_PAR_JOUR;

  const tauxMoyen = kmTotal / (nbBlocs * JOURS_PAR_BLOC);
  const tauxMin = Math.min(...kmParBloc) / JOURS_PAR_BLOC;
  const tauxMax = Math.max(...kmParBloc) / JOURS_PAR_BLOC;

  const kmMin = tauxMin * joursRestants;
  const kmCentral = tauxMoyen * joursRestants;
  const kmMax = tauxMax * joursRestants;
  const kwh = (km: number) => (km * kwhParCentKm) / 100;

  return {
    disponible: true,
    joursRestants,
    kmMin,
    kmCentral,
    kmMax,
    kwhMin: kwh(kmMin),
    kwhCentral: kwh(kmCentral),
    kwhMax: kwh(kmMax),
    kwhPar100km: kwhParCentKm,
    joursMesures,
    nbBlocs,
    nbRejetes,
  };
}
