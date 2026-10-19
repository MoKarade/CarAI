// tests/hubSummary.test.ts — le Route Handler /hub/summary : authentification (échec fermé)
// et payload validé par le VRAI schéma du contrat.
//
// (`tests/summary.test.ts` couvre le CONTENU du summary, construit par une fonction pure.)

import { beforeEach, describe, it, expect } from "vitest";
import {
  CONTRACT_VERSION,
  HUB_TOKEN_HEADER,
  validateSummary,
} from "@mokarade/hub-contract";
import { GET } from "../app/hub/summary/route";
import { __viderCacheHub } from "../lib/hubResume";

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

describe("GET /hub/summary", () => {
  // Le cache est un état de PROCESS : sans ce reset, un cas hériterait du summary d'un
  // autre. Aujourd'hui ça ne mordrait pas — sans DATABASE_URL la collecte est en panne,
  // donc jamais mise en cache — mais compter là-dessus, c'est être correct par accident.
  // Ce test-ci existe précisément pour attraper la régression du jour où elle ne l'est plus.
  beforeEach(__viderCacheHub);

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
      // La traduction `SummaryResponse` → `Response` est le seul code neuf de la route ;
      // un oubli y servirait du JSON annoncé en `text/plain`.
      expect(res.headers.get("content-type")).toContain("application/json");

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
