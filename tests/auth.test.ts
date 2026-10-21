// tests/auth.test.ts — le garde d'accès de l'app privée.
//
// Ces tests partent avec le fork : ce sont eux qui empêchent de re-casser les deux
// défauts que les apps réelles ont dû corriger en production.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { isAuthorizedEmail } from "../lib/authorized";
import { isAuthConfigured } from "../lib/authConfigured";
import { decideGuard, isPublicPath, ROUTES_A_AUTH_PROPRE } from "../lib/authGuard";
// Le compilateur de matcher de Next lui-même (pas une réimplémentation) : le test voit le
// même verdict que la prod.
// `getMiddlewareMatchers` est exporté à l'exécution mais absent des déclarations de types
// de Next : on lui donne sa signature ici.
import * as infosPage from "next/dist/build/analysis/get-page-static-info";
import { getMiddlewareRouteMatcher } from "next/dist/shared/lib/router/utils/middleware-route-matcher";

const { getMiddlewareMatchers } = infosPage as unknown as {
  getMiddlewareMatchers: (
    matcher: string[],
    nextConfig: object,
  ) => Parameters<typeof getMiddlewareRouteMatcher>[0];
};

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
    // Les écrans réels, nommés un à un. `/trajets` affiche les positions et les horaires
    // de Marc — c'est la page la plus sensible de l'app. Le défaut du garde est déjà de
    // tout protéger ; ce test verrouille ce défaut au lieu de lui faire confiance.
    expect(isPublicPath("/trajets")).toBe(false);
    expect(isPublicPath("/recharges")).toBe(false);
    expect(isPublicPath("/donnees")).toBe(false);
    expect(isPublicPath("/analyse")).toBe(false);
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

  // Chaque exclusion du matcher est un lookahead `(?!…)` : SANS ancre de fin, « hub/summary »
  // exclurait aussi tout chemin qui COMMENCE par ces lettres (/hub/summaryX, /api/mcp/x…),
  // qui échapperait alors au garde sans que personne ne le voie. On compile donc le matcher
  // avec le compilateur de Next lui-même et on vérifie le vrai verdict, chemin par chemin.
  describe("verdict réel du matcher (compilateur de Next)", () => {
    const brut = middleware.match(/"(\/\(\(\?!.*)",/)?.[1];
    const source = JSON.parse(`"${brut ?? ""}"`) as string;
    const garde = getMiddlewareRouteMatcher(getMiddlewareMatchers([source], {}));
    const gardee = (chemin: string) => garde(chemin, {} as never, {});

    it("le motif du matcher est trouvé dans middleware.ts", () => {
      expect(brut).toBeDefined();
    });

    // Les vraies routes et fichiers qui DOIVENT échapper au garde, lus dans app/, public/ et
    // les réécritures de next.config.mjs — rien d'inventé.
    it.each([
      ...ROUTES_A_AUTH_PROPRE,
      // Auth.js : app/api/auth/[...nextauth] (toutes ses sous-routes).
      "/api/auth/session",
      "/api/auth/csrf",
      "/api/auth/callback/google",
      "/login",
      // Réécritures RFC 8414 / 9728 avec suffixe de ressource (next.config.mjs).
      "/.well-known/oauth-protected-resource/api/mcp",
      "/.well-known/oauth-authorization-server/api/mcp",
      // Assets Next et fichiers de public/.
      "/_next/static/chunks/main.js",
      "/_next/image",
      "/favicon.ico",
      "/manifest.webmanifest",
      "/sw.js",
      "/icon-192.png",
      "/apple-touch-icon.png",
      "/modele/bz.glb",
      "/draco/draco_decoder.wasm",
    ])("%s reste HORS garde", (chemin) => {
      expect(gardee(chemin)).toBe(false);
    });

    // Les « voisins » de chaque exclusion : même début, autre chemin. Ils DOIVENT rester
    // gardés — c'est précisément ce que l'ancre de fin garantit.
    it.each([
      "/hub/summaryX",
      "/hub/summary/x",
      "/api/sante-x",
      "/api/sante/x",
      "/api/webhooks/smartcarX",
      "/api/webhooks/smartcar/x",
      "/api/webhooks/toyota-otpX",
      "/api/webhooks/toyota-otp/x",
      "/api/cron/toyota-pollX",
      "/api/cron/toyota-poll/x",
      "/api/cron/smartcar-pollX",
      "/api/cron/smartcar-poll/x",
      "/api/export/sauvegardeX",
      "/api/export/sauvegarde/x",
      "/api/export",
      "/api/mcpX",
      "/api/mcp/x",
      "/api/mcp/meta",
      "/api/mcp/meta/asX",
      "/api/mcp/meta/prX",
      "/api/mcp/authorizeX",
      "/api/mcp/tokenX",
      "/api/mcp/registerX",
      "/.well-known/oauth-authorization-serverX",
      "/.well-known/oauth-protected-resourceX",
      "/api/authX",
      "/loginX",
      "/_next/imageX",
      "/_next/staticX",
      "/favicon.icoX/x",
      "/sw.js/x",
      "/api/mcp.x/token",
    ])("%s reste GARDÉ", (chemin) => {
      expect(gardee(chemin)).toBe(true);
    });

    // Témoins : les pages et les routes API privées restent gardées.
    it.each([
      "/",
      "/donnees",
      "/analyse",
      "/reglages",
      "/api/donnees/export",
      "/api/connect",
      "/api/connect/callback",
    ])("%s (privée) reste GARDÉE", (chemin) => {
      expect(gardee(chemin)).toBe(true);
    });
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

  // La vigie de l'Atelier (#204) n'a pas de session Google. Sans cette ligne, elle
  // recevrait une redirection HTML au lieu du JSON attendu et ne verrait jamais une panne
  // de base — le même défaut que /hub/summary, avec un autre appelant.
  it("la santé publique /api/sante passe même sans session", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/api/sante" })).toEqual({
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

  it("l'onglet /analyse est PRIVÉ : non authentifié ⇒ redirection login", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/analyse" })).toEqual({
      type: "redirect",
      location: "/login?callbackUrl=%2Fanalyse",
    });
  });

  // Le poll planifié n'a pas de session Google : il DOIT échapper au garde de session,
  // sinon il recevrait une redirection HTML et n'écrirait jamais rien.
  it("le poll Smartcar planifié porte sa propre auth (hors garde de session)", () => {
    expect(decideGuard({ isAuthenticated: false, pathname: "/api/cron/smartcar-poll" })).toEqual({
      type: "next",
    });
  });
  // INSTALLABILITÉ (PWA). Ces chemins DOIVENT rester accessibles sans session, sinon l'app
  // cesse d'être installable — en silence, sans erreur nulle part. Le navigateur récupère
  // le manifeste SANS cookies : derrière le garde, il recevrait la redirection vers /login.
  // Chromium exige en plus `/sw.js` pour proposer l'installation.
  //
  // Ils passent aujourd'hui par la règle générale « dernier segment avec une extension » ;
  // ce test empêche qu'un resserrement de `isPublicPath` les emporte sans qu'on le voie.
  // Aucun ne porte de donnée du véhicule — les deux assertions de fin le vérifient.
  it("laisse passer les fichiers requis pour l'installation, et RIEN de plus", () => {
    for (const chemin of [
      "/manifest.webmanifest",
      "/sw.js",
      "/icon-192.png",
      "/icon-512.png",
      "/icon-maskable-512.png",
      "/apple-touch-icon.png",
    ]) {
      expect(isPublicPath(chemin), `${chemin} devrait être public`).toBe(true);
    }
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/analyse")).toBe(false);
  });
});

// ══ TOUTE NOUVELLE PAGE EST GARDÉE, SANS QU'ON AIT À Y PENSER ════════════════════════
//
// Le risque n'est jamais la page qu'on écrit aujourd'hui — c'est la sixième. Ce test
// DÉCOUVRE les pages depuis `app/` au lieu de lire une liste écrite à la main : une page
// ajoutée demain sans être gardée le fait échouer, alors qu'une liste recopiée vieillirait
// en silence (patron `routesGardees` de JobAI).
describe("toute page de l'app est derrière le middleware", () => {
  const racine = resolve(__dirname, "..", "app");

  /** Les routes de PAGE (`page.tsx`), en chemin d'URL. */
  function pagesDecouvertes(dossier: string, prefixe = ""): string[] {
    const sorties: string[] = [];
    for (const entree of readdirSync(dossier, { withFileTypes: true })) {
      if (entree.name.startsWith("_") || entree.name === "api") continue;
      const chemin = resolve(dossier, entree.name);
      if (entree.isDirectory()) {
        // Les segments entre parenthèses sont des groupes : ils ne comptent pas dans l'URL.
        const segment = entree.name.startsWith("(") ? "" : `/${entree.name}`;
        sorties.push(...pagesDecouvertes(chemin, `${prefixe}${segment}`));
      } else if (entree.name === "page.tsx") {
        sorties.push(prefixe === "" ? "/" : prefixe);
      }
    }
    return sorties;
  }

  const pages = pagesDecouvertes(racine);

  it("découvre bien les pages (garde contre un test qui passerait à vide)", () => {
    expect(pages.length).toBeGreaterThanOrEqual(5);
    expect(pages).toContain("/");
    expect(pages).toContain("/analyse");
  });

  it("aucune page n'est publique, sauf /login qui l'est par nature", () => {
    const publiques = pages.filter((p) => isPublicPath(p));
    expect(publiques).toEqual(["/login"]);
  });
});
