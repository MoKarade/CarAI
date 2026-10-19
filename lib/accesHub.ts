// lib/accesHub.ts — « ai-je le droit d'être ici ? », posée au hub.
//
// Depuis l'ADR 0001 de Hubperso, CarAI ne fabrique plus de session : elle lit le cookie
// que le hub a posé sur `.hubperso.com`. Mais lire une session ne dit pas qui a le DROIT
// d'en avoir une pour CETTE app précisément — la liste vit dans le hub (table `acces`),
// gérée depuis sa page d'administration. Ce module pose la question :
//
//   POST https://hubperso.com/api/acces   { "email": "…" }   → { "acces": true|false }
//
// authentifié par `HUB_TOKEN`, le MÊME secret que CarAI utilise déjà pour publier son
// propre résumé sur `/hub/summary` (lib/hubToken.ts). Le hub s'en sert pour identifier
// l'appelant : aucun nouveau secret à générer ni à poser sur Vercel.
//
// ── CACHE D'UNE MINUTE, POSITIFS SEULEMENT ──────────────────────────────────────────
//
// Sans cache, chaque lecture de session ferait un aller-retour réseau vers le hub. Avec un
// cache plus long, retirer un accès mettrait trop de temps à mordre. Une minute est le
// compromis assumé côté hub (Hubperso/lib/personnes.ts) — CarAI reprend le même délai pour
// que « révoqué » veuille dire la même chose partout.
//
// UN REFUS N'EST JAMAIS MIS EN CACHE : sinon quelqu'un qu'on vient d'ajouter dans
// l'administration du hub attendrait jusqu'à une minute avant de pouvoir entrer —
// précisément le moment où l'on regarde si ça marche.
//
// ── ÉCHEC FERMÉ ──────────────────────────────────────────────────────────────────────
//
// Hub injoignable, jeton absent, réponse inattendue : tout répond `false`. Le hub devient
// un point de panne unique pour l'accès à CarAI — assumé dans l'ADR 0001, au même titre
// que pour le hub lui-même : mieux vaut refuser que laisser entrer sur un accroc réseau.

import { URL_HUB } from "./connexionHub";

const HUB_TOKEN_HEADER = "x-hub-token";

/** Durée de vie d'une réponse POSITIVE mémorisée. */
export const CACHE_ACCES_MS = 60_000;

const cache = new Map<string, number>();

/** Pour les tests, et pour rendre le cache observable plutôt que magique. */
export function viderCacheAcces(): void {
  cache.clear();
}

function normaliser(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** La seule partie qui touche le réseau — extraite pour être remplaçable en test. */
async function demanderAuHub(adresse: string, jeton: string): Promise<boolean> {
  const reponse = await fetch(new URL("/api/acces", URL_HUB), {
    method: "POST",
    headers: { "content-type": "application/json", [HUB_TOKEN_HEADER]: jeton },
    body: JSON.stringify({ email: adresse }),
    cache: "no-store",
  });
  if (!reponse.ok) return false;
  const corps: unknown = await reponse.json();
  return (
    typeof corps === "object" &&
    corps !== null &&
    "acces" in corps &&
    (corps as { acces: unknown }).acces === true
  );
}

/**
 * Cette adresse a-t-elle accès à CarAI, d'après le hub ?
 *
 * `env` et `interroger` sont injectables pour les tests — ni variable d'environnement
 * réelle, ni requête réseau réelle, à fournir pour éprouver le cache et l'échec fermé.
 */
export async function aAccesHub(
  email: string | null | undefined,
  env: Partial<NodeJS.ProcessEnv> = process.env,
  maintenantMs: number = Date.now(),
  interroger: (adresse: string, jeton: string) => Promise<boolean> = demanderAuHub,
): Promise<boolean> {
  const adresse = normaliser(email);
  if (!adresse) return false;

  const expiration = cache.get(adresse);
  if (expiration !== undefined && expiration > maintenantMs) return true;

  const jeton = env.HUB_TOKEN?.trim();
  if (!jeton) return false;

  try {
    const accorde = await interroger(adresse, jeton);
    if (!accorde) {
      cache.delete(adresse);
      return false;
    }
    cache.set(adresse, maintenantMs + CACHE_ACCES_MS);
    return true;
  } catch (erreur) {
    console.error("[accesHub] requête au hub impossible :", erreur);
    return false;
  }
}
