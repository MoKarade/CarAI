// tests/purgeSurDemande.test.ts — CarAI#202 : l'inventaire de purge ne se charge que sur clic.
//
// Avant : chaque ouverture de Réglages lançait `inventaireSimulees()`, qui parcourt toutes les
// positions, tous les odomètres et toutes les pressions — une lecture de la base pour une
// section que Marc n'ouvre presque jamais, alors que la limite mensuelle de transfert Neon a
// été dépassée. Après : un bouton déclenche la lecture ; rien n'est lu au rendu.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chargerInventairePurge: vi.fn(),
  purgerMesures: vi.fn(),
  requireSession: vi.fn(),
  assurerMigrations: vi.fn(),
  inventaireSimulees: vi.fn(),
}));

vi.mock("@/app/reglages/actions", () => ({
  chargerInventairePurge: mocks.chargerInventairePurge,
  purgerMesures: mocks.purgerMesures,
}));

import { PurgeSimulee } from "@/app/reglages/purgeSimulee";

describe("Réglages ne lit plus l'inventaire de purge à l'ouverture", () => {
  const page = readFileSync("app/reglages/page.tsx", "utf8");

  it("la page n'importe ni n'appelle `inventaireSimulees`", () => {
    expect(page).not.toMatch(/inventaireSimulees/);
    expect(page).not.toMatch(/\bInventairePurge\b/);
  });

  it("la section reste affichée, sans donnée passée en propriété", () => {
    expect(page).toMatch(/<PurgeSimulee\s*\/>/);
    expect(page).toContain("Purge du véhicule de test");
  });
});

describe("PurgeSimulee — rien n'est lu avant le clic", () => {
  beforeEach(() => {
    mocks.chargerInventairePurge.mockReset();
    mocks.purgerMesures.mockReset();
  });

  it("le rendu montre un bouton et n'appelle AUCUNE action", () => {
    const html = renderToStaticMarkup(createElement(PurgeSimulee));
    expect(html).toContain("Chercher les mesures impossibles");
    expect(html).toContain("ne se lance que sur");
    expect(mocks.chargerInventairePurge).not.toHaveBeenCalled();
    expect(mocks.purgerMesures).not.toHaveBeenCalled();
  });

  it("le rendu ne dit pas « rien à purger » : il n'a rien cherché", () => {
    const html = renderToStaticMarkup(createElement(PurgeSimulee));
    expect(html).not.toContain("Aucune mesure impossible");
    expect(html).not.toContain("Supprimer ces");
  });

  it("la lecture ne part que d'un geste : jamais d'effet au montage", () => {
    const source = readFileSync("app/reglages/purgeSimulee.tsx", "utf8");
    expect(source).not.toMatch(/useEffect/);
    // Un seul appel, dans le gestionnaire du bouton.
    expect(source.match(/chargerInventairePurge\(/g)).toHaveLength(1);
    expect(source).toMatch(/onClick=\{charger\}/);
  });

  it("un échec de lecture se DIT, et ne ressemble jamais à une base propre", () => {
    const source = readFileSync("app/reglages/purgeSimulee.tsx", "utf8");
    expect(source).toContain("MESSAGE_ECHEC_INVENTAIRE");
    expect(source).not.toContain("err.message");
    // Le « catch » de la lecture ne pose pas d'inventaire vide.
    expect(source).toMatch(/catch\s*\{[^}]*setEchec\(true\)/s);
  });
});

describe("chargerInventairePurge — l'action serveur", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.requireSession.mockReset();
    mocks.assurerMigrations.mockReset();
    mocks.inventaireSimulees.mockReset();
    vi.doUnmock("@/app/reglages/actions");
    vi.doMock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
    vi.doMock("@/lib/migrations", () => ({ assurerMigrations: mocks.assurerMigrations }));
    vi.doMock("@/lib/vehicle/purgeSimulee", async (importer) => ({
      ...(await importer<typeof import("@/lib/vehicle/purgeSimulee")>()),
      inventaireSimulees: mocks.inventaireSimulees,
    }));
  });

  it("revérifie la session AVANT de lire quoi que ce soit", async () => {
    mocks.requireSession.mockRejectedValue(new Error("non autorisé"));
    const { chargerInventairePurge } = await import("@/app/reglages/actions");
    await expect(chargerInventairePurge()).rejects.toThrow("non autorisé");
    expect(mocks.inventaireSimulees).not.toHaveBeenCalled();
  });

  it("rend l'inventaire une fois la session vérifiée", async () => {
    const inventaire = { candidates: [], parMotif: [], odometreActuelKm: null };
    mocks.requireSession.mockResolvedValue(undefined);
    mocks.assurerMigrations.mockResolvedValue(undefined);
    mocks.inventaireSimulees.mockResolvedValue(inventaire);
    const { chargerInventairePurge } = await import("@/app/reglages/actions");
    await expect(chargerInventairePurge()).resolves.toBe(inventaire);
    expect(mocks.inventaireSimulees).toHaveBeenCalledTimes(1);
  });
});
