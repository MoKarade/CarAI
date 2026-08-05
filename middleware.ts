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
//
// ⚠️ CarAI exclut AUSSI trois routes appelées par des machines (webhooks Smartcar et OTP,
// poll planifié). Elles portent leur propre authentification et sont énumérées UNE À UNE
// dans `ROUTES_A_AUTH_PROPRE` (lib/authGuard.ts), jamais par préfixe de dossier.
//
// La raison de les sortir du matcher plutôt que de les laisser passer par `isPublicPath`
// est le garde fail-closed ci-dessous : il répond 503 AVANT toute autre décision quand
// l'auth n'est pas configurée. Une variable d'auth absente ferait alors échouer les
// livraisons Smartcar — et six échecs consécutifs suffisent à ce que Smartcar DÉSACTIVE le
// webhook (Doc 2 §6.4). Un problème de configuration du login n'a aucune raison de couper
// l'arrivée des données.

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
  // Tout est protégé SAUF : les routes à authentification propre (hub, webhooks, poll
  // planifié), les routes Auth.js, la page de login et les assets Next.
  //
  // ⚠️ Doit rester aligné avec `ROUTES_A_AUTH_PROPRE` / `isPublicPath` (lib/authGuard.ts).
  // Next exige un littéral statique ici — impossible d'interpoler la constante — d'où la
  // duplication. `tests/auth.test.ts` compare les deux listes : c'est le seul moyen qu'une
  // route ajoutée d'un côté ne soit pas oubliée de l'autre.
  matcher: [
    "/((?!hub/summary|api/webhooks/smartcar|api/webhooks/toyota-otp|api/cron/toyota-poll|api/auth|login|_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.).*)",
  ],
};
