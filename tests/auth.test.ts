// tests/auth.test.ts — le garde d'accès de l'app privée.
//
// Ces tests partent avec le fork : ce sont eux qui empêchent de re-casser les deux
// défauts que les apps réelles ont dû corriger en production.

import { describe, it, expect } from "vitest";
import { isAuthorizedEmail } from "../lib/authorized";
import { isAuthConfigured } from "../lib/authConfigured";
import { decideGuard, isPublicPath } from "../lib/authGuard";

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
});
