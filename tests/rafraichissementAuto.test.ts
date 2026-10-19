// tests/rafraichissementAuto.test.ts — le rafraîchissement auto ne doit plus vider le quota Neon.
//
// Garde : l'intervalle (15 min), la pause onglet caché, la reprise au retour visible, et
// l'ABSENCE du rafraîchissement automatique sur /tendances et /activite (pages lourdes).

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  demarrerRafraichissement,
  INTERVALLE_DONNEES_MS,
  type CibleVisibilite,
} from "../app/donnees/planificateurRafraichissement";

function fausseCible(etat: string) {
  let ecouteur: (() => void) | null = null;
  const cible: CibleVisibilite & { visibilityState: string } = {
    visibilityState: etat,
    addEventListener: (_t, cb) => {
      ecouteur = cb;
    },
    removeEventListener: () => {
      ecouteur = null;
    },
  };
  return {
    cible,
    changer(nouvel: string) {
      cible.visibilityState = nouvel;
      ecouteur?.();
    },
    aUnEcouteur: () => ecouteur !== null,
  };
}

describe("planificateur de rafraîchissement", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("l'intervalle des données est de 15 minutes", () => {
    expect(INTERVALLE_DONNEES_MS).toBe(15 * 60_000);
  });

  it("rafraîchit à chaque intervalle quand l'onglet est visible, pas avant", () => {
    const f = fausseCible("visible");
    const rafraichir = vi.fn();
    demarrerRafraichissement(INTERVALLE_DONNEES_MS, rafraichir, f.cible);
    vi.advanceTimersByTime(INTERVALLE_DONNEES_MS - 1);
    expect(rafraichir).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(rafraichir).toHaveBeenCalledTimes(1);
  });

  it("ne rafraîchit pas tant que l'onglet est caché, puis une fois au retour", () => {
    const f = fausseCible("hidden");
    const rafraichir = vi.fn();
    demarrerRafraichissement(INTERVALLE_DONNEES_MS, rafraichir, f.cible);
    vi.advanceTimersByTime(INTERVALLE_DONNEES_MS * 5);
    expect(rafraichir).not.toHaveBeenCalled();
    f.changer("visible");
    expect(rafraichir).toHaveBeenCalledTimes(1);
    f.changer("visible");
    expect(rafraichir).toHaveBeenCalledTimes(1);
  });

  it("pas de rafraîchissement au retour visible si aucun tick n'a été sauté", () => {
    const f = fausseCible("visible");
    const rafraichir = vi.fn();
    demarrerRafraichissement(INTERVALLE_DONNEES_MS, rafraichir, f.cible);
    f.changer("hidden");
    f.changer("visible");
    expect(rafraichir).not.toHaveBeenCalled();
  });

  it("l'arrêt coupe l'intervalle et l'écouteur", () => {
    const f = fausseCible("visible");
    const rafraichir = vi.fn();
    const arreter = demarrerRafraichissement(INTERVALLE_DONNEES_MS, rafraichir, f.cible);
    arreter();
    vi.advanceTimersByTime(INTERVALLE_DONNEES_MS * 3);
    expect(rafraichir).not.toHaveBeenCalled();
    expect(f.aUnEcouteur()).toBe(false);
  });
});

describe("pages lourdes", () => {
  for (const page of ["app/tendances/page.tsx", "app/activite/page.tsx"]) {
    it(`${page} n'a pas de rafraîchissement automatique`, () => {
      const code = readFileSync(page, "utf8");
      expect(code).not.toContain("RafraichissementAuto");
      expect(code).toContain("BoutonRafraichir");
    });
  }

  it("/donnees garde le rafraîchissement auto (à 15 min)", () => {
    expect(readFileSync("app/donnees/page.tsx", "utf8")).toContain("RafraichissementAuto");
    expect(readFileSync("app/donnees/rafraichissement.tsx", "utf8")).toContain(
      "INTERVALLE_DONNEES_MS",
    );
  });
});
