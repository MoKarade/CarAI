// lib/smartcar/errors.ts — taxonomie des erreurs Smartcar V3 (Doc 2 §7). FONCTIONS PURES.
//
// Pourquoi une taxonomie plutôt qu'un `catch (e) { console.error(e) }` : les sept familles
// d'erreurs de Smartcar appellent SEPT réactions différentes, et les confondre coûte cher.
// « Le véhicule n'est pas compatible avec ce signal » est un fait permanent qu'il faut
// mémoriser pour cesser de le demander ; « l'OEM ne répond pas » est passager et mérite un
// nouvel essai ; « ta connexion est cassée » exige que Marc refasse le flow Connect, ce
// qu'aucun backoff ne remplacera. Les traiter pareil, c'est soit boucler pour rien, soit
// abandonner une donnée récupérable.

/** Familles d'erreurs documentées par Smartcar V3. */
export type SmartcarErrorType =
  | "AUTHENTICATION"
  | "BILLING"
  | "COMPATIBILITY"
  | "CONNECTED_SERVICES_ACCOUNT"
  | "PERMISSION"
  | "RATE_LIMIT"
  | "UPSTREAM"
  | "VEHICLE_STATE"
  | "VALIDATION"
  | "SERVER"
  | "UNKNOWN";

/** Action à prendre, telle que Smartcar la suggère dans `resolution.type`. */
export type Resolution = "RETRY_LATER" | "REAUTHENTICATE" | "CONTACT_SUPPORT" | "NONE";

export interface SmartcarError {
  type: SmartcarErrorType;
  code: string | null;
  title: string;
  detail: string;
  status: number;
  resolution: Resolution;
  /** Charge utile brute — jamais jetée : c'est elle qui explique l'inattendu. */
  raw: unknown;
}

const TYPES_CONNUS = new Set<SmartcarErrorType>([
  "AUTHENTICATION",
  "BILLING",
  "COMPATIBILITY",
  "CONNECTED_SERVICES_ACCOUNT",
  "PERMISSION",
  "RATE_LIMIT",
  "UPSTREAM",
  "VEHICLE_STATE",
  "VALIDATION",
  "SERVER",
]);

const RESOLUTIONS_CONNUES = new Set<Resolution>([
  "RETRY_LATER",
  "REAUTHENTICATE",
  "CONTACT_SUPPORT",
]);

function texte(valeur: unknown, defaut: string): string {
  return typeof valeur === "string" && valeur.trim() ? valeur.trim() : defaut;
}

/**
 * Traduit un corps d'erreur Smartcar en objet typé. Ne LÈVE jamais : une erreur mal formée
 * reste une erreur, et la remplacer par une exception de parsing masquerait la vraie cause.
 *
 * `status` sert de filet quand le corps est vide ou illisible (page HTML d'une passerelle,
 * coupure réseau) : le code HTTP suffit à classer, même sans corps exploitable.
 */
export function parseSmartcarError(status: number, corps: unknown): SmartcarError {
  const objet =
    corps && typeof corps === "object" ? (corps as Record<string, unknown>) : {};

  const typeBrut = typeof objet.type === "string" ? objet.type.toUpperCase() : "";
  const type: SmartcarErrorType = TYPES_CONNUS.has(typeBrut as SmartcarErrorType)
    ? (typeBrut as SmartcarErrorType)
    : typeDepuisStatut(status);

  const resolutionBrute =
    objet.resolution && typeof objet.resolution === "object"
      ? (objet.resolution as Record<string, unknown>).type
      : undefined;
  const resolutionTexte =
    typeof resolutionBrute === "string" ? resolutionBrute.toUpperCase() : "";
  const resolution: Resolution = RESOLUTIONS_CONNUES.has(resolutionTexte as Resolution)
    ? (resolutionTexte as Resolution)
    : resolutionParDefaut(type);

  return {
    type,
    code: typeof objet.code === "string" ? objet.code : null,
    title: texte(objet.title, `Erreur Smartcar (HTTP ${status})`),
    detail: texte(objet.detail, "Aucun détail fourni par Smartcar."),
    status,
    resolution,
    raw: corps,
  };
}

/** Classement de repli quand le corps ne porte pas de `type` exploitable. */
function typeDepuisStatut(status: number): SmartcarErrorType {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 429) return "RATE_LIMIT";
  if (status === 430) return "BILLING";
  if (status === 409) return "VEHICLE_STATE";
  if (status === 501) return "COMPATIBILITY";
  if (status === 502 || status === 503 || status === 504) return "UPSTREAM";
  if (status >= 500) return "SERVER";
  if (status === 400 || status === 422) return "VALIDATION";
  return "UNKNOWN";
}

function resolutionParDefaut(type: SmartcarErrorType): Resolution {
  switch (type) {
    case "AUTHENTICATION":
      return "REAUTHENTICATE";
    case "RATE_LIMIT":
    case "UPSTREAM":
    case "SERVER":
      return "RETRY_LATER";
    case "BILLING":
    case "CONNECTED_SERVICES_ACCOUNT":
      return "CONTACT_SUPPORT";
    default:
      return "NONE";
  }
}

/**
 * true si un NOUVEL essai a une chance d'aboutir. Sert à décider d'un backoff, jamais à
 * masquer l'échec : l'appelant journalise dans tous les cas.
 */
export function estRejouable(err: SmartcarError): boolean {
  return err.resolution === "RETRY_LATER";
}

/**
 * true si le véhicule ne SAIT PAS faire ce qu'on lui demande — un fait durable, pas un
 * incident. Retenter est inutile ; l'appelant doit CESSER de demander ce signal.
 *
 * C'est le cas attendu pour tout ce que le Doc 2 §4.2 range en hypothèse : la table de
 * correspondance des signaux n'a pas pu être vérifiée contre la doc Smartcar (bloquée par
 * la politique réseau), donc certains signaux demandés n'existeront pas pour le bZ. Ce
 * n'est pas une panne : c'est la découverte du périmètre réel.
 */
export function estIncompatibilite(err: SmartcarError): boolean {
  return err.type === "COMPATIBILITY";
}

/** true si la connexion Smartcar↔Toyota de Marc est en cause (abonnement, compte OEM). */
export function estProblemeDeCompte(err: SmartcarError): boolean {
  return err.type === "CONNECTED_SERVICES_ACCOUNT" || err.type === "BILLING";
}

/** Message court destiné à Marc — pas la trace brute, mais jamais un euphémisme non plus. */
export function messageLisible(err: SmartcarError): string {
  switch (err.type) {
    case "AUTHENTICATION":
      return "Smartcar refuse les identifiants de CarAI. Vérifie SMARTCAR_CLIENT_ID / SMARTCAR_CLIENT_SECRET.";
    case "BILLING":
      return "Limite du plan Smartcar atteinte — le plan gratuit couvre un seul véhicule.";
    case "COMPATIBILITY":
      return "Le véhicule ne prend pas en charge cette donnée ou cette commande via Smartcar.";
    case "CONNECTED_SERVICES_ACCOUNT":
      return "Problème côté compte Toyota (abonnement Connected Services inactif ou connexion à refaire).";
    case "PERMISSION":
      return "Permission non accordée lors du Connect. Il faut refaire l'autorisation en la cochant.";
    case "RATE_LIMIT":
      return "Trop de requêtes vers Smartcar — nouvel essai plus tard.";
    case "UPSTREAM":
      return "Toyota ne répond pas à Smartcar. Ce n'est pas un problème de CarAI ; nouvel essai plus tard.";
    case "VEHICLE_STATE":
      return `Le véhicule n'est pas dans un état permettant cette commande (${err.code ?? "état non précisé"}).`;
    case "VALIDATION":
      return "Requête refusée par Smartcar (paramètre invalide).";
    default:
      return err.detail;
  }
}
