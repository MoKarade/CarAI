// tests/modele3d.test.ts — le modèle livré est-il là où le code croit qu'il est ?
//
// ⚠️ POURQUOI CE FICHIER EXISTE, ET CE QU'IL AURAIT ÉVITÉ. Le lot 4b a mesuré la géométrie
// en lisant les `min`/`max` des accesseurs de position — c'est-à-dire l'espace LOCAL des
// maillages — et en a déduit le repère de la scène. Les douze nœuds du glTF portent
// pourtant une échelle (÷ 100) et une rotation (+90° autour de X) qui n'apparaissent nulle
// part dans ces valeurs.
//
// Résultat en production : la carrosserie re-tournée une seconde fois, et une caméra cadrée
// pour un objet cent fois trop grand. Marc l'a vu en une seconde — « marche pas elle est
// minus » — mais **aucun test ne pouvait le voir**, parce que les marqueurs étaient à la
// même fausse échelle que le cadrage, donc cohérents entre eux.
//
// Ce fichier compose la transformation TELLE QU'ELLE EST ÉCRITE DANS LE FICHIER et vérifie
// que le module s'y conforme. C'est la seule chose qui relie `ancresVoiture.ts` à ce que le
// navigateur affichera vraiment.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sansCommentairesJsx } from "./aides/controles";
import { ANCRES, MODELE } from "@/lib/vehicle/ancresVoiture";
import { ECHELLE_MODELE, ROTATION_X_RAD, RAYON_VOITURE, versRepereRendu } from "@/lib/vehicle/vue3d";

interface NoeudGltf {
  name?: string;
  mesh?: number;
  scale?: [number, number, number];
  rotation?: [number, number, number, number];
  matrix?: number[];
}

function lireGltf(): { nodes: NoeudGltf[]; meshes: { primitives: { attributes: Record<string, number> }[] }[]; accessors: { min?: number[]; max?: number[] }[] } {
  const b = readFileSync(resolve(process.cwd(), "public/modele/bz.glb"));
  return JSON.parse(b.toString("utf8", 20, 20 + b.readUInt32LE(12)));
}

const gltf = lireGltf();
/** Les nœuds qui portent de la carrosserie — `MaterialHolder` n'en est pas. */
const noeudsRendus = gltf.nodes.filter((n) => n.mesh !== undefined && n.name !== "MaterialHolder");

describe("la transformation que le modèle porte lui-même", () => {
  it("met de la géométrie à l'écran — sinon tout ce qui suit est vide", () => {
    expect(noeudsRendus.length).toBeGreaterThan(5);
  });

  it("applique EXACTEMENT l'échelle que le module suppose, sur les trois axes", () => {
    for (const n of noeudsRendus) {
      expect(n.scale, `le nœud ${n.name} n'a pas d'échelle`).toBeDefined();
      for (const composante of n.scale!) {
        expect(composante).toBeCloseTo(ECHELLE_MODELE, 6);
      }
    }
  });

  // ⚠️ C'est CELLE-CI qui manquait. Le rendu ajoutait sa propre rotation par-dessus.
  it("redresse DÉJÀ la voiture — le rendu ne doit donc plus la tourner", () => {
    const attendu = [Math.sin(ROTATION_X_RAD / 2), 0, 0, Math.cos(ROTATION_X_RAD / 2)];
    for (const n of noeudsRendus) {
      expect(n.rotation, `le nœud ${n.name} n'a pas de rotation`).toBeDefined();
      n.rotation!.forEach((v, i) => expect(v).toBeCloseTo(attendu[i]!, 4));
    }
  });

  it("n'emploie aucune matrice de nœud — sinon `scale`/`rotation` ne diraient pas tout", () => {
    for (const n of gltf.nodes) expect(n.matrix).toBeUndefined();
  });
});

describe("la voiture, là où la scène la met", () => {
  /** La boîte englobante composée : géométrie locale × échelle × rotation. */
  const boite = (() => {
    let lo = [Infinity, Infinity, Infinity];
    let hi = [-Infinity, -Infinity, -Infinity];
    for (const n of noeudsRendus) {
      for (const p of gltf.meshes[n.mesh!]!.primitives) {
        const a = gltf.accessors[p.attributes.POSITION!]!;
        if (!a.min || !a.max) continue;
        lo = lo.map((v, k) => Math.min(v, a.min![k]!));
        hi = hi.map((v, k) => Math.max(v, a.max![k]!));
      }
    }
    // Les huit coins, passés par la MÊME fonction que les ancres.
    const coins: { x: number; y: number; z: number }[] = [];
    for (const x of [lo[0]!, hi[0]!])
      for (const y of [lo[1]!, hi[1]!])
        for (const z of [lo[2]!, hi[2]!]) coins.push(versRepereRendu({ x, y, z }));
    const axe = (k: "x" | "y" | "z") => ({
      min: Math.min(...coins.map((c) => c[k])),
      max: Math.max(...coins.map((c) => c[k])),
    });
    return { x: axe("x"), y: axe("y"), z: axe("z") };
  })();

  // ⚠️ Les tolérances sont larges À DESSEIN : ce test épingle un ORDRE DE GRANDEUR, pas des
  // centimètres. Un modèle re-exporté peut bouger de quelques millimètres ; ce qu'on refuse,
  // c'est une voiture de quarante centimètres ou de quatre cents mètres.
  it("mesure une vraie bZ4X, en mètres", () => {
    expect(boite.x.max - boite.x.min).toBeGreaterThan(1.8);
    expect(boite.x.max - boite.x.min).toBeLessThan(2.5);
    expect(boite.y.max - boite.y.min).toBeGreaterThan(1.3);
    expect(boite.y.max - boite.y.min).toBeLessThan(1.9);
    expect(boite.z.max - boite.z.min).toBeGreaterThan(4.3);
    expect(boite.z.max - boite.z.min).toBeLessThan(5.0);
  });

  it("est DEBOUT et couchée dans le bon sens — plus longue que haute, plus large que haute", () => {
    const largeur = boite.x.max - boite.x.min;
    const hauteur = boite.y.max - boite.y.min;
    const longueur = boite.z.max - boite.z.min;
    expect(longueur).toBeGreaterThan(hauteur);
    expect(largeur).toBeGreaterThan(hauteur);
  });

  it("repose au-dessus de zéro, pas enfoncée dans le sol", () => {
    expect(boite.y.min).toBeGreaterThanOrEqual(0);
    expect(boite.y.min).toBeLessThan(0.4);
  });

  // ⚠️ LE LIEN QUI MANQUAIT : les ancres et la carrosserie dans le MÊME espace. C'est ce
  // test qui aurait rougi sur le défaut livré — les ancres étaient cent fois trop loin.
  it("contient chacune des ancres où se posent les états", () => {
    const marge = 0.25;
    for (const [nom, ancre] of Object.entries(ANCRES)) {
      const p = versRepereRendu(ancre);
      expect(p.x, `${nom} en largeur`).toBeGreaterThan(boite.x.min - marge);
      expect(p.x, `${nom} en largeur`).toBeLessThan(boite.x.max + marge);
      expect(p.y, `${nom} en hauteur`).toBeGreaterThan(boite.y.min - marge);
      expect(p.y, `${nom} en hauteur`).toBeLessThan(boite.y.max + marge);
      expect(p.z, `${nom} en longueur`).toBeGreaterThan(boite.z.min - marge);
      expect(p.z, `${nom} en longueur`).toBeLessThan(boite.z.max + marge);
    }
  });

  it("tient dans le rayon sur lequel la caméra se cadre", () => {
    const demiDiagonale = Math.hypot(
      (boite.x.max - boite.x.min) / 2,
      (boite.y.max - boite.y.min) / 2,
      (boite.z.max - boite.z.min) / 2,
    );
    expect(RAYON_VOITURE).toBeGreaterThan(demiDiagonale * 0.9);
    expect(RAYON_VOITURE).toBeLessThan(demiDiagonale * 1.4);
  });

  it("concorde avec les dimensions que `MODELE` déclare", () => {
    expect((MODELE.avantY - MODELE.arriereY) * ECHELLE_MODELE).toBeCloseTo(
      boite.z.max - boite.z.min,
      1,
    );
  });
});

describe("le rendu ne refait pas ce que le fichier fait déjà", () => {
  // ⚠️ Une garde de SOURCE, parce que le rendu n'est testable par rien d'autre : jsdom n'a
  // pas de WebGL. Elle épingle le geste exact qui a couché la voiture — une rotation
  // appliquée à la scène chargée, par-dessus celle que les nœuds portent déjà.
  const source = sansCommentairesJsx(
    readFileSync(resolve(process.cwd(), "app/ui/Voiture3D.tsx"), "utf8"),
  );

  it("ne touche pas à l'orientation de la scène chargée", () => {
    expect(source).not.toMatch(/\.rotation\.[xyz]\s*=/);
    expect(source).not.toMatch(/\.setRotationFrom|\.quaternion\s*\./);
  });

  it("ne touche pas non plus à son échelle", () => {
    expect(source).not.toMatch(/\.scale\.(set|[xyz]\s*=)/);
  });

  // Anti-vacuité : sans elle, les deux assertions ci-dessus passeraient sur un fichier vide.
  it("lit bien le composant de rendu, décommenté", () => {
    expect(source).toContain("scene.add(gltf.scene)");
    expect(readFileSync(resolve(process.cwd(), "app/ui/Voiture3D.tsx"), "utf8")).toContain(
      "partait couchée",
    );
    expect(source).not.toContain("partait couchée");
  });
});
