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

  // CarAI#41 : la courbe de consommation OUVRE la liste des courbes liées (axe et zoom
  // partagés avec les autres, règle du 14/08). Les pneus restent au-dessus, sur leur axe
  // unique : ce n'est pas elle qu'on déplace.
  it("la courbe de consommation vient avant les autres courbes liées", () => {
    const conso = source.indexOf('id: "consommation"');
    const autres = source.indexOf("...courbes.map((c, i) => ({");
    expect(conso, "la série « consommation » a disparu de la page").toBeGreaterThan(-1);
    expect(autres, "les autres courbes ont disparu de la liste liée").toBeGreaterThan(-1);
    expect(conso).toBeLessThan(autres);
  });

  it("les courbes liées sont rendues depuis cette liste, en un seul composant", () => {
    expect(rendu.match(/<GraphiquesLies/g)).toHaveLength(1);
    expect(place("<GraphiquesLies series={seriesLiees} />")).toBeGreaterThan(-1);
  });

  it("sans segment retenu, une ligne dit pourquoi au lieu d'une courbe inventée", () => {
    expect(rendu).toContain("Pas de courbe de consommation sur cette période");
  });

  // CarAI#31 : la prévision de fin de mois est une ligne du bloc « Consommation réelle », à la
  // suite des chiffres mesurés, avant l'état du véhicule.
  it("la prévision de fin de mois suit la consommation, dans le même bloc", () => {
    const conso = place("<ConsommationReelle conso={conso} />");
    const prev = place("<PrevisionDuMois prevision={prevision} />");
    expect(prev).toBeGreaterThan(conso);
    expect(prev).toBeLessThan(place("<h2>Le véhicule maintenant</h2>"));
  });

  // « Au rythme des 30 derniers jours » : la fenêtre ne suit PAS le sélecteur de période, sinon
  // regarder les dernières 24 h ferait prévoir un mois à partir d'une journée.
  it("la prévision lit sa propre fenêtre de 30 jours, pas celle du sélecteur", () => {
    const debut = source.indexOf("const debutPrevision");
    expect(debut, "la fenêtre fixe de la prévision a disparu").toBeGreaterThan(-1);
    const bloc = source.slice(debut, source.indexOf("prevision = previsionFinDeMois("));
    expect(bloc).toContain("FENETRE_PREVISION_JOURS");
    expect(bloc).toContain("debut: debutPrevision");
    expect(bloc).toContain("depuis: debutPrevision");
    expect(bloc).not.toMatch(/\bdepuis\b(?!: debutPrevision)/);
  });

  it("la prévision ne parle jamais de dollars (aucun prix du kWh n'est mesuré)", () => {
    const composant = source.slice(
      source.indexOf("function PrevisionDuMois"),
      source.indexOf("La ZONE PARCOURUE"),
    );
    expect(composant.length).toBeGreaterThan(300);
    expect(composant).not.toMatch(/style:\s*["']currency|CAD|\$\s*\d|\d\s*\$/);
    expect(composant).toContain("aucun prix du kWh n’est mesuré");
  });
});
