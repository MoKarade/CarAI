// tests/signals.test.ts — traduction des signaux Smartcar.
//
// Ces tests portent sur la partie la plus INCERTAINE du projet : la doc Smartcar n'a pas pu
// être consultée (egress bloqué), donc les noms de signaux sont des hypothèses. Ils
// vérifient donc surtout que se TROMPER de nom ne coûte aucune donnée — c'est la propriété
// qui protège l'historique, pas l'exactitude d'une table qu'on ne peut pas encore vérifier.

import { describe, expect, it } from "vitest";
import {
  interpreterPourcentage,
  metriquePourSignal,
  normaliserSignal,
  signalVersSnapshot,
  signauxVersSnapshots,
} from "@/lib/smartcar/signals";

const RECU_LE = new Date("2026-08-05T12:00:00.000Z");

describe("normaliserSignal — tolérance sur la forme de l'enveloppe", () => {
  it("lit la forme attendue (attributes / body / meta)", () => {
    const signal = normaliserSignal({
      code: "TractionBattery-StateOfCharge",
      attributes: {
        name: "StateOfCharge",
        group: "TractionBattery",
        body: { unit: "percent", value: 62 },
      },
      meta: { oemUpdatedTime: "2026-08-05T11:30:00.000Z" },
    });

    expect(signal).not.toBeNull();
    expect(signal!.code).toBe("tractionbattery-stateofcharge");
    expect(signal!.groupe).toBe("tractionbattery");
    expect(signal!.valeur).toBe(62);
    expect(signal!.unite).toBe("percent");
    expect(signal!.oemUpdatedAt?.toISOString()).toBe("2026-08-05T11:30:00.000Z");
  });

  it("lit aussi une enveloppe alternative (metadata / valeur à la racine)", () => {
    const signal = normaliserSignal({
      code: "odometer-traveleddistance",
      value: 4210,
      metadata: { retrievedTime: "2026-08-05T11:45:00.000Z" },
    });

    expect(signal!.valeur).toBe(4210);
    expect(signal!.groupe).toBe("odometer");
    expect(signal!.retrievedAt?.toISOString()).toBe("2026-08-05T11:45:00.000Z");
  });

  it("refuse un signal sans code plutôt que d'inventer une métrique", () => {
    expect(normaliserSignal({ attributes: { value: 3 } })).toBeNull();
  });
});

describe("metriquePourSignal — trois niveaux, aucune donnée jetée", () => {
  it("correspondance exacte quand le code est connu", () => {
    expect(metriquePourSignal("tractionbattery-stateofcharge", "tractionbattery")).toBe(
      "battery_soc",
    );
  });

  it("repli par GROUPE quand le nom du signal est inconnu", () => {
    // Le cas qui compte : la table de correspondance a été bâtie sans pouvoir lire la doc.
    // Un nom mal deviné doit rester correctement classé grâce au groupe.
    expect(metriquePourSignal("closure-doorlockstate", "closure")).toBe("lock_status");
    expect(metriquePourSignal("wheel-tirepressurefrontleft", "wheel")).toBe("tire_pressure");
  });

  it("conserve le code brut quand même le groupe est inconnu", () => {
    expect(metriquePourSignal("surveillance-cabincamera", "surveillance")).toBe(
      "surveillance-cabincamera",
    );
  });

  it("ne range pas un groupe hors sujet pour un électrique sous une métrique de repli", () => {
    expect(
      metriquePourSignal("internalcombustionengine-oiltemperature", "internalcombustionengine"),
    ).toBe("internalcombustionengine-oiltemperature");
  });
});

describe("signalVersSnapshot — recordedAt et typage des valeurs", () => {
  it("préfère l'horodatage OEM à tout le reste", () => {
    const signal = normaliserSignal({
      code: "tractionbattery-stateofcharge",
      attributes: { group: "TractionBattery", body: { unit: "percent", value: 55 } },
      meta: {
        oemUpdatedTime: "2026-08-05T10:00:00.000Z",
        retrievedTime: "2026-08-05T11:00:00.000Z",
      },
    })!;

    const snap = signalVersSnapshot(signal, { source: "smartcar", recuLe: RECU_LE });
    expect(snap.recordedAt.toISOString()).toBe("2026-08-05T10:00:00.000Z");
    expect(snap.receivedAt).toEqual(RECU_LE);
    expect(snap.valueNumeric).toBe(55);
  });

  it("retombe sur la réception quand la source ne date rien", () => {
    const signal = normaliserSignal({ code: "motion-speed", value: 0 })!;
    const snap = signalVersSnapshot(signal, { source: "smartcar", recuLe: RECU_LE });
    expect(snap.recordedAt).toEqual(RECU_LE);
  });

  it("écrit une ligne même sans valeur — « répondu sans valeur » est une information", () => {
    const signal = normaliserSignal({
      code: "closure-lockstatus",
      attributes: { group: "Closure", body: { value: null } },
    })!;
    const snap = signalVersSnapshot(signal, { source: "smartcar", recuLe: RECU_LE });

    expect(snap.metricType).toBe("lock_status");
    expect(snap.valueNumeric).toBeNull();
    expect(snap.valueText).toBeNull();
  });

  it("range un objet en JSON (position, pressions par pneu)", () => {
    const signal = normaliserSignal({
      code: "location-preciselocation",
      attributes: { group: "Location", body: { value: { latitude: 46.8, longitude: -71.2 } } },
    })!;
    const snap = signalVersSnapshot(signal, {
      source: "toyota_na",
      recuLe: RECU_LE,
      locationType: "real_time",
    });

    expect(snap.metricType).toBe("location");
    expect(snap.valueJson).toEqual({ latitude: 46.8, longitude: -71.2 });
    expect(snap.locationType).toBe("real_time");
  });

  it("rend un booléen lisible ET traçable sur un graphique", () => {
    const signal = normaliserSignal({ code: "charge-ispluggedin", value: true })!;
    const snap = signalVersSnapshot(signal, { source: "smartcar", recuLe: RECU_LE });
    expect(snap.valueText).toBe("true");
    expect(snap.valueNumeric).toBe(1);
  });

  it("ne laisse pas passer une valeur non finie comme un nombre", () => {
    const signal = normaliserSignal({ code: "motion-speed", value: Number.NaN })!;
    const snap = signalVersSnapshot(signal, { source: "smartcar", recuLe: RECU_LE });
    expect(snap.valueNumeric).toBeNull();
  });
});

describe("signauxVersSnapshots — tolère tableau et objet indexé", () => {
  it("traite un tableau", () => {
    const lignes = signauxVersSnapshots(
      [
        { code: "odometer-traveleddistance", value: 4210 },
        { code: "tractionbattery-stateofcharge", value: 62 },
      ],
      { source: "smartcar", recuLe: RECU_LE },
    );
    expect(lignes.map((l) => l.metricType)).toEqual(["odometer", "battery_soc"]);
  });

  it("traite un objet indexé par code", () => {
    const lignes = signauxVersSnapshots(
      { "odometer-traveleddistance": { value: 4210, unit: "km" } },
      { source: "smartcar", recuLe: RECU_LE },
    );
    expect(lignes).toHaveLength(1);
    expect(lignes[0]!.metricType).toBe("odometer");
    expect(lignes[0]!.valueNumeric).toBe(4210);
  });

  it("ignore une charge vide sans lever", () => {
    expect(signauxVersSnapshots(null, { source: "smartcar", recuLe: RECU_LE })).toEqual([]);
  });
});

describe("interpreterPourcentage — l'unité décide, jamais la valeur", () => {
  it("accepte un pourcentage déclaré", () => {
    expect(interpreterPourcentage(62, "percent")).toEqual({ pourcent: 62, fiable: true });
  });

  it("convertit une fraction déclarée", () => {
    expect(interpreterPourcentage(0.3, "ratio")).toEqual({ pourcent: 30, fiable: true });
  });

  it("REFUSE de deviner sans unité — un état de charge de 1 % est légitime", () => {
    // Le bug qu'on évite : une règle « valeur <= 1 ⇒ fraction » afficherait 100 % pour une
    // batterie à 1 %, c'est-à-dire au moment précis où l'information compte le plus.
    const resultat = interpreterPourcentage(1, null);
    expect(resultat.fiable).toBe(false);
    expect(resultat.pourcent).toBe(1);
  });

  it("rend null sur une valeur absente ou non finie", () => {
    expect(interpreterPourcentage(null, "percent").pourcent).toBeNull();
    expect(interpreterPourcentage(Number.POSITIVE_INFINITY, "percent").fiable).toBe(false);
  });
});
