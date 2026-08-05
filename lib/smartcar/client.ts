// lib/smartcar/client.ts — appels HTTP directs à l'API Smartcar V3 (Doc 2 §1, §2, §4).
//
// PAS DE SDK, délibérément (Doc 2 §1) : les SDKs backend officiels sont en mode maintenance
// jusqu'au 1ᵉʳ décembre 2026, et Smartcar recommande lui-même l'appel HTTP direct. Une
// dépendance de moins, et aucune surprise le jour où le SDK cesse d'être publié.
//
// V3 EXCLUSIVEMENT. Tout exemple trouvé en ligne mentionnant `api.smartcar.com/v2.0/…` est
// obsolète pour ce projet — V2.0 est annoncée dépréciée pour le Q4 2026.

import {
  ErreurSmartcar,
  credentialsSmartcar,
  obtenirToken,
  oublierToken,
  type CredentialsSmartcar,
} from "./auth";
import { parseSmartcarError } from "./errors";

export const BASE_VEHICLE = "https://vehicle.api.smartcar.com/v3";
export const BASE_MANAGEMENT = "https://management.api.smartcar.com/v3";
export const BASE_COMPATIBILITY = "https://compatibility.api.smartcar.com/v3";

/** En-têtes de fraîcheur documentés (Doc 2 §5.6) — toujours capturés, jamais devinés. */
export const HEADER_DATA_AGE = "sc-data-age";
export const HEADER_FETCHED_AT = "sc-fetched-at";

export interface ReponseSmartcar<T> {
  data: T;
  /** Quand le VÉHICULE a enregistré la donnée (`SC-Data-Age`). */
  dataAge: Date | null;
  /** Quand Smartcar l'a récupérée de l'OEM (`SC-Fetched-At`). */
  fetchedAt: Date | null;
  status: number;
}

function dateEntete(valeur: string | null): Date | null {
  if (!valeur) return null;
  const d = new Date(valeur);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface ContexteSmartcar {
  credentials: CredentialsSmartcar;
  /** Issu du flow Connect. Requis sur tout appel touchant un véhicule (Doc 2 §3.3). */
  userId: string;
  fetchImpl?: typeof fetch;
}

/**
 * Contexte complet, ou `null` si l'intégration n'est pas encore branchée.
 *
 * Renvoyer `null` plutôt que lever : « pas encore configuré » est un ÉTAT NORMAL de CarAI
 * au démarrage, pas une erreur. L'app doit afficher « connecte ton véhicule », pas une
 * trace de pile.
 */
export async function contexteSmartcar(
  lireUserId: () => Promise<string | null>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ContexteSmartcar | null> {
  const credentials = credentialsSmartcar(env);
  if (!credentials) return null;
  const userId = await lireUserId();
  if (!userId) return null;
  return { credentials, userId };
}

/**
 * Appel authentifié à l'API véhicule.
 *
 * Sur 401/403, le token en cache est oublié et l'appel est rejoué UNE fois : un token
 * expiré est le seul échec qu'un simple renouvellement corrige, et il arrive
 * mécaniquement toutes les heures. Une seule reprise, jamais une boucle — si le second
 * essai échoue aussi, ce sont les identifiants qui sont en cause, et retenter n'y changera
 * rien qu'une facture d'appels.
 */
export async function appelSmartcar<T = unknown>(
  contexte: ContexteSmartcar,
  chemin: string,
  options: { method?: string; body?: unknown; base?: string } = {},
): Promise<ReponseSmartcar<T>> {
  const { method = "GET", body, base = BASE_VEHICLE } = options;
  const fetchImpl = contexte.fetchImpl ?? fetch;

  const executer = async (token: string): Promise<Response> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "sc-user-id": contexte.userId,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";

    return fetchImpl(`${base}${chemin}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let token = await obtenirToken({ credentials: contexte.credentials, fetchImpl });
  let reponse = await executer(token);

  if (reponse.status === 401 || reponse.status === 403) {
    oublierToken();
    token = await obtenirToken({ credentials: contexte.credentials, fetchImpl });
    reponse = await executer(token);
  }

  const brut = await reponse.text();
  let json: unknown = null;
  try {
    json = brut ? JSON.parse(brut) : null;
  } catch {
    // Une réponse non-JSON sur une API JSON est presque toujours une page d'erreur de
    // passerelle. On garde le début du texte : c'est ce qui permettra de comprendre.
    json = { detail: brut.slice(0, 500) };
  }

  if (!reponse.ok) throw new ErreurSmartcar(parseSmartcarError(reponse.status, json));

  return {
    data: json as T,
    dataAge: dateEntete(reponse.headers.get(HEADER_DATA_AGE)),
    fetchedAt: dateEntete(reponse.headers.get(HEADER_FETCHED_AT)),
    status: reponse.status,
  };
}

/**
 * Lit des signaux à la demande (Doc 2 §4.1).
 *
 * Le mode nominal de CarAI est le WEBHOOK (Doc 2 §6) : Smartcar pousse, on écrit. Cette
 * fonction sert aux cas que le push ne couvre pas — un « rafraîchir maintenant » déclenché
 * par Marc, ou le rattrapage d'une livraison manquée.
 */
export async function lireSignaux(
  contexte: ContexteSmartcar,
  vehicleId: string,
  codes: string[],
): Promise<ReponseSmartcar<unknown>> {
  return appelSmartcar(contexte, `/vehicles/${encodeURIComponent(vehicleId)}/signals`, {
    method: "POST",
    body: { signals: codes },
  });
}

/** Liste les véhicules autorisés par le Connect. */
export async function listerVehicules(
  contexte: ContexteSmartcar,
): Promise<ReponseSmartcar<unknown>> {
  return appelSmartcar(contexte, "/vehicles");
}

/** Historique d'entretien (Doc 2 §5.4). Peu fréquent : appelé à la demande, pas par webhook. */
export async function lireHistoriqueEntretien(
  contexte: ContexteSmartcar,
  vehicleId: string,
): Promise<ReponseSmartcar<unknown>> {
  return appelSmartcar(
    contexte,
    `/vehicles/${encodeURIComponent(vehicleId)}/service/history`,
  );
}

/**
 * Compatibilité du véhicule (Doc 2 §4.3). API PUBLIQUE : aucune authentification.
 *
 * Le résultat se met en cache au moins 24 h — recommandation explicite de Smartcar, la
 * donnée ne bougeant qu'une fois par jour. ⚠️ Un bZ 2026 est un modèle très récent : il
 * peut ne pas encore figurer dans ce jeu de données faute de connexions réelles observées.
 * Une absence ne prouve donc PAS une incompatibilité — c'est une absence de preuve, et le
 * code ne doit jamais la traiter comme un refus.
 */
export async function lireCompatibilite(params: {
  region?: string;
  make?: string;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const { region = "CA", make = "TOYOTA", fetchImpl = fetch } = params;
  const url = `${BASE_COMPATIBILITY}/compatible-vehicles?filter[region]=${encodeURIComponent(region)}&filter[make]=${encodeURIComponent(make)}`;

  const reponse = await fetchImpl(url, { headers: { Accept: "application/json" } });
  const brut = await reponse.text();
  let json: unknown = null;
  try {
    json = brut ? JSON.parse(brut) : null;
  } catch {
    json = { detail: brut.slice(0, 500) };
  }
  if (!reponse.ok) throw new ErreurSmartcar(parseSmartcarError(reponse.status, json));
  return json;
}
