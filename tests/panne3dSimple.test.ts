// tests/panne3dSimple.test.ts — une panne 3D dit la panne en mots simples, sans le texte
// technique de l'erreur (carte 11 du 15/10) ; le détail va dans la console.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("pannes de la vue 3D", () => {
  const source = readFileSync("app/ui/Voiture3D.tsx", "utf8");

  it("n'ajoute plus le message technique de l'erreur au texte affiché", () => {
    expect(source).not.toMatch(/setPanne\(\s*`[^`]*\$\{e instanceof Error/);
  });

  it("dit les trois pannes en mots simples", () => {
    expect(source).toContain("La vue 3D n’est pas disponible sur cet appareil.");
    expect(source).toContain("Le modèle 3D n’a pas pu être chargé.");
    expect(source).toContain("La vue 3D n’a pas pu démarrer.");
  });

  it("garde le détail dans la console pour le diagnostic", () => {
    expect(source.match(/console\.error\("\[3d\]/g)?.length).toBe(3);
  });
});
