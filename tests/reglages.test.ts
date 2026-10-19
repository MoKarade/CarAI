// tests/reglages.test.ts — la saisie qui débloque les montants.
//
// Marc, 13/08 : « le prix pour les recharges marche toujours pas ». Cause réelle : rien
// n'écrivait jamais `tarifKwh`. Ces tests couvrent la validation de la saisie qui le rend
// enfin possible — et surtout la distinction VIDE ≠ ZÉRO, qui décide si l'écran affiche
// « — » ou « 0,00 $ ».

import { describe, expect, it } from "vitest";
import { lireReglages, nombreOuNull, valeursFormulaireBail } from "@/lib/vehicle/reglages";

/** Un FormData minimal, comme celui qu'une Server Action reçoit. */
const form = (champs: Record<string, string>) => ({
  get: (cle: string) => (cle in champs ? champs[cle]! : null),
});

const VALIDE = {
  debut: "2027-07-14",
  dureeMois: "36",
  kilometrageAutorise: "36000",
  kilometrageInitial: "30",
  tarifKwh: "0.078",
  coutParKmExcedentaire: "0.15",
  devise: "CAD",
};

describe("nombreOuNull", () => {
  // ⚠️ LE piège, déjà rencontré sur Number(null) : Number("") vaut 0. Un champ vidé
  // deviendrait « l'électricité est gratuite » au lieu de « je ne sais pas ».
  it("un champ VIDE rend null, jamais zéro", () => {
    expect(nombreOuNull("")).toBeNull();
    expect(nombreOuNull("   ")).toBeNull();
    expect(nombreOuNull(null)).toBeNull();
    expect(nombreOuNull(undefined)).toBeNull();
  });

  it("un zéro SAISI reste zéro — c'est une affirmation, pas une absence", () => {
    expect(nombreOuNull("0")).toBe(0);
  });

  it("accepte la virgule décimale (clavier francophone)", () => {
    expect(nombreOuNull("0,078")).toBeCloseTo(0.078, 6);
  });

  it("rend NaN sur une saisie illisible, pour que l'appelant la refuse", () => {
    expect(Number.isNaN(nombreOuNull("abc") as number)).toBe(true);
  });
});

describe("lireReglages", () => {
  it("accepte une saisie complète et rend des termes prêts à écrire", () => {
    const r = lireReglages(form(VALIDE));
    expect(r.ok).toBe(true);
    expect(r.erreurs).toEqual([]);
    expect(r.bail).toMatchObject({
      debut: "2027-07-14",
      dureeMois: 36,
      kilometrageAutorise: 36_000,
      kilometrageInitial: 30,
      tarifKwh: 0.078,
      coutParKmExcedentaire: 0.15,
      devise: "CAD",
    });
  });

  // ⚠️ Le cœur de la demande : sans ce chemin, aucun montant n'apparaît jamais.
  it("le tarif du kWh saisi ressort tel quel — c'est lui qui débloque les montants", () => {
    const r = lireReglages(form({ ...VALIDE, tarifKwh: "0,1042" }));
    expect(r.bail!.tarifKwh).toBeCloseTo(0.1042, 6);
  });

  it("un tarif EFFACÉ remet null : les montants disparaissent au lieu d'être faux", () => {
    const r = lireReglages(form({ ...VALIDE, tarifKwh: "" }));
    expect(r.ok).toBe(true);
    expect(r.bail!.tarifKwh).toBeNull();
  });

  it("refuse une date de signature mal formée", () => {
    const r = lireReglages(form({ ...VALIDE, debut: "14/07/2026" }));
    expect(r.ok).toBe(false);
    expect(r.erreurs.join(" ")).toContain("AAAA-MM-JJ");
  });

  it("refuse une durée non entière ou négative", () => {
    expect(lireReglages(form({ ...VALIDE, dureeMois: "0" })).ok).toBe(false);
    expect(lireReglages(form({ ...VALIDE, dureeMois: "-12" })).ok).toBe(false);
    expect(lireReglages(form({ ...VALIDE, dureeMois: "12.5" })).ok).toBe(false);
  });

  it("refuse un kilométrage autorisé absent ou nul", () => {
    expect(lireReglages(form({ ...VALIDE, kilometrageAutorise: "" })).ok).toBe(false);
    expect(lireReglages(form({ ...VALIDE, kilometrageAutorise: "0" })).ok).toBe(false);
  });

  it("refuse un tarif négatif, mais accepte qu'il soit inconnu", () => {
    expect(lireReglages(form({ ...VALIDE, tarifKwh: "-0.05" })).ok).toBe(false);
    expect(lireReglages(form({ ...VALIDE, tarifKwh: "" })).ok).toBe(true);
  });

  it("accepte un odomètre initial vide — il reste inconnu, la limite est dite ailleurs", () => {
    const r = lireReglages(form({ ...VALIDE, kilometrageInitial: "" }));
    expect(r.ok).toBe(true);
    expect(r.bail!.kilometrageInitial).toBeNull();
  });

  it("rend TOUTES les erreurs d'un coup plutôt qu'une à la fois", () => {
    const r = lireReglages(
      form({ ...VALIDE, debut: "hier", dureeMois: "zéro", kilometrageAutorise: "" }),
    );
    expect(r.ok).toBe(false);
    expect(r.erreurs.length).toBeGreaterThanOrEqual(3);
  });

  it("la devise vide retombe sur CAD, une devise mal formée est refusée", () => {
    expect(lireReglages(form({ ...VALIDE, devise: "" })).bail!.devise).toBe("CAD");
    expect(lireReglages(form({ ...VALIDE, devise: "dollars" })).ok).toBe(false);
    expect(lireReglages(form({ ...VALIDE, devise: "usd" })).bail!.devise).toBe("USD");
  });

  it("aucun bail n'est rendu quand la saisie est refusée", () => {
    const r = lireReglages(form({ ...VALIDE, kilometrageAutorise: "-1" }));
    expect(r.ok).toBe(false);
    expect(r.bail).toBeUndefined();
  });
});

describe("valeursFormulaireBail", () => {
  it("sans bail en base, tous les champs sont VIDES (jamais 0) et la devise reste CAD", () => {
    expect(valeursFormulaireBail(null)).toEqual({
      debut: undefined,
      dureeMois: undefined,
      kilometrageAutorise: undefined,
      kilometrageInitial: undefined,
      coutParKmExcedentaire: undefined,
      tarifKwh: undefined,
      devise: "CAD",
    });
  });

  it("avec un bail, reprend ses termes en texte ; un nullable inconnu reste vide", () => {
    const r = lireReglages(form({ ...VALIDE, tarifKwh: "", coutParKmExcedentaire: "" }));
    expect(valeursFormulaireBail(r.bail!)).toEqual({
      debut: "2027-07-14",
      dureeMois: "36",
      kilometrageAutorise: "36000",
      kilometrageInitial: "30",
      coutParKmExcedentaire: undefined,
      tarifKwh: undefined,
      devise: "CAD",
    });
  });
});
