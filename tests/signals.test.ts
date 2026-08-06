// tests/signals.test.ts — traduction des signaux Smartcar.
//
// Ces tests portent sur la partie la plus INCERTAINE du projet : la doc Smartcar n'a pas pu
// être consultée (egress bloqué), donc les noms de signaux sont des hypothèses. Ils
// vérifient donc surtout que se TROMPER de nom ne coûte aucune donnée — c'est la propriété
// qui protège l'historique, pas l'exactitude d'une table qu'on ne peut pas encore vérifier.

import { describe, expect, it } from "vitest";
import {
  CORRESPONDANCE_EXACTE,
  SIGNAUX_CONFIRMES_BZ,
  codesDesSignaux,
  nombreDeSignaux,
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

  // ⚠️ REFORMULÉ le 06/08/2026. Ce test vérifiait que le repli par GROUPE rattrapait un
  // nom de signal inconnu. Ce repli a dû être RETIRÉ du chemin d'écriture : la bZ publie
  // six signaux `Charge` et quatre `Closure` au même horodatage, et les ranger sous une
  // métrique commune les faisait entrer en collision avec l'index unique — sept mesures
  // sur quinze disparaissaient sans bruit.
  //
  // L'invariant PROTÉGÉ n'était pas « le groupe classe », c'était « aucune donnée n'est
  // perdue ». Il est désormais garanti plus fortement : par l'UNICITÉ.
  it("deux codes DISTINCTS ne partagent jamais la même métrique", () => {
    const codes = [
      "charge-ischarging",
      "charge-detailedchargingstatus",
      "charge-ischargingcableconnected",
      "charge-ischargingportflapopen",
      "charge-timetocomplete",
      "charge-chargetimers",
      "closure-islocked",
      "closure-doors",
      "closure-windows",
      "closure-enginecover",
    ];
    const metriques = codes.map((c) => metriquePourSignal(c, c.split("-")[0]!));
    expect(new Set(metriques).size).toBe(codes.length);
  });

  it("un code inconnu devient sa propre métrique — unique, donc jamais écrasé", () => {
    expect(metriquePourSignal("closure-doorlockstate", "closure")).toBe("closure-doorlockstate");
    expect(metriquePourSignal("wheel-tirepressurefrontleft", "wheel")).toBe(
      "wheel-tirepressurefrontleft",
    );
    // Et deux inconnus du même groupe restent distincts l'un de l'autre.
    expect(metriquePourSignal("closure-a", "closure")).not.toBe(
      metriquePourSignal("closure-b", "closure"),
    );
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
      code: "closure-islocked",
      group: "Closure",
      body: { value: null },
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

describe("SIGNAUX_CONFIRMES_BZ — la liste de référence de la couverture", () => {
  it("compte 15 signaux, tous uniques", () => {
    // 15 = le rapport Smartcar du 06/08/2026 (statuts SUCCESS sur la bZ). Si un signal
    // passe SUCCESS plus tard (ex. motion-currentspeed après un Connect élargi), ce test
    // se met à jour DANS LE MÊME COMMIT que la liste.
    expect(SIGNAUX_CONFIRMES_BZ).toHaveLength(15);
    expect(new Set(SIGNAUX_CONFIRMES_BZ).size).toBe(15);
  });

  it("chaque code confirmé a une correspondance EXACTE (jamais le repli code brut)", () => {
    // Un code confirmé absent de la table serait stocké sous son code brut : rien ne
    // serait perdu, mais l'inventaire afficherait un libellé cryptique pour une donnée
    // qu'on connaît parfaitement.
    for (const code of SIGNAUX_CONFIRMES_BZ) {
      expect(CORRESPONDANCE_EXACTE[code], `${code} devrait être mappé`).toBeDefined();
    }
  });
});

describe("formes RÉELLES du catalogue de signaux (06/08/2026, bZ live)", () => {
  it("un corps SANS value/values est stocké en entier — closure-enginecover: { isOpen }", () => {
    // Vu sur le vrai véhicule : le capot avant répond `body: { isOpen: false }`, ni
    // `value` ni `values`. La première version écrivait « non communiqué » pour un état
    // qui était là, sous nos yeux.
    const normalise = normaliserSignal({
      code: "closure-enginecover",
      name: "EngineCover",
      group: "Closure",
      body: { isOpen: false },
      status: { value: "SUCCESS" },
    });
    const ligne = signalVersSnapshot(normalise!, { source: "smartcar", recuLe: RECU_LE });
    expect(ligne.metricType).toBe("frunk_status");
    expect(ligne.valueJson).toEqual({ isOpen: false });
  });

  it("la position embarque son TYPE : LAST_PARKED n'est pas du temps réel", () => {
    const normalise = normaliserSignal({
      code: "location-preciselocation",
      name: "PreciseLocation",
      group: "Location",
      body: {
        latitude: 46.157352,
        longitude: -71.88961,
        heading: null,
        direction: null,
        locationType: "LAST_PARKED",
      },
      status: { value: "SUCCESS" },
    });
    const ligne = signalVersSnapshot(normalise!, { source: "smartcar", recuLe: RECU_LE });
    expect(ligne.locationType).toBe("last_parked");
    expect(ligne.valueJson).toMatchObject({ latitude: 46.157352 });
  });

  it("REAL_TIME est reconnu aussi, et un corps à `value` garde le chemin nominal", () => {
    const tempsReel = normaliserSignal({
      code: "location-preciselocation",
      body: { latitude: 1, longitude: 2, locationType: "REAL_TIME" },
    });
    expect(
      signalVersSnapshot(tempsReel!, { source: "smartcar", recuLe: RECU_LE }).locationType,
    ).toBe("real_time");

    // Non-régression : `body: { value, unit }` ne doit PAS tomber dans le repli corps
    // entier — l'autonomie réelle porte aussi type/additionalValues à côté de value.
    const autonomie = normaliserSignal({
      code: "tractionbattery-range",
      body: { value: 293.8, type: "DEFAULT", additionalValues: [], unit: "km" },
    });
    const ligne = signalVersSnapshot(autonomie!, { source: "smartcar", recuLe: RECU_LE });
    expect(ligne.valueNumeric).toBe(293.8);
    expect(ligne.unit).toBe("km");
    expect(ligne.valueJson).toBeNull();
  });
});

describe("aucun couple de codes vers la même métrique (collision d'index unique)", () => {
  it("chaque métrique de CORRESPONDANCE_EXACTE n'a qu'UN code", () => {
    // Deux codes partageant une métrique ET un horodatage : le second est écarté par
    // l'index unique comme un doublon, en silence — la perte exacte que le correctif du
    // repli par groupe (#10) a fermée. Ce test empêche de la réintroduire par la table.
    const parMetrique = new Map<string, string[]>();
    for (const [code, metrique] of Object.entries(CORRESPONDANCE_EXACTE)) {
      parMetrique.set(metrique, [...(parMetrique.get(metrique) ?? []), code]);
    }
    for (const [metrique, codes] of parMetrique) {
      expect(codes, `métrique ${metrique} partagée par ${codes.join(" et ")}`).toHaveLength(1);
    }
  });
});

describe("signalVersSnapshot — le STATUT fait partie de la mesure", () => {
  it("écrit le statut déclaré par la source", () => {
    const normalise = normaliserSignal({
      code: "tractionbattery-stateofcharge",
      body: {},
      status: { value: "UNKNOWN" },
    });
    const ligne = signalVersSnapshot(normalise!, { source: "smartcar", recuLe: RECU_LE });
    // Sans lui, une ligne sans valeur est ambiguë pour toujours : « la bZ a répondu
    // UNKNOWN » et « la donnée a été refusée » se ressemblent, et le raw qui permettait
    // de trancher est purgé après sa fenêtre de rétention.
    expect(ligne.signalStatus).toBe("UNKNOWN");
    expect(ligne.valueNumeric).toBeNull();
  });

  it("statut absent ⇒ null, jamais un « SUCCESS » inventé", () => {
    const normalise = normaliserSignal({ code: "odometer-traveleddistance", body: { value: 5 } });
    const ligne = signalVersSnapshot(normalise!, { source: "smartcar", recuLe: RECU_LE });
    expect(ligne.signalStatus).toBeNull();
  });
});

describe("codesDesSignaux — le journal dit LESQUELS, pas seulement combien", () => {
  it("liste les codes triés d'une charge réelle", () => {
    const codes = codesDesSignaux([
      { code: "odometer-traveleddistance", body: { value: 1200 } },
      { code: "closure-islocked", body: { value: true } },
      { code: "charge-ischarging", body: { value: false } },
    ]);
    expect(codes).toEqual([
      "charge-ischarging",
      "closure-islocked",
      "odometer-traveleddistance",
    ]);
  });

  it("écarte un signal sans code lisible au lieu d'inventer une entrée", () => {
    const codes = codesDesSignaux([
      { code: "closure-islocked", body: { value: true } },
      { body: { value: 42 } },
      { code: "   " },
    ]);
    expect(codes).toEqual(["closure-islocked"]);
  });

  it("tolère l'objet indexé, comme le chemin d'écriture", () => {
    // Même coercition que signauxVersSnapshots : si les deux lectures divergeaient, le
    // journal mentirait sur ce qui a réellement été écrit.
    const charge = { "odometer-traveleddistance": { body: { value: 5 } } };
    expect(codesDesSignaux(charge)).toEqual(["odometer-traveleddistance"]);
    expect(signauxVersSnapshots(charge, { source: "smartcar", recuLe: RECU_LE })).toHaveLength(1);
  });

  it("rend une liste vide sur une charge absente", () => {
    expect(codesDesSignaux(null)).toEqual([]);
    expect(codesDesSignaux(undefined)).toEqual([]);
  });
});

describe("nombreDeSignaux — le compte suit la MÊME coercition que l'écriture", () => {
  it("compte l'objet indexé comme le tableau", () => {
    // Compter `length` seulement sur un tableau affichait « 0 reçu » — le signal
    // d'alarme par excellence — pour une charge en objet pourtant écrite normalement,
    // avec un delta « sans code lisible » NÉGATIF (revue adversariale du 06/08/2026).
    const objet = { "odometer-traveleddistance": { body: { value: 5 } } };
    expect(nombreDeSignaux(objet)).toBe(1);
    expect(nombreDeSignaux([{ code: "a" }, { code: "b" }])).toBe(2);
  });

  it("compte aussi les signaux SANS code lisible (l'écart reste positif et visible)", () => {
    const charge = [{ code: "closure-islocked" }, { body: { value: 42 } }];
    expect(nombreDeSignaux(charge)).toBe(2);
    expect(codesDesSignaux(charge)).toHaveLength(1);
  });

  it("rend 0 sur une charge absente", () => {
    expect(nombreDeSignaux(null)).toBe(0);
    expect(nombreDeSignaux(undefined)).toBe(0);
  });
});
