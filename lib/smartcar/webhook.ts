// lib/smartcar/webhook.ts — vérification et lecture des livraisons de webhook (Doc 2 §6).
// FONCTIONS PURES (le HMAC est du calcul, pas de l'I/O) : testable sans serveur.
//
// Trois choses s'y jouent, dans cet ordre strict :
//   1. AUTHENTICITÉ — un endpoint public qui écrit en base sans vérifier la signature
//      accepte les données de n'importe qui. La signature se calcule sur le corps BRUT,
//      avant tout `JSON.parse` : re-sérialiser change les octets et invalide le HMAC.
//   2. CHALLENGE — Smartcar ne livre RIEN tant que l'endpoint n'a pas répondu au défi de
//      vérification initial. Tant qu'il échoue, le silence ressemble à « pas de données ».
//   3. LECTURE — l'événement porte son identifiant (idempotence) et ses signaux.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Header porteur de la signature. Comparé en minuscules : les en-têtes HTTP sont insensibles à la casse. */
export const HEADER_SIGNATURE = "sc-signature";

/**
 * HMAC-SHA256 hexadécimal d'une charge utile, clé = token de management Smartcar.
 * Utilisé pour vérifier une livraison ET pour répondre au challenge — c'est le même calcul.
 */
export function hmacHex(cle: string, charge: string): string {
  return createHmac("sha256", cle).update(charge).digest("hex");
}

/**
 * Compare deux signatures en TEMPS CONSTANT.
 *
 * `timingSafeEqual` exige des buffers de même longueur et LÈVE sinon — d'où la vérification
 * de longueur en amont. Elle ne fuite rien : la longueur d'un HMAC-SHA256 hex est toujours
 * 64, elle est publique.
 */
export function signaturesEgales(attendue: string, fournie: string): boolean {
  const a = Buffer.from(attendue, "utf8");
  const b = Buffer.from(fournie, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Vérifie l'authenticité d'une livraison à partir du corps BRUT.
 *
 * ⚠️ `corpsBrut` doit être la chaîne exacte reçue (`await request.text()`), jamais un objet
 * re-sérialisé : `JSON.stringify(JSON.parse(x))` réordonne les clés et change les espaces,
 * donc produit un HMAC différent. Le handler lit le texte UNE fois et ne le reconstruit pas.
 *
 * Échec fermé : sans token de management configuré, aucune livraison n'est acceptée. Un
 * webhook non vérifié est une porte ouverte en écriture sur la base.
 */
export function livraisonAuthentique(params: {
  corpsBrut: string;
  signature: string | null;
  managementToken: string | undefined;
}): boolean {
  const { corpsBrut, signature, managementToken } = params;
  if (!managementToken?.trim() || !signature?.trim()) return false;
  return signaturesEgales(hmacHex(managementToken, corpsBrut), signature.trim());
}

export type TypeEvenement = "VERIFY" | "VEHICLE_STATE" | "VEHICLE_ERROR" | "INCONNU";

export interface EvenementWebhook {
  type: TypeEvenement;
  /** Identifiant unique de la livraison — clé d'idempotence (Doc 2 §6.3). */
  eventId: string | null;
  /** Défi à renvoyer haché, présent uniquement sur un événement VERIFY. */
  challenge: string | null;
  /** Signaux livrés, forme brute — la normalisation vit dans `signals.ts`. */
  signaux: unknown;
  /** Raisons de la livraison. Sert à comprendre POURQUOI, jamais à filtrer QUOI traiter. */
  declencheurs: unknown;
  vehicleId: string | null;
  raw: unknown;
}

function lire(objet: Record<string, unknown>, ...cles: string[]): unknown {
  for (const cle of cles) {
    if (objet[cle] !== undefined && objet[cle] !== null) return objet[cle];
  }
  return null;
}

function texteOuNull(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() ? valeur.trim() : null;
}

/**
 * Lit une charge utile de webhook, tolérante sur l'emplacement exact des champs.
 *
 * Même raison que dans `signals.ts` : la doc Smartcar n'a pas pu être consultée (politique
 * d'egress). L'enveloppe connue place les données sous `payload`, mais certains événements
 * les portent à la racine. On regarde les deux — quinze lignes contre un pipeline muet.
 */
export function lireEvenement(charge: unknown): EvenementWebhook {
  const racine =
    charge && typeof charge === "object" ? (charge as Record<string, unknown>) : {};
  const payload =
    racine.payload && typeof racine.payload === "object"
      ? (racine.payload as Record<string, unknown>)
      : {};

  const nomBrut =
    texteOuNull(lire(racine, "eventName", "eventType", "type", "event")) ?? "";
  const nom = nomBrut.toUpperCase();

  const challenge =
    texteOuNull(lire(payload, "challenge")) ?? texteOuNull(lire(racine, "challenge"));

  // Un événement portant un challenge EST une vérification, même si le nom d'événement
  // diffère de ce qu'on attendait. On se fie au contenu, pas à l'étiquette.
  let type: TypeEvenement = "INCONNU";
  if (nom.includes("VERIFY") || challenge) type = "VERIFY";
  else if (nom.includes("VEHICLE_STATE") || nom.includes("STATE")) type = "VEHICLE_STATE";
  else if (nom.includes("ERROR")) type = "VEHICLE_ERROR";

  const vehicule =
    payload.vehicle && typeof payload.vehicle === "object"
      ? (payload.vehicle as Record<string, unknown>)
      : {};

  return {
    type,
    eventId: texteOuNull(lire(racine, "eventId", "id", "deliveryId")),
    challenge,
    signaux: lire(payload, "signals", "data") ?? lire(racine, "signals", "data"),
    declencheurs: lire(payload, "triggers") ?? lire(racine, "triggers"),
    vehicleId:
      texteOuNull(lire(vehicule, "id", "vehicleId")) ??
      texteOuNull(lire(payload, "vehicleId")) ??
      texteOuNull(lire(racine, "vehicleId")),
    raw: charge,
  };
}

/** Réponse au défi de vérification : le challenge, haché avec le token de management. */
export function reponseChallenge(challenge: string, managementToken: string): { challenge: string } {
  return { challenge: hmacHex(managementToken, challenge) };
}

/**
 * Depuis combien de temps aucune livraison n'est arrivée, et faut-il s'en inquiéter.
 *
 * Raison d'être (Doc 2 §6.4) : après 6 échecs de livraison consécutifs, Smartcar DÉSACTIVE
 * le webhook. Le flux s'arrête alors sans que rien ne devienne rouge — l'app tourne, les
 * pages s'affichent, et les données cessent simplement d'arriver. Comme la fraîcheur Toyota
 * est déjà de 30 à 60 minutes, un silence de quelques heures ne se remarque pas à l'œil.
 *
 * Le seuil par défaut (6 h) est délibérément lâche : il vaut mieux une alerte tardive et
 * sûre qu'une alerte qui crie à chaque nuit où la voiture n'a pas bougé.
 */
export function silenceWebhook(params: {
  derniereLivraison: Date | null;
  maintenant: Date;
  seuilHeures?: number;
}): { heures: number | null; silencieux: boolean } {
  const { derniereLivraison, maintenant, seuilHeures = 6 } = params;
  if (!derniereLivraison) return { heures: null, silencieux: false };
  const heures = (maintenant.getTime() - derniereLivraison.getTime()) / 3_600_000;
  return { heures, silencieux: heures >= seuilHeures };
}
