// tests/moletteZoom.test.ts — la molette doit zoomer, ET la page doit rester défilable.
//
// CAS RÉEL, Marc, 20/08/2026 : « j'arrive pas à scroll sur les graphs, ça me fait descendre
// la page ». La légende promettait « Molette pour zoomer » et il ne se passait rien.
//
// Cause : React attache `onWheel` en écouteur PASSIF. `preventDefault()` y est ignoré par
// le navigateur, donc le défilement de la page l'emportait — le graphique filait hors de
// l'écran avant qu'on voie le moindre zoom. Il faut un écouteur natif `{ passive: false }`.
//
// Et le zoom exige Ctrl/⌘ : capturer la molette NUE rendrait un écran de huit courbes
// infranchissable, puisque le curseur y est presque toujours au-dessus de l'une d'elles.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const source = readFileSync("app/ui/GraphiquesLies.tsx", "utf8");

describe("zoom à la molette", () => {
  it("n'utilise PAS onWheel de React — il est passif, donc inopérant", () => {
    expect(source, "onWheel React ne peut pas empêcher le défilement").not.toMatch(
      /onWheel=\{/,
    );
  });

  it("attache un écouteur natif explicitement NON passif", () => {
    expect(source).toMatch(/addEventListener\(\s*"wheel"[\s\S]{0,80}passive:\s*false/);
  });

  it("appelle preventDefault — sinon la page défile en même temps", () => {
    expect(source).toMatch(/preventDefault\(\)/);
  });

  it("exige Ctrl ou ⌘ : la molette NUE doit laisser la page défiler", () => {
    // L'invariant qui protège la navigation. Sans lui, on remplace un bug par un pire :
    // un écran qu'on ne peut plus parcourir du tout.
    expect(source).toMatch(/if \(!e\.ctrlKey && !e\.metaKey\) return;/);
  });

  it("retire l'écouteur au démontage", () => {
    expect(source).toMatch(/removeEventListener\("wheel"/);
  });

  it("la légende annonce le geste qui marche AUSSI sur téléphone", () => {
    // Les captures de Marc viennent d'un téléphone : il n'y a aucune molette. Promettre
    // « Molette pour zoomer » à quelqu'un qui n'en a pas est une consigne inapplicable.
    expect(source).toMatch(/boutons \+ et −/);
  });
});

// ── LA MÊME RÈGLE, PARTOUT OÙ ELLE S'APPLIQUE ──────────────────────────────────────────
//
// ⚠️ Marc, 20/08 (soir) : « nulle la maps de tendance quand je zoom ça scroll la page ».
// MÊME BUG, autre composant. J'avais corrigé les graphiques le matin sans chercher les
// autres surfaces — un `grep onWheel` l'aurait trouvé le jour même. C'est la classe du
// demi-correctif de l'odomètre (une voie de lecture corrigée sur deux).
//
// Ce test balaie donc TOUTE l'interface, plutôt que de nommer les deux fichiers connus :
// une troisième surface qui apparaîtrait demain tomberait dessus toute seule.
describe("aucune surface zoomable ne capture la molette par onWheel React", () => {
  const fichiers = readdirSync("app/ui").filter((f) => f.endsWith(".tsx"));

  it("balaie bien quelque chose (le garde ne doit pas être vide)", () => {
    expect(fichiers.length).toBeGreaterThan(5);
  });

  for (const f of fichiers) {
    it(`${f} n'a pas de onWheel React`, () => {
      expect(readFileSync(`app/ui/${f}`, "utf8")).not.toMatch(/onWheel=\{/);
    });
  }
});

describe("la carte interactive suit la même règle que les graphiques", () => {
  const carte = readFileSync("app/ui/CarteInteractive.tsx", "utf8");

  it("attache un écouteur natif NON passif et exige Ctrl/⌘", () => {
    expect(carte).toMatch(/addEventListener\("wheel",[^)]*\{\s*passive:\s*false\s*\}/);
    expect(carte).toMatch(/ctrlKey/);
    expect(carte).toMatch(/metaKey/);
    expect(carte).toMatch(/preventDefault\(\)/);
  });

  it("la légende NOMME le geste réel — une consigne inapplicable est pire que rien", () => {
    // Elle a dit « molette pour zoomer » pendant que la molette nue faisait défiler la
    // page : on cherche alors le défaut au mauvais endroit.
    expect(carte).toMatch(/Ctrl\/⌘ \+ molette/);
  });

  it("la carte Google vivante exige le même geste, via le mode de Google", () => {
    const vivante = readFileSync("app/ui/CarteGoogleVivante.tsx", "utf8");
    expect(vivante).toMatch(/gestureHandling: "cooperative"/);
  });
});
