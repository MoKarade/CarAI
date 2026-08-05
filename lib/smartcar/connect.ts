// lib/smartcar/connect.ts — flow d'autorisation Smartcar Connect (Doc 2 §3.4-3.5).
//
// Marc connecte son véhicule UNE fois. Le flow ne produit pas un token à rafraîchir mais un
// `userId` à conserver (Doc 2 §3.1) — c'est la différence structurelle avec V2.0, et c'est
// pour ça que CarAI n'a aucune logique de refresh côté utilisateur.

export const URL_CONNECT = "https://connect.smartcar.com/oauth/authorize";

/**
 * Permissions demandées au Connect (Doc 2 §3.5).
 *
 * `read_diagnostics` est VOLONTAIREMENT absente : le System Status et les codes défaut sont
 * réservés aux marques GM et FCA (Doc 2 §5.5). La demander ne débloquerait rien pour Toyota
 * et allongerait l'écran d'autorisation d'une permission inutile — or une liste de
 * permissions qu'on ne lit plus est une liste qu'on accepte sans regarder.
 */
export const PERMISSIONS = [
  "read_vehicle_info",
  "read_battery",
  "read_charge",
  "control_charge",
  "read_odometer",
  "read_location",
  "read_security",
  "control_security",
  "read_tires",
  "read_service_history",
] as const;

/** Erreurs que le Connect peut renvoyer (Doc 2 §3.4), traduites pour Marc. */
export const MESSAGES_ERREUR_CONNECT: Readonly<Record<string, string>> = {
  access_denied: "Autorisation refusée. Le véhicule n'a pas été connecté.",
  invalid_subscription:
    "L'abonnement Toyota Connected Services n'est pas actif. Vérifie-le dans l'app Toyota, onglet abonnements, puis recommence.",
  no_vehicles: "Aucun véhicule n'est rattaché à ce compte Toyota.",
  vehicle_incompatible:
    "Ce véhicule n'est pas compatible avec Smartcar pour les données demandées.",
  configuration_error:
    "Configuration Smartcar incorrecte (identifiants ou URL de redirection). Vérifie le tableau de bord Smartcar.",
  server_error: "Smartcar a rencontré une erreur. Réessaie dans quelques minutes.",
};

export function messageErreurConnect(code: string | null): string {
  if (!code) return "Le Connect a échoué sans préciser pourquoi.";
  return (
    MESSAGES_ERREUR_CONNECT[code] ?? `Le Connect a échoué (${code}).`
  );
}

/**
 * Construit l'URL vers laquelle envoyer Marc pour autoriser son véhicule.
 *
 * `state` est une valeur aléatoire à vérifier au retour : sans elle, un tiers pourrait
 * amener Marc à rattacher un AUTRE véhicule à son CarAI (CSRF sur le flow OAuth).
 */
export function construireUrlConnect(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  mode?: "live" | "test" | "simulated";
  singleSelect?: boolean;
}): string {
  const { clientId, redirectUri, state, mode = "live", singleSelect = true } = params;

  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: PERMISSIONS.join(" "),
    state,
    mode,
  });
  // CarAI ne suit qu'UN véhicule : forcer la sélection unique évite d'en rattacher
  // plusieurs par inadvertance, ce que le plan gratuit ne couvre de toute façon pas.
  if (singleSelect) query.set("single_select", "true");

  return `${URL_CONNECT}?${query.toString()}`;
}

/** Lit la réponse du Connect. Ne décide de rien : sépare seulement succès et échec. */
export function lireRetourConnect(parametres: URLSearchParams):
  | { ok: true; code: string; userId: string | null; state: string | null }
  | { ok: false; message: string; state: string | null } {
  const state = parametres.get("state");
  const erreur = parametres.get("error");

  if (erreur) {
    return { ok: false, message: messageErreurConnect(erreur), state };
  }

  const code = parametres.get("code");
  if (!code) {
    return {
      ok: false,
      message: "Réponse du Connect incomplète : ni code d'autorisation ni erreur.",
      state,
    };
  }

  // Selon la configuration, Smartcar renvoie directement le `userId` (Doc 2 §3.4). Quand il
  // est absent, l'appelant le récupérera en échangeant le code.
  return { ok: true, code, userId: parametres.get("user_id"), state };
}
