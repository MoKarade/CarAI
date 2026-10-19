// lib/vehicle/fil.ts — le FIL MÊLÉ de l'écran Activité. PUR, testé.
//
// Choix de Marc (cadrage du 17/08, 3ᵉ salve) : trajets et recharges fusionnent en UNE
// chronologie — « on revit sa journée telle qu'elle s'est passée » — groupée PAR JOUR avec
// un en-tête de totaux (« dim. 17 août — 109 km · 3 trajets · 1 recharge »).
//
// Ce module ne lit rien : il reçoit des trajets et des sessions déjà construits par leurs
// modules respectifs (`decouperTrajets`, `reconstituerCharges`) et ne fait que les MÊLER
// et les GROUPER. La frontière de jour se calcule dans le fuseau de Marc — un événement de
// 21 h locale appartient à SA journée, pas à celle de demain en UTC (leçon JobAI).

import type { Trajet } from "@/lib/vehicle/trajets";
import type { SessionCharge } from "@/lib/vehicle/charges";

export type EvenementFil =
  | { genre: "trajet"; t: Date; trajet: Trajet }
  | { genre: "recharge"; t: Date; session: SessionCharge };

export interface JourFil {
  /** Clé AAAA-MM-JJ dans le fuseau demandé — stable, triable. */
  cle: string;
  /** Les événements du jour, du plus RÉCENT au plus ancien. */
  evenements: EvenementFil[];
  /** Totaux du jour, pour l'en-tête. */
  kmTrajets: number;
  nbTrajets: number;
  nbRecharges: number;
}

/** Clé de jour locale (AAAA-MM-JJ). `en-CA` produit exactement ce format. */
export function cleJourLocale(t: Date, fuseau = "America/Toronto"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(t);
}

/**
 * Les trajets de la MÊME journée civile que `reference`, du plus ancien au plus récent.
 * PURE, testée.
 *
 * Sert à la CARTE de l'écran Activité : montrer le seul trajet sélectionné n'affichait
 * qu'un bout de la route quand un déplacement sortait découpé (Marc, 18/09 : « ça coupe à
 * la moitié du trajet »).
 *
 * ⚠️ La journée d'un trajet est celle de son ARRIVÉE — la même règle que `construireFil`,
 * et surtout pas une seconde écrite ici : un trajet qui part à 23 h 50 et arrive à 00 h 20
 * doit tomber dans le même jour que la ligne du fil qui l'annonce, sinon la carte et la
 * liste se contrediraient sur la date d'un même trajet.
 */
export function trajetsDuMemeJour<T extends { debut: Date; fin: Date }>(
  trajets: readonly T[],
  reference: T,
  fuseau = "America/Toronto",
): T[] {
  const cle = cleJourLocale(reference.fin, fuseau);
  return trajets
    .filter((t) => cleJourLocale(t.fin, fuseau) === cle)
    .sort((a, b) => a.debut.getTime() - b.debut.getTime());
}

/**
 * Mêle trajets et recharges en un fil groupé par jour, du plus récent au plus ancien.
 *
 * L'instant de tri d'un trajet est sa FIN (l'arrivée) et celui d'une recharge son DÉBUT :
 * c'est l'ordre dans lequel la journée s'est vécue — on arrive, PUIS on branche. Trier les
 * deux sur le début inverserait trajet et recharge à chaque retour à la maison.
 */
export function construireFil(params: {
  trajets: Trajet[];
  sessions: SessionCharge[];
  fuseau?: string;
}): JourFil[] {
  const { trajets, sessions, fuseau = "America/Toronto" } = params;

  const evenements: EvenementFil[] = [
    ...trajets.map((trajet): EvenementFil => ({ genre: "trajet", t: trajet.fin, trajet })),
    ...sessions.map(
      (session): EvenementFil => ({ genre: "recharge", t: session.debut, session }),
    ),
  ].sort((a, b) => b.t.getTime() - a.t.getTime());

  const jours = new Map<string, JourFil>();
  for (const e of evenements) {
    const cle = cleJourLocale(e.t, fuseau);
    let jour = jours.get(cle);
    if (!jour) {
      jour = { cle, evenements: [], kmTrajets: 0, nbTrajets: 0, nbRecharges: 0 };
      jours.set(cle, jour);
    }
    jour.evenements.push(e);
    if (e.genre === "trajet") {
      jour.nbTrajets += 1;
      jour.kmTrajets += e.trajet.distanceKm;
    } else {
      jour.nbRecharges += 1;
    }
  }

  // Map préserve l'ordre d'insertion, et les événements arrivent triés du plus récent au
  // plus ancien : les jours sortent donc déjà dans le bon ordre.
  return [...jours.values()];
}

/**
 * L'énergie ~consommée d'un trajet, déduite du SOC et de la capacité. PURE.
 *
 * `null` — jamais un zéro — dès qu'un des deux relevés de SOC manque, que la capacité est
 * inconnue, ou que le delta est NÉGATIF (la voiture a chargé en route ou la mesure est
 * bruitée : un « −2 kWh consommés » n'aurait aucun sens à l'écran).
 */
export function energieTrajetKwh(params: {
  socDebut: number | null;
  socFin: number | null;
  capaciteKwh: number | null;
}): number | null {
  const { socDebut, socFin, capaciteKwh } = params;
  if (socDebut === null || socFin === null || capaciteKwh === null) return null;
  const delta = socDebut - socFin;
  if (delta <= 0) return null;
  return (delta / 100) * capaciteKwh;
}

/** kWh/100 km d'un trajet — seulement quand énergie ET distance existent. PURE. */
export function consoTrajet(params: {
  energieKwh: number | null;
  distanceKm: number;
}): number | null {
  const { energieKwh, distanceKm } = params;
  if (energieKwh === null || distanceKm <= 0) return null;
  return (energieKwh / distanceKm) * 100;
}
