// app/api/mcp/token/route.ts — échange du code contre les jetons, et rotation du refresh.
//
// Deux grants, pas un de plus : `authorization_code` et `refresh_token`. Tout le reste est
// refusé explicitement — un serveur d'autorisation qui accepte des grants qu'il n'a pas
// pensés est la façon habituelle de se faire contourner.

import { contexteMcp, reponse503, reponseErreurOAuth, lireCorps, NO_STORE } from "@/lib/mcp/contexte";
import { OAuthError } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const ctx = contexteMcp(request);
  if (!ctx) return reponse503();

  try {
    const c = await lireCorps(request);
    const clientId = c.client_id ?? "";
    if (!clientId) throw new OAuthError("invalid_request", "client_id manquant.");

    if (c.grant_type === "authorization_code") {
      const jetons = ctx.auth.exchangeCode({
        code: c.code ?? "",
        clientId,
        clientSecret: c.client_secret,
        redirectUri: c.redirect_uri ?? "",
        codeVerifier: c.code_verifier ?? "",
      });
      return Response.json(jetons, { headers: NO_STORE });
    }

    if (c.grant_type === "refresh_token") {
      const jetons = ctx.auth.refreshGrant({
        refreshToken: c.refresh_token ?? "",
        clientId,
        clientSecret: c.client_secret,
      });
      return Response.json(jetons, { headers: NO_STORE });
    }

    throw new OAuthError(
      "unsupported_grant_type",
      "Seuls authorization_code et refresh_token sont acceptés.",
    );
  } catch (err) {
    return reponseErreurOAuth(err);
  }
}
