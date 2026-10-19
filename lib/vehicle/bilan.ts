// lib/vehicle/bilan.ts — les chiffres des TROIS moments où Marc ouvre l'app.
//
// Il a répondu le 12/08/2026 : le matin avant de partir, le soir pour faire le point, et
// quand il se demande s'il va payer. Trois questions différentes, donc trois blocs — et
// c'est ce module qui calcule ce que chacun a besoin de savoir.
//
// PURE : l'instant et les données sont des paramètres. Un bilan « aujourd'hui » qui lirait
// l'horloge lui-même serait intestable au passage de minuit — précisément le moment où il
// se trompe.

import type { PointOdometre } from "@/lib/vehicle/lease";

/**
 * Début du jour local, en UTC. PURE.
 *
 * ⚠️ Vercel tourne en UTC, Marc vit à UTC−4. « Aujourd'hui » calculé en UTC bascule à
 * 20 h locale : un trajet de 21 h compterait pour demain, et le bilan du soir — celui
 * qu'il regarde justement à cette heure-là — serait toujours faux (leçon JobAI).
 */
export function debutDuJourLocal(maintenant: Date, fuseau = "America/Toronto"): Date {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parties = Object.fromEntries(
    format.formatToParts(maintenant).map((p) => [p.type, p.value]),
  );
  const heures = Number(parties.hour === "24" ? "0" : parties.hour);
  const minutes = Number(parties.minute);
  // On retranche l'heure locale écoulée : le résultat est minuit local, exprimé en UTC.
  return new Date(maintenant.getTime() - (heures * 60 + minutes) * 60_000);
}

/** Début du MOIS local, en UTC. Même raison que ci-dessus. */
export function debutDuMoisLocal(maintenant: Date, fuseau = "America/Toronto"): Date {
  const jour = Number(
    new Intl.DateTimeFormat("en-CA", { timeZone: fuseau, day: "2-digit" }).format(maintenant),
  );
  const minuit = debutDuJourLocal(maintenant, fuseau);
  return new Date(minuit.getTime() - (jour - 1) * 86_400_000);
}

/**
 * Kilomètres parcourus depuis un instant, lus sur l'ODOMÈTRE. PURE, testée.
 *
 * `max − min` sur la fenêtre, et non `dernier − premier` : l'ordre d'arrivée des relevés
 * n'est pas garanti et un compteur ne recule pas, donc les extrêmes sont plus robustes.
 *
 * ⚠️ Il faut un relevé AVANT la fenêtre (ou à son début) pour connaître le point de départ.
 * Sans lui, on ne peut pas distinguer « il n'a pas roulé » de « on ne sait pas depuis
 * quand » — d'où le `null`, jamais un 0 qui affirmerait qu'il n'a pas bougé.
 */
export function kmDepuis(historique: PointOdometre[], depuis: Date): number | null {
  const tries = [...historique].sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime());
  if (tries.length === 0) return null;

  // Point de départ : le dernier relevé à ou avant le début de la fenêtre.
  let depart: number | null = null;
  for (const p of tries) {
    if (p.mesureLe.getTime() <= depuis.getTime()) depart = p.km;
    else break;
  }

  const dans = tries.filter((p) => p.mesureLe.getTime() >= depuis.getTime());
  // Aucun relevé dans la fenêtre : le compteur n'a pas bougé DEPUIS le dernier connu, donc
  // zéro km — mais seulement si on sait d'où on part.
  if (dans.length === 0) return depart === null ? null : 0;

  const arrivee = Math.max(...dans.map((p) => p.km));
  // Sans point de départ connu, on ne sait pas ce qui a été parcouru AVANT le premier
  // relevé de la fenêtre : dire « 0 » serait affirmer qu'il n'a pas roulé.
  if (depart === null) return null;

  return Math.max(0, arrivee - depart);
}

/**
 * Kilomètres parcourus ENTRE deux instants. PURE.
 *
 * ⚠️ NÉ DU COÛT AUX 100 KM (Marc, 15/09). `kmDepuis` mesure jusqu'à MAINTENANT ; un coût
 * aux 100 km doit rapporter des dollars à des kilomètres parcourus sur la MÊME fenêtre que
 * les recharges comptées. Mesuré sur les vraies données : l'odomètre portait plusieurs milliers de km depuis
 * la signature quand les recharges observées ne commencent que bien plus tard —
 * diviser l'un par l'autre rend un coût quatre fois trop bas, et rien à l'écran ne cloche.
 *
 * Même règle que `kmDepuis` pour l'inconnu : sans point de départ connu, `null`. Dire « 0 »
 * serait affirmer qu'il n'a pas roulé.
 */
export function kmEntre(
  historique: PointOdometre[],
  debut: Date,
  fin: Date,
): number | null {
  if (fin.getTime() < debut.getTime()) return null;
  const tries = [...historique].sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime());
  if (tries.length === 0) return null;

  let depart: number | null = null;
  for (const p of tries) {
    if (p.mesureLe.getTime() <= debut.getTime()) depart = p.km;
    else break;
  }
  if (depart === null) return null;

  const dans = tries.filter(
    (p) => p.mesureLe.getTime() >= debut.getTime() && p.mesureLe.getTime() <= fin.getTime(),
  );
  // Aucun relevé dans la fenêtre : le compteur n'a pas bougé pendant celle-ci.
  if (dans.length === 0) return 0;

  return Math.max(0, Math.max(...dans.map((p) => p.km)) - depart);
}

/**
 * La fenêtre de la métrique « Km » publiée au hub. Sept jours, demandés par Marc le 15/09.
 *
 * ⚠️ Cette constante BORNE le calcul ET compose le libellé (`hubSummary.ts`). Deux nombres
 * écrits séparément — l'un dans la requête, l'autre dans le texte — divergent au premier
 * réglage, et l'écran annonce alors une fenêtre qu'il ne mesure pas. C'est exactement ce
 * qui vient d'être corrigé chez BatchChef, et ce que le hub a affiché pendant une journée :
 * « sur 7 j » calculé sur quatre heures d'historique.
 */
export const FENETRE_KM_JOURS = 7;

/**
 * Ce qu'une mesure de kilométrage sur fenêtre rend RÉELLEMENT.
 *
 * ⚠️ `du` / `au` sont les RELEVÉS, pas les bords de la fenêtre demandée. C'est toute la
 * raison d'être de ce type : un odomètre ne se mesure qu'entre deux relevés existants, et
 * ceux-ci ne tombent jamais pile sur les bords. Rendre le seul nombre de kilomètres
 * laisserait croire qu'il couvre la fenêtre demandée — alors que le relevé de départ peut
 * dater de trois semaines, et que le nombre vaut alors trois semaines de route sous une
 * étiquette de sept jours.
 */
export interface KmSurFenetre {
  km: number;
  /** Relevé qui sert de point de départ. */
  du: Date;
  /** Relevé le plus récent retenu. */
  au: Date;
  /** Durée RÉELLEMENT couverte par la mesure, en jours. À comparer à la fenêtre voulue. */
  couvertureJours: number;
}

/**
 * Kilomètres parcourus sur une fenêtre glissante, AVEC la durée réellement couverte. PURE.
 *
 * Différence avec `kmDepuis`, et elle est délibérée : `kmDepuis` rend un nombre nu, et
 * `0` quand aucun relevé ne tombe dans la fenêtre — une lecture qui se défend pour
 * « aujourd'hui » (le compteur n'a rien publié, donc rien n'a été signalé) mais pas pour
 * sept jours, où sept jours de silence ne veulent pas dire sept jours immobile.
 * Ici : `null` s'il n'y a rien à mesurer, et la COUVERTURE sinon, pour que l'appelant
 * puisse refuser de publier une mesure qui ne correspond pas à son étiquette.
 *
 * `max − min` sur la fenêtre plutôt que `dernier − premier` : l'ordre d'arrivée des relevés
 * n'est pas garanti et un compteur ne recule pas (même règle que `kmDepuis`).
 */
export function kmSurFenetre(
  historique: PointOdometre[],
  fenetreJours: number,
  maintenant: Date,
): KmSurFenetre | null {
  if (!(fenetreJours > 0)) return null;
  const depuis = new Date(maintenant.getTime() - fenetreJours * 86_400_000);

  const tries = [...historique]
    .filter((p) => Number.isFinite(p.km) && !Number.isNaN(p.mesureLe.getTime()))
    .sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime());
  if (tries.length === 0) return null;

  // Point de départ : le dernier relevé À OU AVANT le bord de la fenêtre. Sans lui, on ne
  // sait pas ce qui a été parcouru avant le premier relevé de la fenêtre.
  let depart: PointOdometre | null = null;
  for (const p of tries) {
    if (p.mesureLe.getTime() <= depuis.getTime()) depart = p;
    else break;
  }
  if (depart === null) return null;

  const dans = tries.filter((p) => p.mesureLe.getTime() >= depuis.getTime());
  // Aucun relevé DANS la fenêtre : l'arrivée est inconnue. Rendre 0 affirmerait que la
  // voiture n'a pas roulé de la semaine, alors qu'on constate seulement un silence.
  if (dans.length === 0) return null;

  const arrivee = dans.reduce((a, b) => (b.km >= a.km ? b : a));
  return {
    km: Math.max(0, arrivee.km - depart.km),
    du: depart.mesureLe,
    au: arrivee.mesureLe,
    couvertureJours: (arrivee.mesureLe.getTime() - depart.mesureLe.getTime()) / 86_400_000,
  };
}

export interface BilanQuotidien {
  /** Kilomètres parcourus aujourd'hui. `null` si non mesurable. */
  kmAujourdhui: number | null;
  /** Kilomètres parcourus depuis le 1er du mois. `null` si non mesurable. */
  kmCeMois: number | null;
  /**
   * Kilométrage que le bail autorise sur un mois moyen — le repère du bilan du soir.
   * `allocation / durée` ramené à 30,44 jours (la longueur moyenne d'un mois). `null` quand
   * le bail n'est pas renseigné en base : aucun repère n'est inventé.
   */
  budgetMensuelKm: number | null;
  /** Part du budget mensuel déjà consommée, en pourcent. `null` si non mesurable. */
  partDuMoisPourcent: number | null;
}

const JOURS_PAR_MOIS_MOYEN = 30.436875;

/** Les chiffres du bilan quotidien. PURE, testée. */
export function calculerBilan(params: {
  historiqueOdometre: PointOdometre[];
  /** `null` = bail non renseigné : les kilomètres restent mesurés, sans budget. */
  allocationKm: number | null;
  dureeMois: number | null;
  maintenant: Date;
  fuseau?: string;
}): BilanQuotidien {
  const { historiqueOdometre, allocationKm, dureeMois, maintenant, fuseau } = params;

  const kmAujourdhui = kmDepuis(historiqueOdometre, debutDuJourLocal(maintenant, fuseau));
  const kmCeMois = kmDepuis(historiqueOdometre, debutDuMoisLocal(maintenant, fuseau));
  const budgetMensuelKm =
    allocationKm === null || dureeMois === null || dureeMois <= 0 ? null : allocationKm / dureeMois;

  return {
    kmAujourdhui,
    kmCeMois,
    budgetMensuelKm,
    partDuMoisPourcent:
      kmCeMois === null || budgetMensuelKm === null || budgetMensuelKm <= 0
        ? null : (kmCeMois / budgetMensuelKm) * 100,
  };
}

/** Jours moyens d'un mois — exporté pour que l'écran puisse expliquer le repère. */
export const JOURS_MOIS_MOYEN = JOURS_PAR_MOIS_MOYEN;
