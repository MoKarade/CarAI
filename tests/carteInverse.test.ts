// tests/carteInverse.test.ts — la projection de la carte doit être RÉVERSIBLE.
//
// Sans cet inverse, la carte ne sait que MONTRER : elle ne peut pas recevoir un lieu qu'on
// désigne du doigt (Marc, 21/08 : « je veux pouvoir choisir sur la map »).

import { describe, expect, it } from "vitest";
import {
  composerVue,
  deprojeter,
  metresParPixel,
  pointDepuisCadre,
  projeter,
  rayonEnPixels,
  ZOOM_MAX,
  ZOOM_MIN,
} from "@/lib/vehicle/carte";

const QUEBEC = { lat: 46.8139, lng: -71.208 };

describe("deprojeter — l'inverse exact de projeter", () => {
  it("un aller-retour rend le point de départ, à tous les zooms", () => {
    for (let zoom = ZOOM_MIN; zoom <= ZOOM_MAX; zoom += 1) {
      const retour = deprojeter(projeter(QUEBEC, zoom), zoom);
      expect(retour.lat, `lat au zoom ${zoom}`).toBeCloseTo(QUEBEC.lat, 6);
      expect(retour.lng, `lng au zoom ${zoom}`).toBeCloseTo(QUEBEC.lng, 6);
    }
  });

  it("tient sur des latitudes très différentes — Mercator n'est pas linéaire", () => {
    // ⚠️ C'est TOUT l'enjeu : une inversion linéaire « à peu près juste » colle près de
    // l'équateur et dérive de plus en plus vers les pôles. Québec est à 46,8°.
    for (const lat of [-60, -20, 0, 20, 46.81, 70]) {
      const p = { lat, lng: 12.34 };
      const retour = deprojeter(projeter(p, 14), 14);
      expect(retour.lat, `lat ${lat}`).toBeCloseTo(lat, 6);
      expect(retour.lng, `lng à ${lat}`).toBeCloseTo(12.34, 6);
    }
  });

  it("une inversion LINÉAIRE se tromperait — la preuve que le test discrimine", () => {
    const zoom = 14;
    const n = 256 * 2 ** zoom;
    const pixel = projeter(QUEBEC, zoom);
    // Ce que donnerait une règle de trois naïve sur la latitude.
    const latNaive = 90 - (pixel.y / n) * 180;
    expect(Math.abs(latNaive - QUEBEC.lat)).toBeGreaterThan(1);
  });
});

describe("pointDepuisCadre — du pixel cliqué au lieu désigné", () => {
  const vue = composerVue({ points: [QUEBEC], largeur: 640, hauteur: 400, zoom: 15 })!;

  it("le centre du cadre redonne le point qui l'a cadré", () => {
    const centre = pointDepuisCadre({ x: vue.largeur / 2, y: vue.hauteur / 2 }, vue);
    expect(centre.lat).toBeCloseTo(QUEBEC.lat, 5);
    expect(centre.lng).toBeCloseTo(QUEBEC.lng, 5);
  });

  it("le marqueur projeté et le point cliqué sur lui coïncident", () => {
    // L'aller et le retour passent par la MÊME origine : c'est ce couplage qui garantit
    // qu'on désigne bien ce qu'on voit.
    const m = vue.marqueurs[0]!;
    const retour = pointDepuisCadre(m, vue);
    expect(retour.lat).toBeCloseTo(QUEBEC.lat, 4);
    expect(retour.lng).toBeCloseTo(QUEBEC.lng, 4);
  });

  it("aller à DROITE augmente la longitude, aller en BAS diminue la latitude", () => {
    const centre = { x: vue.largeur / 2, y: vue.hauteur / 2 };
    const droite = pointDepuisCadre({ x: centre.x + 100, y: centre.y }, vue);
    const bas = pointDepuisCadre({ x: centre.x, y: centre.y + 100 }, vue);
    expect(droite.lng).toBeGreaterThan(QUEBEC.lng);
    expect(bas.lat).toBeLessThan(QUEBEC.lat);
  });
});

describe("metresParPixel — l'échelle réelle, cosinus compris", () => {
  it("à l'équateur, la formule classique de Web Mercator", () => {
    // 40 075 017 m / (256 × 2^0) ≈ 156 543 m/px au zoom 0.
    expect(metresParPixel(0, 0)).toBeCloseTo(156543.03, 1);
  });

  it("doubler le zoom divise l'échelle par deux", () => {
    expect(metresParPixel(46.8, 15) / metresParPixel(46.8, 16)).toBeCloseTo(2, 6);
  });

  it("⚠️ à Québec l'échelle est bien plus FINE qu'à l'équateur — 32 % d'écart", () => {
    // C'est le piège : ignorer le cosinus dessinerait un rayon de 120 m couvrant 176 m sur
    // le terrain, donc apparierait des recharges faites chez le voisin.
    const rapport = metresParPixel(0, 15) / metresParPixel(46.8139, 15);
    expect(rapport).toBeCloseTo(1 / Math.cos((46.8139 * Math.PI) / 180), 6);
    expect(rapport).toBeGreaterThan(1.4);
  });

  it("rayonEnPixels grandit avec le zoom et avec le rayon", () => {
    const a = rayonEnPixels(120, 46.8, 15);
    expect(rayonEnPixels(120, 46.8, 16)).toBeCloseTo(a * 2, 6);
    expect(rayonEnPixels(240, 46.8, 15)).toBeCloseTo(a * 2, 6);
  });

  it("un rayon de 120 m est VISIBLE au zoom d'un quartier, pas microscopique", () => {
    // Sans cette vérification, le cercle pourrait être juste ET inutilisable à l'écran.
    expect(rayonEnPixels(120, 46.8139, 16)).toBeGreaterThan(20);
  });
});
