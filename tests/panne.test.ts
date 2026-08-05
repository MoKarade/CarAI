// tests/panne.test.ts — classification des erreurs de base.
//
// Régression du 05/08/2026 : la page d'accueil rendait un 500 « Application error » au tout
// premier chargement, parce que la lecture de `vehicle_snapshots` gagnait la course contre
// les migrations. Ces tests verrouillent la moitié « diagnostic » du correctif — dire
// LEQUEL des deux problèmes on a, puisqu'ils appellent des gestes opposés.

import { describe, expect, it } from "vitest";
import { classerPanne, messagePanne, resumePanne, CODE_TABLE_ABSENTE } from "@/lib/panne";

describe("classerPanne", () => {
  it("reconnaît une table absente par son code Postgres", () => {
    expect(classerPanne({ code: CODE_TABLE_ABSENTE })).toBe("schema_absent");
  });

  it("descend dans `cause` — Drizzle enveloppe l'erreur du pilote", () => {
    // C'est la forme EXACTE vue en production : Drizzle lève « Failed query: … » et le
    // code réel (42P01) vit dans `cause`. Sans cette descente, on classerait « base
    // injoignable » et Marc irait vérifier DATABASE_URL au lieu d'attendre les migrations.
    const erreur = Object.assign(new Error("Failed query: SELECT …"), {
      cause: Object.assign(new Error('relation "vehicle_snapshots" does not exist'), {
        code: "42P01",
      }),
    });
    expect(classerPanne(erreur)).toBe("schema_absent");
  });

  it("classe les autres codes Postgres en base injoignable", () => {
    expect(classerPanne({ code: "28P01" })).toBe("base_injoignable"); // mot de passe refusé
    expect(classerPanne({ code: "53300" })).toBe("base_injoignable"); // trop de connexions
  });

  it("se rabat sur le texte quand aucun code n'est exploitable", () => {
    expect(classerPanne(new Error('relation "truc" does not exist'))).toBe("schema_absent");
  });

  it("avoue son ignorance plutôt que d'affirmer une cause", () => {
    expect(classerPanne(new Error("boom"))).toBe("inconnue");
    expect(classerPanne(null)).toBe("inconnue");
    expect(classerPanne(undefined)).toBe("inconnue");
  });

  it("ne boucle pas sur une chaîne de causes circulaire", () => {
    const a: Record<string, unknown> = {};
    a.cause = a;
    expect(() => classerPanne(a)).not.toThrow();
  });
});

describe("messages", () => {
  it("dit d'ATTENDRE quand le schéma manque, pas de vérifier la connexion", () => {
    const m = messagePanne("schema_absent");
    expect(m).toContain("recharge");
    expect(m).not.toContain("DATABASE_URL");
  });

  it("dit de vérifier DATABASE_URL quand la base ne répond pas", () => {
    expect(messagePanne("base_injoignable")).toContain("DATABASE_URL");
  });

  it("le résumé tient dans le label d'alerte du hub (80 caractères)", () => {
    for (const type of ["schema_absent", "base_injoignable", "inconnue"] as const) {
      expect(resumePanne(type).length).toBeLessThanOrEqual(80);
    }
  });
});

// ── Le garde-fou de la régression elle-même ────────────────────────────────────────
// `collecter()` est le SEUL point d'entrée de l'affichage, et il ne doit JAMAIS lever :
// c'est ce qui garantit qu'aucun chemin ne peut rendre un 500 « Application error ».
describe("collecter — ne lève jamais", () => {
  it("rend une panne exploitable quand DATABASE_URL est absent", async () => {
    const avant = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const { collecter } = await import("@/lib/vehicle/instantane");
      const r = await collecter(new Date("2026-08-05T12:00:00.000Z"));

      expect(r.typePanne).toBe("base_injoignable");
      expect(r.instantane.panne).not.toBeNull();
      expect(r.etat.vide).toBe(true);
      // Le label part dans une alerte du hub, bornée à 80 caractères par le contrat.
      expect(r.instantane.panne!.length).toBeLessThanOrEqual(80);
    } finally {
      if (avant === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = avant;
    }
  });
});
