// tests/hubSummary.test.ts — le Route Handler /hub/summary : authentification (échec fermé)
// et payload validé par le VRAI schéma du contrat.
//
// (`tests/summary.test.ts` couvre le CONTENU du summary, construit par une fonction pure.)

import { describe, it, expect } from "vitest";
import {
  CONTRACT_VERSION,
  HUB_TOKEN_HEADER,
  validateSummary,
} from "@mokarade/hub-contract";
import { hubTokenValid } from "../lib/hubToken";
import { GET } from "../app/hub/summary/route";

const JETON = "jeton-de-test-carai-0123456789";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://carai.hubperso.com/hub/summary", { headers });
}

async function withHubToken(value: string | undefined, fn: () => Promise<void>) {
  const before = process.env.HUB_TOKEN;
  if (value === undefined) delete process.env.HUB_TOKEN;
  else process.env.HUB_TOKEN = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.HUB_TOKEN;
    else process.env.HUB_TOKEN = before;
  }
}

describe("hubTokenValid", () => {
  it("accepte le bon jeton, refuse le reste", () => {
    expect(hubTokenValid(JETON, JETON)).toBe(true);
    expect(hubTokenValid("autre", JETON)).toBe(false);
    expect(hubTokenValid(null, JETON)).toBe(false);
    expect(hubTokenValid("", JETON)).toBe(false);
  });
});

describe("GET /hub/summary", () => {
  it("503 si HUB_TOKEN non configuré, sans summary — hub désactivé, pas erreur interne", async () => {
    await withHubToken(undefined, async () => {
      const res = await GET(req({ [HUB_TOKEN_HEADER]: JETON }));
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain("contractVersion");
    });
  });

  it("401 sans jeton et avec un jeton invalide", async () => {
    await withHubToken(JETON, async () => {
      expect((await GET(req())).status).toBe(401);
      expect((await GET(req({ [HUB_TOKEN_HEADER]: "mauvais" }))).status).toBe(401);
    });
  });

  it("200 : summary conforme au contrat + no-store", async () => {
    await withHubToken(JETON, async () => {
      const res = await GET(req({ [HUB_TOKEN_HEADER]: JETON }));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const summary = validateSummary(await res.json());
      expect(summary.contractVersion).toBe(CONTRACT_VERSION);
      expect(summary.app.id).toBe("carai");

      // Sans DATABASE_URL, CarAI publie une PANNE (`error`), pas « en construction ».
      // La distinction est le cœur du no-fake-data : une configuration manquante n'est pas
      // un véhicule silencieux, et confondre les deux ferait passer une panne pour un
      // démarrage normal.
      expect(summary.status).toBe("error");
      expect(summary.metrics).toEqual([]);
      expect(summary.alerts[0]!.severity).toBe("alert");
    });
  });
});
