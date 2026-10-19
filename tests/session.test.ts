// tests/session.test.ts — décision de session, nouveau cookie prioritaire (phase 1).
//
// `decideSessionEmail` est la seule partie PURE de `requireSession` : la lecture des cookies
// et de la session Auth.js reste dans lib/session.ts, non testée directement (patron déjà
// suivi par `decideGuard` dans lib/authGuard.ts / tests/auth.test.ts — voir l'en-tête de
// lib/sessionDecision.ts pour pourquoi cette extraction est nécessaire, pas seulement
// stylistique).

import { describe, it, expect } from "vitest";
import { decideSessionEmail } from "../lib/sessionDecision";

const AUTORISE = "marc@example.com";

describe("decideSessionEmail — nouveau cookie prioritaire, repli sur l'ancien", () => {
  it("accepte le nouveau cookie quand l'email est autorisé", () => {
    expect(decideSessionEmail("marc@example.com", null, AUTORISE)).toBe("marc@example.com");
  });

  it("retombe sur l'ancienne session quand le nouveau cookie est absent", () => {
    expect(decideSessionEmail(null, "marc@example.com", AUTORISE)).toBe("marc@example.com");
  });

  it("le nouveau cookie a priorité si les deux sont présents et valides", () => {
    // Cas impossible en pratique en phase 1 (Hubperso n'émet pas encore le nouveau), mais la
    // priorité doit être correcte le jour où la phase 2 arrive.
    expect(decideSessionEmail("marc@example.com", "marc@example.com", AUTORISE)).toBe(
      "marc@example.com",
    );
  });

  // Le test explicitement demandé : « email hors accès ». Un nouveau cookie signé mais
  // portant une adresse non autorisée ne doit ni être accepté, ni empêcher un repli valide
  // sur l'ancien cookie.
  it("email hors accès sur le nouveau cookie ⇒ retombe sur l'ancien s'il est autorisé", () => {
    expect(decideSessionEmail("intrus@example.com", "marc@example.com", AUTORISE)).toBe(
      "marc@example.com",
    );
  });

  it("email hors accès sur les deux sources ⇒ refus", () => {
    expect(decideSessionEmail("intrus@example.com", "autre@example.com", AUTORISE)).toBeNull();
  });

  it("aucune session sur aucune des deux sources ⇒ refus", () => {
    expect(decideSessionEmail(null, null, AUTORISE)).toBeNull();
  });

  // Fail-closed : sans allowlist configurée, aucune adresse ne passe (cf. isAuthorizedEmail).
  it("allowlist non configurée ⇒ refus même pour une adresse par ailleurs valide", () => {
    expect(decideSessionEmail("marc@example.com", null, undefined)).toBeNull();
  });
});
