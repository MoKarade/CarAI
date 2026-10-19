// tests/vue3d.test.ts — la géométrie de la vue 3D, prouvée sans WebGL.
//
// ⚠️ Ce que ce fichier NE teste pas : le rendu. jsdom n'a pas de WebGL, et monter le canvas
// ne mesurerait que « ça n'a pas planté ». Ce qui est ici est ce qui DÉCIDE — le repère, le
// cadrage, et si un marqueur est devant la tôle ou derrière.

import { describe, expect, it } from "vitest";
import { ANCRES, MODELE, type ElementVoiture } from "@/lib/vehicle/ancresVoiture";
import { ANCRES as ANCRES_2D, type IdPoint } from "@/lib/vehicle/pointsVoiture";
import {
  CENTRE_VOITURE,
  ECHELLE_MODELE,
  bornesOrbite,
  MARGE_SILHOUETTE,
  RAYON_VOITURE,
  ROTATION_X_RAD,
  SEUIL_MARQUEUR_ATTEIGNABLE,
  distanceCadrage,
  elementPourPoint,
  repartirPoints,
  libelleElement,
  marqueurAtteignable,
  positionCameraDepart,
  versRepereRendu,
  visibiliteMarqueur,
} from "@/lib/vehicle/vue3d";

describe("le repère de rendu", () => {
  it("met le toit AU-DESSUS du sol — c'est ce qui attrape une rotation de mauvais signe", () => {
    const toit = versRepereRendu({ x: 0, y: 0, z: MODELE.toitZ });
    const sol = versRepereRendu({ x: 0, y: 0, z: MODELE.solZ });
    expect(toit.y).toBeGreaterThan(sol.y);
    // L'écart vaut la hauteur mesurée, RAMENÉE À L'ÉCHELLE DE LA SCÈNE : une rotation juste
    // ne déforme rien, et l'échelle divise tout par le même facteur.
    expect(toit.y - sol.y).toBeCloseTo((MODELE.solZ - MODELE.toitZ) * ECHELLE_MODELE, 6);
  });

  // ⚠️ Le défaut du 18/09 tenait dans cette ligne : le module appliquait la rotation et
  // OUBLIAIT l'échelle. Une voiture de 1,6 m de haut devenait un objet de 160, la caméra se
  // cadrait dessus, et la carrosserie — elle, correctement mise à l'échelle par ses propres
  // nœuds — se retrouvait cent fois plus petite que ses propres marqueurs.
  it("ramène les ancres à l'échelle de la SCÈNE, pas seulement à son orientation", () => {
    const toit = versRepereRendu({ x: 0, y: 0, z: MODELE.toitZ });
    // Un toit de voiture est à environ un mètre et demi du sol. Pas à cent cinquante.
    expect(Math.abs(toit.y)).toBeGreaterThan(1);
    expect(Math.abs(toit.y)).toBeLessThan(2.5);
  });

  it("envoie le nez vers l'observateur et la poupe derrière", () => {
    expect(versRepereRendu({ x: 0, y: MODELE.avantY, z: 0 }).z).toBeGreaterThan(0);
    expect(versRepereRendu({ x: 0, y: MODELE.arriereY, z: 0 }).z).toBeLessThan(0);
  });

  it("garde la largeur sur son axe, à l'échelle de la scène", () => {
    expect(versRepereRendu({ x: -MODELE.demiLargeurFlanc, y: 0, z: 0 }).x).toBeCloseTo(
      -MODELE.demiLargeurFlanc * ECHELLE_MODELE,
      6,
    );
  });

  // ⚠️ LA garde de ce fichier. `ROTATION_X_RAD` tourne la CARROSSERIE, `versRepereRendu`
  // place les MARQUEURS : deux écritures de la même rotation, dans deux endroits qui ne se
  // lisent jamais ensemble. Si elles divergent, les marqueurs flottent à côté de la voiture
  // — et rien ne plante. Ici, la matrice de rotation est appliquée telle quelle et comparée.
  it("applique EXACTEMENT la transformation que les nœuds du modèle portent", () => {
    const cos = Math.cos(ROTATION_X_RAD);
    const sin = Math.sin(ROTATION_X_RAD);
    for (const ancre of Object.values(ANCRES)) {
      // L'ordre du glTF : l'échelle d'abord, la rotation ensuite.
      const [x, y, z] = [
        ancre.x * ECHELLE_MODELE,
        ancre.y * ECHELLE_MODELE,
        ancre.z * ECHELLE_MODELE,
      ];
      const parLaMatrice = { x, y: y * cos - z * sin, z: y * sin + z * cos };
      const parLeModule = versRepereRendu(ancre);
      expect(parLeModule.x).toBeCloseTo(parLaMatrice.x, 6);
      expect(parLeModule.y).toBeCloseTo(parLaMatrice.y, 6);
      expect(parLeModule.z).toBeCloseTo(parLaMatrice.z, 6);
    }
  });

  it("place le centre entre le sol et le toit, et entre le nez et la poupe", () => {
    const toit = versRepereRendu({ x: 0, y: 0, z: MODELE.toitZ });
    const sol = versRepereRendu({ x: 0, y: 0, z: MODELE.solZ });
    expect(CENTRE_VOITURE.y).toBeGreaterThan(sol.y);
    expect(CENTRE_VOITURE.y).toBeLessThan(toit.y);
    expect(Math.abs(CENTRE_VOITURE.z)).toBeLessThan(10);
  });
});

describe("le cadrage", () => {
  it("contient la voiture entière — vérifié sur la dimension la plus serrée", () => {
    for (const ratio of [0.45, 0.75, 1, 1.9]) {
      const d = distanceCadrage(50, ratio);
      const fovV = (50 * Math.PI) / 180;
      const fovH = 2 * Math.atan(Math.tan(fovV / 2) * ratio);
      const demiChampVertical = d * Math.tan(fovV / 2);
      const demiChampHorizontal = d * Math.tan(fovH / 2);
      expect(Math.min(demiChampVertical, demiChampHorizontal)).toBeGreaterThanOrEqual(
        RAYON_VOITURE - 1e-6,
      );
    }
  });

  // ⚠️ Le piège que ce test épingle : le champ de three.js est VERTICAL. Cadrer dessus seul
  // laisse un téléphone tenu debout couper le nez de la voiture, et un écran d'ordinateur
  // ne montre rien du problème.
  it("recule DAVANTAGE en portrait qu'en paysage", () => {
    expect(distanceCadrage(50, 0.5)).toBeGreaterThan(distanceCadrage(50, 1.6));
  });

  it("recule d'autant plus que le champ est étroit", () => {
    expect(distanceCadrage(25, 1)).toBeGreaterThan(distanceCadrage(60, 1));
  });

  it("dérive son rayon des mesures du modèle, jamais d'un nombre figé", () => {
    const longueur = (MODELE.avantY - MODELE.arriereY) * ECHELLE_MODELE;
    // La voiture mesure 4,69 m de long : sa demi-diagonale ne peut pas être plus petite.
    expect(RAYON_VOITURE).toBeGreaterThan(longueur / 2);
    expect(RAYON_VOITURE).toBeLessThan(longueur);
  });
});

describe("les bornes de l'orbite", () => {
  const d = distanceCadrage(45, 0.3);

  it("laissent s'approcher sans traverser la tôle", () => {
    const b = bornesOrbite(d);
    expect(b.min).toBeGreaterThan(0);
    expect(b.min).toBeLessThan(RAYON_VOITURE);
  });

  // ⚠️ Le plafond DOIT laisser tenir le cadrage initial. Écrit en dur à 1600 et interprété
  // en mètres, il plaçait la caméra à un kilomètre et demi ; borné trop court, il
  // couperait la voiture dès l'ouverture.
  it("laissent reculer AU MOINS jusqu'à voir la voiture entière", () => {
    expect(bornesOrbite(d).max).toBeGreaterThanOrEqual(d);
  });

  it("suivent le cadrage au lieu de le contredire", () => {
    expect(bornesOrbite(50).max).toBeLessThan(bornesOrbite(100).max);
  });

  it("restent à une échelle de voiture, jamais de paysage", () => {
    // Quelle que soit la forme de l'écran, on ne recule pas à plus de cent mètres.
    for (const ratio of [0.3, 0.6, 1, 2]) {
      expect(bornesOrbite(distanceCadrage(45, ratio)).max).toBeLessThan(100);
    }
  });
});

describe("la visibilité d'un marqueur", () => {
  const gauche = versRepereRendu(ANCRES["pneu-avant-gauche"]);
  const droit = versRepereRendu(ANCRES["pneu-avant-droit"]);
  // Une caméra franchement du côté X négatif, à hauteur du centre.
  const cameraAGauche = { x: -600, y: CENTRE_VOITURE.y, z: CENTRE_VOITURE.z };

  it("voit le flanc qu'elle regarde et pas celui d'en face", () => {
    expect(visibiliteMarqueur(gauche, cameraAGauche)).toBeGreaterThan(
      visibiliteMarqueur(droit, cameraAGauche),
    );
  });

  it("rend le marqueur d'en face INATTEIGNABLE — on ne tape pas au travers de la tôle", () => {
    expect(marqueurAtteignable(visibiliteMarqueur(gauche, cameraAGauche))).toBe(true);
    expect(marqueurAtteignable(visibiliteMarqueur(droit, cameraAGauche))).toBe(false);
  });

  it("garde un marqueur vu de PROFIL encore un peu visible", () => {
    // Caméra dans l'axe longitudinal : les deux flancs sont exactement de profil.
    const deFace = { x: 0, y: CENTRE_VOITURE.y, z: CENTRE_VOITURE.z + 600 };
    const v = visibiliteMarqueur({ x: 100, y: CENTRE_VOITURE.y, z: CENTRE_VOITURE.z }, deFace);
    expect(v).toBeCloseTo(MARGE_SILHOUETTE / (1 + MARGE_SILHOUETTE), 6);
    expect(v).toBeGreaterThan(0);
  });

  it("reste borné entre 0 et 1, caméra où qu'elle soit", () => {
    const cameras = [
      { x: 900, y: 900, z: 900 },
      { x: -900, y: -900, z: -900 },
      { x: 0, y: 2000, z: 0 },
      CENTRE_VOITURE,
    ];
    for (const camera of cameras) {
      for (const ancre of Object.values(ANCRES)) {
        const v = visibiliteMarqueur(versRepereRendu(ancre), camera);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it("vaut 1 pour une ancre posée au centre — rien ne peut la cacher", () => {
    expect(visibiliteMarqueur(CENTRE_VOITURE, { x: 0, y: 0, z: 900 })).toBe(1);
  });

  it("le seuil d'atteignabilité discrimine de part et d'autre", () => {
    expect(marqueurAtteignable(SEUIL_MARQUEUR_ATTEIGNABLE + 0.01)).toBe(true);
    expect(marqueurAtteignable(SEUIL_MARQUEUR_ATTEIGNABLE)).toBe(false);
  });
});

describe("la caméra de départ", () => {
  const d = distanceCadrage(50, 0.6);
  const p = positionCameraDepart(d);

  it("se tient à la distance demandée du centre", () => {
    expect(Math.hypot(p.x - CENTRE_VOITURE.x, p.y - CENTRE_VOITURE.y, p.z - CENTRE_VOITURE.z))
      .toBeCloseTo(d, 6);
  });

  it("regarde la voiture de trois quarts AVANT, et d'un peu au-dessus", () => {
    expect(p.y).toBeGreaterThan(CENTRE_VOITURE.y);
    expect(p.z).toBeGreaterThan(CENTRE_VOITURE.z);
    expect(Math.abs(p.x)).toBeGreaterThan(MODELE.demiLargeurFlanc * ECHELLE_MODELE);
  });
});

describe("le pont entre les deux vocabulaires du dépôt", () => {
  it("traduit chaque roue du schéma 2D vers la bonne roue 3D", () => {
    expect(elementPourPoint("pneu-avant-gauche")).toBe("pneu-avant-gauche");
    expect(elementPourPoint("pneu-avant-droite")).toBe("pneu-avant-droit");
    expect(elementPourPoint("pneu-arriere-gauche")).toBe("pneu-arriere-gauche");
    expect(elementPourPoint("pneu-arriere-droite")).toBe("pneu-arriere-droit");
  });

  // ⚠️ Deux informations qui tomberaient sur le même élément se superposeraient au même
  // point de la tôle : l'une recouvre l'autre, et c'est l'utilisateur qui découvre qu'il
  // lui en manque une.
  it("ne fait jamais tomber deux informations sur le même élément", () => {
    const poses = Object.keys(ANCRES_2D)
      .map((id) => elementPourPoint(id as IdPoint))
      .filter((e): e is NonNullable<typeof e> => e !== null);
    expect(new Set(poses).size).toBe(poses.length);
  });

  it("décide de CHAQUE information du schéma — aucune n'est oubliée", () => {
    for (const id of Object.keys(ANCRES_2D) as IdPoint[]) {
      const element = elementPourPoint(id);
      if (element !== null) expect(ANCRES[element]).toBeDefined();
    }
  });

  // ⚠️ La règle du dépôt appliquée au placement : un horodatage n'a pas de lieu sur une
  // carrosserie. L'y poser inventerait un endroit, et l'endroit se lirait comme un sens.
  it("ne pose SUR la voiture que ce qui désigne un organe", () => {
    expect(elementPourPoint("odometre")).toBeNull();
    expect(elementPourPoint("synchro")).toBeNull();
  });
});

describe("la répartition des points", () => {
  const points = [
    { id: "verrou" as IdPoint, valeur: "Fermée" },
    { id: "synchro" as IdPoint, valeur: "il y a 4 min" },
    { id: "pneu-avant-droite" as IdPoint, valeur: "219" },
  ];

  it("sépare ce qui se pose sur la tôle de ce qui s'affiche à côté", () => {
    const { surLaVoiture, horsVoiture } = repartirPoints(points);
    expect(surLaVoiture.map((m) => m.point.id)).toEqual(["verrou", "pneu-avant-droite"]);
    expect(horsVoiture.map((p) => p.id)).toEqual(["synchro"]);
  });

  it("rend les ancres DÉJÀ dans le repère de rendu, jamais celui du modèle", () => {
    const { surLaVoiture } = repartirPoints([{ id: "verrou" as IdPoint }]);
    expect(surLaVoiture[0]!.ancre).toEqual(versRepereRendu(ANCRES.verrouillage));
    // Le verrouillage est sur le TOIT : dans le repère de rendu, il est donc EN HAUT.
    expect(surLaVoiture[0]!.ancre.y).toBeGreaterThan(CENTRE_VOITURE.y);
  });

  // ⚠️ Anti-vacuité : sans ça, une répartition qui jetterait tout passerait les deux tests
  // précédents dès qu'on lui donne une liste vide.
  it("ne perd aucun point en chemin", () => {
    const { surLaVoiture, horsVoiture } = repartirPoints(points);
    expect(surLaVoiture.length + horsVoiture.length).toBe(points.length);
  });
});

describe("les libellés", () => {
  const elements = Object.keys(ANCRES) as ElementVoiture[];

  it("nomme CHAQUE élément, sans trou", () => {
    for (const element of elements) {
      expect(libelleElement(element).trim().length).toBeGreaterThan(0);
    }
  });

  it("donne un nom DIFFÉRENT à chacun — sinon deux marqueurs se confondent à la voix", () => {
    expect(new Set(elements.map(libelleElement)).size).toBe(elements.length);
  });
});
