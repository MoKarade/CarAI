// lib/smartcar/rejeu.ts — RECONSTRUIRE les mesures perdues depuis les livraisons brutes.
//
// ══ POURQUOI CE MODULE EXISTE (incident du 18/08/2026) ═══════════════════════════════
// La migration 0005 devait supprimer l'historique des signaux « qui n'ont jamais eu de
// data » (demande de Marc). Son SQL testait `value_numeric IS NULL AND value_text IS
// NULL` — en OUBLIANT `value_json`. Or c'est là que vivent les positions GPS, les
// pressions de pneus et l'état des ouvrants. Résultat mesuré à l'écran : plus un seul
// trajet (« 1040 km roulés sans relevé de position ») et plus aucun prix de recharge,
// qui dépend du LIEU, donc des positions.
//
// ⚠️ Ce que ce module NE fait PAS : inventer. Il ne reconstruit que ce que la base
// contient ENCORE — le JSON brut des livraisons (`webhook_deliveries.raw`), conservé
// 90 jours et JAMAIS touché par la purge. C'est très exactement le filet que le CLAUDE.md
// décrivait : « le raw est redondant » n'est vrai que si le pipeline sait le relire.
// Ce qui est plus vieux que la fenêtre de rétention est perdu, et se dit comme tel.
//
// ⚠️ Rejouer est SÛR par construction : `insererSnapshots` écrit avec
// `onConflictDoNothing` sur l'index unique (source, métrique, instant de mesure). Une
// mesure encore présente n'est pas dupliquée ; seule une mesure ABSENTE est réécrite.
// Relancer deux fois ne change donc rien — la deuxième passe écrit zéro ligne.

import { and, asc, gt, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { webhookDeliveries } from "@/lib/db/schema";
import { signauxVersSnapshots } from "@/lib/smartcar/signals";
import { insererSnapshots } from "@/lib/smartcar/ingest";
import {
  CLE_REJEU_CURSEUR,
  REJEU_TERMINE,
  ecrireConfig,
  lireConfigTexte,
} from "@/lib/config";

/**
 * Livraisons par lot. Volontairement PETIT : la boucle de `rejouerJusquAuBout` vérifie
 * son budget ENTRE deux lots, donc un gros lot rendrait la borne grossière — c'est le
 * dépassement de temps serverless qu'on éviterait mal.
 */
export const LOT_REJEU = 50;

export interface ResultatRejeu {
  /** Livraisons dont le `raw` a été relu. */
  livraisonsLues: number;
  /** Mesures RÉELLEMENT réécrites (0 = rien ne manquait — le cas normal en régime). */
  mesuresRestaurees: number;
  /**
   * Ce que les livraisons CONTENAIENT, par métrique — indépendamment de ce qui a été
   * écrit. ⚠️ C'est le compteur qui DIAGNOSTIQUE : sans lui, « le rejeu n'a rien
   * restauré » et « les livraisons ne contenaient aucune position » laissent la MÊME
   * trace, alors que ce sont deux causes opposées (un bug de rejeu / une donnée qui
   * n'est jamais passée par le webhook). Leçon JobAI : un outil de diagnostic qui se
   * tait quand il ne trouve rien ne diagnostique rien.
   */
  vuesParMetrique: Record<string, number>;
  /** Curseur : dernier `event_id` traité, pour reprendre là où on s'est arrêté. */
  dernierEventId: string | null;
  /** `true` quand la passe a rempli son lot : il reste probablement du travail. */
  encore: boolean;
}

/**
 * Extrait la liste de signaux d'un payload brut de livraison Smartcar.
 *
 * Le `raw` est l'enveloppe COMPLÈTE reçue ; les signaux vivent sous `data.signals` (forme
 * verrouillée par `tests/livraisonReelle.test.ts`). On tolère les deux formes rencontrées
 * plutôt que d'échouer : une enveloppe inconnue rend `null` et la livraison est SAUTÉE,
 * jamais devinée.
 */
export function signauxDuRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return null;
  const enveloppe = raw as Record<string, unknown>;
  const data = enveloppe.data;
  if (data && typeof data === "object") {
    const signals = (data as Record<string, unknown>).signals;
    if (Array.isArray(signals)) return signals;
  }
  if (Array.isArray(enveloppe.signals)) return enveloppe.signals;
  return null;
}

/**
 * Relit un LOT de livraisons brutes et réécrit les mesures manquantes.
 *
 * `apres` est le curseur : passer le `dernierEventId` de la passe précédente. Les
 * livraisons sont parcourues par `event_id` croissant — un ordre STABLE (clé primaire),
 * contrairement à `received_at` qui peut porter des ex æquo et ferait boucler le curseur.
 */
export async function rejouerLivraisons(params: {
  apres?: string | null;
  lot?: number;
} = {}): Promise<ResultatRejeu> {
  const { apres = null, lot = LOT_REJEU } = params;

  const lignes = await db
    .select({
      eventId: webhookDeliveries.eventId,
      raw: webhookDeliveries.raw,
      receivedAt: webhookDeliveries.receivedAt,
    })
    .from(webhookDeliveries)
    .where(
      apres
        ? and(isNotNull(webhookDeliveries.raw), gt(webhookDeliveries.eventId, apres))
        : isNotNull(webhookDeliveries.raw),
    )
    .orderBy(asc(webhookDeliveries.eventId))
    .limit(lot);

  let mesuresRestaurees = 0;
  let dernierEventId: string | null = apres;
  const vuesParMetrique: Record<string, number> = {};

  for (const ligne of lignes) {
    dernierEventId = ligne.eventId;
    const signaux = signauxDuRaw(ligne.raw);
    if (signaux === null) continue;

    // ⚠️ PAS de `filtrerRepetitions` ici : il écarte les lignes SANS valeur dont le statut
    // n'a pas changé, en se fondant sur le dernier statut connu — un état d'AUJOURD'HUI.
    // Appliqué à un rejeu d'historique, il jetterait des transitions passées légitimes.
    // On réécrit ce que la livraison portait ; l'index unique fait le reste.
    const snapshots = signauxVersSnapshots(signaux, {
      source: "smartcar",
      // ⚠️ L'instant de MESURE vient du signal quand il en porte un ; sinon `recordedAt`
      // retombe sur ce `recuLe`. Il DOIT donc être celui de la livraison d'ORIGINE :
      // passer `new Date()` daterait d'aujourd'hui des mesures vieilles de semaines, et
      // fabriquerait une fraîcheur qui n'a jamais existé (verrouillé par test).
      recuLe: ligne.receivedAt,
    });
    for (const snap of snapshots) {
      vuesParMetrique[snap.metricType] = (vuesParMetrique[snap.metricType] ?? 0) + 1;
    }
    mesuresRestaurees += await insererSnapshots(snapshots, { publier: false });
  }

  return {
    livraisonsLues: lignes.length,
    mesuresRestaurees,
    vuesParMetrique,
    dernierEventId,
    encore: lignes.length === lot,
  };
}

/**
 * UN lot de réparation, appelé par le cron du poll. Rend une phrase à journaliser, ou
 * `null` quand il n'y a plus rien à faire.
 *
 * ⚠️ Le curseur vit EN BASE (`CLE_REJEU_CURSEUR`) et va jusqu'à la sentinelle `fini` :
 * une variable de module serait vide à chaque démarrage à froid, et la réparation
 * repartirait de zéro toutes les 30 minutes — pour toujours. La condition d'arrêt est le
 * lot INCOMPLET (`encore === false`), pas un compteur : c'est le seul signal qui dit
 * « la dernière livraison a été relue ».
 */
export async function rejouerUnLot(): Promise<string | null> {
  const curseur = await lireConfigTexte(CLE_REJEU_CURSEUR);
  if (curseur === REJEU_TERMINE) return null;

  const r = await rejouerLivraisons({ apres: curseur });

  if (!r.encore) {
    await ecrireConfig(CLE_REJEU_CURSEUR, REJEU_TERMINE);
    return `terminée — ${r.livraisonsLues} livraison(s) relue(s) sur ce dernier lot, ${r.mesuresRestaurees} mesure(s) restaurée(s).`;
  }

  // `dernierEventId` ne peut pas être null ici : `encore` implique un lot PLEIN.
  await ecrireConfig(CLE_REJEU_CURSEUR, r.dernierEventId);
  return `${r.livraisonsLues} livraison(s) relue(s), ${r.mesuresRestaurees} mesure(s) restaurée(s) — reprise au prochain passage.`;
}

/**
 * Budgets de temps, par point d'appel. Généreux côté cron (il n'a personne qui attend),
 * serrés côté page (le travail vit DANS l'invocation de la page — leçon JobAI : un
 * `after()` hérite de la durée de vie de sa fonction, il ne s'y ajoute pas).
 */
export const BUDGET_CRON_MS = 20_000;
export const BUDGET_PAGE_MS = 6_000;

/**
 * Reconstruit AUTANT que le budget le permet, puis rend la main. PAS de « un lot par
 * passage » : Marc a demandé que ça se fasse tout seul (18/08 : « récupère tous les
 * trajets et recharges et mets dans l'app »), donc on enchaîne les lots tant qu'il reste
 * du temps, et on reprend au curseur à l'appel suivant.
 *
 * Rend `null` quand il n'y avait rien à faire — le cas normal une fois la réparation
 * terminée, et ce qui rend l'appel gratuit sur toutes les pages, pour toujours.
 */
export async function rejouerJusquAuBout(params: {
  budgetMs: number;
  maintenant?: () => number;
}): Promise<string | null> {
  const { budgetMs, maintenant = () => Date.now() } = params;
  const debut = maintenant();

  const curseur = await lireConfigTexte(CLE_REJEU_CURSEUR);
  if (curseur === REJEU_TERMINE) return null;

  let position = curseur;
  let livraisons = 0;
  let mesures = 0;
  const vues: Record<string, number> = {};

  // ⚠️ La condition d'arrêt est le lot INCOMPLET, jamais un compteur : c'est le seul
  // signal qui dit « la dernière livraison a été relue ». Le budget, lui, ne fait
  // qu'interrompre — le curseur garde la place et l'appel suivant reprend.
  for (;;) {
    const r = await rejouerLivraisons({ apres: position });
    livraisons += r.livraisonsLues;
    mesures += r.mesuresRestaurees;
    for (const [metrique, n] of Object.entries(r.vuesParMetrique)) {
      vues[metrique] = (vues[metrique] ?? 0) + n;
    }
    position = r.dernierEventId;

    if (!r.encore) {
      await ecrireConfig(CLE_REJEU_CURSEUR, REJEU_TERMINE);
      return (
        `TERMINÉE — ${livraisons} livraison(s) relue(s), ${mesures} mesure(s) restaurée(s). ` +
        `Contenu vu : ${resumerVues(vues)}`
      );
    }

    // Curseur écrit à CHAQUE lot : une coupure (timeout, redéploiement) ne doit jamais
    // faire recommencer depuis le début.
    await ecrireConfig(CLE_REJEU_CURSEUR, position);

    if (maintenant() - debut >= budgetMs) {
      return (
        `${livraisons} livraison(s) relue(s), ${mesures} mesure(s) restaurée(s) — la suite au ` +
        `prochain affichage. Contenu vu : ${resumerVues(vues)}`
      );
    }
  }
}

/**
 * Le contenu relu, par métrique, du plus fourni au moins fourni. Dit explicitement
 * « aucune » quand il n'y a rien : c'est CE cas qu'il faut pouvoir distinguer d'un
 * journal muet.
 */
function resumerVues(vues: Record<string, number>): string {
  const entrees = Object.entries(vues).sort((a, b) => b[1] - a[1]);
  if (entrees.length === 0) return "aucune métrique dans les livraisons relues";
  return entrees.map(([m, n]) => `${m}=${n}`).join(", ");
}
