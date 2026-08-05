// lib/smartcar/auth.ts — authentification applicative Smartcar V3 (Doc 2 §3).
//
// DEUX COUCHES À NE PAS CONFONDRE (Doc 2 §3.1) :
//   1. M2M — un seul jeu client_id/client_secret pour toute l'app. C'est ce fichier.
//   2. Connect — le flow OAuth où Marc autorise son véhicule UNE fois. Il ne produit pas
//      un token à rafraîchir mais un `userId` à conserver (voir `lib/smartcar/connect.ts`).
//
// Le token applicatif vit 1 heure et n'a PAS de refresh token : on en redemande un.

import { parseSmartcarError, type SmartcarError } from "./errors";
import type { Env } from "@/lib/env";

export const URL_TOKEN = "https://iam.smartcar.com/oauth2/token";

/** Marge avant expiration : on renouvelle un peu tôt plutôt que de perdre un appel sur un 401. */
const MARGE_MS = 60_000;

interface TokenCache {
  token: string;
  expireLe: number;
}

let cache: TokenCache | null = null;

/** Vide le cache. Utilisé par les tests et après une erreur d'authentification. */
export function oublierToken(): void {
  cache = null;
}

export class ErreurSmartcar extends Error {
  readonly details: SmartcarError;
  constructor(details: SmartcarError) {
    super(`${details.type}: ${details.title}`);
    this.name = "ErreurSmartcar";
    this.details = details;
  }
}

export interface CredentialsSmartcar {
  clientId: string;
  clientSecret: string;
}

/**
 * Lit les identifiants d'environnement. `null` = intégration NON CONFIGURÉE — un état
 * assumé, pas une panne. L'appelant affiche « non connecté » plutôt que d'inventer un état.
 */
export function credentialsSmartcar(
  env: Env = process.env,
): CredentialsSmartcar | null {
  const clientId = env.SMARTCAR_CLIENT_ID?.trim();
  const clientSecret = env.SMARTCAR_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Renvoie un token applicatif valide, depuis le cache si possible.
 *
 * ⚠️ Le cache est un cache de PROCESSUS : vide au démarrage à froid, non partagé entre
 * instances serverless. Le taux de réutilisation est donc partiel — et c'est tout bénéfice,
 * chaque réutilisation étant un aller-retour économisé. Ce qui compte, c'est qu'aucune
 * PANNE ne soit jamais mise en cache : un échec doit rester observable et le prochain appel
 * doit réessayer.
 *
 * `maintenant` est injecté pour que l'expiration soit testable sans horloge réelle.
 */
export async function obtenirToken(params: {
  credentials: CredentialsSmartcar;
  fetchImpl?: typeof fetch;
  maintenant?: number;
}): Promise<string> {
  const { credentials, fetchImpl = fetch, maintenant = Date.now() } = params;

  if (cache && cache.expireLe > maintenant) return cache.token;

  const corps = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });

  const reponse = await fetchImpl(URL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: corps.toString(),
  });

  const brut = await reponse.text();
  let json: unknown = null;
  try {
    json = brut ? JSON.parse(brut) : null;
  } catch {
    json = { detail: brut.slice(0, 500) };
  }

  if (!reponse.ok) {
    // Rien n'est mis en cache sur un échec : le prochain appel doit vraiment réessayer.
    throw new ErreurSmartcar(parseSmartcarError(reponse.status, json));
  }

  const objet = (json ?? {}) as Record<string, unknown>;
  const token = typeof objet.access_token === "string" ? objet.access_token : null;
  if (!token) {
    throw new ErreurSmartcar(
      parseSmartcarError(reponse.status, {
        type: "SERVER",
        title: "Réponse de token Smartcar inexploitable",
        detail: "Le champ access_token est absent de la réponse.",
      }),
    );
  }

  const dureeSecondes =
    typeof objet.expires_in === "number" && Number.isFinite(objet.expires_in)
      ? objet.expires_in
      : 3600;

  cache = { token, expireLe: maintenant + dureeSecondes * 1000 - MARGE_MS };
  return token;
}
