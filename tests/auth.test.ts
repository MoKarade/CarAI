// tests/auth.test.ts — le garde d'accès de l'app privée.
//
// Ces tests partent avec le fork : ce sont eux qui empêchent de re-casser les deux
// défauts que les apps réelles ont dû corriger en production.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isAuthorizedEmail } from "../lib/authorized";
import { isAuthConfigured } from "../lib/authConfigured";
import { decideGuard, isPublicPath, ROUTES_A_AUTH_PROPRE } from "../lib/authGuard";

describe("isAuthorizedEmail — une seule adresse admise", () => {
  it("accepte l'adresse autorisée, insensible à la casse et aux espaces", () => {
    expect(isAuthorizedEmail(" Marc@Example.COM ", "marc@example.com")).toBe(true);
  });

  it("refuse toute autre adresse", () => {
    expect(isAuthorizedEmail("autre@example.com", "marc@example.com")).toBe(false);
  });

  // Fail-closed : une allowlist non configurée ne doit JAMAIS tout laisser passer.
  it("refuse quand l'allowlist est absente ou vide", () => {
    expect(isAuthorizedEmail("marc@example.com", undefined)).toBe(false);
    expect(isAuthorizedEmail("marc@example.com", "   ")).toBe(false);
  });

  it("refuse quand le candidat est absent", () => {
    expect(isAuthorizedEmail(null, "marc@example.com")).toBe(false);
  });
});

describe("isAuthConfigured — fail-closed", () => {
  it("exige AUTH_SECRET ET AUTHORIZED_EMAIL", () => {
    expect(isAuthConfigured({ AUTH_SECRET: "s", AUTHORIZED_EMAIL: "a@b.c" })).toBe(true);
    expect(isAuthConfigured({ AUTH_SECRET: "s" })).toBe(false);
    expect(isAuthConfigured({ AUTHORIZED_EMAIL: "a@b.c" })).toBe(false);
    expect(isAuthConfigured({})).toBe(false);
  });

  it("une valeur blanche ne compte pas comme configurée", () => {
    expect(isAuthConfigured({ AUTH_SECRET: "  ", AUTHORIZED_EMAIL: "a@b.c" })).toBe(false);
  });
});

describe("isPublicPath", () => {
  // ⚠️ LE test à ne jamais supprimer. Si /hub/summary tombe derrière la session, le hub
  // reçoit une redirection HTML au lieu du JSON et affiche « injoignable » en permanence,
  // alors que l'app marche parfaitement dans un navigateur. Bug vécu par JobAI.
  it("laisse /hub/summary PUBLIC — il porte sa propre auth par jeton", () => {
    expect(isPublicPath("/hub/summary")).toBe(true);
  });

  it("laisse passer login, routes Auth.js et assets", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/auth/callback/google")).toBe(true);
    expect(isPublicPath("/_next/static/chunk.js")).toBe(true);
    expect(isPublicPath("/icon.svg")).toBe(true);
  });

  it("protège les pages de données", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/detail/42")).toBe(false);
  });

  // Les routes appelées par des MACHINES portent leur propre authentification et doivent
  // échapper au garde de session. Pour Smartcar, l'enjeu est concret : une route qui répond
  // 302 ou 503 compte comme un échec de livraison, et six échecs consécutifs suffisent à ce
  // que Smartcar DÉSACTIVE le webhook — le flux de données s'arrêterait sans rien de rouge.
  it("laisse publiques les routes à authentification propre", () => {
    for (const route of ROUTES_A_AUTH_PROPRE) {
      expect(isPublicPath(route), `${route} devrait être publique`).toBe(true);
    }
  });

  // ⚠️ Le contre-test : la liste est EXPLICITE, jamais un préfixe de dossier. Une route de
  // webhook ajoutée demain sans être déclarée doit tomber DERRIÈRE le garde — le mauvais
  // côté de l'oubli doit être le côté sûr (leçon JobAI : « un garde qui s'exclut d'un
  // dossier entier s'en exclut pour toujours »).
  it("ne rend PAS public un webhook non déclaré", () => {
    expect(isPublicPath("/api/webhooks/inconnu")).toBe(false);
    expect(isPublicPath("/api/cron/autre-chose")).toBe(false);
  });
});

// Deux listes disent la même chose à deux endroits : `ROUTES_A_AUTH_PROPRE` et le matcher
// du middleware. Next exige un littéral statique dans le matcher, donc la duplication est
// inévitable — mais elle n'a pas à être silencieuse. Ce test est le seul mécanisme qui
// empêche une route ajoutée d'un côté d'être oubliée de l'autre.
describe("alignement matcher ↔ isPublicPath", () => {
  const middleware = readFileSync(resolve(process.cwd(), "middleware.ts"), "utf8");

  it("chaque route à auth propre est exclue du matcher du middleware", () => {
    for (const route of ROUTES_A_AUTH_PROPRE) {
      const sansSlash = route.replace(/^\//, "");
      expect(
        middleware.includes(sansSlash),
        `${route} est dans ROUTES_A_AUTH_PROPRE mais absente du matcher de middleware.ts`,
      ).toBe(true);
    }
  });
});

describe("decideGuard", () => {
  it("laisse passer une session valide", () => {
    expect(decideGuard({ isAuthenticated: true, pathname: "/" })).toEqual({ type: "next" });
  });

  it("redirige une PAGE non authentifiée vers /login, en gardant la destination", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/detail", search: "?a=1" })).toEqual({
      type: "redirect",
      location: "/login?callbackUrl=%2Fdetail%3Fa%3D1",
    });
  });

  // Un client machine attend du JSON : une redirection HTML serait illisible pour lui.
  it("répond 401 pour une route API non authentifiée, jamais une redirection", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/api/truc" })).toEqual({
      type: "unauthorized",
    });
  });

  it("le endpoint du hub passe même sans session", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/hub/summary" })).toEqual({
      type: "next",
    });
  });

  // La page /donnees liste tout ce que la base contient (comptes, dates, codes de
  // signaux) : elle DOIT rester derrière le garde. Ce test la nomme explicitement pour
  // qu'une future exclusion du matcher « pour dépanner » fasse tomber quelque chose.
  it("l'inventaire /donnees est PRIVÉ : non authentifié ⇒ redirection login", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/donnees" })).toEqual({
      type: "redirect",
      location: "/login?callbackUrl=%2Fdonnees",
    });
  });

  // L'export CSV livre l'HISTORIQUE COMPLET, coordonnées GPS incluses : c'est la route la
  // plus sensible de l'app. Nommée ici pour la même raison que /donnees.
  it("l'export CSV /api/donnees/export est PRIVÉ : non authentifié ⇒ 401", () => {
    expect(
      decideGuard({ isAuthenticated: false, pathname: "/api/donnees/export" }),
    ).toEqual({ type: "unauthorized" });
  });
});
