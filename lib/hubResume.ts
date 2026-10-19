// lib/hubResume.ts — la production du summary hub, et son cache.
//
// Séparé du route handler pour une raison de FRAMEWORK, pas de goût : un fichier
// `app/**/route.ts` de Next ne peut exporter que des noms connus (`GET`, `dynamic`, …).
// Y ajouter un `__viderCacheHub` pour les tests fait échouer `tsc` sur le type généré par
// Next. Le cache et son utilitaire de reset vivent donc ici, où ils sont librement
// exportables — et la route redevient ce qu'elle doit être : une adaptation de transport.
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
//
// Le cache vit ici et non dans le helper partagé `serveSummary` : ce que coûte un summary
// est l'affaire de l'app qui le produit, et d'elle seule. Le hub ne peut pas le savoir, et
// le contrat n'a pas à le deviner.

import type { HubSummary } from "@mokarade/hub-contract";
import { construireSummary } from "./hubSummary";
import { collecterInstantane } from "./vehicle/instantane";

const CACHE_MS = 60_000;

let cache: { summary: HubSummary; expireLe: number } | null = null;

/** Pour les tests : un cache de process qui survit d'un cas à l'autre les fausserait tous. */
export function __viderCacheHub(): void {
  cache = null;
}

export async function resumeHub(): Promise<HubSummary> {
  const maintenant = Date.now();
  if (cache && cache.expireLe > maintenant) return cache.summary;

  const instantane = await collecterInstantane(new Date(maintenant));
  const summary = construireSummary(instantane);

  // Seul un état SAIN est mémorisé. Voir l'avertissement en tête de fichier.
  //
  // Noter qu'une panne ne JETTE pas : CarAI publie un summary dégradé et honnête, que le
  // hub affiche tel quel. Jeter ferait répondre 500 à `serveSummary`, donc « injoignable »
  // côté hub — un diagnostic plus vague que celui que l'app sait donner elle-même.
  cache = instantane.panne ? null : { summary, expireLe: maintenant + CACHE_MS };

  return summary;
}
