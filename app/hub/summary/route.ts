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
