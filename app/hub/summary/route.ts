// app/hub/summary/route.ts
//
// Endpoint consommé par le hub perso (hubperso.com), contrat @mokarade/hub-contract v1.
// Le hub appelle GET /hub/summary avec le header x-hub-token ; 401 sinon (échec fermé),
// réponse toujours en Cache-Control: no-store (un summary est un instantané).
//
// PAR DÉFAUT : renvoie un summary « building » honnête (no-fake-data) — l'app démarre
// « en construction », zéro chiffre inventé. AU FORK, quand ton moteur est prêt :
// remplace `buildingSummary(APP, …)` par un vrai HubSummary construit sur tes données,
// validé par HubSummarySchema.parse(...) avant d'être renvoyé.
//
// ⚠️ Cette route reste HORS du middleware d'authentification utilisateur : elle porte sa
// propre auth par jeton. Voir l'en-tête de `lib/authGuard.ts` — c'est le piège n°1 de ce
// template, vécu en production.
//
// ── CE QUE LE HUB FAIT DE TA RÉPONSE, ET CE QUE ÇA T'IMPOSE ──────────────────────────
//
// 1. IL POLLE VITE. Le hub rafraîchit toutes les ~15 s tant qu'un onglet est ouvert.
//    Si produire ton summary coûte quelque chose de BORNÉ (exécution Apps Script, appel
//    d'API tierce, requête lourde), METS UN CACHE COURT ICI — pas dans le hub, il ne peut
//    pas savoir ce que ça te coûte. DriveAI a découvert que 19 polls sur 20 renvoyaient
//    des octets identiques, chacun au prix d'une exécution comptée sur un quota DUR.
//    Règle : si la donnée sous-jacente ne bouge qu'aux N minutes, un cache de N/5 dans ce
//    handler ne perd aucune fraîcheur et divise la facture d'autant. Ne JAMAIS mettre en
//    cache une PANNE — un échec doit rester observable et le prochain appel doit réessayer.
//
// 2. IL AFFICHE `dataAsOf`, PAS `generatedAt`. `generatedAt` = quand tu as fabriqué la
//    réponse (toujours « maintenant »). `dataAsOf` = quand la DONNÉE a été rafraîchie pour
//    la dernière fois. Si ton moteur tourne par tick, publie `dataAsOf` : sans lui, le hub
//    ne peut pas distinguer « à jour » de « figé depuis trois jours ».
//
// 3. IL SOMME LES COÛTS PAR PÉRIODE. Le bloc `usage` (contrat v1.1) porte
//    `cost: { amount, currency, period }` avec period = 'total' | 'mois' | 'jour'.
//    ⚠️ Le hub ne fusionne JAMAIS deux périodes différentes (il l'a fait, ça produisait un
//    montant qui n'existe pas). Choisis `total` (cumul depuis toujours) sauf raison
//    explicite : c'est ce que publient BatchChef et FinanceAI, donc leurs coûts s'agrègent
//    entre eux. Une app qui publie `mois` apparaîtra dans un total séparé.
//    Si tu n'as AUCUN coût réel à publier, n'envoie PAS de bloc `usage` : l'app s'affiche
//    « non suivie », ce qui est honnête. Un `amount: 0` inventé serait de la fausse donnée.
//
// 4. IL RENDS TES `href` VIA UN FILTRE. Seuls http/https deviennent cliquables. Publie des
//    URLs absolues.

import {
  HUB_TOKEN_HEADER,
  buildingSummary,
  type HubSummary,
} from "@mokarade/hub-contract";
import { hubTokenValid } from "@/lib/hubToken";

// ── À PERSONNALISER AU FORK ──────────────────────────────────────────────────
const APP: HubSummary["app"] = {
  id: "app-template", // kebab-case, stable
  name: "App Template", // 1 à 30 caractères
  url: "https://app-template.hubperso.com",
  color: "#6366f1", // hex 6 digits, couleur d'accent du widget
};
// ─────────────────────────────────────────────────────────────────────────────

const NO_STORE = { "Cache-Control": "no-store" } as const;

// Jamais de cache statique : le hub veut l'état courant à chaque appel.
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  const expected = process.env.HUB_TOKEN ?? "";
  if (!expected) {
    // 503, pas 500 : sans jeton configuré, l'intégration hub est DÉSACTIVÉE — un état
    // assumé, pas une erreur interne. C'est la convention de tous les consommateurs
    // réels (BatchChef, DriveAI, JobAI — ADR-0001 de JobAI) ; le template était le
    // seul à répondre 500.
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

  // TODO au fork : remplacer par un vrai summary quand le moteur est actif.
  const summary = buildingSummary(APP, {
    alertLabel: "App en construction — moteur pas encore actif.",
  });

  return Response.json(summary, { headers: NO_STORE });
}
