// tests/sessionAsymetrique.test.ts — lecture du nouveau cookie signé (phase 1, additive).
//
// Ces tests prouvent le CÂBLAGE côté CarAI (lecture de la variable d'environnement, forme du
// JWKS attendue) : les règles de sécurité elles-mêmes (algorithme figé, kid, expiration...)
// sont déjà testées dans hub-contract. On les rejoue ici parce qu'un mauvais câblage (ex. :
// oublier de passer les clés) doit échouer FERMÉ, et c'est ce fichier qui le garantit pour
// CarAI précisément.

import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type JWK } from "jose";
import { SESSION_EMETTEUR } from "@mokarade/hub-contract/session";
import { lireSessionAsymetrique } from "../lib/sessionAsymetrique";

const KID = "test-2026-09";
const MAINTENANT_S = () => Math.floor(Date.now() / 1000);

describe("lireSessionAsymetrique", () => {
  let privateKey: CryptoKey;
  let jwkPublique: JWK;
  let env: Partial<NodeJS.ProcessEnv>;

  beforeAll(async () => {
    const paire = await generateKeyPair("ES256", { extractable: true });
    privateKey = paire.privateKey;
    jwkPublique = { ...(await exportJWK(paire.publicKey)), kid: KID };
    env = { HUB_SESSION_PUBLIC_KEYS: JSON.stringify({ keys: [jwkPublique] }) };
  });

  async function signerValide(overrides: { email?: string; expireDansS?: number } = {}) {
    return new SignJWT({ email: overrides.email ?? "marc@example.com" })
      .setProtectedHeader({ alg: "ES256", kid: KID })
      .setIssuedAt()
      .setIssuer(SESSION_EMETTEUR)
      .setExpirationTime(MAINTENANT_S() + (overrides.expireDansS ?? 3600))
      .sign(privateKey);
  }

  it("rend l'identité pour un cookie valide", async () => {
    const cookie = await signerValide({ email: "marc@example.com" });
    const identite = await lireSessionAsymetrique(cookie, env);
    expect(identite?.email).toBe("marc@example.com");
  });

  it("cookie absent → null", async () => {
    expect(await lireSessionAsymetrique(undefined, env)).toBeNull();
  });

  it("clés publiques non configurées → null (repli silencieux sur l'ancien cookie)", async () => {
    const cookie = await signerValide();
    expect(await lireSessionAsymetrique(cookie, {})).toBeNull();
  });

  it("clés publiques illisibles (JSON invalide) → null", async () => {
    const cookie = await signerValide();
    const envCasse = { HUB_SESSION_PUBLIC_KEYS: "{pas du json" };
    expect(await lireSessionAsymetrique(cookie, envCasse)).toBeNull();
  });

  it("signature invalide (signé par une autre paire de clés) → null", async () => {
    const autrePaire = await generateKeyPair("ES256", { extractable: true });
    const cookie = await new SignJWT({ email: "marc@example.com" })
      .setProtectedHeader({ alg: "ES256", kid: KID }) // prétend porter le bon kid
      .setIssuedAt()
      .setIssuer(SESSION_EMETTEUR)
      .setExpirationTime(MAINTENANT_S() + 3600)
      .sign(autrePaire.privateKey); // mais signé avec une AUTRE clé privée
    expect(await lireSessionAsymetrique(cookie, env)).toBeNull();
  });

  it("algorithme none → null", async () => {
    const b64url = (obj: unknown) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");
    const cookie = `${b64url({ alg: "none", kid: KID })}.${b64url({
      email: "marc@example.com",
      iss: SESSION_EMETTEUR,
      iat: MAINTENANT_S(),
      exp: MAINTENANT_S() + 3600,
    })}.`;
    expect(await lireSessionAsymetrique(cookie, env)).toBeNull();
  });

  it("confusion d'algorithme HS256 (clé publique reprise comme secret) → null", async () => {
    const secret = new TextEncoder().encode(JSON.stringify(jwkPublique));
    const cookie = await new SignJWT({ email: "marc@example.com" })
      .setProtectedHeader({ alg: "HS256", kid: KID })
      .setIssuedAt()
      .setIssuer(SESSION_EMETTEUR)
      .setExpirationTime(MAINTENANT_S() + 3600)
      .sign(secret);
    expect(await lireSessionAsymetrique(cookie, env)).toBeNull();
  });

  it("cookie expiré → null", async () => {
    const cookie = await signerValide({ expireDansS: -3600 });
    expect(await lireSessionAsymetrique(cookie, env)).toBeNull();
  });

  it("kid inconnu → null (pas de repli sur « la seule clé »)", async () => {
    const cookie = await new SignJWT({ email: "marc@example.com" })
      .setProtectedHeader({ alg: "ES256", kid: "autre-cle" })
      .setIssuedAt()
      .setIssuer(SESSION_EMETTEUR)
      .setExpirationTime(MAINTENANT_S() + 3600)
      .sign(privateKey);
    expect(await lireSessionAsymetrique(cookie, env)).toBeNull();
  });
});
