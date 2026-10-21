// tests/ordreTendances.test.ts — l'ordre des blocs de /tendances (CarAI#30).
//
// Décision de Marc (19/10/2026) : « Consommation réelle » ouvre l'écran, avant « Le véhicule
// maintenant » ; la carte de la zone parcourue est SOUS les courbes ; « Ce que ça permet de
// déduire » reste. Seul l'ordre compte ici : aucun calcul ni aucune mesure. La page est un
// composant serveur qui lit la base : on verrouille l'ordre dans son rendu (le JSX de la
// fonction `Tendances`), comme les autres tests de mise en page du dépôt.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("app/tendances/page.tsx", "utf8");
// Le rendu de l'écran seulement : après `<BoutonRafraichir />`, pas les composants au-dessus.
const rendu = source.slice(source.indexOf("<BoutonRafraichir />"));

function place(motif: string): number {
  const i = rendu.indexOf(motif);
  expect(i, `« ${motif} » a disparu du rendu de /tendances`).toBeGreaterThan(-1);
  return i;
}

describe("ordre des blocs de /tendances", () => {
  it("le rendu est bien isolé (anti-vacuité)", () => {
    expect(rendu.length).toBeGreaterThan(500);
    expect(rendu.startsWith("<BoutonRafraichir />")).toBe(true);
  });

  it("la consommation réelle vient avant l'état du véhicule", () => {
    expect(place("<h2>Consommation réelle</h2>")).toBeLessThan(
      place("<h2>Le véhicule maintenant</h2>"),
    );
  });

  it("la consommation est le premier bloc de l'écran", () => {
    const titres = [...rendu.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(titres[0]).toBe("Consommation réelle");
  });

  it("les déductions restent, après l'état du véhicule", () => {
    expect(place("<h2>Ce que ça permet de déduire</h2>")).toBeGreaterThan(
      place("<h2>Le véhicule maintenant</h2>"),
    );
  });

  it("la carte de la zone parcourue est sous les courbes", () => {
    const carte = place("<Trajet ");
    expect(carte).toBeGreaterThan(place("<GraphiquesLies"));
    expect(carte).toBeGreaterThan(place("<GraphiqueMulti"));
    expect(carte).toBeGreaterThan(place("<h2>Évolution</h2>"));
  });
});
