// app/hub/summary/route.ts
//
// Endpoint consommé par le hub perso (hubperso.com), contrat @mokarade/hub-contract v1.
// Le hub appelle GET /hub/summary avec le header x-hub-token ; 401 sinon (échec fermé),
// réponse toujours en Cache-Control: no-store (un summary est un instantané).
//
// ⚠️ Cette route reste HORS du middleware d'authentification utilisateur : elle porte sa
// propre auth par jeton. Voir l'en-tête de `lib/authGuard.ts` — c'est le piège n°1 du
// template, vécu en production par JobAI.
//
// ── LE CACHE COURT EST DÉLIBÉRÉ ──────────────────────────────────────────────────────
// Le hub rafraîchit toutes les ~15 s tant qu'un onglet est ouvert. Les données de CarAI,
// elles, ne bougent qu'aux 30-60 min (fraîcheur Toyota via Smartcar) ou aux 2 h (poll
// Toyota). Sans cache, dix-neuf appels sur vingt referaient les mêmes requêtes — dont une
// agrégation d'odomètre sur un historique conservé indéfiniment — pour rendre des octets
// identiques. Un cache de 60 s ne perd donc AUCUNE fraîcheur réelle.
//
// ⚠️ Une PANNE n'est JAMAIS mise en cache. Un échec doit rester observable et le prochain
// appel doit réessayer — sinon une coupure de base d'une seconde se figerait pour une
// minute, et pire, se réparerait toute seule à l'écran sans qu'on ait rien vu.

import { HUB_TOKEN_HEADER, type HubSummary } from "@mokarade/hub-contract";
import { hubTokenValid } from "@/lib/hubToken";
import { construireSummary } from "@/lib/hubSummary";
import { collecterInstantane } from "@/lib/vehicle/instantane";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Jamais de cache statique : le hub veut l'état courant à chaque appel. */
export const dynamic = "force-dynamic";

const CACHE_MS = 60_000;

let cache: { summary: HubSummary; expireLe: number } | null = null;

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.HUB_TOKEN ?? "";
  if (!expected) {
    // 503, pas 500 : sans jeton configuré, l'intégration hub est DÉSACTIVÉE — un état
    // assumé, pas une erreur interne. C'est la convention de tous les consommateurs réels.
    return Response.json(
      { error: "hub désactivé : HUB_TOKEN non configuré côté serveur." },
      { status: 503, headers: NO_STORE },
    );
  }

  if (!hubTokenValid(request.headers.get(HUB_TOKEN_HEADER), expected)) {
    return Response.json(
      { error: `Header ${HUB_TOKEN_HEADER} absent ou invalide.` },
      { status: 401, headers: NO_STORE },
    );
  }

  const maintenant = Date.now();
  if (cache && cache.expireLe > maintenant) {
    return Response.json(cache.summary, { headers: NO_STORE });
  }

  const instantane = await collecterInstantane(new Date(maintenant));
  const summary = construireSummary(instantane);

  // Seul un état SAIN est mémorisé. Voir l'avertissement en tête de fichier.
  if (!instantane.panne) {
    cache = { summary, expireLe: maintenant + CACHE_MS };
  } else {
    cache = null;
  }

  return Response.json(summary, { headers: NO_STORE });
}
