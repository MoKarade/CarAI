// tests/schemaVehicule.test.ts — placer une mesure sur la voiture, et décider de son état.
//
// Ce module dessine par procuration : une erreur ici ne casse rien, elle peint la mauvaise
// roue en rouge. D'où deux exigences testées ici plus qu'ailleurs — (1) les seuils viennent
// des CONSTANTES d'alertes.ts, jamais d'un chiffre recopié ; (2) une position qu'on ne sait
// pas lire reste `null` au lieu d'être devinée.

import { describe, expect, it } from "vitest";
import { BAISSE_PNEU_KPA, ECART_PNEU_KPA } from "@/lib/vehicle/alertes";
import {
  diagnostiquerPneus,
  libellePosition,
  ouvrantsDuJson,
  positionDepuisLibelle,
  positionDepuisRangee,
  resumerOuvrants,
  PSI_PAR_KPA,
} from "@/lib/vehicle/schemaVehicule";

describe("positionDepuisLibelle", () => {
  it("lit ce que rouesDuJson produit", () => {
    expect(positionDepuisLibelle("avant gauche")).toBe("avant-gauche");
    expect(positionDepuisLibelle("avant droite")).toBe("avant-droite");
    expect(positionDepuisLibelle("arrière gauche")).toBe("arriere-gauche");
    expect(positionDepuisLibelle("arrière droite")).toBe("arriere-droite");
  });

  it("lit aussi les formes anglaises des sources", () => {
    expect(positionDepuisLibelle("frontLeft")).toBe("avant-gauche");
    expect(positionDepuisLibelle("REAR_RIGHT")).toBe("arriere-droite");
    expect(positionDepuisLibelle("back left door")).toBe("arriere-gauche");
  });

  // ⚠️ LE point du module : ne jamais deviner. Une position inventée peindrait une portière
  // ouverte du mauvais côté sur l'écran qui sert à vérifier qu'on a tout fermé.
  it("REFUSE une position ambiguë ou incomplète", () => {
    expect(positionDepuisLibelle("gauche")).toBeNull(); // ni avant ni arrière
    expect(positionDepuisLibelle("avant")).toBeNull(); // ni gauche ni droite
    expect(positionDepuisLibelle("coffre")).toBeNull();
    expect(positionDepuisLibelle("")).toBeNull();
    // Les deux dimensions présentes DEUX fois : illisible, donc refusé.
    expect(positionDepuisLibelle("avant arrière gauche")).toBeNull();
  });
});

describe("positionDepuisRangee", () => {
  it("suit la convention mesurée sur la bZ (rangée 0 = avant, colonne 0 = gauche)", () => {
    expect(positionDepuisRangee(0, 0)).toBe("avant-gauche");
    expect(positionDepuisRangee(0, 1)).toBe("avant-droite");
    expect(positionDepuisRangee(1, 0)).toBe("arriere-gauche");
    expect(positionDepuisRangee(1, 1)).toBe("arriere-droite");
  });

  it("refuse ce qui n'est pas une coordonnée connue", () => {
    expect(positionDepuisRangee(2, 0)).toBeNull();
    expect(positionDepuisRangee(0, 5)).toBeNull();
    expect(positionDepuisRangee(null, 0)).toBeNull();
    expect(positionDepuisRangee("avant", "gauche")).toBeNull();
  });
});

describe("diagnostiquerPneus", () => {
  const roues = (...pressions: number[]) => [
    { libelle: "avant gauche", pression: pressions[0]! },
    { libelle: "avant droite", pression: pressions[1]! },
    { libelle: "arrière gauche", pression: pressions[2]! },
    { libelle: "arrière droite", pression: pressions[3]! },
  ];

  it("quatre roues égales : rien à signaler, et chacune est placée", () => {
    const d = diagnostiquerPneus(roues(230, 230, 230, 230));
    expect(d).toHaveLength(4);
    expect(d.every((p) => p.etat === "ok")).toBe(true);
    expect(d.every((p) => p.raison === "")).toBe(true);
    expect(d.map((p) => p.position)).toEqual([
      "avant-gauche",
      "avant-droite",
      "arriere-gauche",
      "arriere-droite",
    ]);
  });

  // ⚠️ Dérivé de la CONSTANTE, jamais d'un « 20 » recopié : au premier rajustement du seuil
  // dans alertes.ts, un test écrit en dur mentirait sans rien casser.
  it("les seuils se dérivent de ECART_PNEU_KPA, des deux côtés", () => {
    const juste = diagnostiquerPneus(roues(230 - ECART_PNEU_KPA, 230, 230, 230))[0]!;
    expect(juste.etat).toBe("alerte");

    const dessous = diagnostiquerPneus(roues(230 - ECART_PNEU_KPA + 1, 230, 230, 230))[0]!;
    expect(dessous.etat).not.toBe("alerte");
  });

  it("le palier « surveiller » est la MOITIÉ du seuil d'alerte", () => {
    const moitie = diagnostiquerPneus(roues(230 - ECART_PNEU_KPA / 2, 230, 230, 230))[0]!;
    expect(moitie.etat).toBe("surveiller");
    expect(moitie.raison).not.toBe("");

    const sous = diagnostiquerPneus(roues(230 - ECART_PNEU_KPA / 2 + 1, 230, 230, 230))[0]!;
    expect(sous.etat).toBe("ok");
  });

  it("attrape une baisse par rapport à SA PROPRE référence, même si les 4 roues sont égales", () => {
    // Les quatre roues descendent ensemble (froid) : l'écart entre roues ne voit rien.
    const plates = roues(200, 200, 200, 200);
    expect(diagnostiquerPneus(plates)[0]!.etat).toBe("ok");

    const references = new Map([["avant gauche", 200 + BAISSE_PNEU_KPA]]);
    const avecRef = diagnostiquerPneus(plates, references)[0]!;
    expect(avecRef.etat).toBe("alerte");
    expect(avecRef.baisseKpa).toBe(BAISSE_PNEU_KPA);
    expect(avecRef.raison).toContain("habitude");
  });

  it("compare à la MÉDIANE des autres, pas à leur moyenne", () => {
    // Deux roues basses : une moyenne serait tirée vers le bas et masquerait l'écart.
    const d = diagnostiquerPneus(roues(180, 180, 240, 240))[0]!;
    expect(d.ecartKpa).toBe(60); // médiane(180, 240, 240) = 240
  });

  it("sous trois roues, aucun écart n'est calculable — et rien n'est affirmé", () => {
    const d = diagnostiquerPneus([{ libelle: "avant gauche", pression: 150 }]);
    expect(d[0]!.ecartKpa).toBeNull();
    expect(d[0]!.etat).toBe("ok");
  });

  it("convertit en psi — l'unité des pompes à air d'ici", () => {
    const d = diagnostiquerPneus(roues(240, 240, 240, 240))[0]!;
    expect(d.psi).toBeCloseTo(240 * PSI_PAR_KPA, 6);
    expect(d.psi).toBeCloseTo(34.8, 1);
  });

  it("garde le libellé de la source même quand la position est illisible", () => {
    const d = diagnostiquerPneus([
      { libelle: "roue de secours", pression: 300 },
      { libelle: "avant gauche", pression: 230 },
      { libelle: "avant droite", pression: 230 },
    ]);
    expect(d[0]!.position).toBeNull();
    expect(d[0]!.libelle).toBe("roue de secours");
  });
});

describe("ouvrantsDuJson", () => {
  it("lit la forme values[] avec row/column", () => {
    const o = ouvrantsDuJson({
      values: [
        { row: 0, column: 0, isOpen: false },
        { row: 1, column: 1, isOpen: true },
      ],
    });
    expect(o).toHaveLength(2);
    expect(o[0]).toMatchObject({ position: "avant-gauche", ouvert: false });
    expect(o[1]).toMatchObject({ position: "arriere-droite", ouvert: true });
  });

  it("lit la forme imbriquée { values: { values: [...] } } vue en livraison TEST", () => {
    const o = ouvrantsDuJson({ values: { values: [{ row: 0, column: 1, isOpen: true }] } });
    expect(o).toHaveLength(1);
    expect(o[0]!.position).toBe("avant-droite");
  });

  it("lit la forme « un objet par ouvrant »", () => {
    const o = ouvrantsDuJson({
      frontLeft: { isOpen: true },
      rearRight: { isOpen: false },
    });
    expect(o).toHaveLength(2);
    expect(o.find((x) => x.position === "avant-gauche")!.ouvert).toBe(true);
    expect(o.find((x) => x.position === "arriere-droite")!.ouvert).toBe(false);
  });

  it("accepte un booléen écrit en TEXTE (les sources le font)", () => {
    const o = ouvrantsDuJson({ values: [{ row: 0, column: 0, isOpen: "true" }] });
    expect(o[0]!.ouvert).toBe(true);
  });

  // ⚠️ Sans position lisible, l'ouvrant existe mais n'est PAS placé : le schéma le comptera
  // sans colorier de portière.
  it("garde l'ouvrant SANS position quand la source ne dit pas de quel coin il s'agit", () => {
    const o = ouvrantsDuJson({ values: [{ name: "coffre", isOpen: true }] });
    expect(o).toHaveLength(1);
    expect(o[0]!.position).toBeNull();
    expect(o[0]!.cle).toBe("coffre");
    expect(o[0]!.ouvert).toBe(true);
  });

  it("écarte ce qui ne porte aucun état d'ouverture", () => {
    expect(ouvrantsDuJson({ values: [{ row: 0, column: 0 }] })).toEqual([]);
    expect(ouvrantsDuJson({})).toEqual([]);
    expect(ouvrantsDuJson(null)).toEqual([]);
    expect(ouvrantsDuJson({ vitesse: 42 })).toEqual([]);
  });
});

describe("resumerOuvrants", () => {
  it("sépare ce qu'on peut PEINDRE de ce qu'on doit se contenter de compter", () => {
    const r = resumerOuvrants([
      { cle: "avant gauche", position: "avant-gauche", ouvert: true },
      { cle: "coffre", position: null, ouvert: true },
      { cle: "arrière droite", position: "arriere-droite", ouvert: false },
    ]);
    expect(r.ouvertes).toEqual(["avant-gauche"]);
    expect(r.nbOuvertsSansPosition).toBe(1);
    expect(r.nbTotal).toBe(3);
  });

  it("tout fermé : rien à peindre", () => {
    const r = resumerOuvrants([
      { cle: "avant gauche", position: "avant-gauche", ouvert: false },
    ]);
    expect(r.ouvertes).toEqual([]);
    expect(r.nbOuvertsSansPosition).toBe(0);
  });
});

describe("libellePosition", () => {
  it("rend un libellé français lisible", () => {
    expect(libellePosition("arriere-gauche")).toBe("arrière gauche");
    expect(libellePosition("avant-droite")).toBe("avant droite");
  });
});
