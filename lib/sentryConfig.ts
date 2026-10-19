// lib/sentryConfig.ts — réglages Sentry communs au serveur, au navigateur et au script d'essai.
//
// Pur et sans effet de bord : ne lit aucun environnement, ne démarre rien. Le DSN arrive en
// paramètre, et SANS DSN Sentry reste éteint (l'app démarre et se construit sans erreur).
//
// Donnée personnelle (décision de Marc, 15/10/2026 : aucune donnée perso en ligne) : CarAI sert la
// position du véhicule, son kilométrage et les habitudes de charge. Ni l'adresse IP, ni les cookies,
// ni les en-têtes, ni le corps ou la chaîne de requête, ni le fil des appels et des journaux
// (`breadcrumbs`) ne partent JAMAIS. `sendDefaultPii` reste faux ET `retirerDonneesPersonnelles`
// nettoie l'événement en dernier recours. Verrou : `tests/sentryConfig.test.ts`.
//
// ⚠️ Drizzle met les PARAMÈTRES de la requête dans le message de ses erreurs
// (« Failed query: … params: 48.85,2.35,… ») : une panne de base enverrait des coordonnées ou un
// kilométrage dans le texte de l'erreur. Le message est gardé, la ligne `params:` est remplacée.

/** Le sous-ensemble d'un événement Sentry que l'on nettoie (types structurels, aucun import). */
export interface EvenementNettoyable {
  message?: string;
  request?: {
    data?: unknown;
    cookies?: unknown;
    headers?: unknown;
    query_string?: unknown;
  };
  user?: unknown;
  breadcrumbs?: unknown;
  exception?: { values?: { value?: string }[] };
}

/** Ce qui remplace les paramètres d'une requête SQL dans un message d'erreur. */
export const PARAMETRES_RETIRES = "params: [retirés]";

/** Retire tout ce qui peut identifier une personne ou un trajet ; garde le message, la pile et le chemin. */
export function retirerDonneesPersonnelles<T extends EvenementNettoyable>(evenement: T): T {
  if (evenement.request) {
    delete evenement.request.data;
    delete evenement.request.cookies;
    delete evenement.request.headers;
    delete evenement.request.query_string;
  }
  delete evenement.user;
  delete evenement.breadcrumbs;
  for (const valeur of evenement.exception?.values ?? []) {
    if (typeof valeur.value === "string") {
      valeur.value = valeur.value.replace(/params:[\s\S]*$/i, PARAMETRES_RETIRES);
    }
  }
  return evenement;
}

export interface OptionsSentry {
  dsn: string | undefined;
  enabled: boolean;
  sendDefaultPii: false;
  tracesSampleRate: 0;
  beforeSend: typeof retirerDonneesPersonnelles;
}

/**
 * Options de `Sentry.init`. `dsn` vide ou absent = éteint : aucun événement ne part.
 * Pas de traces de performance (`tracesSampleRate` à 0) : le besoin est de voir les ERREURS.
 */
export function optionsSentry(dsn: string | undefined): OptionsSentry {
  const propre = dsn?.trim() ? dsn.trim() : undefined;
  return {
    dsn: propre,
    enabled: propre !== undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: retirerDonneesPersonnelles,
  };
}
