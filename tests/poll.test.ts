// tests/poll.test.ts — le poll qui comble les silences du webhook.
//
// La propriété critique : la réponse de l'API `GET /vehicles/{id}/signals` a une forme
// DIFFÉRENTE de celle du webhook (code et status sous `attributes`, `id` à la racine).
// Lire seulement la racine faisait rendre `null` à chaque signal — un poll qui écrit
// zéro mesure sans lever la moindre erreur.

import { describe, expect, it } from "vitest";
import { extraireSignaux, grouperParStatut } from "@/lib/smartcar/poll";
import { filtrerRepetitions } from "@/lib/smartcar/ingest";
import type { NouveauSnapshot } from "@/lib/db/schema";
import {
  normaliserSignal,
  resumerStatutsSignaux,
  signalVersSnapshot,
  signauxVersSnapshots,
} from "@/lib/smartcar/signals";

const RECU_LE = new Date("2026-08-11T21:00:00.000Z");

/** Forme RÉELLE du catalogue, copiée d'une réponse de production du 11/08/2026. */
const SIGNAL_API = {
  id: "tractionbattery-stateofcharge",
  type: "signal",
  attributes: {
    code: "tractionbattery-stateofcharge",
    name: "StateOfCharge",
    group: "TractionBattery",
    status: { value: "SUCCESS" },
    body: { value: 75, unit: "percent" },
  },
  meta: {
    ingestedAt: "2026-08-11T20:52:00.000Z",
    retrievedAt: "2026-08-11T20:52:00.000Z",
    oemUpdatedAt: "2026-08-11T17:05:00.000Z",
  },
  links: { self: "https://vehicle.api.smartcar.com/v3/vehicles/abc/signals/…" },
};

const SIGNAL_API_REFUSE = {
  id: "motion-currentspeed",
  type: "signal",
  attributes: {
    code: "motion-currentspeed",
    name: "CurrentSpeed",
    group: "Motion",
    status: {
      value: "ERROR",
      error: { type: "PERMISSION", code: "UNKNOWN" },
    },
  },
  meta: { ingestedAt: "2026-08-11T20:52:00.000Z" },
};

describe("normaliserSignal — forme de l'API, pas seulement celle du webhook", () => {
  it("lit code, statut et valeur quand ils vivent sous `attributes`", () => {
    const signal = normaliserSignal(SIGNAL_API);
    expect(signal).not.toBeNull();
    expect(signal!.code).toBe("tractionbattery-stateofcharge");
    expect(signal!.groupe).toBe("tractionbattery");
    expect(signal!.valeur).toBe(75);
    expect(signal!.unite).toBe("percent");
    expect(signal!.statut).toBe("SUCCESS");
    // `oemUpdatedAt` fait foi : c'est l'instant où le VÉHICULE a produit la mesure —
    // 17:05, pas 20:52 où Smartcar l'a relue. C'est ce qui empêche un poll de créer une
    // fausse mesure à chaque passage sur une donnée figée.
    expect(signal!.oemUpdatedAt?.toISOString()).toBe("2026-08-11T17:05:00.000Z");
  });

  it("le motif d'un refus survit aussi à la forme API", () => {
    const signal = normaliserSignal(SIGNAL_API_REFUSE);
    expect(signal!.statut).toBe("ERROR (PERMISSION)");
    expect(signalVersSnapshot(signal!, { source: "smartcar", recuLe: RECU_LE }).valueNumeric)
      .toBeNull();
  });

  it("`id` sert de code de repli quand `code` manque partout", () => {
    const signal = normaliserSignal({ id: "wheel-tires", attributes: { body: { value: 1 } } });
    expect(signal!.code).toBe("wheel-tires");
  });

  it("NON-RÉGRESSION : la forme du webhook (tout à la racine) marche toujours", () => {
    const signal = normaliserSignal({
      code: "odometer-traveleddistance",
      group: "Odometer",
      body: { value: 3400, unit: "km" },
      status: { value: "SUCCESS" },
    });
    expect(signal!.code).toBe("odometer-traveleddistance");
    expect(signal!.valeur).toBe(3400);
    expect(signal!.statut).toBe("SUCCESS");
  });
});

describe("extraireSignaux — l'enveloppe de la réponse", () => {
  it("lit `data` et le total annoncé", () => {
    const { signaux, totalAnnonce } = extraireSignaux({
      data: [SIGNAL_API, SIGNAL_API_REFUSE],
      meta: { totalCount: 84, pageSize: 30, pageNumber: 1 },
    });
    expect(signaux).toHaveLength(2);
    // Le total sert à DIRE qu'une réponse est partielle plutôt qu'à la faire passer pour
    // complète — la leçon des bornes de tête, appliquée à la pagination.
    expect(totalAnnonce).toBe(84);
  });

  it("tolère `signals` à la racine, et une enveloppe inconnue rend une liste vide", () => {
    expect(extraireSignaux({ signals: [SIGNAL_API] }).signaux).toHaveLength(1);
    expect(extraireSignaux({ autre: true }).signaux).toEqual([]);
    expect(extraireSignaux(null).signaux).toEqual([]);
    expect(extraireSignaux({ data: [] }).totalAnnonce).toBeNull();
  });
});

describe("le poll alimente le MÊME pipeline que le webhook", () => {
  it("une réponse d'API devient des snapshots écrivables", () => {
    const { signaux } = extraireSignaux({ data: [SIGNAL_API, SIGNAL_API_REFUSE] });
    const lignes = signauxVersSnapshots(signaux, { source: "smartcar", recuLe: RECU_LE });

    expect(lignes).toHaveLength(2);
    const soc = lignes.find((l) => l.metricType === "battery_soc")!;
    expect(soc.valueNumeric).toBe(75);
    expect(soc.signalStatus).toBe("SUCCESS");
    // L'instant de MESURE vient du véhicule : deux polls successifs sur une donnée figée
    // produisent la même clé (source, métrique, instant) et le second est dédupliqué.
    expect(soc.recordedAt.toISOString()).toBe("2026-08-11T17:05:00.000Z");

    // Un signal refusé s'écrit quand même : « la source a refusé » est une information.
    const vitesse = lignes.find((l) => l.signalCode === "motion-currentspeed")!;
    expect(vitesse.signalStatus).toBe("ERROR (PERMISSION)");
    expect(vitesse.valueNumeric).toBeNull();
  });

  it("la ventilation des statuts marche sur la forme API", () => {
    const { succes, enEchec } = resumerStatutsSignaux([SIGNAL_API, SIGNAL_API_REFUSE]);
    expect(succes).toEqual(["tractionbattery-stateofcharge"]);
    expect(enEchec).toEqual([
      { code: "motion-currentspeed", statut: "ERROR (PERMISSION)" },
    ]);
  });
});

describe("filtrerRepetitions — un refus déjà connu ne se ré-inscrit pas", () => {
  const ligne = (
    signalCode: string,
    signalStatus: string | null,
    valeur: number | null = null,
  ): NouveauSnapshot => ({
    recordedAt: RECU_LE,
    receivedAt: RECU_LE,
    source: "smartcar",
    metricType: signalCode,
    signalCode,
    signalStatus,
    valueNumeric: valeur,
    valueText: null,
    valueJson: null,
    unit: null,
    locationType: null,
  });

  it("écarte une répétition, garde une TRANSITION", () => {
    // Mesuré au premier poll réel : sans ce filtre, 58 lignes vides étaient écrites à
    // CHAQUE passage — un signal refusé n'ayant aucun horodatage du véhicule, la
    // déduplication structurelle ne pouvait rien écarter.
    const connus = new Map<string, string | null>([
      ["closure-sunroof", "ERROR (COMPATIBILITY)"],
      ["charge-ischarging", "ERROR (UPSTREAM)"],
    ]);

    const garde = filtrerRepetitions(
      [
        ligne("closure-sunroof", "ERROR (COMPATIBILITY)"), // répétition → écartée
        ligne("charge-ischarging", "SUCCESS"), // la bZ répond à nouveau → GARDÉE
        ligne("signal-neuf", "ERROR (PERMISSION)"), // jamais vu → GARDÉE
      ],
      connus,
    );

    expect(garde.map((l) => l.signalCode)).toEqual(["charge-ischarging", "signal-neuf"]);
  });

  it("une ligne qui porte une VALEUR n'est jamais écartée", () => {
    const connus = new Map<string, string | null>([["odometer", "SUCCESS"]]);
    const garde = filtrerRepetitions([ligne("odometer", "SUCCESS", 3400)], connus);
    expect(garde).toHaveLength(1);
  });

  it("un statut qui disparaît est aussi une transition", () => {
    const connus = new Map<string, string | null>([["x", "ERROR (UPSTREAM)"]]);
    expect(filtrerRepetitions([ligne("x", null)], connus)).toHaveLength(1);
    // …et deux absences de statut consécutives, elles, se répètent.
    expect(filtrerRepetitions([ligne("x", null)], new Map([["x", null]]))).toHaveLength(0);
  });
});

describe("grouperParStatut — la ventilation qui commande l'action", () => {
  it("groupe par statut et trie, pour que deux polls se comparent à l'œil", () => {
    expect(
      grouperParStatut([
        { code: "hvac-b", statut: "ERROR (PERMISSION)" },
        { code: "climate-x", statut: "ERROR (COMPATIBILITY)" },
        { code: "hvac-a", statut: "ERROR (PERMISSION)" },
      ]),
    ).toEqual({
      "ERROR (PERMISSION)": ["hvac-a", "hvac-b"],
      "ERROR (COMPATIBILITY)": ["climate-x"],
    });
  });

  it("aucun refus : un objet vide, jamais des clés fantômes", () => {
    expect(grouperParStatut([])).toEqual({});
  });
});
