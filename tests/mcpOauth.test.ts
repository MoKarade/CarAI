// tests/mcpOauth.test.ts — le mini serveur OAuth 2.1 du connecteur MCP.
//
// C'est la seule porte d'entrée non authentifiée par session de toute l'app : chaque garde
// est testée pour ce qu'elle EMPÊCHE, pas seulement pour le chemin heureux. Un test qui ne
// vérifie que « ça marche quand tout va bien » verrouille les bugs plutôt que les corriger.

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { makeOAuthProvider, makeAttemptLimiter, OAuthError, lireEnvMcp } from "@/lib/mcp/oauth";

const CLE_SIGNATURE = "x".repeat(48);
const CLE_ACCES = "clé-d-accès-de-test-aléatoire";
const ISSUER = "https://carai.hubperso.com";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function provider(now?: () => number) {
  return makeOAuthProvider({
    signingKey: CLE_SIGNATURE,
    accessKey: CLE_ACCES,
    issuer: ISSUER,
    ...(now ? { now } : {}),
  });
}

/** Un couple PKCE valide : le vérifieur, et son défi S256 en base64url. */
function pkce(verifieur = "verifieur-pkce-de-test-suffisamment-long") {
  const challenge = createHash("sha256").update(verifieur, "utf8").digest().toString("base64url");
  return { verifieur, challenge };
}

/** Parcourt le flux complet et rend les jetons. */
function flotComplet(p: ReturnType<typeof provider>) {
  const { verifieur, challenge } = pkce();
  const client = p.registerClient([REDIRECT]);
  const code = p.authorize({
    clientId: client.client_id,
    redirectUri: REDIRECT,
    codeChallenge: challenge,
    accessKey: CLE_ACCES,
  });
  const jetons = p.exchangeCode({
    code,
    clientId: client.client_id,
    clientSecret: client.client_secret,
    redirectUri: REDIRECT,
    codeVerifier: verifieur,
  });
  return { client, jetons };
}

describe("flux nominal", () => {
  it("register → authorize → token → accès accepté", () => {
    const p = provider();
    const { jetons } = flotComplet(p);
    expect(jetons.token_type).toBe("Bearer");
    expect(jetons.access_token.startsWith("ca1.")).toBe(true);
    expect(() => p.verifyAccessToken(`Bearer ${jetons.access_token}`)).not.toThrow();
  });

  it("le refresh tourne : un nouveau refresh est émis, l'ancien ne resert pas", () => {
    const p = provider();
    const { client, jetons } = flotComplet(p);
    const suite = p.refreshGrant({
      refreshToken: jetons.refresh_token,
      clientId: client.client_id,
      clientSecret: client.client_secret,
    });
    expect(suite.refresh_token).not.toBe(jetons.refresh_token);
    // Rotation OAuth 2.1 : rejouer l'ancien est le signe d'un vol, et doit échouer.
    expect(() =>
      p.refreshGrant({
        refreshToken: jetons.refresh_token,
        clientId: client.client_id,
        clientSecret: client.client_secret,
      }),
    ).toThrow(OAuthError);
  });
});

describe("PKCE — obligatoire, et vérifié", () => {
  it("refuse une demande d'autorisation sans code_challenge S256", () => {
    const p = provider();
    for (const q of [
      { response_type: "code", client_id: "c", redirect_uri: REDIRECT },
      { response_type: "code", client_id: "c", redirect_uri: REDIRECT, code_challenge: "x", code_challenge_method: "plain" },
    ]) {
      expect(() => p.validateAuthorizeRequest(q)).toThrow(OAuthError);
    }
  });

  it("refuse un code_verifier qui ne correspond pas au défi", () => {
    const p = provider();
    const client = p.registerClient([REDIRECT]);
    const code = p.authorize({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: pkce().challenge,
      accessKey: CLE_ACCES,
    });
    expect(() =>
      p.exchangeCode({
        code,
        clientId: client.client_id,
        redirectUri: REDIRECT,
        codeVerifier: "pas-le-bon-verifieur",
      }),
    ).toThrow(OAuthError);
  });
});

describe("redirect_uri — l'allowlist est ce qui empêche un code de partir ailleurs", () => {
  it("refuse un domaine tiers", () => {
    const p = provider();
    expect(() => p.registerClient(["https://evil.example/cb"])).toThrow(OAuthError);
  });

  it("refuse un userinfo qui déguise l'hôte réel", () => {
    // `http://127.0.0.1@evil.com` a pour host `evil.com` : un contrôle naïf « ça commence
    // par 127.0.0.1 » l'accepterait. Finding CRITIQUE hérité du panel FinanceAI.
    const p = provider();
    expect(() => p.registerClient(["http://127.0.0.1@evil.com/cb"])).toThrow(OAuthError);
  });

  it("refuse un préfixe qui ressemble à une origine admise", () => {
    const p = provider();
    expect(() => p.registerClient(["https://claude.ai.evil.example/cb"])).toThrow(OAuthError);
  });

  it("accepte claude.ai et le loopback", () => {
    const p = provider();
    expect(() => p.registerClient([REDIRECT])).not.toThrow();
    expect(() => p.registerClient(["http://127.0.0.1:8976/cb"])).not.toThrow();
  });

  it("le code est LIÉ à son redirect_uri : l'échanger pour un autre échoue", () => {
    const p = provider();
    const { verifieur, challenge } = pkce();
    const client = p.registerClient([REDIRECT]);
    const code = p.authorize({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      accessKey: CLE_ACCES,
    });
    expect(() =>
      p.exchangeCode({
        code,
        clientId: client.client_id,
        redirectUri: "http://127.0.0.1:8976/cb",
        codeVerifier: verifieur,
      }),
    ).toThrow(OAuthError);
  });
});

describe("clé d'accès — la seule porte devinable", () => {
  it("refuse une clé fausse avec access_denied", () => {
    const p = provider();
    try {
      p.authorize({
        clientId: "c",
        redirectUri: REDIRECT,
        codeChallenge: pkce().challenge,
        accessKey: "pas-la-bonne",
      });
      throw new Error("aurait dû refuser");
    } catch (err) {
      expect(err).toBeInstanceOf(OAuthError);
      expect((err as OAuthError).code).toBe("access_denied");
    }
  });
});

describe("codes et jetons — ce qu'un attaquant ne doit pas pouvoir faire", () => {
  it("un code ne sert qu'UNE fois", () => {
    const p = provider();
    const { verifieur, challenge } = pkce();
    const client = p.registerClient([REDIRECT]);
    const code = p.authorize({
      clientId: client.client_id,
      redirectUri: REDIRECT,
      codeChallenge: challenge,
      accessKey: CLE_ACCES,
    });
    const args = { code, clientId: client.client_id, redirectUri: REDIRECT, codeVerifier: verifieur };
    expect(() => p.exchangeCode(args)).not.toThrow();
    expect(() => p.exchangeCode(args)).toThrow(OAuthError);
  });

  it("une signature modifiée est rejetée", () => {
    const p = provider();
    const { jetons } = flotComplet(p);
    const [prefixe, corps] = jetons.access_token.split(".");
    const falsifie = `${prefixe}.${corps}.${"A".repeat(43)}`;
    expect(() => p.verifyAccessToken(`Bearer ${falsifie}`)).toThrow(OAuthError);
  });

  it("un jeton signé par une AUTRE clé est rejeté", () => {
    const autre = makeOAuthProvider({ signingKey: "y".repeat(48), accessKey: CLE_ACCES, issuer: ISSUER });
    const { jetons } = flotComplet(autre);
    expect(() => provider().verifyAccessToken(`Bearer ${jetons.access_token}`)).toThrow(OAuthError);
  });

  it("un refresh token ne passe pas là où un access token est attendu", () => {
    const p = provider();
    const { jetons } = flotComplet(p);
    expect(() => p.verifyAccessToken(`Bearer ${jetons.refresh_token}`)).toThrow(OAuthError);
  });

  it("un jeton expiré est rejeté", () => {
    let t = 1_000_000;
    const p = provider(() => t);
    const { jetons } = flotComplet(p);
    t += 2 * 60 * 60 * 1000; // au-delà de l'heure de validité
    expect(() => p.verifyAccessToken(`Bearer ${jetons.access_token}`)).toThrow(OAuthError);
  });

  it("un jeton d'une AUTRE app de l'écosystème est rejeté sur le préfixe", () => {
    // Le préfixe fait partie du contrat : même si CarAI et DriveAI partageaient un jour une
    // clé de signature par erreur, leurs jetons ne seraient pas interchangeables.
    const p = provider();
    const { jetons } = flotComplet(p);
    const deguise = jetons.access_token.replace(/^ca1\./, "da1.");
    expect(() => p.verifyAccessToken(`Bearer ${deguise}`)).toThrow(OAuthError);
  });

  it("un en-tête absent ou malformé est refusé, jamais toléré", () => {
    const p = provider();
    for (const entete of [undefined, "", "Basic abc", "Bearer", "ca1.sans-bearer"]) {
      expect(() => p.verifyAccessToken(entete as string | undefined)).toThrow(OAuthError);
    }
  });
});

describe("métadonnées de découverte", () => {
  it("annoncent les endpoints sous l'issuer reçu, et exigent S256", () => {
    const p = provider();
    const as = p.authorizationServerMetadata();
    expect(as.issuer).toBe(ISSUER);
    expect(as.authorization_endpoint).toBe(`${ISSUER}/api/mcp/authorize`);
    expect(as.token_endpoint).toBe(`${ISSUER}/api/mcp/token`);
    expect(as.registration_endpoint).toBe(`${ISSUER}/api/mcp/register`);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);

    const pr = p.protectedResourceMetadata();
    expect(pr.resource).toBe(`${ISSUER}/api/mcp`);
    expect(pr.bearer_methods_supported).toEqual(["header"]);
  });
});

describe("configuration — échec FERMÉ", () => {
  it("refuse de démarrer avec des clés trop courtes", () => {
    expect(() =>
      makeOAuthProvider({ signingKey: "court", accessKey: CLE_ACCES, issuer: ISSUER }),
    ).toThrow();
    expect(() =>
      makeOAuthProvider({ signingKey: CLE_SIGNATURE, accessKey: "court", issuer: ISSUER }),
    ).toThrow();
  });

  it("lireEnvMcp rend null tant que les deux clés ne sont pas posées", () => {
    const avant = { s: process.env.MCP_SIGNING_KEY, a: process.env.MCP_ACCESS_KEY };
    try {
      delete process.env.MCP_SIGNING_KEY;
      delete process.env.MCP_ACCESS_KEY;
      expect(lireEnvMcp()).toBeNull();

      process.env.MCP_SIGNING_KEY = CLE_SIGNATURE;
      expect(lireEnvMcp(), "une seule clé ne suffit pas").toBeNull();

      process.env.MCP_ACCESS_KEY = "trop-court";
      expect(lireEnvMcp(), "une clé d'accès courte est refusée").toBeNull();

      process.env.MCP_ACCESS_KEY = CLE_ACCES;
      expect(lireEnvMcp()).toEqual({ signingKey: CLE_SIGNATURE, accessKey: CLE_ACCES });
    } finally {
      if (avant.s === undefined) delete process.env.MCP_SIGNING_KEY;
      else process.env.MCP_SIGNING_KEY = avant.s;
      if (avant.a === undefined) delete process.env.MCP_ACCESS_KEY;
      else process.env.MCP_ACCESS_KEY = avant.a;
    }
  });
});

describe("limiteur de tentatives", () => {
  it("bloque après le quota d'ÉCHECS, et un succès remet le compteur à zéro", () => {
    const t = 0;
    const l = makeAttemptLimiter({ maxFailures: 3, windowMs: 60_000, now: () => t });
    expect(l.isBlocked()).toBe(false);
    l.recordFailure();
    l.recordFailure();
    expect(l.isBlocked()).toBe(false);
    l.recordFailure();
    expect(l.isBlocked()).toBe(true);
    expect(l.retryAfterSeconds()).toBeGreaterThan(0);

    // Marc ne doit JAMAIS être bloqué par son usage légitime.
    l.reset();
    expect(l.isBlocked()).toBe(false);
  });

  it("oublie les échecs sortis de la fenêtre", () => {
    let t = 0;
    const l = makeAttemptLimiter({ maxFailures: 2, windowMs: 1000, now: () => t });
    l.recordFailure();
    l.recordFailure();
    expect(l.isBlocked()).toBe(true);
    t += 2000;
    expect(l.isBlocked()).toBe(false);
  });
});

// ── Le câblage, pas seulement la logique ────────────────────────────────────────────────
//
// Tous les tests ci-dessus tiennent UN provider et exercent ses gardes dessus. C'est
// nécessaire et insuffisant : la garde anti-rejeu vit DANS l'instance, donc un câblage qui
// reconstruit le provider à chaque requête la vide à chaque fois — la logique reste juste et
// la protection n'existe plus. C'est arrivé ici, et seul un appel HTTP réel l'a montré
// (rejouer un code d'autorisation rendait 200 et un jeton neuf).
//
// Ce test rejoue ce scénario au niveau du câblage : deux requêtes successives doivent
// retrouver LE MÊME provider.
describe("contexteMcp — le provider doit SURVIVRE d'une requête à l'autre", () => {
  it("rend la même instance pour deux requêtes de même origine", async () => {
    const { contexteMcp } = await import("@/lib/mcp/contexte");
    const avant = { s: process.env.MCP_SIGNING_KEY, a: process.env.MCP_ACCESS_KEY };
    try {
      process.env.MCP_SIGNING_KEY = CLE_SIGNATURE;
      process.env.MCP_ACCESS_KEY = CLE_ACCES;

      const req = () => new Request(`${ISSUER}/api/mcp`);
      const un = contexteMcp(req());
      const deux = contexteMcp(req());
      expect(un).not.toBeNull();
      expect(
        deux!.auth,
        "provider reconstruit à chaque requête ⇒ l'anti-rejeu des codes ne protège rien",
      ).toBe(un!.auth);
    } finally {
      if (avant.s === undefined) delete process.env.MCP_SIGNING_KEY;
      else process.env.MCP_SIGNING_KEY = avant.s;
      if (avant.a === undefined) delete process.env.MCP_ACCESS_KEY;
      else process.env.MCP_ACCESS_KEY = avant.a;
    }
  });

  it("un code consommé le reste sur une requête SUIVANTE", async () => {
    const { contexteMcp } = await import("@/lib/mcp/contexte");
    const avant = { s: process.env.MCP_SIGNING_KEY, a: process.env.MCP_ACCESS_KEY };
    try {
      process.env.MCP_SIGNING_KEY = CLE_SIGNATURE;
      process.env.MCP_ACCESS_KEY = CLE_ACCES;

      const { verifieur, challenge } = pkce("verifieur-du-test-de-cablage-oauth");
      const c1 = contexteMcp(new Request(`${ISSUER}/api/mcp/authorize`))!;
      const client = c1.auth.registerClient([REDIRECT]);
      const code = c1.auth.authorize({
        clientId: client.client_id,
        redirectUri: REDIRECT,
        codeChallenge: challenge,
        accessKey: CLE_ACCES,
      });
      const args = {
        code,
        clientId: client.client_id,
        clientSecret: client.client_secret,
        redirectUri: REDIRECT,
        codeVerifier: verifieur,
      };

      // Requête 1 : l'échange réussit.
      expect(() => contexteMcp(new Request(`${ISSUER}/api/mcp/token`))!.auth.exchangeCode(args))
        .not.toThrow();
      // Requête 2 (contexte relu, comme le ferait le serveur) : le rejeu échoue.
      expect(() => contexteMcp(new Request(`${ISSUER}/api/mcp/token`))!.auth.exchangeCode(args))
        .toThrow(OAuthError);
    } finally {
      if (avant.s === undefined) delete process.env.MCP_SIGNING_KEY;
      else process.env.MCP_SIGNING_KEY = avant.s;
      if (avant.a === undefined) delete process.env.MCP_ACCESS_KEY;
      else process.env.MCP_ACCESS_KEY = avant.a;
    }
  });
});
