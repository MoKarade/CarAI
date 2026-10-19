// tests/mesures.test.ts — la requête filtrée qui alimente le tableau ET l'export CSV.
// PGlite + migrations réelles, comme tests/inventaire.test.ts : zéro mock.

import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { vehicleSnapshots, type VehicleSnapshot } from "@/lib/db/schema";
import {
  depuisPourPeriode,
  estPosition,
  listerMesures,
  pageEffective,
  periodeValide,
  valeurAffichable,
} from "@/lib/vehicle/mesures";
import { baseDeTest } from "./aides/basePGlite";

const dbTest = baseDeTest([vehicleSnapshots]).base;
const dbx = dbTest as unknown as NonNullable<Parameters<typeof listerMesures>[0]>["dbx"];

const T = (j: number) => new Date(Date.UTC(2026, 7, j, 10, 0, 0));

async function semer() {
  await dbTest.insert(vehicleSnapshots).values([
    { recordedAt: T(1), source: "smartcar", metricType: "odometer", valueNumeric: 100, unit: "km" },
    { recordedAt: T(2), source: "smartcar", metricType: "battery_soc", valueNumeric: 70, unit: "percent" },
    { recordedAt: T(3), source: "smartcar", metricType: "odometer", valueNumeric: 150, unit: "km" },
    { recordedAt: T(4), source: "toyota_na", metricType: "battery_soc", valueNumeric: 71, unit: "percent" },
  ]);
}

describe("listerMesures — filtres, ordre, pagination, total", () => {
  it("sans filtre : tout, plus récent d'abord, avec le TOTAL", async () => {
    await semer();
    const { lignes, total } = await listerMesures({ dbx });
    expect(total).toBe(4);
    expect(lignes.map((l) => l.recordedAt.getUTCDate())).toEqual([4, 3, 2, 1]);
  });

  it("filtre par métrique et par source", async () => {
    await semer();
    const odo = await listerMesures({ filtres: { metricType: "odometer" }, dbx });
    expect(odo.total).toBe(2);
    expect(odo.lignes.every((l) => l.metricType === "odometer")).toBe(true);

    const toyota = await listerMesures({ filtres: { source: "toyota_na" }, dbx });
    expect(toyota.total).toBe(1);
  });

  it("filtre « depuis » sur l'instant de MESURE, pas de réception", async () => {
    await semer();
    const { total } = await listerMesures({ filtres: { depuis: T(3) }, dbx });
    expect(total).toBe(2);
  });

  it("pagination par offset : le total reste celui du FILTRE", async () => {
    await semer();
    const page2 = await listerMesures({ limite: 2, offset: 2, dbx });
    expect(page2.lignes).toHaveLength(2);
    expect(page2.total).toBe(4);
    expect(page2.lignes.map((l) => l.recordedAt.getUTCDate())).toEqual([2, 1]);
  });

  it("avecTotal: false saute le count — l'export ne recompte pas la table à chaque page", async () => {
    await semer();
    const sansTotal = await listerMesures({ limite: 2, avecTotal: false, dbx });
    expect(sansTotal.lignes).toHaveLength(2);
    expect(sansTotal.total).toBeNull();
  });

  it("pagination par CURSEUR : reprend exactement après la dernière ligne servie", async () => {
    await semer();
    const p1 = await listerMesures({ limite: 2, dbx });
    const derniere = p1.lignes[1]!;
    const p2 = await listerMesures({
      limite: 2,
      curseur: { recordedAt: derniere.recordedAt, id: derniere.id },
      dbx,
    });
    // Aucun recouvrement, aucune perte : la réunion des deux pages = tout.
    const ids = [...p1.lignes, ...p2.lignes].map((l) => l.id);
    expect(new Set(ids).size).toBe(4);
  });

  it("CURSEUR insensible aux INSERTS entre deux pages (l'export sur base vivante)", async () => {
    await semer();
    const p1 = await listerMesures({ limite: 2, dbx });
    const derniere = p1.lignes[1]!;

    // Une livraison arrive ENTRE deux pages de l'export : avec un offset, tout se décale
    // et une ligne serait servie DEUX fois. Le curseur ne bouge pas.
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(5), source: "smartcar", metricType: "battery_soc", valueNumeric: 75 },
    ]);

    const p2 = await listerMesures({
      limite: 10,
      curseur: { recordedAt: derniere.recordedAt, id: derniere.id },
      dbx,
    });
    const idsP1 = new Set(p1.lignes.map((l) => l.id));
    expect(p2.lignes.some((l) => idsP1.has(l.id))).toBe(false);
    expect(p2.lignes).toHaveLength(2);
  });
});

describe("valeurAffichable — l'écran montre tout SAUF les coordonnées", () => {
  const base: VehicleSnapshot = {
    id: 1,
    recordedAt: T(1),
    receivedAt: T(1),
    source: "smartcar",
    metricType: "tire_pressure",
    signalCode: "wheel-tires",
    signalStatus: "SUCCESS",
    valueNumeric: null,
    valueText: null,
    valueJson: null,
    unit: null,
    locationType: null,
  };

  // ⚠️ Ces deux tests verrouillaient le MASQUAGE des coordonnées (« position (voir export
  // CSV) »). Marc a levé cette réserve le 12/08/2026 : c'est sa voiture, dans son app
  // privée derrière son login mono-adresse. Ils ne sont pas supprimés — ils sont
  // REFORMULÉS vers ce qu'ils protègent encore, et qui n'a pas disparu avec le masquage :
  // une position doit être RECONNUE (donc rendue en coordonnées lisibles, jamais en JSON
  // tronqué), et cette reconnaissance doit tenir par CONTENU, pas par liste de codes.
  it("une POSITION se rend en coordonnées lisibles, jamais en JSON brut", () => {
    const rendu = valeurAffichable({
      ...base,
      metricType: "location",
      signalCode: "location-preciselocation",
      valueJson: { latitude: 48.34567, longitude: -77.76543 },
    });
    expect(rendu).toBe("48.34567, -77.76543");
    // Ni accolades ni noms de champs : c'est une valeur, pas une structure.
    expect(rendu).not.toContain("{");
    expect(rendu).not.toContain("latitude");
  });

  it("la reconnaissance est par CONTENU : un code de position INCONNU est reconnu aussi", () => {
    // Finding HIGH de la revue du 06/08 (prouvé par exécution) : le pipeline stocke tout
    // code inconnu sous sa propre métrique et le repli « corps entier » conserve
    // {latitude, longitude} quel que soit le code. Une détection par identité exacte
    // raterait `location-approximatelocation`, qui s'afficherait alors en JSON tronqué.
    // Quatre signaux indépendants — chacun suffit.
    const inconnu = {
      ...base,
      metricType: "location-approximatelocation",
      signalCode: "location-approximatelocation",
      valueJson: { latitude: 48.34567, longitude: -77.76543 },
    };
    expect(estPosition(inconnu)).toBe(true);
    expect(valeurAffichable(inconnu)).toBe("48.34567, -77.76543");

    // Par le locationType porté par la ligne, même sous un code absurde.
    expect(estPosition({ ...base, locationType: "last_parked" })).toBe(true);

    // Par les CLÉS du JSON, même sans code ni métrique reconnaissables.
    expect(
      valeurAffichable({ ...base, metricType: "mystere", valueJson: { lat: 1, lng: 2 } }),
    ).toBe("1.00000, 2.00000");
  });

  it("une position ILLISIBLE ne devient pas une coordonnée inventée", () => {
    // Reconnue comme position (le locationType le dit) mais sans couple exploitable : on
    // retombe sur l'affichage générique plutôt que de fabriquer un point sur la carte.
    // Sans ce repli, une latitude seule aurait pu devenir « 46.15, 0.00000 ».
    const rendu = valeurAffichable({
      ...base,
      metricType: "location",
      locationType: "last_parked",
      valueJson: { latitude: 46.15 },
    });
    expect(rendu).not.toContain("0.00000");
    expect(rendu).toContain("46.15");
  });

  it("un détail JSON non sensible S'AFFICHE — c'est pour le voir que le tableau existe", () => {
    const rendu = valeurAffichable({
      ...base,
      valueJson: { values: [{ tirePressure: 282.68 }] },
    });
    expect(rendu).toContain("282.68");
  });

  it("numérique avec unité, texte, et absence honnête", () => {
    expect(valeurAffichable({ ...base, valueNumeric: 293.8, unit: "km" })).toBe("293.8 km");
    expect(valeurAffichable({ ...base, valueText: "CHARGING" })).toBe("CHARGING");
    expect(valeurAffichable(base)).toBe("non communiqué");
  });
});

describe("depuisPourPeriode / periodeValide — la fenêtre du filtre", () => {
  const maintenant = new Date("2026-08-06T12:00:00.000Z");

  it("24h / 7j / 30j / tout", () => {
    expect(depuisPourPeriode("24h", maintenant)?.toISOString()).toBe(
      "2026-08-05T12:00:00.000Z",
    );
    expect(depuisPourPeriode("7j", maintenant)?.toISOString()).toBe(
      "2026-07-30T12:00:00.000Z",
    );
    expect(depuisPourPeriode("tout", maintenant)).toBeNull();
    // Une période inconnue N'AMPUTE PAS la sélection : tout l'historique.
    expect(depuisPourPeriode("bidon", maintenant)).toBeNull();
    expect(depuisPourPeriode(undefined, maintenant)).toBeNull();
  });

  it("periodeValide normalise — l'écran affiche la clé RÉELLEMENT appliquée", () => {
    expect(periodeValide("7j")).toBe("7j");
    expect(periodeValide("48h")).toBe("tout");
    expect(periodeValide(null)).toBe("tout");
    // Un nom de la chaîne de prototypes passait `in` et produisait une date invalide
    // (revue du 06/08) : `Object.hasOwn` ferme le cas.
    expect(periodeValide("constructor")).toBe("tout");
    expect(depuisPourPeriode("constructor", maintenant)).toBeNull();
  });
});

describe("pageEffective — jamais de page fantôme", () => {
  it("borne à la dernière page réelle, plancher 1", () => {
    // Sélection rétrécie sous le rafraîchissement auto : page 5 de 380 lignes → page 4.
    expect(pageEffective(5, 380, 100)).toBe(4);
    // Vieux lien ?page=3 sur 4 mesures → page 1, pas « aucune mesure ».
    expect(pageEffective(3, 4, 100)).toBe(1);
    expect(pageEffective(1, 0, 100)).toBe(1);
    expect(pageEffective(0, 50, 100)).toBe(1);
    expect(pageEffective(2, 250, 100)).toBe(2);
  });
});

// ══ « JE VEUX QUE LES DONNÉES QUE J'AI » ═════════════════════════════════════════════
//
// La table porte aussi une ligne par signal REFUSÉ. Sur 74 signaux dont 58 en échec, elles
// noient les vraies mesures : chercher son état de charge dans une liste aux trois quarts
// vide, c'est ne pas avoir ses données.
describe("filtre avecValeurSeulement", () => {
  beforeEach(async () => {
    await dbTest.execute(sql`DELETE FROM vehicle_snapshots`);
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(1), source: "smartcar", metricType: "battery_soc", signalCode: "soc", signalStatus: "SUCCESS", valueNumeric: 69 },
      { recordedAt: T(2), source: "smartcar", metricType: "lock_status", signalCode: "lock", signalStatus: "SUCCESS", valueText: "true" },
      { recordedAt: T(3), source: "smartcar", metricType: "tire_pressure", signalCode: "tires", signalStatus: "SUCCESS", valueJson: { a: 1 } },
      // Trois refus : aucune valeur, seulement un statut.
      { recordedAt: T(4), source: "smartcar", metricType: "hvac", signalCode: "hvac-a", signalStatus: "ERROR (PERMISSION)" },
      { recordedAt: T(5), source: "smartcar", metricType: "climat", signalCode: "climate-x", signalStatus: "ERROR (COMPATIBILITY)" },
      { recordedAt: T(6), source: "smartcar", metricType: "diag", signalCode: "diag-y", signalStatus: "ERROR (COMPATIBILITY)" },
    ]);
  });

  it("ne garde que les lignes qui portent une valeur — les trois formes comptent", async () => {
    const { lignes, total } = await listerMesures({
      filtres: { avecValeurSeulement: true },
      dbx,
    });
    expect(total).toBe(3);
    expect(lignes.map((l) => l.metricType).sort()).toEqual([
      "battery_soc",
      "lock_status",
      "tire_pressure",
    ]);
  });

  it("le TOTAL suit le filtre — sinon « 3 sur 6 » ferait croire à une page manquante", async () => {
    const filtre = await listerMesures({ filtres: { avecValeurSeulement: true }, dbx });
    const sansFiltre = await listerMesures({ dbx });
    expect(filtre.total).toBe(3);
    expect(sansFiltre.total).toBe(6);
  });

  it("sans le drapeau, TOUT reste visible — c'est un défaut d'affichage, pas une purge", async () => {
    // Les traces de refus expliquent un trou dans une série des mois plus tard : elles
    // restent en base et restent accessibles.
    const { total } = await listerMesures({ filtres: {}, dbx });
    expect(total).toBe(6);
  });

  it("se combine avec les autres filtres sans les annuler", async () => {
    const { total } = await listerMesures({
      filtres: { avecValeurSeulement: true, metricType: "battery_soc" },
      dbx,
    });
    expect(total).toBe(1);
  });
});
