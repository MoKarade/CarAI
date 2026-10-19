// tests/financeaiBail.test.ts — le client qui lit le bail chez FinanceAI.
//
// Ce que ces tests défendent : SEPT états distincts. FinanceAI tourne sur le PC de Marc, donc
// « injoignable » est un état NORMAL et fréquent — le confondre avec « jeton refusé » ou
// « aucune dette enregistrée » enverrait Marc corriger la mauvaise chose. Chaque état appelle
// un geste différent, donc chacun doit survivre jusqu'à l'écran.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELAI_SUMMARY_MS, lireBailFinanceAI } from "@/lib/financeai/bail";

const URL_TEST = "https://finance.example/vehicule/bail";
const JETON = "un-jeton-de-test";

const BAIL_OK = {
  ok: true,
  statut: "trouve",
  bail: {
    nom: "bZ",
    devise: "CAD",
    solde: 23000,
    mensualite: 500,
    tauxAnnuelPourcent: 0,
    montantOrigine: null,
    debut: "2027-07-14",
    finTerme: null,
    champsAbsents: ["montantOrigine", "finTerme"],
    dataAsOf: "2027-09-14T21:42:22.639Z",
  },
};

/** Un `fetch` de test qui rend la réponse voulue — jamais de vrai réseau. */
const faux = (status: number, corps: unknown): typeof fetch =>
  (async () =>
    new Response(corps === undefined ? null : JSON.stringify(corps), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

beforeEach(() => {
  vi.stubEnv("FINANCEAI_BAIL_URL", URL_TEST);
  vi.stubEnv("FINANCEAI_BAIL_TOKEN", JETON);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lireBailFinanceAI — les sept états", () => {
  it("« non-configuré » quand l'URL manque — ce n'est PAS une panne", async () => {
    vi.stubEnv("FINANCEAI_BAIL_URL", "");
    expect((await lireBailFinanceAI(faux(200, BAIL_OK))).statut).toBe("non-configure");
  });

  it("« non-configuré » quand le jeton manque", async () => {
    vi.stubEnv("FINANCEAI_BAIL_TOKEN", "");
    expect((await lireBailFinanceAI(faux(200, BAIL_OK))).statut).toBe("non-configure");
  });

  it("« injoignable » quand le serveur ne répond pas — le PC de Marc est éteint", async () => {
    const qui_leve = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const r = await lireBailFinanceAI(qui_leve);
    expect(r.statut).toBe("injoignable");
    if (r.statut !== "injoignable") return;
    expect(r.detail).toContain("ECONNREFUSED");
  });

  it("« refusé » sur 401 ET sur 403 — le jeton ne correspond pas", async () => {
    expect((await lireBailFinanceAI(faux(401, { error: "x" }))).statut).toBe("refuse");
    expect((await lireBailFinanceAI(faux(403, { error: "x" }))).statut).toBe("refuse");
  });

  it("« absent » sur 404 — FinanceAI n'a aucune dette de véhicule", async () => {
    expect((await lireBailFinanceAI(faux(404, { statut: "introuvable" }))).statut).toBe("absent");
  });

  it("« ambigu » sur 409, avec les noms — FinanceAI refuse de choisir, et il a raison", async () => {
    const r = await lireBailFinanceAI(faux(409, { statut: "ambigu", candidates: ["bZ", "Corolla"] }));
    expect(r.statut).toBe("ambigu");
    if (r.statut !== "ambigu") return;
    expect(r.candidates).toEqual(["bZ", "Corolla"]);
  });

  it("« invalide » sur 500 — on ne rend pas un chiffre qu'on n'a pas su lire", async () => {
    expect((await lireBailFinanceAI(faux(503, { ok: false }))).statut).toBe("invalide");
  });

  it("« invalide » sur une réponse HORS SCHÉMA — jamais un montant réparé", async () => {
    const tordu = { ok: true, bail: { ...BAIL_OK.bail, solde: "beaucoup" } };
    expect((await lireBailFinanceAI(faux(200, tordu))).statut).toBe("invalide");
  });

  it("« invalide » sur un corps illisible, sans lever", async () => {
    const pasDuJson = (async () => new Response("{pas du json", { status: 200 })) as unknown as typeof fetch;
    expect((await lireBailFinanceAI(pasDuJson)).statut).toBe("invalide");
  });

  it("« ok » avec le bail, sur une réponse conforme", async () => {
    const r = await lireBailFinanceAI(faux(200, BAIL_OK));
    expect(r.statut).toBe("ok");
    if (r.statut !== "ok") return;
    expect(r.bail.nom).toBe("bZ");
    expect(r.bail.mensualite).toBe(500);
    expect(r.bail.champsAbsents).toContain("montantOrigine");
  });
});

describe("lireBailFinanceAI — la requête", () => {
  it("présente le jeton en Bearer, et n'accepte AUCUN cache (un solde est un instantané)", async () => {
    const espion = vi.fn(async () => new Response(JSON.stringify(BAIL_OK), { status: 200 }));
    await lireBailFinanceAI(espion as unknown as typeof fetch);
    expect(espion).toHaveBeenCalledTimes(1);
    const [url, init] = espion.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_TEST);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${JETON}`);
    expect(init.cache).toBe("no-store");
    // Et un délai borné : le PC de Marc peut être éteint, l'accueil ne doit pas l'attendre.
    expect(init.signal).toBeDefined();
  });

  it("n'appelle RIEN quand l'intégration n'est pas configurée", async () => {
    vi.stubEnv("FINANCEAI_BAIL_URL", "");
    const espion = vi.fn(async () => new Response("{}", { status: 200 }));
    await lireBailFinanceAI(espion as unknown as typeof fetch);
    expect(espion).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Le DÉLAI est un paramètre, et pas par goût de la généralité.
//
// L'accueil de CarAI et le summary du hub n'ont pas le même budget : l'accueil doit échouer
// vite (3 s) pour ne pas se figer sur une ligne d'information, le summary dispose des 9 s
// que Hubperso accorde à chaque app et son résultat est mis en cache 60 s. Un serveur en
// scale-to-zero met ~2 s à se réveiller : à 3 s, le premier appel après une veille
// échouerait presque toujours, et « injoignable » deviendrait l'état normal d'un serveur
// qui va parfaitement bien.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("délai d'attente", () => {
  it("le summary attend plus longtemps que l'accueil, et reste sous le budget du hub", () => {
    expect(DELAI_SUMMARY_MS).toBeGreaterThan(3_000);
    // 9 s est le budget que `lib/fetchSummary.ts` de Hubperso accorde à une app. Dépasser
    // ferait afficher « CarAI injoignable » — donc accuser la voiture pour une lenteur de
    // FinanceAI.
    expect(DELAI_SUMMARY_MS).toBeLessThan(9_000);
  });

  it("le délai demandé est CELUI qui part dans la requête", async () => {
    process.env.FINANCEAI_BAIL_URL = "https://exemple.test/vehicule/bail";
    process.env.FINANCEAI_BAIL_TOKEN = "x".repeat(20);
    let signalRecu: AbortSignal | null = null;
    const faux: typeof fetch = async (_url, init) => {
      signalRecu = (init?.signal as AbortSignal) ?? null;
      return new Response(JSON.stringify({ ok: true, bail: null }), { status: 500 });
    };
    await lireBailFinanceAI(faux, DELAI_SUMMARY_MS);
    // Un signal absent voudrait dire qu'AUCUN délai ne borne l'appel : le summary
    // attendrait alors indéfiniment, et le hub trancherait à sa place, à 9 s, en accusant
    // CarAI. C'est la seule chose vérifiable sans horloge réelle.
    expect(signalRecu).toBeInstanceOf(AbortSignal);
  });
});
