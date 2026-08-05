// lib/smartcar/commands.ts — commandes envoyées au véhicule (Doc 2 §5.2-5.3, Doc 4 §4).
//
// ══ LE PIÈGE DU 202, ET POURQUOI IL EST DÉJÀ DÉSAMORCÉ ═══════════════════════════════
// Le Doc 2 §5.2 avertit : au-delà de ~175 s, Smartcar répond `202 Accepted` puis GARDE LA
// CONNEXION OUVERTE et diffuse le résultat final sur cette même connexion. Traiter
// l'arrivée des premiers octets comme une réponse complète ferait annoncer un succès qui
// n'existe pas encore.
//
// `appelSmartcar` lit `await response.text()`, qui n'aboutit qu'une fois le flux CLOS —
// donc après le résultat final. Le piège est structurellement évité, pas contourné. Ce
// commentaire existe pour qu'un futur refactor vers un lecteur de flux incrémental sache
// exactement ce qu'il casserait.
//
// ══ TOUTE COMMANDE EST JOURNALISÉE, MÊME RATÉE (Doc 4 §4.5) ══════════════════════════
// Smartcar documente qu'une commande peut réussir côté API sans que l'effet se propage au
// véhicule. Le seul moyen d'élucider « j'ai verrouillé et la voiture était ouverte » est
// d'avoir gardé la réponse brute et l'heure exacte.

import { db } from "@/lib/db";
import { vehicleCommandsLog, type CommandStatus } from "@/lib/db/schema";
import { appelSmartcar, type ContexteSmartcar } from "./client";
import { ErreurSmartcar } from "./auth";
import { messageLisible } from "./errors";

export type TypeCommande =
  | "lock"
  | "unlock"
  | "start_charge"
  | "stop_charge"
  | "set_charge_limit";

export interface ResultatCommande {
  statut: CommandStatus;
  message: string;
  /** Identifiant de l'entrée de journal — la traçabilité exigée par le Doc 4 §5. */
  journalId: number | null;
  raw: unknown;
}

/**
 * Chemins des commandes V3.
 *
 * ⚠️ Le Doc 2 §5.3 et le Doc 4 §4.1 signalent que la doc consultée au cadrage indiquait
 * *« 2.0 is still the only supported version for sending remote commands »* pour les
 * commandes de sécurité, en demandant de revérifier l'état de la migration V3 au moment de
 * coder. Cette vérification n'a PAS pu être faite : `smartcar.com` est bloqué par la
 * politique d'egress de la session (403 côté proxy).
 *
 * Décision : on code V3, conformément à la règle « V3 exclusivement » du Doc 2 §1, et on
 * concentre les chemins ICI. Si Smartcar répond 404/501 sur la sécurité, la correction est
 * une ligne dans cette table — pas une refonte. La commande est de toute façon journalisée
 * avec sa réponse brute, donc l'échec sera lisible plutôt que mystérieux.
 */
export const CHEMINS_COMMANDES: Readonly<Record<TypeCommande, string>> = {
  lock: "/commands/security/lock",
  unlock: "/commands/security/unlock",
  start_charge: "/commands/charge/start",
  stop_charge: "/commands/charge/stop",
  set_charge_limit: "/commands/charge/limit",
};

/** Bornes documentées de la limite de charge (Doc 2 §5.2) : fraction entre 0,5 et 1,0. */
export const LIMITE_CHARGE_MIN = 0.5;
export const LIMITE_CHARGE_MAX = 1.0;

/**
 * Valide une limite de charge et la ramène en FRACTION.
 *
 * Accepte 50–100 (pourcentage) comme 0,5–1,0 (fraction) parce que les deux se disent
 * naturellement — « mets la limite à 80 » et « mets-la à 0.8 ». La règle de conversion est
 * SANS ambiguïté ici, contrairement au cas de l'état de charge (`signals.ts`) : 0,8 et 80
 * sont tous deux valides et distinguables, alors que 1 % et 100 % ne le sont pas.
 */
export function normaliserLimiteCharge(
  valeur: number,
): { fraction: number } | { erreur: string } {
  if (!Number.isFinite(valeur)) return { erreur: "Limite de charge invalide." };

  const fraction = valeur > 1 ? valeur / 100 : valeur;
  if (fraction < LIMITE_CHARGE_MIN || fraction > LIMITE_CHARGE_MAX) {
    return {
      erreur: `Limite de charge hors bornes : Smartcar accepte de ${LIMITE_CHARGE_MIN * 100} % à ${LIMITE_CHARGE_MAX * 100} %.`,
    };
  }
  return { fraction };
}

async function journaliser(entree: {
  commandType: string;
  status: CommandStatus;
  issuedBy: string;
  params?: unknown;
  message?: string;
  rawResponse?: unknown;
  completedAt?: Date | null;
}): Promise<number | null> {
  try {
    const lignes = await db
      .insert(vehicleCommandsLog)
      .values({
        commandType: entree.commandType,
        source: "smartcar",
        status: entree.status,
        issuedBy: entree.issuedBy,
        params: (entree.params ?? null) as object | null,
        message: entree.message ?? null,
        rawResponse: (entree.rawResponse ?? null) as object | null,
        completedAt: entree.completedAt ?? new Date(),
      })
      .returning({ id: vehicleCommandsLog.id });
    return lignes[0]?.id ?? null;
  } catch (err) {
    // Le journal ne doit jamais empêcher une commande d'aboutir : Marc a demandé à
    // verrouiller sa voiture, pas à écrire une ligne de base. L'échec est signalé.
    console.error("[commandes] journalisation impossible", err);
    return null;
  }
}

/**
 * Envoie une commande et journalise le résultat, quel qu'il soit.
 *
 * Ne LÈVE pas sur une erreur Smartcar : une commande refusée parce qu'une portière est
 * ouverte est une réponse légitime du véhicule, pas un plantage de CarAI. L'appelant (UI ou
 * MCP) reçoit un message lisible et l'entrée de journal correspondante.
 */
export async function envoyerCommande(params: {
  contexte: ContexteSmartcar;
  vehicleId: string;
  commande: TypeCommande;
  corps?: unknown;
  issuedBy: string;
}): Promise<ResultatCommande> {
  const { contexte, vehicleId, commande, corps, issuedBy } = params;
  const chemin = `/vehicles/${encodeURIComponent(vehicleId)}${CHEMINS_COMMANDES[commande]}`;

  try {
    const reponse = await appelSmartcar(contexte, chemin, {
      method: "POST",
      body: corps ?? {},
    });

    // Un 202 dont le corps est arrivé EN ENTIER (voir l'en-tête) est un résultat final.
    // On ne l'annonce « en cours » que si le corps ne dit rien du tout.
    const statut: CommandStatus =
      reponse.status === 202 && !reponse.data ? "pending" : "success";

    const journalId = await journaliser({
      commandType: commande,
      status: statut,
      issuedBy,
      params: corps,
      message: statut === "success" ? "Commande acceptée par Smartcar." : "Commande en cours.",
      rawResponse: reponse.data,
    });

    return {
      statut,
      message:
        statut === "success"
          ? "Commande acceptée par Smartcar. L'effet peut mettre un moment à se propager au véhicule."
          : "Commande acceptée, résultat pas encore connu.",
      journalId,
      raw: reponse.data,
    };
  } catch (err) {
    if (err instanceof ErreurSmartcar) {
      const message = messageLisible(err.details);
      const journalId = await journaliser({
        commandType: commande,
        status: "failed",
        issuedBy,
        params: corps,
        message,
        rawResponse: err.details.raw,
      });
      return { statut: "failed", message, journalId, raw: err.details.raw };
    }

    // Erreur non Smartcar (réseau, coupure). `unknown` et non `failed` : on ne sait
    // sincèrement pas si le véhicule a reçu l'ordre — l'affirmer dans un sens ou dans
    // l'autre serait faux, et c'est exactement ce que la colonne `unknown` existe pour dire.
    const message =
      err instanceof Error ? err.message : "Erreur inconnue lors de l'envoi de la commande.";
    const journalId = await journaliser({
      commandType: commande,
      status: "unknown",
      issuedBy,
      message,
    });
    return { statut: "unknown", message, journalId, raw: null };
  }
}
