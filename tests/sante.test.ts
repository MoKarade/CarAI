// tests/sante.test.ts — GET /api/sante : santé publique pour la vigie de l'Atelier (#204).
//
// `lib/db` n'est PAS importé par les tests (voir son en-tête) : la seule branche testable
// sans base réelle est « base non configurée », exactement le patron déjà suivi par
// tests/hubSummary.test.ts. La branche « base configurée mais injoignable » délègue tout à
// Drizzle/Neon (`db.execute`) et n'a pas de logique propre à re-tester ici.

import { describe, it, expect } from "vitest";
import { GET } from "../app/api/sante/route";

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
