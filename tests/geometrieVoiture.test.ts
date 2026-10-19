// tests/geometrieVoiture.test.ts — la géométrie MESURÉE de la voiture, et son accord avec
// les ancres des pastilles.
//
// Ce fichier ne teste pas un calcul : il verrouille des CONSTANTES issues d'une mesure, et
// surtout leur COHÉRENCE entre elles. C'est là qu'un écart se glisse — l'image change, les
// roues bougent, et les pastilles de pression continuent de pointer l'ancien emplacement
// sans que rien ne le signale.

import { describe, expect, it } from "vitest";
import {
  OUVRANTS,
  RATIO_IMAGE,
  ROUES,
  estSymetrique,
  tientDansLeCadre,
  type Boite,
} from "@/lib/vehicle/geometrieVoiture";
import { ANCRES } from "@/lib/vehicle/pointsVoiture";
import type { Position } from "@/lib/vehicle/schemaVehicule";

describe("la géométrie mesurée sur le rendu", () => {
  it("les quatre roues sont en MIROIR — c'est la signature d'une vue orthographique", () => {
    // ⚠️ L'invariant qui prouve que le rendu est bien zénithal et sans perspective. Une
    // caméra de travers, ou une perspective résiduelle, décalerait un côté par rapport à
    // l'autre — et tout le placement des pastilles en dépend.
    expect(estSymetrique(ROUES)).toBe(true);
  });

  it("le miroir DISCRIMINE : une roue déplacée le fait tomber", () => {
    const fausse = { ...ROUES, "avant-droite": { ...ROUES["avant-droite"], y: 30 } };
    expect(estSymetrique(fausse)).toBe(false);
  });

  it("toutes les boîtes tiennent dans le cadre", () => {
    for (const [nom, b] of Object.entries({ ...ROUES, ...OUVRANTS })) {
      expect(tientDansLeCadre(b as Boite), `${nom} déborde`).toBe(true);
    }
  });

  it("une roue fait à peu près la largeur d'un pneu de bZ4X", () => {
    // 235 mm de section sur 2 117 mm hors tout = 11,1 %. On tolère l'épaulement et le
    // rendu, mais une valeur qui s'en éloignerait beaucoup signalerait un masque qui a
    // attrapé autre chose que le pneu — c'est exactement ce qui est arrivé au premier jet
    // (« roues » de 41 % de large, dues à un motif `rubber|wheel|rim` trop large).
    for (const b of Object.values(ROUES)) {
      expect(b.largeur).toBeGreaterThan(8);
      expect(b.largeur).toBeLessThan(16);
    }
  });

  it("le rapport annoncé est bien celui de l'image livrée", () => {
    expect(RATIO_IMAGE).toBeCloseTo(760 / 1685, 5);
    // Portrait franc : c'est ce qui justifie de ranger les pastilles en colonne.
    expect(RATIO_IMAGE).toBeLessThan(0.6);
  });
});

describe("les pastilles de pression suivent les roues", () => {
  const paires: Array<[string, Position]> = [
    ["pneu-avant-gauche", "avant-gauche"],
    ["pneu-avant-droite", "avant-droite"],
    ["pneu-arriere-gauche", "arriere-gauche"],
    ["pneu-arriere-droite", "arriere-droite"],
  ];

  it("chaque pastille est posée SUR sa roue", () => {
    // ⚠️ LE COUPLAGE QUI COMPTE. Sans ce test, remplacer l'image (donc re-mesurer `ROUES`)
    // laisserait les ancres sur l'ancien emplacement : les pressions désigneraient la
    // mauvaise roue, en silence, et une pastille verte sur la roue molle est précisément
    // le mensonge que ce projet s'interdit.
    //
    // L'invariant est « DANS la boîte de la roue », pas « à son centre » : l'ordonnée doit
    // pouvoir glisser le long de la roue pour laisser passer un voisin (c'est ce qui a
    // libéré la place de la trappe de charge à l'avant droit). Exiger le centre aurait
    // interdit ce réglage sans rien protéger de plus.
    for (const [idPoint, position] of paires) {
      const ancre = ANCRES[idPoint as keyof typeof ANCRES];
      const roue = ROUES[position];
      expect(ancre.x, `${idPoint} en x`).toBeCloseTo(roue.x, 5);
      expect(ancre.y, `${idPoint} au-dessus de sa roue`).toBeGreaterThanOrEqual(
        roue.y - roue.hauteur / 2,
      );
      expect(ancre.y, `${idPoint} sous sa roue`).toBeLessThanOrEqual(roue.y + roue.hauteur / 2);
    }
  });

  it("le couplage DISCRIMINE : une pastille sortie de sa roue le fait tomber", () => {
    // Preuve que le test ci-dessus attrape bien ce qu'il annonce.
    const roue = ROUES["avant-droite"];
    const horsRoue = roue.y + roue.hauteur / 2 + 0.1;
    expect(horsRoue).toBeGreaterThan(roue.y + roue.hauteur / 2);
  });

  it("la charge désigne la trappe : à DROITE, et à l'AVANT", () => {
    // Marc, 20/08 : « mets la charge à l'endroit où se charge la voiture (avant droit) ».
    expect(ANCRES.charge.x).toBeGreaterThan(60);
    expect(ANCRES.charge.y).toBeLessThan(30);
  });

  it("les autres points ne sont PAS sur les roues : ils descendent en colonne", () => {
    // La largeur est la ressource rare dans un cadre portrait ; la colonne centrale est ce
    // qui permet à six pastilles de cohabiter sans se toucher.
    // ⚠️ `charge` n'en fait PAS partie : elle a rejoint la trappe, à l'avant droit.
    const centraux = ["autonomie", "verrou", "ouvrants", "odometre", "synchro"] as const;
    for (const id of centraux) expect(ANCRES[id].x, id).toBe(50);
  });
});
