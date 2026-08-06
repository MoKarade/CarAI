// tests/livraisonReelle.test.ts — la structure RÉELLE d'une livraison Smartcar.
//
// Ce fichier existe parce que tout le reste du mapping a d'abord été écrit à partir
// d'hypothèses : la documentation de Smartcar est filtrée par la politique réseau des
// sessions Claude, et le Doc 2 §4.2 prévenait que sa table de correspondance n'était pas
// vérifiée. Le 06/08/2026, une VRAIE livraison est enfin arrivée.
//
// Le payload ci-dessous en est la copie fidèle. Il remplace la supposition par le fait, et
// tout écart futur de notre lecture le fera tomber.

import { describe, expect, it } from "vitest";
import { estSimulee, lireEvenement, resumerErreursVehicule } from "@/lib/smartcar/webhook";
import { normaliserSignal, signauxVersSnapshots } from "@/lib/smartcar/signals";

/** Livraison VEHICLE_STATE réellement reçue le 06/08/2026 (mode TEST côté Smartcar). */
const LIVRAISON = {
  eventId: "15f09daf-c094-4612-8553-39b70dd54d58",
  eventType: "VEHICLE_STATE",
  data: {
    user: { id: "bec26c1a-3e7c-4965-8bd7-56ad42f1b854", externalId: "user-external-id-123" },
    vehicle: {
      id: "3a7f39f9-246c-4609-8f4c-ae4ceb8a0281",
      make: "Tesla",
      model: "Model 3",
      year: 2020,
      mode: "test",
      powertrainType: "BEV",
    },
    signals: [
      {
        code: "closure-islocked",
        name: "IsLocked",
        group: "Closure",
        body: { value: true },
        status: { value: "SUCCESS" },
        meta: { oemUpdatedAt: 1786018966898, retrievedAt: 1786018966898 },
      },
      {
        code: "odometer-traveleddistance",
        name: "TraveledDistance",
        group: "Odometer",
        body: { value: 78432, unit: "km" },
        status: { value: "SUCCESS" },
        meta: { oemUpdatedAt: 1786018966898, retrievedAt: 1786018966898 },
      },
      {
        code: "tractionbattery-stateofcharge",
        name: "StateOfCharge",
        group: "TractionBattery",
        body: { value: 78, unit: "percent" },
        status: { value: "SUCCESS" },
        meta: { oemUpdatedAt: 1786018966898, retrievedAt: 1786018966898 },
      },
      {
        code: "vehicleuseraccount-permissions",
        name: "Permissions",
        group: "VehicleUserAccount",
        body: { values: ["vehicle_cmds", "vehicle_device_data"] },
        status: { value: "SUCCESS" },
        meta: { oemUpdatedAt: 1786018966898, retrievedAt: 1786018966898 },
      },
    ],
  },
  triggers: [
    { type: "SIGNAL_UPDATED", signal: { name: "IsLocked", code: "closure-islocked", group: "Closure" } },
  ],
  meta: {
    version: "4.0",
    webhookId: "8e81bb55-8408-44a4-af62-2cfb3b8416e2",
    webhookName: "carai",
    deliveryId: "06816a87-e928-494c-93b0-04c5d3c6e861",
    deliveredAt: 1786018966899,
    mode: "TEST",
    signalCount: 11,
  },
};

const RECU_LE = new Date("2026-08-06T12:00:00.000Z");

describe("enveloppe de la livraison", () => {
  const ev = lireEvenement(LIVRAISON);

  it("reconnaît le type et l'identifiant d'événement", () => {
    expect(ev.type).toBe("VEHICLE_STATE");
    expect(ev.eventId).toBe("15f09daf-c094-4612-8553-39b70dd54d58");
  });

  it("trouve les signaux sous `data.signals` — et NON l'objet `data` entier", () => {
    // La régression que ce test bloque : retomber sur `data` produirait trois
    // pseudo-signaux nommés « user », « vehicle » et « signals ».
    expect(Array.isArray(ev.signaux)).toBe(true);
    expect((ev.signaux as unknown[]).length).toBe(4);
  });

  it("trouve l'identifiant du véhicule sous `data.vehicle.id`", () => {
    expect(ev.vehicleId).toBe("3a7f39f9-246c-4609-8f4c-ae4ceb8a0281");
  });

  it("lit le mode et le reconnaît comme simulé", () => {
    expect(ev.mode).toBe("TEST");
    expect(estSimulee(ev)).toBe(true);
  });

  it("une livraison LIVE n'est PAS traitée comme simulée", () => {
    const live = lireEvenement({ ...LIVRAISON, meta: { ...LIVRAISON.meta, mode: "LIVE" } });
    expect(estSimulee(live)).toBe(false);
  });
});

describe("structure d'un signal", () => {
  it("lit name / group / body à la RACINE du signal, pas sous `attributes`", () => {
    const s = normaliserSignal(LIVRAISON.data.signals[1]!)!;
    expect(s.code).toBe("odometer-traveleddistance");
    expect(s.groupe).toBe("odometer");
    expect(s.nom).toBe("TraveledDistance");
    expect(s.valeur).toBe(78432);
    expect(s.unite).toBe("km");
    expect(s.statut).toBe("SUCCESS");
  });

  it("convertit un horodatage NUMÉRIQUE en millisecondes", () => {
    // Le bug que ce test bloque : n'accepter que des chaînes ISO faisait tomber tous les
    // horodatages à null, donc `recordedAt` sur l'instant de réception — ce qui désactive
    // la déduplication du schéma, entièrement fondée sur `recorded_at`.
    const s = normaliserSignal(LIVRAISON.data.signals[0]!)!;
    expect(s.oemUpdatedAt).not.toBeNull();
    expect(s.oemUpdatedAt!.getTime()).toBe(1786018966898);
    expect(s.oemUpdatedAt!.getUTCFullYear()).toBe(2026);
  });

  it("lit `body.values` au pluriel", () => {
    const s = normaliserSignal(LIVRAISON.data.signals[3]!)!;
    expect(s.valeur).toEqual(["vehicle_cmds", "vehicle_device_data"]);
  });
});

describe("conversion en snapshots", () => {
  const lignes = signauxVersSnapshots(lireEvenement(LIVRAISON).signaux, {
    source: "smartcar",
    recuLe: RECU_LE,
  });

  it("produit une ligne par signal, sans en perdre ni en inventer", () => {
    expect(lignes).toHaveLength(4);
  });

  it("classe correctement les codes réels", () => {
    const par = new Map(lignes.map((l) => [l.signalCode, l.metricType]));
    expect(par.get("odometer-traveleddistance")).toBe("odometer");
    expect(par.get("tractionbattery-stateofcharge")).toBe("battery_soc");
    // `closure-islocked` — et non `closure-lockstatus` comme supposé au départ.
    expect(par.get("closure-islocked")).toBe("lock_status");
  });

  it("date les mesures de l'instant OEM, pas de la réception", () => {
    for (const l of lignes) {
      expect(l.recordedAt.getTime()).toBe(1786018966898);
      expect(l.receivedAt).toEqual(RECU_LE);
    }
  });

  it("range un booléen en texte ET en numérique, un tableau en JSON", () => {
    const verrou = lignes.find((l) => l.signalCode === "closure-islocked")!;
    expect(verrou.valueText).toBe("true");
    expect(verrou.valueNumeric).toBe(1);

    const perms = lignes.find((l) => l.signalCode === "vehicleuseraccount-permissions")!;
    expect(perms.valueJson).toEqual(["vehicle_cmds", "vehicle_device_data"]);
  });

  it("conserve l'unité déclarée, ce qui rend le pourcentage interprétable", () => {
    const soc = lignes.find((l) => l.signalCode === "tractionbattery-stateofcharge")!;
    expect(soc.unit).toBe("percent");
    expect(soc.valueNumeric).toBe(78);
  });
});

// ── VEHICLE_ERROR : l'information la plus actionnable du pipeline ───────────────────
// Reçu en LIVE le 06/08/2026 sur la vraie bZ : huit des onze signaux souscrits refusés.
// Cette information dit exactement quoi retirer de la souscription — encore faut-il
// qu'elle soit lisible, et non noyée dans trente lignes de JSON.
const ERREUR_REELLE = {
  eventId: "036121c7-db5c-429d-914d-cf66ea77d3cd",
  eventType: "VEHICLE_ERROR",
  data: {
    vehicle: {
      id: "c6909d83-4dfc-4b25-85f7-ea060c00fe9d",
      make: "TOYOTA",
      model: "bZ XLE AWD",
      year: 2026,
      mode: "live",
      powertrainType: "BEV",
    },
    errors: [
      {
        type: "COMPATIBILITY",
        code: "VEHICLE_NOT_CAPABLE",
        resolution: { type: null },
        signals: [
          { code: "connectivitysoftware-currentfirmwareversion" },
          { code: "connectivitystatus-isasleep" },
          { code: "connectivitystatus-isdigitalkeypaired" },
          { code: "connectivitystatus-isonline" },
          { code: "vehicleidentification-nickname" },
          { code: "vehicleuseraccount-permissions" },
          { code: "vehicleuseraccount-role" },
        ],
      },
      {
        type: "PERMISSION",
        code: null,
        resolution: { type: "REAUTHENTICATE" },
        signals: [{ code: "internalcombustionengine-fuellevel" }],
      },
    ],
  },
  meta: { mode: "LIVE", deliveryId: "b670fe35", webhookName: "carai", version: "4.0" },
};

describe("resumerErreursVehicule", () => {
  const lignes = resumerErreursVehicule(ERREUR_REELLE);

  it("produit une ligne par famille d'erreur", () => {
    expect(lignes).toHaveLength(2);
  });

  it("nomme les signaux refusés — c'est ce qui dit quoi retirer", () => {
    expect(lignes[0]).toContain("7 signal(aux)");
    expect(lignes[0]).toContain("connectivitystatus-isonline");
  });

  it("distingue les deux causes, qui appellent des gestes OPPOSÉS", () => {
    // COMPATIBILITY : réessayer est vain, il faut retirer le signal.
    expect(lignes[0]).toContain("NE SAIT PAS");
    // PERMISSION : refaire le Connect peut régler le cas.
    expect(lignes[1]).toContain("Connect");
  });

  it("ne lève pas sur une charge vide ou inattendue", () => {
    expect(resumerErreursVehicule(null)).toHaveLength(1);
    expect(resumerErreursVehicule({ data: {} })).toHaveLength(1);
  });

  it("l'événement est bien classé VEHICLE_ERROR et reconnu comme LIVE", () => {
    const ev = lireEvenement(ERREUR_REELLE);
    expect(ev.type).toBe("VEHICLE_ERROR");
    expect(estSimulee(ev)).toBe(false);
    expect(ev.vehicleId).toBe("c6909d83-4dfc-4b25-85f7-ea060c00fe9d");
  });
});
