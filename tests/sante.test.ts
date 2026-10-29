// tests/sante.test.ts — GET /api/sante : santé publique pour la vigie de l'Atelier (#204).
//
// `lib/db` n'est PAS importé par les tests (voir son en-tête) : la seule branche testable
// sans base réelle est « base non configurée », exactement le patron déjà suivi par
// tests/hubSummary.test.ts. La branche « base configurée mais injoignable » délègue tout à
// Drizzle/Neon (`db.execute`) et n'a pas de logique propre à re-tester ici.

import { describe, it, expect } from "vitest";
import { GET } from "../app/api/sante/route";
import { commitServi } from "../lib/sante";

async function withDatabaseUrl(value: string | undefined, fn: () => Promise<void>) {
  const before = process.env.DATABASE_URL;
  if (value === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = before;
  }
}

describe("GET /api/sante", () => {
  it("503 { ok: false, cause: \"base\" } si DATABASE_URL non configuré", async () => {
    await withDatabaseUrl(undefined, async () => {
      const res = await GET();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, cause: "base" });
    });
  });

  it("ne renvoie ni donnée du véhicule ni message d'erreur brut", async () => {
    await withDatabaseUrl(undefined, async () => {
      const corps = await (await GET()).text();
      expect(corps).not.toMatch(/DATABASE_URL|neon|postgres/i);
    });
  });

  it("Cache-Control: no-store, dans les deux cas", async () => {
    await withDatabaseUrl(undefined, async () => {
      const res = await GET();
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });
});

describe("le commit servi (VERCEL_GIT_COMMIT_SHA)", () => {
  const SHA = "9a1635f4acaafe0cd58d4d82a90d2d893ca324e2";

  async function avecSha(valeur: string | undefined, fn: () => Promise<void>) {
    const avant = process.env.VERCEL_GIT_COMMIT_SHA;
    if (valeur === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = valeur;
    try {
      await fn();
    } finally {
      if (avant === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
      else process.env.VERCEL_GIT_COMMIT_SHA = avant;
    }
  }

  it("valide : un SHA hexadécimal donne ses 7 premiers caractères, en minuscules", () => {
    expect(commitServi(SHA)).toBe("9a1635f");
    expect(commitServi(SHA.toUpperCase())).toBe("9a1635f");
    expect(commitServi("9a1635f")).toBe("9a1635f");
  });

  it("rejeté : absent, vide, trop court ou non hexadécimal → pas de champ, rien d'inventé", () => {
    for (const mauvais of [undefined, "", "9a1635", "zzzzzzzzzz", "9a1635f; drop table", " 9a1635f"]) {
      expect(commitServi(mauvais)).toBeUndefined();
    }
  });

  it("la réponse porte le commit quand la variable est posée (cas ok:false)", async () => {
    await withDatabaseUrl(undefined, () =>
      avecSha(SHA, async () => {
        const res = await GET();
        expect(res.status).toBe(503);
        expect(await res.json()).toEqual({ ok: false, cause: "base", commit: "9a1635f" });
      }),
    );
  });

  it("la réponse n'a pas le champ commit quand la variable est absente ou invalide", async () => {
    await withDatabaseUrl(undefined, async () => {
      for (const valeur of [undefined, "pas-un-sha"]) {
        await avecSha(valeur, async () => {
          expect(await (await GET()).json()).toEqual({ ok: false, cause: "base" });
        });
      }
    });
  });
});
