// tests/paiementsBail.test.ts — « payé sur le total du bail », le calcul PUR.
//
// Ce que ces tests défendent :
//  - le TOTAL est `mensualité × durée`, jamais le montant financé (ils divergent dès que le
//    taux n'est pas nul, et le second n'est pas ce que Marc paiera) ;
//  - une mensualité absente rend `null`, jamais un zéro — « 0 sur 0 » aurait l'air d'une mesure ;
//  - les contrôles de cohérence PARLENT au lieu de corriger en silence, et s'ABSTIENNENT là où
//    ils ne veulent rien dire (taux non nul).

import { describe, expect, it } from "vitest";
import { paiementsBail, versementsDus, type ChiffresBail } from "@/lib/vehicle/paiementsBail";
import type { TermesBail } from "@/lib/vehicle/lease";

const TERMES: TermesBail = {
  debut: "2027-07-14",
  dureeMois: 36,
  kilometrageAutorise: 36_000,
  coutParKmExcedentaire: null,
  devise: "CAD",
};

// Mensualité FICTIVE, cohérente avec le solde : 12 000 / 24 versements restants. La cohérence
// des trois chiffres est ce qui fait de ce cas un témoin utile.
const MENSUALITE = 500;

const chiffres = (over: Partial<ChiffresBail> = {}): ChiffresBail => ({
  mensualite: MENSUALITE,
  solde: 12_000,
  tauxAnnuelPourcent: 0,
  montantOrigine: null,
  debut: "2027-07-14",
  ...over,
});

const LE_15_SEPT = new Date("2027-09-15T14:00:00Z");

describe("versementsDus", () => {
  it("compte les mois RÉVOLUS — le quantième de signature n'est pas encore atteint", () => {
    // Du 14/07 au 13/09 : le 2e mois n'est pas révolu.
    expect(versementsDus(new Date("2027-07-14T00:00:00Z"), new Date("2027-09-13T00:00:00Z"), 36)).toBe(1);
    // Du 14/07 au 14/09 : il l'est.
    expect(versementsDus(new Date("2027-07-14T00:00:00Z"), new Date("2027-09-14T00:00:00Z"), 36)).toBe(2);
  });

  it("ne compte rien avant le début, et jamais au-delà de la durée", () => {
    const debut = new Date("2027-07-14T00:00:00Z");
    expect(versementsDus(debut, new Date("2027-07-01T00:00:00Z"), 36)).toBe(0);
    expect(versementsDus(debut, new Date("2040-01-01T00:00:00Z"), 36)).toBe(36);
  });

  it("rend 0 sur une durée absurde plutôt que de lever", () => {
    expect(versementsDus(new Date("2027-07-14T00:00:00Z"), LE_15_SEPT, 0)).toBe(0);
  });
});

describe("paiementsBail — le calcul", () => {
  it("le total est mensualité × durée, et le payé suit les versements dus", () => {
    const p = paiementsBail({ termes: TERMES, chiffres: chiffres(), maintenant: LE_15_SEPT });
    expect(p).not.toBeNull();
    expect(p!.versementsFaits).toBe(2);
    expect(p!.versementsTotal).toBe(36);
    expect(p!.totalContrat).toBeCloseTo(36 * MENSUALITE, 2);
    expect(p!.payeContrat).toBeCloseTo(2 * MENSUALITE, 2);
    expect(p!.fraction).toBeCloseTo(2 / 36, 6);
  });

  it("le total NE VIENT PAS du montant financé — il reste mensualité × durée", () => {
    // Un montant financé volontairement très différent : s'il servait de total, la fraction
    // changerait. Elle ne doit pas bouger.
    const p = paiementsBail({
      termes: TERMES,
      chiffres: chiffres({ montantOrigine: 30_000, tauxAnnuelPourcent: 5 }),
      maintenant: LE_15_SEPT,
    });
    expect(p!.totalContrat).toBeCloseTo(36 * MENSUALITE, 2);
    expect(p!.fraction).toBeCloseTo(2 / 36, 6);
  });
});

describe("paiementsBail — ce qui rend null (jamais un zéro)", () => {
  it("sans mensualité", () => {
    expect(paiementsBail({ termes: TERMES, chiffres: chiffres({ mensualite: null }), maintenant: LE_15_SEPT })).toBeNull();
  });
  it("sur une durée nulle", () => {
    const termes = { ...TERMES, dureeMois: 0 };
    expect(paiementsBail({ termes, chiffres: chiffres(), maintenant: LE_15_SEPT })).toBeNull();
  });
  it("sur une date de début illisible", () => {
    const termes = { ...TERMES, debut: "pas une date" };
    expect(paiementsBail({ termes, chiffres: chiffres(), maintenant: LE_15_SEPT })).toBeNull();
  });
});

describe("paiementsBail — les contrôles de cohérence", () => {
  it("AUCUNE réserve quand les trois chiffres concordent (anti-vacuité)", () => {
    const p = paiementsBail({ termes: TERMES, chiffres: chiffres({ solde: 17_000 }), maintenant: LE_15_SEPT });
    expect(p!.reserves).toEqual([]);
  });

  it("DIT l'écart quand le solde ne correspond pas aux versements restants", () => {
    const p = paiementsBail({
      termes: TERMES,
      chiffres: chiffres({ solde: 52_000 }),
      maintenant: LE_15_SEPT,
    });
    expect(p!.reserves).toHaveLength(1);
    expect(p!.reserves[0]).toContain("solde");
  });

  it("S'ABSTIENT du contrôle de solde dès que le taux n'est pas nul — il ne voudrait rien dire", () => {
    const p = paiementsBail({
      termes: TERMES,
      chiffres: chiffres({ solde: 52_000, tauxAnnuelPourcent: 5.9 }),
      maintenant: LE_15_SEPT,
    });
    expect(p!.reserves).toEqual([]);
  });

  it("DIT l'écart quand le montant financé ne correspond pas au total des versements", () => {
    const p = paiementsBail({
      termes: TERMES,
      chiffres: chiffres({ montantOrigine: 60_000 }),
      maintenant: LE_15_SEPT,
    });
    expect(p!.reserves.some((r) => r.includes("montant financé"))).toBe(true);
  });

  it("ne crie pas pour un arrondi — sous la tolérance, rien n'est dit", () => {
    const p = paiementsBail({
      termes: TERMES,
      chiffres: chiffres({ solde: 17_000, montantOrigine: 36 * MENSUALITE + 40 }),
      maintenant: LE_15_SEPT,
    });
    expect(p!.reserves).toEqual([]);
  });

  it("DIT la divergence de date entre les deux sources, sans trancher", () => {
    const p = paiementsBail({
      termes: TERMES,
      chiffres: chiffres({ debut: "2027-08-01" }),
      maintenant: LE_15_SEPT,
    });
    expect(p!.reserves.some((r) => r.includes("2027-08-01") && r.includes("2027-07-14"))).toBe(true);
    // Et CarAI garde la main sur les TERMES : le calcul reste ancré sur SA date.
    expect(p!.versementsFaits).toBe(2);
  });
});
