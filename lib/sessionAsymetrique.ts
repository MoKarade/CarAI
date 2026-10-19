// lib/sessionAsymetrique.ts — phase 1 de la migration vers la session signée (plan
// `auth-asym-hubperso`, Option A : C:\dev\_pc-local\agence\pages\plans\auth-asym-hubperso.md).
//
// Hubperso sera seul à signer (clé privée dans son seul projet Vercel) ; les satellites,
// dont CarAI, ne font que LIRE avec les clés publiques. Ce module n'importe aucune fonction
// de signature et ne reçoit jamais de clé privée : par construction, CarAI ne peut pas
// fabriquer de session.
//
// Phase 1 = additive et sans effet observable : Hubperso n'émet pas encore ce cookie,
// `lib/session.ts` continue de retomber sur l'ancien (Auth.js/JWE) tant qu'il n'y en a pas.
// `AUTH_SECRET` et next-auth restent en place — leur retrait est la phase 3.
//
// Clés publiques : JAMAIS inventées. `HUB_SESSION_PUBLIC_KEYS` porte le JWKS publié par
// le hub (1 à 2 `kid` pendant une rotation), en JSON. Absente ou illisible → aucune session
// asymétrique n'est acceptée (repli silencieux sur l'ancien cookie, jamais d'exception).

import { verifierSession, type IdentiteSession } from "@mokarade/hub-contract/session";

/** Nom du cookie signé posé par Hubperso (plan §3), domaine `.hubperso.com`. */
export const NOM_COOKIE_ASYMETRIQUE = "__Secure-hub.session";

function clesPubliques(env: Partial<NodeJS.ProcessEnv>): unknown {
  const brut = env.HUB_SESSION_PUBLIC_KEYS?.trim();
  if (!brut) return null;
  try {
    return JSON.parse(brut);
  } catch {
    return null;
  }
}

/**
 * Vérifie le cookie de session signé et rend l'identité, ou `null` si quoi que ce soit ne va
 * pas (cookie absent, clés publiques non configurées, signature invalide, algorithme autre
 * qu'ES256, `kid` inconnu, expiré...). Ne lève jamais — `verifierSession` du contrat porte
 * cette garantie, testée là-bas ; ce module ajoute la lecture de la variable d'environnement.
 */
export async function lireSessionAsymetrique(
  cookieValue: string | undefined,
  env: Partial<NodeJS.ProcessEnv> = process.env,
): Promise<IdentiteSession | null> {
  if (!cookieValue) return null;
  const cles = clesPubliques(env);
  if (!cles) return null;
  return verifierSession(cookieValue, cles);
}
