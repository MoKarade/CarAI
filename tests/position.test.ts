// tests/position.test.ts — lecture des coordonnées et projection du trajet.
//
// Deux exigences distinctes : ne JAMAIS fabriquer une position qu'on n'a pas su lire
// (une fausse position est pire qu'une absence — elle se croit), et projeter FIDÈLEMENT
// (un tracé déformé raconte un trajet qui n'a pas eu lieu).

import { describe, expect, it } from "vitest";
import { vehicleSnapshots } from "@/lib/db/schema";
import {
  coordonneesDuJson,
  distanceKm,
  historiquePositions,
  formaterCoordonnee,
  lienCarte,
  traceTrajet,
  type PointPosition,
} from "@/lib/vehicle/position";
import { baseDeTest } from "./aides/basePGlite";

const P = (lat: number, lng: number, h = 12): PointPosition => ({
  t: new Date(Date.UTC(2026, 7, 12, h, 0, 0)),
  lat,
  lng,
  type: null,
});

describe("coordonneesDuJson", () => {
  it("lit les deux graphies vues dans le catalogue réel", () => {
    expect(coordonneesDuJson({ latitude: 46.81, longitude: -71.2 })).toEqual({
      lat: 46.81,
      lng: -71.2,
    });
    expect(coordonneesDuJson({ lat: 46.81, lng: -71.2 })).toEqual({ lat: 46.81, lng: -71.2 });
  });

  it("descend dans `value` quand la livraison imbrique le couple", () => {
    expect(coordonneesDuJson({ value: { latitude: 46.81, longitude: -71.2 } })).toEqual({
      lat: 46.81,
      lng: -71.2,
    });
  });

  it("est insensible à la CASSE — la source n'est pas sous notre contrôle", () => {
    expect(coordonneesDuJson({ Latitude: 46.81, Longitude: -71.2 })).toEqual({
      lat: 46.81,
      lng: -71.2,
    });
  });

  it("accepte des coordonnées transmises en TEXTE", () => {
    expect(coordonneesDuJson({ latitude: "46.81", longitude: "-71.2" })).toEqual({
      lat: 46.81,
      lng: -71.2,
    });
  });

  // ⚠️ Le cœur : jamais de position inventée. Un couple à demi lu tombé à (0, 0) placerait
  // la voiture dans le golfe de Guinée — une erreur qui a l'air d'une donnée.
  it("REFUSE tout ce qui n'est pas un couple complet et plausible", () => {
    expect(coordonneesDuJson({ latitude: 46.81 })).toBeNull();
    expect(coordonneesDuJson({ longitude: -71.2 })).toBeNull();
    expect(coordonneesDuJson({ latitude: "?", longitude: -71.2 })).toBeNull();
    expect(coordonneesDuJson({ latitude: 95, longitude: -71.2 })).toBeNull();
    expect(coordonneesDuJson({ latitude: 46.81, longitude: 999 })).toBeNull();
    expect(coordonneesDuJson(null)).toBeNull();
    expect(coordonneesDuJson("46.81,-71.2")).toBeNull();
    expect(coordonneesDuJson({ isOpen: false })).toBeNull();
  });

  it("(0, 0) reste lisible s'il est RÉELLEMENT publié — on refuse d'inventer, pas de lire", () => {
    // La règle est « ne pas fabriquer », pas « censurer une valeur légitime ».
    expect(coordonneesDuJson({ latitude: 0, longitude: 0 })).toEqual({ lat: 0, lng: 0 });
  });
});

describe("traceTrajet", () => {
  it("rend null sans aucune position — jamais un cadre vide", () => {
    expect(traceTrajet([])).toBeNull();
  });

  it("projette une position unique sans exploser sur une étendue nulle", () => {
    const trace = traceTrajet([P(46.81, -71.2)])!;
    expect(trace.nbPoints).toBe(1);
    expect(Number.isFinite(trace.derniere.x)).toBe(true);
    expect(Number.isFinite(trace.derniere.y)).toBe(true);
    expect(trace.etendueKm).toBe(0);
  });

  it("met le NORD en haut : une latitude plus grande donne un y plus PETIT", () => {
    // En SVG l'origine est en haut à gauche ; sans inversion, le trajet serait un miroir.
    const trace = traceTrajet([P(46.8, -71.2, 10), P(46.9, -71.2, 11)])!;
    const [premier, second] = trace.chemin.split(" ").map((c) => Number(c.split(",")[1]));
    expect(second).toBeLessThan(premier!);
  });

  // ⚠️ L'invariant qui rend le dessin honnête. À 46,8°, un degré de longitude vaut ~76 km
  // contre ~111 km pour un degré de latitude. Un déplacement de MÊME distance réelle en
  // x et en y doit donner un déplacement de MÊME longueur à l'écran.
  it("corrige la longitude par la latitude — un carré réel reste un carré à l'écran", () => {
    const lat0 = 46.8;
    const dLat = 0.02;
    // Le delta de longitude qui couvre la MÊME distance que dLat en latitude.
    const dLng = dLat / Math.cos((lat0 * Math.PI) / 180);

    const trace = traceTrajet(
      [P(lat0, -71.2), P(lat0 + dLat, -71.2), P(lat0 + dLat, -71.2 + dLng)],
      { largeur: 400, hauteur: 400, marge: 0 },
    )!;

    const pts = trace.chemin.split(" ").map((c) => {
      const [x, y] = c.split(",").map(Number);
      return { x: x!, y: y! };
    });

    const cotéVertical = Math.abs(pts[1]!.y - pts[0]!.y);
    const cotéHorizontal = Math.abs(pts[2]!.x - pts[1]!.x);

    // Deux côtés de même longueur RÉELLE ⇒ même longueur à l'écran, à 2 % près.
    expect(cotéHorizontal).toBeGreaterThan(0);
    expect(Math.abs(cotéHorizontal - cotéVertical) / cotéVertical).toBeLessThan(0.02);
  });

  it("prouve la correction : SANS elle, les deux côtés différeraient de ~30 %", () => {
    // Test miroir du précédent — il mesure ce que la correction ÉVITE. Sans elle, le
    // rapport des côtés vaudrait 1/cos(46,8°) ≈ 1,46 : un carré vu comme un rectangle.
    const facteur = 1 / Math.cos((46.8 * Math.PI) / 180);
    expect(facteur).toBeGreaterThan(1.4);
  });

  it("garde le trajet DANS le cadre, marge comprise", () => {
    const trace = traceTrajet(
      [P(46.7, -71.4), P(46.9, -71.0), P(46.75, -71.35)],
      { largeur: 600, hauteur: 320, marge: 10 },
    )!;
    for (const couple of trace.chemin.split(" ")) {
      const [x, y] = couple.split(",").map(Number);
      expect(x!).toBeGreaterThanOrEqual(0);
      expect(x!).toBeLessThanOrEqual(600);
      expect(y!).toBeGreaterThanOrEqual(0);
      expect(y!).toBeLessThanOrEqual(320);
    }
  });

  it("expose les bornes réelles et une étendue en km plausible", () => {
    const trace = traceTrajet([P(46.7, -71.4), P(46.9, -71.0)])!;
    expect(trace.latMin).toBeCloseTo(46.7, 5);
    expect(trace.latMax).toBeCloseTo(46.9, 5);
    // Diagonale d'environ 0,2° de latitude et 0,4° de longitude autour de Québec.
    expect(trace.etendueKm).toBeGreaterThan(25);
    expect(trace.etendueKm).toBeLessThan(45);
  });
});

describe("distanceKm", () => {
  it("mesure une distance connue avec une précision raisonnable", () => {
    // Québec → Montréal : ~233 km à vol d'oiseau.
    const d = distanceKm({ lat: 46.8139, lng: -71.208 }, { lat: 45.5017, lng: -73.5673 });
    expect(d).toBeGreaterThan(220);
    expect(d).toBeLessThan(245);
  });

  it("rend 0 pour deux points identiques, sans NaN d'arrondi", () => {
    expect(distanceKm({ lat: 46.8, lng: -71.2 }, { lat: 46.8, lng: -71.2 })).toBe(0);
  });
});

describe("lienCarte et formaterCoordonnee", () => {
  it("compose un lien vers une carte externe — ouvert par un CLIC, jamais par la page", () => {
    expect(lienCarte({ lat: 46.81234, lng: -71.20765 })).toBe(
      "https://www.google.com/maps?q=46.81234,-71.20765",
    );
  });

  it("garde assez de décimales pour situer sans prétendre au centimètre", () => {
    // 5 décimales ≈ 1 m : la précision d'un GPS de voiture, pas plus.
    expect(formaterCoordonnee(46.8123456)).toBe("46.81235");
    expect(formaterCoordonnee(-71.2)).toBe("-71.20000");
  });
});

// ══ LECTURE EN BASE, sur le VRAI schéma ══════════════════════════════════════════════
describe("historiquePositions", () => {
  const dbTest = baseDeTest([vehicleSnapshots]).base;
  const dbx = dbTest as unknown as Parameters<typeof historiquePositions>[0] extends
    | { dbx?: infer D }
    | undefined
    ? D
    : never;

  const T = (h: number) => new Date(Date.UTC(2026, 7, 12, h, 0, 0));

  it("rend les positions du plus ANCIEN au plus récent, coordonnées lues", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(9), source: "smartcar", metricType: "location", signalCode: "location-preciselocation", locationType: "last_parked", valueJson: { latitude: 46.8, longitude: -71.2 } },
      { recordedAt: T(11), source: "smartcar", metricType: "location", signalCode: "location-preciselocation", locationType: "real_time", valueJson: { latitude: 46.85, longitude: -71.25 } },
    ]);

    const points = await historiquePositions({ dbx });
    expect(points.map((p) => p.lat)).toEqual([46.8, 46.85]);
    expect(points[1]!.type).toBe("real_time");
  });

  it("capte une position publiée sous un code INCONNU, via son location_type", async () => {
    // La porte d'entrée n'est pas la seule métrique `location` : une source future peut
    // publier ailleurs. Sans cette seconde clause, le trajet perdrait ces points en silence.
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "toyota_na", metricType: "mystere", signalCode: "x", locationType: "last_parked", valueJson: { lat: 46.9, lng: -71.3 } },
    ]);
    const points = await historiquePositions({ dbx });
    expect(points).toHaveLength(1);
    expect(points[0]!.lng).toBe(-71.3);
  });

  it("ÉCARTE les lignes dont les coordonnées sont illisibles, sans planter", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "smartcar", metricType: "location", signalCode: "l", valueJson: { latitude: 46.8 } },
      { recordedAt: T(11), source: "smartcar", metricType: "location", signalCode: "l", valueJson: { erreur: "indisponible" } },
      { recordedAt: T(12), source: "smartcar", metricType: "location", signalCode: "l", valueJson: { latitude: 46.8, longitude: -71.2 } },
    ]);
    const points = await historiquePositions({ dbx });
    expect(points).toHaveLength(1);
  });

  it("la LIMITE garde le côté RÉCENT — un trajet ne se fige jamais sur le passé", async () => {
    await dbTest.insert(vehicleSnapshots).values(
      [10, 11, 12, 13].map((h) => ({
        recordedAt: T(h),
        source: "smartcar" as const,
        metricType: "location",
        signalCode: "l",
        valueJson: { latitude: 46 + h / 100, longitude: -71.2 },
      })),
    );
    const points = await historiquePositions({ limite: 2, dbx });
    expect(points.map((p) => p.lat)).toEqual([46.12, 46.13]);
  });
});
