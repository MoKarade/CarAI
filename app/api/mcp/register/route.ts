// app/api/mcp/register/route.ts — enregistrement dynamique de client (DCR, RFC 7591).
//
// claude.ai s'enregistre lui-même : il n'y a pas de « client ID à copier » à fournir à Marc.
// Sans stockage — le `client_secret` est DÉRIVÉ du `client_id` par HMAC, donc n'importe
// quelle instance serverless le revérifie sans base de données.
//
// La garde qui compte est l'ALLOWLIST des `redirect_uris` : un client qui s'enregistrerait
// avec une redirection vers un domaine tiers pourrait faire aboutir le code d'autorisation
// chez lui. Elle est appliquée ici ET re-appliquée à l'autorisation (ceinture + bretelles).

// Pas de `lireCorps` ici : la DCR est spécifiée en JSON uniquement, et `redirect_uris` est un
// TABLEAU — un corps form-urlencoded ne saurait pas le porter.
import { contexteMcp, reponse503, reponseErreurOAuth, NO_STORE } from "@/lib/mcp/contexte";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const ctx = contexteMcp(request);
  if (!ctx) return reponse503();

  try {
    const corps = await request
      .clone()
      .json()
      .catch(() => null) as { redirect_uris?: unknown } | null;

    const uris = Array.isArray(corps?.redirect_uris)
      ? (corps.redirect_uris as unknown[]).filter((u): u is string => typeof u === "string")
      : [];

    return Response.json(ctx.auth.registerClient(uris), { status: 201, headers: NO_STORE });
  } catch (err) {
    return reponseErreurOAuth(err);
  }
}
