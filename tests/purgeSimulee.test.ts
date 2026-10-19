// tests/purgeSimulee.test.ts — la seule opération irréversible de l'app.
//
// Marc, 19/08/2026 : « oui purge les données du véhicule simulé ». Une suppression en base
// ne se rattrape pas au déploiement suivant : chaque motif doit être PROUVABLE, et le test
// vérifie surtout ce que la purge REFUSE de toucher. Un test qui n'exercerait que les cas à
// supprimer verrouillerait exactement le mauvais comportement.

import { describe, expect, it } from "vitest";
import {
  motifPosition,
  pressionImpossible,
  LONDRES,
  RAYON_LONDRES_KM,
  PRESSION_PLANCHER_KPA,
} from "@/lib/vehicle/purgeSimulee";

/** Quelques points réels du Québec, pris dans les trajets de Marc. */
const QUEBEC = [
  { lat: 46.82, lng: -71.25 },
  { lat: 46.84, lng: -71.28 },
  { lat: 47.45, lng: -70.43 },
  { lat: 46.22, lng: -71.77 },
];

describe("motifPosition — ce qu'il DÉSIGNE", () => {
  it("reconnaît la position du véhicule simulé (Londres)", () => {
    expect(motifPosition(LONDRES)).toBe("position-londres");
    // La valeur exacte vue dans les trajets fantômes.
    expect(motifPosition({ lat: 51.5014, lng: -0.1419 })).toBe("position-londres");
  });

  it("reconnaît le 0°,0°", () => {
    expect(motifPosition({ lat: 0, lng: 0 })).toBe("position-nulle");
  });
});

describe("motifPosition — ce qu'il REFUSE de désigner", () => {
  it("ne touche à AUCUN point du Québec", () => {
    for (const p of QUEBEC) {
      expect(motifPosition(p), `${p.lat},${p.lng} est un vrai endroit de Marc`).toBeNull();
    }
  });

  it("ne conclut rien sans position", () => {
    expect(motifPosition(null)).toBeNull();
  });

  it("ne prend pas une position VALIDE proche de 0 pour une position nulle", () => {
    // Le golfe de Guinée existe. Le seuil est à 0,001° (~100 m), pas à « autour de zéro ».
    expect(motifPosition({ lat: 0.5, lng: 0.5 })).toBeNull();
  });

  it("laisse un point juste HORS du rayon de Londres", () => {
    // ~1,8° de latitude ≈ 200 km au nord : au-delà du rayon, on ne conclut plus.
    expect(motifPosition({ lat: LONDRES.lat + 1.8, lng: LONDRES.lng })).toBeNull();
  });

  it("le rayon reste petit devant la distance Québec–Londres", () => {
    // Garde de CONCEPTION : le jour où quelqu'un élargit le rayon, ce test rappelle qu'il
    // n'existe aucune zone grise entre les deux — 100 km sur 5 000, il y a de la marge.
    expect(RAYON_LONDRES_KM).toBeLessThan(1000);
  });
});

// ── Pressions impossibles (Marc, 19/08 : « le 32 kPa du 11/08, c'est pas possible ») ────
//
// 32 kPa = 4,6 psi : le pneu est à plat sur la jante. La voiture a roulé ce jour-là.
// Ce n'est pas une crevaison, c'est une mesure fausse — probablement une valeur en psi
// rangée comme des kPa.

const roues = (...kpa: number[]) =>
  kpa.map((tirePressure, i) => ({
    row: i < 2 ? 0 : 1,
    column: i % 2,
    tirePressure,
  }));

describe("pressionImpossible — ce qu'il désigne", () => {
  it("les QUATRE pneus à 32 kPa : le cas du 11/08", () => {
    expect(pressionImpossible(roues(32, 32, 32, 32))).toBe(true);
  });

  it("quatre pneus juste sous le plancher", () => {
    const bas = PRESSION_PLANCHER_KPA - 1;
    expect(pressionImpossible(roues(bas, bas, bas, bas))).toBe(true);
  });
});

describe("pressionImpossible — ce qu'il REFUSE de désigner", () => {
  it("UN SEUL pneu à plat reste une VRAIE crevaison — on n'y touche pas", () => {
    // C'est le test le plus important du fichier. Un pneu à 32 kPa et trois normaux, c'est
    // exactement ce à quoi ressemble une crevaison : l'événement de sécurité qu'il faut
    // surtout NE PAS effacer. La condition est « tous », jamais « au moins un ».
    expect(pressionImpossible(roues(32, 268, 262, 268))).toBe(false);
    expect(pressionImpossible(roues(0, 268, 262, 268))).toBe(false);
  });

  it("laisse les pressions réelles de la bZ", () => {
    expect(pressionImpossible(roues(268.9, 262, 268.9, 262))).toBe(false);
  });

  it("ne conclut rien sur un relevé illisible", () => {
    for (const x of [null, undefined, {}, [], "texte"]) {
      expect(pressionImpossible(x)).toBe(false);
    }
  });

  it("le plancher reste très en dessous d'un pneu roulable", () => {
    // Garde de CONCEPTION : le relever au-dessus de ~100 kPa commencerait à mordre sur des
    // sous-gonflages RÉELS, qui sont précisément ce que l'app doit signaler.
    expect(PRESSION_PLANCHER_KPA).toBeLessThan(100);
  });
});
