// tests/fraicheur.test.ts — le ton du badge « dernière mise à jour » de l'accueil.
//
// Demande Marc (17/08) : « je veux que ce soit indiqué clairement c'est quand la
// dernière update ». Les cas se dérivent des CONSTANTES, jamais de leurs valeurs du
// jour (leçon DriveAI : un test codé « 90 min ≥ 90 » ment au premier rajustement).

import { describe, expect, it } from "vitest";
import {
  FRAICHEUR_ATTENTION_MINUTES,
  FRAICHEUR_DANGER_MINUTES,
  tonFraicheur,
} from "@/lib/vehicle/state";
import { SEUIL_SILENCE_HEURES } from "@/lib/hubSummary";

describe("tonFraicheur", () => {
  it("dans le rythme normal du véhicule (30–60 min) : ok", () => {
    expect(tonFraicheur(0)).toBe("ok");
    expect(tonFraicheur(FRAICHEUR_ATTENTION_MINUTES - 1)).toBe("ok");
  });

  it("au seuil d'attention et au-delà : attention", () => {
    expect(tonFraicheur(FRAICHEUR_ATTENTION_MINUTES)).toBe("attention");
    expect(tonFraicheur(FRAICHEUR_DANGER_MINUTES - 1)).toBe("attention");
  });

  it("au seuil de danger, ou sans aucune donnée : danger", () => {
    expect(tonFraicheur(FRAICHEUR_DANGER_MINUTES)).toBe("danger");
    expect(tonFraicheur(null)).toBe("danger");
  });

  it("le seuil de danger raconte la MÊME histoire que l'alerte de silence du summary", () => {
    // Deux seuils qui divergent = un badge vert pendant que le hub alerte (ou l'inverse).
    // Verrouillé ici, par import des deux constantes — sans dépendance entre les modules.
    expect(FRAICHEUR_DANGER_MINUTES).toBe(SEUIL_SILENCE_HEURES * 60);
  });
});
