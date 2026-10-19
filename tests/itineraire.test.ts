// tests/itineraire.test.ts — la préparation d'un trajet pour l'itinéraire Google.
//
// Le bug d'origine (Marc, 17/08 : « je vois que la destination pas le trajet ») : un
// trajet en BOUCLE (départ ≈ arrivée) donnait origine = destination à l'Embed API, qui
// n'affichait qu'une épingle. Chaque comportement d'ici est ce qui l'empêche de revenir.

import { describe, expect, it } from "vitest";
import {
  MAX_ETAPES,
  planifierItineraire,
  type PointGps,
} from "@/lib/itineraire";

// Repère à Québec. ~1° de latitude ≈ 111,32 km ; la longitude est corrigée du cosinus.
const QC = { lat: 46.8139, lng: -71.208 };

/** Un point à `nord` / `est` mètres du repère — les cas se lisent en mètres, pas en degrés. */
function p(nordM: number, estM: number): PointGps {
  return {
    lat: QC.lat + nordM / 111_320,
    lng: QC.lng + estM / (111_320 * Math.cos((QC.lat * Math.PI) / 180)),
  };
}

describe("planifierItineraire — les boucles (le bug du 17/08)", () => {
  it("une boucle AVEC un relevé éloigné trace l'itinéraire en passant par lui", () => {
    // Maison → commerce à 2 km → maison (retour à 30 m du départ : boucle).
    const plan = planifierItineraire([p(0, 0), p(2000, 0), p(30, 0)]);
    expect(plan).not.toBeNull();
    if (plan?.mode !== "itineraire") throw new Error(`attendu un itinéraire, reçu ${plan?.mode}`);
    expect(plan.etapes).toHaveLength(1);
    expect(plan.etapes[0]).toEqual(p(2000, 0));
    // Les ancres restent les relevés RÉELS — jamais recalculées ni fusionnées.
    expect(plan.origine).toEqual(p(0, 0));
    expect(plan.destination).toEqual(p(30, 0));
  });

  it("une boucle SANS relevé éloigné devient « sur place » — jamais une épingle muette", () => {
    // L'ancien code envoyait origine ≈ destination sans étape : Google affichait UNE
    // épingle, sans explication. C'est exactement la capture de Marc.
    const plan = planifierItineraire([p(0, 0), p(40, 20)]);
    expect(plan).toEqual({ mode: "sur-place", centre: p(40, 20) });
  });

  it("un vrai A → B à deux relevés reste un itinéraire direct", () => {
    const plan = planifierItineraire([p(0, 0), p(3000, 0)]);
    if (plan?.mode !== "itineraire") throw new Error(`attendu un itinéraire, reçu ${plan?.mode}`);
    expect(plan.etapes).toHaveLength(0);
    expect(plan.origine).toEqual(p(0, 0));
    expect(plan.destination).toEqual(p(3000, 0));
  });
});

describe("planifierItineraire — le tri des étapes candidates", () => {
  it("dédoublonne les relevés d'un même arrêt (< 120 m du candidat précédent)", () => {
    const plan = planifierItineraire([
      p(0, 0),
      p(1000, 0),
      p(1010, 5), // le même arrêt, relevé deux fois
      p(1030, -5), // et une troisième
      p(2000, 0),
    ]);
    if (plan?.mode !== "itineraire") throw new Error(`attendu un itinéraire, reçu ${plan?.mode}`);
    expect(plan.etapes).toEqual([p(1000, 0)]);
  });

  it("écarte les relevés collés à l'origine ou à la destination (< 150 m)", () => {
    const plan = planifierItineraire([
      p(0, 0),
      p(100, 0), // encore dans la cour de départ
      p(2500, 0),
      p(4900, 0), // déjà dans la cour d'arrivée
      p(5000, 0),
    ]);
    if (plan?.mode !== "itineraire") throw new Error(`attendu un itinéraire, reçu ${plan?.mode}`);
    expect(plan.etapes).toEqual([p(2500, 0)]);
  });

  it("aucun point → null ; un seul point → « sur place »", () => {
    expect(planifierItineraire([])).toBeNull();
    expect(planifierItineraire([p(0, 0)])).toEqual({ mode: "sur-place", centre: p(0, 0) });
  });
});

describe("planifierItineraire — l'échantillonnage sous le plafond d'étapes", () => {
  // Une boucle aller-retour : 28 relevés qui S'ÉLOIGNENT (300 m d'écart), puis retour
  // direct au départ. L'APEX (le relevé le plus loin, à 8,4 km) est APRÈS toutes les
  // cibles d'échantillonnage kilométrique — un échantillonnage sans apex forcé le RATE,
  // et Google refermerait la boucle au plus court. Ce cas est le discriminant : retirer
  // le forçage de l'apex fait échouer ce test (prouvé par mutation à l'écriture).
  const allerRetour: PointGps[] = [
    p(0, 0),
    ...Array.from({ length: 28 }, (_, i) => p(300 * (i + 1), 0)),
    p(30, 0), // boucle
  ];

  it("plafonne à MAX_ETAPES, dans l'ordre du parcours, en forçant l'apex", () => {
    const plan = planifierItineraire(allerRetour);
    if (plan?.mode !== "itineraire") throw new Error(`attendu un itinéraire, reçu ${plan?.mode}`);
    expect(plan.etapes).toHaveLength(MAX_ETAPES);
    // L'apex de la boucle est dedans — c'est LUI qui donne sa forme au trajet.
    expect(plan.etapes).toContainEqual(p(300 * 28, 0));
    // Et les étapes suivent l'ordre du parcours (Google les visite dans cet ordre).
    const nords = plan.etapes.map((e) => e.lat);
    expect([...nords].sort((a, b) => a - b)).toEqual(nords);
  });

  it("sous le plafond, TOUS les candidats deviennent des étapes (rien d'inventé, rien de perdu)", () => {
    const plan = planifierItineraire([p(0, 0), p(1000, 0), p(2000, 0), p(3000, 0)]);
    if (plan?.mode !== "itineraire") throw new Error(`attendu un itinéraire, reçu ${plan?.mode}`);
    expect(plan.etapes).toEqual([p(1000, 0), p(2000, 0)]);
  });
});
