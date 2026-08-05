// tests/hubSummary.test.ts — le Route Handler /hub/summary : auth (échec fermé) et
// payload validé par le VRAI schéma du contrat.

import { describe, it, expect } from "vitest";
import {
  CONTRACT_VERSION,
  HUB_TOKEN_HEADER,
  validateSummary,
} from "@mokarade/hub-contract";
import { hubTokenValid } from "../lib/hubToken";
import { GET } from "../app/hub/summary/route";

const JETON = "jeton-de-test-app-template-0123456789";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://app-template.hubperso.com/hub/summary", { headers });
}

function withHubToken(value: string | undefined, fn: () => void | Promise<void>) {
  const before = process.env.HUB_TOKEN;
  if (value === undefined) delete process.env.HUB_TOKEN;
  else process.env.HUB_TOKEN = value;
  try {
    return fn();
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
      const res = GET(req({ [HUB_TOKEN_HEADER]: JETON }));
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain("contractVersion");
    });
  });

  it("401 sans jeton et avec un jeton invalide", async () => {
    await withHubToken(JETON, async () => {
      expect(GET(req()).status).toBe(401);
      expect(GET(req({ [HUB_TOKEN_HEADER]: "mauvais" })).status).toBe(401);
    });
  });

  it("200 : building summary conforme au contrat + no-store", async () => {
    await withHubToken(JETON, async () => {
      const res = GET(req({ [HUB_TOKEN_HEADER]: JETON }));
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");

      const summary = validateSummary(await res.json());
      expect(summary.contractVersion).toBe(CONTRACT_VERSION);
      expect(summary.status).toBe("building");
      expect(summary.metrics).toEqual([]);
      expect(summary.actions).toEqual([]);
      expect(summary.alerts).toHaveLength(1);
      expect(summary.app.id).toBe("app-template");
    });
  });
});
