// app/hub/summary/route.ts
//
// Endpoint consommé par le hub perso (hubperso.com), contrat @mokarade/hub-contract.
//
// CE FICHIER NE FAIT PLUS QUE DU TRANSPORT. Le trio 503/401/405, la comparaison du jeton
// en temps constant, `Cache-Control: no-store` et la validation avant émission vivent dans
// `serveSummary` (`@mokarade/hub-contract/endpoint`), écrits UNE fois pour toutes les apps.
// Ce que CarAI a de propre — son cache et sa règle de fraîcheur — vit dans `lib/hubResume.ts`.
//
// ⚠️ Cette route reste HORS du middleware d'authentification utilisateur : elle porte sa
// propre auth par jeton. Voir l'en-tête de `lib/authGuard.ts` — c'est le piège n°1 du
// template, vécu en production par JobAI.

import { HUB_TOKEN_HEADER, serveSummary } from "@mokarade/hub-contract/endpoint";
import { resumeHub } from "@/lib/hubResume";

/** Jamais de cache statique : le hub veut l'état courant à chaque appel. */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const { status, headers, body } = await serveSummary(
    { method: "GET", token: request.headers.get(HUB_TOKEN_HEADER) },
    { expectedToken: process.env.HUB_TOKEN, build: resumeHub },
  );
  return new Response(body, { status, headers });
}
