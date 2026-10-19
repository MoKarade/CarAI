// tests/bulles.test.ts — la règle de désélection des bulles posées sur la voiture.

import { describe, expect, it } from "vitest";
import { bullesAFermer } from "@/lib/vehicle/bulles";

describe("bullesAFermer — un appui ailleurs désélectionne", () => {
  it("un appui HORS de toute bulle les ferme toutes", () => {
    expect(bullesAFermer(["charge", "verrou"], null)).toEqual(["charge", "verrou"]);
  });

  it("un appui DANS une autre bulle ferme la précédente", () => {
    expect(bullesAFermer(["charge"], "verrou")).toEqual(["charge"]);
  });

  it("⚠️ la bulle VISÉE n'est jamais fermée, même déjà ouverte", () => {
    // C'est le cas qui casse si on l'oublie : la bascule native du `<details>` suit
    // l'appui : la refermer nous-mêmes l'annulerait, et un appui sur une bulle ouverte ne
    // la refermerait PLUS JAMAIS.
    expect(bullesAFermer(["charge"], "charge")).toEqual([]);
  });

  it("rien d'ouvert : rien à faire, quel que soit l'appui", () => {
    expect(bullesAFermer([], null)).toEqual([]);
    expect(bullesAFermer([], "charge")).toEqual([]);
  });

  it("garde l'ORDRE des bulles reçues — le composant s'en sert pour parcourir le DOM", () => {
    expect(bullesAFermer(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });
});
