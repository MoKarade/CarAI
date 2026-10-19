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
 * ✅ VÉRIFIÉS le 2026-08-14 contre la doc officielle (`docs/SMARTCAR_API.md`, section
 * « Vehicle Commands »), que Marc a pu récupérer depuis son navigateur — `smartcar.com`
 * reste bloqué par la politique d'egress des sessions Claude.
 *
 * Ce que la vérification a corrigé : `set_charge_limit` pointait sur
 * `/commands/charge/limit`, écrit de mémoire. Le vrai chemin est `/commands/charge/set-limit`.
 * La commande renvoyait donc un 404 depuis toujours — jamais détecté parce qu'elle n'avait
 * jamais été essayée sur la vraie voiture. Les quatre autres chemins étaient corrects.
 *
 * La concentration des chemins ICI est ce qui a rendu la correction triviale : une ligne.
 * Garder cette propriété.
 *
 * ⚠️ Les horaires de charge (`charge-schedules`) N'ONT PAS de segment `/commands/` — leur
 * chemin est `/vehicles/{id}/charge-schedules/…` directement. C'est une exception de l'API,
 * pas une coquille : voir `CHEMINS_HORAIRES_CHARGE` plus bas.
 */
export const CHEMINS_COMMANDES: Readonly<Record<TypeCommande, string>> = {
  lock: "/commands/security/lock",
  unlock: "/commands/security/unlock",
  start_charge: "/commands/charge/start",
  stop_charge: "/commands/charge/stop",
  set_charge_limit: "/commands/charge/set-limit",
};

/**
 * Commandes DOCUMENTÉES que CarAI n'implémente pas encore (doc du 2026-08-14).
 *
 * Volontairement des constantes inertes : le chemin est connu, le CORPS de requête ne l'est
 * pas (les pages de doc replient « Show child attributes »). Coder un appel sans son corps
 * produirait un 400 déguisé en fonctionnalité. À brancher quand le schéma sera récupéré.
 *
 * ⚠️ Noter l'absence de `/commands/` sur les horaires : c'est le chemin réel de l'API.
 */
export const CHEMINS_NON_IMPLEMENTES = {
  set_destination: "/commands/navigation/set-destination",
  horaire_charge_quotidien: "/charge-schedules/daily",
  horaire_charge_hebdomadaire: "/charge-schedules/weekly",
  horaire_charge_semaine_travail: "/charge-schedules/workweek",
  /** DELETE, avec l'identifiant d'horaire en fin de chemin. */
  horaire_charge_suppression: "/charge-schedules/{scheduleId}",
} as const;

/**
 * Bornes de la limite de charge — VÉRIFIÉES contre le schéma `ChargeLimitAttributes` de la
 * spec OpenAPI (2026-08-14) : `percent`, ENTIER, `minimum: 50`, `maximum: 100`.
 *
 * ⚠️ Le cadrage avait supposé une FRACTION (0,5–1,0) faute d'accès à la doc. C'était faux.
 */
export const LIMITE_CHARGE_MIN = 50;
export const LIMITE_CHARGE_MAX = 100;

/**
 * Valide une limite de charge et la ramène en POURCENTAGE ENTIER (50–100), la seule forme
 * que l'API accepte.
 *
 * Accepte quand même une fraction en ENTRÉE (0,8) parce que les deux se disent naturellement
 * — « mets la limite à 80 » et « mets-la à 0.8 ». La conversion est sans ambiguïté ici,
 * contrairement au cas de l'état de charge (`signals.ts`) : 0,8 et 80 sont tous deux valides
 * et distinguables, alors que 1 % et 100 % ne le sont pas.
 *
 * L'arrondi est explicite : `percent` est un entier au schéma, et envoyer 80.5 ferait
 * échouer la validation côté Smartcar avec un 400 que rien n'expliquerait à Marc.
 */
export function normaliserLimiteCharge(
  valeur: number,
): { percent: number } | { erreur: string } {
  if (!Number.isFinite(valeur)) return { erreur: "Limite de charge invalide." };

  const percent = Math.round(valeur > 1 ? valeur : valeur * 100);
  if (percent < LIMITE_CHARGE_MIN || percent > LIMITE_CHARGE_MAX) {
    return {
      erreur: `Limite de charge hors bornes : Smartcar accepte de ${LIMITE_CHARGE_MIN} % à ${LIMITE_CHARGE_MAX} %.`,
    };
  }
  return { percent };
}

/**
 * Enveloppe de corps commune aux commandes paramétrées (`SetChargeLimitRequest`,
 * `SetNavigationDestinationRequest`, horaires de charge) : `{ data: { attributes } }`.
 */
export function corpsCommande(attributes: Record<string, unknown>): unknown {
  return { data: { attributes } };
}

/** Statut d'exécution tel que la réponse le déclare (`ExecutionStatus` de la spec). */
type StatutLu = { statut: CommandStatus; message: string };

/**
 * Lit le VRAI résultat d'une commande dans le corps de la réponse.
 *
 * ══ LE BUG QUE CETTE FONCTION CORRIGE ════════════════════════════════════════════════
 * Le code d'origine déduisait le statut du code HTTP seul : tout 200/202 porteur d'un corps
 * était annoncé « success ». Or la spec OpenAPI (2026-08-14) est formelle — le corps d'un
 * 200 comme d'un 202 contient `data.attributes.status.value`, qui vaut `SUCCESS`, **`FAILURE`**
 * ou `PENDING`, et l'exemple officiel d'un `security-lock` en échec est servi SOUS UN 202 :
 *
 *   status: { value: FAILURE, error: { code: LOCK_FAILED,
 *             detail: "The vehicle was unable to lock its doors." } }
 *
 * CarAI annonçait donc « Verrouillé » quand la voiture avait refusé — exactement le
 * « j'ai verrouillé et la voiture était ouverte » que l'en-tête de ce fichier dit vouloir
 * élucider. Le HTTP dit que Smartcar a traité la demande ; SEUL le corps dit ce que le
 * VÉHICULE a fait.
 *
 * `suggestedUserMessage` est privilégié quand il existe : la spec le décrit comme « a
 * user-facing message that can be displayed directly to end users ».
 */
export function lireStatutExecution(data: unknown, httpStatus: number): StatutLu {
  const attributs = (data as { data?: { attributes?: unknown } } | null)?.data?.attributes as
    | { status?: { value?: unknown; error?: Record<string, unknown> } }
    | undefined;
  const valeur = attributs?.status?.value;

  if (valeur === "SUCCESS") {
    return { statut: "success", message: "Commande exécutée par le véhicule." };
  }

  if (valeur === "FAILURE") {
    const err = attributs?.status?.error;
    const detail =
      (typeof err?.suggestedUserMessage === "string" && err.suggestedUserMessage) ||
      (typeof err?.detail === "string" && err.detail) ||
      (typeof err?.title === "string" && err.title) ||
      "sans détail";
    const code = typeof err?.code === "string" ? ` (${err.code})` : "";
    return { statut: "failed", message: `Le véhicule a refusé la commande : ${detail}${code}` };
  }

  if (valeur === "PENDING") {
    return { statut: "pending", message: "Commande acceptée, résultat pas encore connu." };
  }

  // Statut absent ou inconnu : ne PAS inventer un succès. Un 202 sans corps lisible est
  // « en cours » ; tout le reste est `unknown`, la colonne qui existe pour dire « on ne
  // sait sincèrement pas ». La réponse brute est journalisée pour trancher après coup.
  if (httpStatus === 202) {
    return { statut: "pending", message: "Commande acceptée, résultat pas encore connu." };
  }
  return {
    statut: "unknown",
    message:
      "Smartcar a répondu sans déclarer de statut d'exécution. Réponse brute gardée au journal.",
  };
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

    // Le statut se lit DANS LE CORPS, jamais dans le code HTTP : un 200 comme un 202 peut
    // porter `status.value: FAILURE`. Voir `lireStatutExecution`.
    const { statut, message } = lireStatutExecution(reponse.data, reponse.status);

    const journalId = await journaliser({
      commandType: commande,
      status: statut,
      issuedBy,
      params: corps,
      message,
      rawResponse: reponse.data,
    });

    return { statut, message, journalId, raw: reponse.data };
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
