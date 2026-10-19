// tests/santeCache.test.ts — le verdict de /api/sante est gardé 45 s en mémoire.
//
// Pourquoi : /api/sante est PUBLIQUE (hors garde de session). Sans mémoire, n'importe qui
// peut la marteler et chaque appel touche Neon (SELECT 1 + assurerMigrations) — le quota
// Neon a déjà été dépassé le 29/09/2026. Avec la mémoire, au plus UN appel par fenêtre de
// 45 s touche la base, par instance.
//
// La base et les migrations sont remplacées par des doublures qui COMPTENT les appels :
// c'est le nombre d'accès à Neon qu'on vérifie, pas une valeur métier.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const appels = vi.hoisted(() => ({ select: 0, migrations: 0, echec: false }));

vi.mock("@/lib/db", () => ({
  baseConfiguree: () => true,
  db: {
    execute: async () => {
      appels.select += 1;
      if (appels.echec) throw new Error("base injoignable");
      return [];
    },
  },
}));

vi.mock("@/lib/migrations", () => ({
  assurerMigrations: async () => {
    appels.migrations += 1;
  },
}));

import { creerCacheSante, DUREE_CACHE_SANTE_MS } from "../lib/sante";

describe("creerCacheSante — au plus une sonde par fenêtre", () => {
  it("la fenêtre vaut 45 s", () => {
    expect(DUREE_CACHE_SANTE_MS).toBe(45_000);
  });

  it("réutilise le verdict pendant la fenêtre, re-sonde après", async () => {
    let t = 1_000_000;
    const sonde = vi.fn(async () => true);
    const sante = creerCacheSante(sonde, 45_000, () => t);

    expect(await sante()).toBe(true);
    t += 44_999;
    expect(await sante()).toBe(true);
    expect(sonde).toHaveBeenCalledTimes(1);

    t += 1; // pile 45 s après la sonde : la fenêtre est close
    expect(await sante()).toBe(true);
    expect(sonde).toHaveBeenCalledTimes(2);
  });

  // Une panne est mémorisée AUSSI : c'est justement quand la base est en panne qu'il ne
  // faut pas la marteler (leçon du 29/09).
  it("mémorise aussi un verdict « pas ok »", async () => {
    let t = 0;
    const sonde = vi.fn(async () => false);
    const sante = creerCacheSante(sonde, 45_000, () => t);

    expect(await sante()).toBe(false);
    t += 10_000;
    expect(await sante()).toBe(false);
    expect(sonde).toHaveBeenCalledTimes(1);
  });

  it("des appels simultanés partagent UNE seule sonde", async () => {
    let liberer: (v: boolean) => void = () => {};
    const sonde = vi.fn(() => new Promise<boolean>((r) => (liberer = r)));
    const sante = creerCacheSante(sonde, 45_000, () => 0);

    const a = sante();
    const b = sante();
    liberer(true);
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(sonde).toHaveBeenCalledTimes(1);
  });

  // Une sonde qui LÈVE (bug imprévu) ne doit ni rester coincée en cours, ni laisser
  // passer un faux « ok » : elle vaut « pas ok », mémorisé comme tel.
  it("une sonde qui lève vaut « pas ok » et n'est pas re-tentée dans la fenêtre", async () => {
    const sonde = vi.fn(async () => {
      throw new Error("inattendu");
    });
    const sante = creerCacheSante(sonde, 45_000, () => 0);

    expect(await sante()).toBe(false);
    expect(await sante()).toBe(false);
    expect(sonde).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/sante — Neon touché au plus une fois par fenêtre", () => {
  beforeEach(() => {
    appels.select = 0;
    appels.migrations = 0;
    appels.echec = false;
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T23:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("10 appels en rafale : un seul SELECT 1 et un seul assurerMigrations", async () => {
    const { GET } = await import("../app/api/sante/route");
    for (let i = 0; i < 10; i++) {
      const res = await GET();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    expect(appels.select).toBe(1);
    expect(appels.migrations).toBe(1);
  });

  it("re-sonde la base une fois la fenêtre de 45 s écoulée", async () => {
    const { GET } = await import("../app/api/sante/route");
    await GET();
    vi.advanceTimersByTime(45_000);
    await GET();
    expect(appels.select).toBe(2);
  });

  it("base injoignable : 503 mémorisé, sans re-frapper Neon dans la fenêtre", async () => {
    appels.echec = true;
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../app/api/sante/route");

    for (let i = 0; i < 5; i++) {
      const res = await GET();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, cause: "base" });
    }
    expect(appels.select).toBe(1);
    erreur.mockRestore();
  });
});
