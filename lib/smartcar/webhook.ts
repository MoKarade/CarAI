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
  /** `TEST` / `LIVE` tel que déclaré par Smartcar (`meta.mode`). */
  mode: string | null;
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

  // ⚠️ La charge réelle vit sous `data` — confirmé par le handler de référence de
  // Smartcar : `payload.get('data', {}).get('challenge')`. La première version de ce code
  // ne regardait que sous `payload`, d'où un challenge jamais trouvé. On accepte les deux
  // (plus la racine) : ça ne coûte rien et ça survit à un renommage.
  const donnees =
    racine.data && typeof racine.data === "object"
      ? (racine.data as Record<string, unknown>)
      : {};
  const payload =
    racine.payload && typeof racine.payload === "object"
      ? (racine.payload as Record<string, unknown>)
      : {};

  const nomBrut =
    texteOuNull(lire(racine, "eventType", "eventName", "type", "event")) ?? "";
  const nom = nomBrut.toUpperCase();

  const challenge =
    texteOuNull(lire(donnees, "challenge")) ??
    texteOuNull(lire(payload, "challenge")) ??
    texteOuNull(lire(racine, "challenge"));

  // Un événement portant un challenge EST une vérification, même si le nom d'événement
  // diffère de ce qu'on attendait. On se fie au contenu, pas à l'étiquette.
  let type: TypeEvenement = "INCONNU";
  if (nom.includes("VERIFY") || challenge) type = "VERIFY";
  else if (nom.includes("VEHICLE_STATE") || nom.includes("STATE")) type = "VEHICLE_STATE";
  else if (nom.includes("ERROR")) type = "VEHICLE_ERROR";

  // Le véhicule vit sous `data.vehicle` — confirmé par une livraison RÉELLE (06/08/2026).
  const vehicule =
    donnees.vehicle && typeof donnees.vehicle === "object"
      ? (donnees.vehicle as Record<string, unknown>)
      : payload.vehicle && typeof payload.vehicle === "object"
        ? (payload.vehicle as Record<string, unknown>)
        : {};

  // `meta` porte l'identité de la livraison ET son MODE (TEST vs LIVE).
  const meta =
    racine.meta && typeof racine.meta === "object"
      ? (racine.meta as Record<string, unknown>)
      : {};

  const mode = texteOuNull(lire(meta, "mode"))?.toUpperCase() ?? null;

  return {
    type,
    // `deliveryId` identifie LA LIVRAISON ; `eventId` identifie l'ÉVÉNEMENT. Pour
    // l'idempotence, c'est la livraison qui compte : deux retentatives du même événement
    // portent le même `eventId` et doivent être traitées une seule fois.
    eventId:
      texteOuNull(lire(racine, "eventId")) ??
      texteOuNull(lire(meta, "deliveryId")) ??
      texteOuNull(lire(racine, "id", "deliveryId")),
    challenge,
    // ⚠️ `data.signals` — et SURTOUT PAS `data` tout court. La première version retombait
    // sur l'objet `data` entier (qui contient `user`, `vehicle`, `signals`) : le pipeline
    // aurait fabriqué trois pseudo-signaux nommés « user », « vehicle » et « signals ».
    signaux:
      lire(donnees, "signals") ?? lire(payload, "signals") ?? lire(racine, "signals"),
    declencheurs:
      lire(racine, "triggers") ?? lire(donnees, "triggers") ?? lire(payload, "triggers"),
    vehicleId:
      texteOuNull(lire(vehicule, "id", "vehicleId")) ??
      texteOuNull(lire(payload, "vehicleId")) ??
      texteOuNull(lire(racine, "vehicleId")),
    /**
     * `TEST` = données SIMULÉES par Smartcar, pas celles du véhicule de Marc.
     * Voir `estSimulee` — elles ne doivent jamais entrer dans l'historique.
     */
    mode,
    raw: charge,
  };
}

/**
 * La livraison contient-elle des données SIMULÉES ?
 *
 * ══ POURQUOI CE GARDE EXISTE (constat du 06/08/2026) ═════════════════════════════════
 * La première livraison reçue portait `meta.mode: "TEST"` : une Tesla Model 3 de 2020,
 * 78 432 km, 65 % de carburant — un véhicule à moteur thermique, alors que CarAI suit un
 * bZ électrique.
 *
 * Enregistrer ça ne serait pas un détail cosmétique. Ces 78 432 km entreraient dans
 * l'historique d'odomètre, donc dans la régression du bail, et CarAI annoncerait un
 * dépassement de dizaines de milliers de kilomètres sur une allocation de 112 000 — une
 * alerte financière fondée sur une voiture qui n'est pas la sienne.
 *
 * Les livraisons de test restent TRACÉES (`webhook_deliveries`) : le pipeline se prouve
 * de bout en bout, sans qu'un seul chiffre inventé n'atteigne les données.
 */
export function estSimulee(evenement: { mode: string | null }): boolean {
  return evenement.mode === "TEST" || evenement.mode === "SIMULATED";
}

/** Réponse au défi de vérification : le challenge, haché avec le token de management. */
export function reponseChallenge(challenge: string, managementToken: string): { challenge: string } {
  return { challenge: hmacHex(managementToken, challenge) };
}

/**
 * Un challenge a-t-il la FORME attendue ? `challenge_` suivi d'alphanumérique.
 *
 * ══ CE GARDE N'EST PAS COSMÉTIQUE : IL FERME UN ORACLE DE SIGNATURE ══════════════════
 *
 * L'événement de vérification n'est PAS signé — le handler de référence de Smartcar y
 * répond sans vérifier quoi que ce soit. Il faut donc bien répondre au challenge AVANT le
 * contrôle de signature, sinon la vérification échoue en 401 (vécu le 05/08/2026).
 *
 * Mais répondre à un challenge arbitraire revient à signer, sur demande, n'importe quelle
 * chaîne avec le token de management. Un tiers pourrait alors : (1) composer le corps
 * JSON d'une fausse livraison, (2) nous le faire signer en le présentant comme un
 * challenge, (3) renvoyer ce corps avec la signature obtenue — qui passerait le contrôle.
 * L'endpoint deviendrait la clé de sa propre serrure.
 *
 * La contrainte de forme casse l'attaque : un corps JSON commence par `{`, jamais par
 * `challenge_`, et ne peut pas être uniquement alphanumérique. On ne signe donc que des
 * chaînes structurellement incapables d'être une livraison. La borne de longueur ferme
 * les variantes exotiques.
 */
export function challengeBienForme(valeur: string): boolean {
  return /^challenge_[A-Za-z0-9]{1,128}$/.test(valeur);
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
