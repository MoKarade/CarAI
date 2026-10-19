// lib/mcp/metadonnees.ts — le corps des deux réponses de découverte OAuth, en un endroit.
//
// Deux routes servent ces métadonnées ; elles doivent dire EXACTEMENT la même chose sur
// l'issuer, sinon la découverte échoue avec un message qui n'aide personne.

import { contexteMcp, reponse503, NO_STORE } from "@/lib/mcp/contexte";

export function reponseMetadonnees(request: Request, type: "as" | "pr"): Response {
  const ctx = contexteMcp(request);
  if (!ctx) return reponse503();
  const corps =
    type === "as" ? ctx.auth.authorizationServerMetadata() : ctx.auth.protectedResourceMetadata();
  return Response.json(corps, { headers: NO_STORE });
}
