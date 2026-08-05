// lib/hubSummary.ts — construction du summary publié au hub perso. FONCTION PURE.
//
// Prend un instantané de l'état de CarAI et rend un `HubSummary` conforme au contrat. Pure
// pour être testable sans base : c'est ce qui permet de vérifier « aucune donnée ⇒ status
// building » sans monter un Postgres.
//
// ── LES DEUX RÈGLES DU HUB QUI SE PAIENT COMPTANT ────────────────────────────────────
//
// 1. `dataAsOf` ≠ `generatedAt`. `generatedAt` c'est « quand j'ai fabriqué cette réponse »
//    (toujours maintenant) ; `dataAsOf` c'est « quand la DONNÉE a été rafraîchie ». Sans le
//    second, le hub ne peut pas distinguer un véhicule à jour d'un véhicule dont les
//    données sont figées depuis trois jours — et pour CarAI, dont la source se rafraîchit
//    aux 30-60 min et peut se taire sans bruit, c'est précisément l'information critique.
//
// 2. Pas de bloc `usage`. CarAI n'a AUCUN coût mesuré : le plan Smartcar est gratuit
//    (1 véhicule), il n'y a pas d'appel LLM. Publier `amount: 0` affirmerait un suivi de
//    coût qui n'existe pas ; omettre le bloc fait afficher « non suivi », ce qui est vrai.

import {
  CONTRACT_VERSION,
  validateSummary,
  type HubAlert,
  type HubMetric,
  type HubSummary,
} from "@mokarade/hub-contract";
import type { EtatBail } from "./vehicle/lease";
import { resumerBail } from "./vehicle/lease";
import { interpreterPourcentage } from "./smartcar/signals";

export const APP: HubSummary["app"] = {
  // ⚠️ Doit rester IDENTIQUE à l'entrée `id` de `lib/sources.ts` côté Hubperso.
  id: "carai",
  name: "CarAI",
  url: "https://carai.hubperso.com",
  color: "#2f9e6e",
};

export interface InstantaneCarAI {
  /** Dernière mesure de charge, avec son unité déclarée (jamais devinée). */
  batterieSoc: { valeur: number; unite: string | null } | null;
  autonomieKm: number | null;
  odometreKm: number | null;
  statutCharge: string | null;
  /** Mesure la plus récente, toutes métriques confondues. */
  fraicheur: Date | null;
  bail: EtatBail | null;
  /** Heures depuis la dernière livraison de webhook, `null` si aucune n'est jamais arrivée. */
  silenceWebhookHeures: number | null;
  toyotaDesactive: boolean;
  /** Base injoignable ou schéma absent — une PANNE, pas un état « en construction ». */
  panne: string | null;
  generatedAt: Date;
}

/** Seuil de silence au-delà duquel on soupçonne un webhook désactivé (Doc 2 §6.4). */
export const SEUIL_SILENCE_HEURES = 6;

function arrondi(valeur: number, decimales = 0): number {
  const f = 10 ** decimales;
  return Math.round(valeur * f) / f;
}

/**
 * Construit le summary. Toujours valide au regard du contrat — `validateSummary` lève sinon,
 * ce qui vaut mieux qu'un widget « invalide » côté hub sans qu'on sache pourquoi.
 */
export function construireSummary(instantane: InstantaneCarAI): HubSummary {
  const metrics: HubMetric[] = [];
  const alerts: HubAlert[] = [];

  // ── PANNE : elle prime sur tout le reste ───────────────────────────────────────────
  // Un `status: "error"` avec zéro métrique est honnête ; afficher les dernières valeurs
  // connues comme si de rien n'était laisserait croire que tout va bien.
  if (instantane.panne) {
    return validateSummary({
      contractVersion: CONTRACT_VERSION,
      app: APP,
      generatedAt: instantane.generatedAt.toISOString(),
      status: "error",
      metrics: [],
      alerts: [{ label: `CarAI : ${instantane.panne}`.slice(0, 80), severity: "alert" }],
      actions: [{ label: "Ouvrir CarAI", kind: "link", href: APP.url }],
    });
  }

  // ── ÉTAT DE CHARGE ─────────────────────────────────────────────────────────────────
  if (instantane.batterieSoc) {
    const { pourcent, fiable } = interpreterPourcentage(
      instantane.batterieSoc.valeur,
      instantane.batterieSoc.unite,
    );
    if (fiable && pourcent !== null) {
      metrics.push({
        label: "Charge",
        value: arrondi(pourcent),
        format: "percent",
        severity: pourcent <= 15 ? "alert" : pourcent <= 30 ? "warn" : "ok",
      });
    } else {
      // Unité non déclarée : impossible de trancher entre 0,3 % et 30 %. On publie la
      // valeur brute en texte plutôt qu'un pourcentage qui pourrait être faux d'un
      // facteur 100 — sur une jauge de batterie, ce serait la pire des erreurs.
      metrics.push({
        label: "Charge (unité inconnue)",
        value: String(instantane.batterieSoc.valeur),
        format: "text",
      });
    }
  }

  if (instantane.autonomieKm !== null) {
    metrics.push({
      label: "Autonomie",
      value: `${arrondi(instantane.autonomieKm)} km`,
      format: "text",
    });
  }

  if (instantane.statutCharge) {
    metrics.push({ label: "Charge en cours", value: instantane.statutCharge, format: "text" });
  }

  if (instantane.odometreKm !== null) {
    metrics.push({
      label: "Odomètre",
      value: `${Math.round(instantane.odometreKm).toLocaleString("fr-CA")} km`,
      format: "text",
    });
  }

  // ── BAIL ───────────────────────────────────────────────────────────────────────────
  const bail = instantane.bail;
  if (bail?.consommePourcent !== null && bail?.consommePourcent !== undefined) {
    metrics.push({
      label: "Bail consommé",
      value: arrondi(bail.consommePourcent, 1),
      format: "percent",
      // Le point de comparaison n'est pas 100 % mais le temps ÉCOULÉ : consommer 40 % de
      // son forfait après 40 % du bail est parfaitement sain, et l'afficher en alerte
      // apprendrait à ignorer l'indicateur.
      severity:
        bail.consommePourcent > bail.ecoulePourcent + 15
          ? "alert"
          : bail.consommePourcent > bail.ecoulePourcent + 5
            ? "warn"
            : "ok",
    });
  }

  if (bail && bail.depassementProjete !== null && bail.depassementProjete > 0) {
    alerts.push({
      label: resumerBail(bail).slice(0, 80),
      severity: bail.depassementProjete > bail.allocationTotale * 0.1 ? "alert" : "warn",
    });
  }

  // ── SILENCE DU WEBHOOK ─────────────────────────────────────────────────────────────
  // C'est l'alerte la plus importante de ce summary : elle signale la panne QUI NE FAIT
  // PAS DE BRUIT. Smartcar désactive un webhook après six échecs de livraison ; sans cette
  // ligne, le tableau de bord continuerait d'afficher fièrement des valeurs figées.
  if (
    instantane.silenceWebhookHeures !== null &&
    instantane.silenceWebhookHeures >= SEUIL_SILENCE_HEURES
  ) {
    alerts.push({
      label: `Aucune donnée Smartcar depuis ${Math.floor(instantane.silenceWebhookHeures)} h — webhook peut-être désactivé.`.slice(
        0,
        80,
      ),
      severity: instantane.silenceWebhookHeures >= 24 ? "alert" : "warn",
    });
  }

  if (instantane.toyotaDesactive) {
    alerts.push({
      label: "Source Toyota non officielle désactivée. Smartcar continue normalement.",
      severity: "info",
    });
  }

  // ── STATUT GLOBAL ──────────────────────────────────────────────────────────────────
  // Aucune donnée ⇒ `building`, jamais `ok` avec des métriques vides : le hub afficherait
  // un widget qui a l'air branché alors que rien n'est encore arrivé.
  const aucuneDonnee = metrics.length === 0;
  const degrade =
    instantane.silenceWebhookHeures !== null &&
    instantane.silenceWebhookHeures >= SEUIL_SILENCE_HEURES;

  const status: HubSummary["status"] = aucuneDonnee
    ? "building"
    : degrade
      ? "degraded"
      : "ok";

  if (aucuneDonnee && alerts.length === 0) {
    alerts.push({
      label: "CarAI en place — en attente des premières données du véhicule.",
      severity: "info",
    });
  }

  return validateSummary({
    contractVersion: CONTRACT_VERSION,
    app: APP,
    generatedAt: instantane.generatedAt.toISOString(),
    // Omis quand aucune donnée n'est arrivée : un `dataAsOf` égal à `generatedAt`
    // annoncerait une fraîcheur à la seconde alors qu'il n'y a rien.
    ...(instantane.fraicheur ? { dataAsOf: instantane.fraicheur.toISOString() } : {}),
    status,
    metrics: metrics.slice(0, 6),
    alerts: alerts.slice(0, 10),
    actions: [{ label: "Ouvrir CarAI", kind: "link", href: APP.url }],
    // Pas de bloc `usage` : voir l'en-tête de fichier.
  });
}
