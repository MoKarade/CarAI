// lib/vehicle/rafraichissement.ts — la contre-pression du bouton « Rafraîchir maintenant ».
//
// ══ POURQUOI UN MODULE POUR UN BOUTON ════════════════════════════════════════════════
//
// `[UI-02]`. Un bouton qui déclenche un appel à Smartcar est un geste humain devenu
// mécanique : sans plancher, quinze clics font quinze appels. C'est la leçon JobAI, écrite
// mot pour mot — « supprimer un geste manuel déplace son coût : il faut le borner AVANT ».
//
// La mécanique de réservation, elle, est PARTAGÉE (`lib/vehicle/creneau.ts`) : la synchro
// de l'historique d'entretien s'en sert aussi, avec un plancher de 24 h. Ce module n'ajoute
// que ce qui est propre au bouton — sa clé, son plancher, et la phrase du refus.

import type { db } from "@/lib/db";
import { derniereReservation, reserverCreneau } from "@/lib/vehicle/creneau";

/** La clé de la réservation, en base. */
export const CLE_RAFRAICHIR = "poll.rafraichirManuel";

/**
 * Délai minimal entre deux rafraîchissements demandés à la main.
 *
 * ⚠️ Ce n'est PAS la cadence du poll (`CADENCE_POLL_MINUTES`, 15 min) et il ne faut pas
 * l'y aligner : un bouton qui refuse pendant un quart d'heure n'a aucun intérêt — Marc
 * ouvre l'app justement parce qu'il veut voir MAINTENANT. Le plancher ne protège que
 * contre le martèlement : le temps qu'un aller-retour Smartcar prenne, plus une marge.
 */
export const PLANCHER_RAFRAICHIR_MS = 60_000;

export type DecisionRafraichissement =
  | { autorise: true }
  | { autorise: false; resteSecondes: number };

/**
 * Le bouton peut-il tirer ? PURE, testée.
 *
 * ⚠️ Elle ne DÉCIDE rien en production — c'est `reserverRafraichissement` qui tranche, et
 * elle seule. Celle-ci sert à COMPOSER le refus : dire « encore 40 s » plutôt que de
 * laisser un bouton sans effet. Les faire décider toutes les deux rouvrirait la course
 * qu'on vient de fermer.
 *
 * `dernier` à `null` veut dire « jamais demandé » — donc oui. C'est le seul cas où
 * l'absence d'information autorise : ne rien savoir d'un passé qui n'existe pas n'est pas
 * un doute.
 */
export function deciderRafraichissement(params: {
  dernier: Date | null;
  maintenant: Date;
  plancherMs?: number;
}): DecisionRafraichissement {
  const { dernier, maintenant, plancherMs = PLANCHER_RAFRAICHIR_MS } = params;
  if (dernier === null) return { autorise: true };

  const ecoule = maintenant.getTime() - dernier.getTime();
  // Une horloge cassée (date invalide) ne doit pas ouvrir la porte : on la traite comme un
  // appel qui vient d'avoir lieu. Le sens sûr de l'erreur est le refus.
  if (!Number.isFinite(ecoule)) return { autorise: false, resteSecondes: plancherMs / 1000 };
  if (ecoule >= plancherMs) return { autorise: true };

  return { autorise: false, resteSecondes: Math.ceil((plancherMs - ecoule) / 1000) };
}

/** Réserve le créneau du bouton, ou refuse. ATOMIQUE — voir `lib/vehicle/creneau.ts`. */
export async function reserverRafraichissement(params?: {
  plancherMs?: number;
  dbx?: typeof db;
  maintenant?: Date;
}): Promise<boolean> {
  return reserverCreneau({
    cle: CLE_RAFRAICHIR,
    plancherMs: params?.plancherMs ?? PLANCHER_RAFRAICHIR_MS,
    dbx: params?.dbx,
    maintenant: params?.maintenant,
  });
}

/** Quand le bouton a tiré pour la dernière fois. `null` s'il n'a jamais servi. */
export async function dernierRafraichissement(dbx?: typeof db): Promise<Date | null> {
  return derniereReservation(CLE_RAFRAICHIR, dbx);
}
