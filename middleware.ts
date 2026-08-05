// middleware.ts
//
// Garde global : l'app est PRIVÉE, rien n'est servi sans session valide. La décision est
// déléguée à `decideGuard` (lib/authGuard.ts, testé unitairement) ; ce fichier ne fait que
// la brancher sur NextAuth.
//
// ⚠️ Le matcher DOIT rester aligné avec `isPublicPath`. En particulier `hub/summary` en
// est EXCLU : il porte sa propre auth par jeton. L'y inclure renverrait au hub une
// redirection HTML au lieu du JSON — le widget afficherait « injoignable » en permanence
// alors que l'app marche (bug vécu par JobAI). Voir l'en-tête de lib/authGuard.ts.
//
// ⚠️ Toute NOUVELLE route qui affiche des données doit rester DERRIÈRE ce garde : ne
// jamais l'ajouter aux exclusions du matcher « pour dépanner ».

import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { decideGuard } from "@/lib/authGuard";
import { isAuthConfigured } from "@/lib/authConfigured";

export default auth((req) => {
  // Fail-closed : sans AUTH_SECRET/AUTHORIZED_EMAIL, Auth.js loggue MissingSecret mais
  // laisse passer (constaté en préproduction). On refuse alors TOUT ce qui est protégé.
  if (!isAuthConfigured()) {
    return NextResponse.json(
      {
        error: "auth_unconfigured",
        message:
          "Authentification non configurée (AUTH_SECRET / AUTHORIZED_EMAIL manquants). Accès refusé.",
      },
      { status: 503 },
    );
  }

  const decision = decideGuard({
    isAuthenticated: Boolean(req.auth),
    pathname: req.nextUrl.pathname,
    search: req.nextUrl.search,
  });

  switch (decision.type) {
    case "next":
      return;
    case "unauthorized":
      return NextResponse.json(
        { error: "unauthenticated", message: "Authentification requise." },
        { status: 401 },
      );
    case "redirect":
      return NextResponse.redirect(new URL(decision.location, req.nextUrl.origin));
  }
});

export const config = {
  // Tout est protégé SAUF : l'endpoint du hub (auth par jeton), les routes Auth.js, la
  // page de login et les assets Next. Doit rester aligné avec `isPublicPath`.
  matcher: [
    "/((?!hub/summary|api/auth|login|_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.).*)",
  ],
};
