// tests/depassementEnDollars.test.ts — le dépassement du forfait en dollars (CarAI#7).
//
// Le tarif du km excédentaire est saisi par Marc dans Réglages ; AUCUNE valeur réelle n'entre
// ici : tout est fictif. Ce que ces tests gardent : le montant n'apparaît QUE quand le tarif est
// connu ET qu'un dépassement est projeté, il est dit « estimation », et un coût inconnu ne
// devient jamais « 0 $ ». La base et l'odomètre sont des doublures.

import { beforeEach, describe, expect, it, vi } from "vitest";

const base = vi.hoisted(() => ({
  lignes: [] as { value: unknown }[],
  odometre: [] as { km: number; mesureLe: Date }[],
}));

vi.mock("@/lib/db", () => ({
  baseConfiguree: () => true,
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => base.lignes }) }),
    }),
  },
}));
vi.mock("@/lib/vehicle/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vehicle/history")>()),
  historiqueOdometre: async () => base.odometre,
}));

import { outilParNom } from "@/lib/mcp/outils";
import { calculerEtatBail, libelleDepassementProjete } from "@/lib/vehicle/lease";

const maintenant = new Date("2027-08-05T12:00:00.000Z");

const BAIL = {
  debut: "2027-07-14",
  dureeMois: 36,
  kilometrageAutorise: 36_000,
  coutParKmExcedentaire: null as number | null,
  devise: "CAD",
};

const ROULE_BEAUCOUP = [
  { km: 0, mesureLe: new Date("2027-07-14T12:00:00.000Z") },
  { km: 2200, mesureLe: maintenant },
];
const ROULE_PEU = [
  { km: 0, mesureLe: new Date("2027-07-14T12:00:00.000Z") },
  { km: 500, mesureLe: maintenant },
];

function etat(tarif: number | null, odometre = ROULE_BEAUCOUP) {
  return calculerEtatBail({
    bail: { ...BAIL, coutParKmExcedentaire: tarif },
    historiqueOdometre: odometre,
    maintenant,
  });
}

describe("libelleDepassementProjete", () => {
  it("dépassement positif et tarif connu : kilomètres ET dollars, dit « estimation »", () => {
    const texte = libelleDepassementProjete(etat(0.15))!;
    expect(texte).toMatch(/^Dépassement projeté : [\d\s  ]+ km, ~ [\d\s  ]+\s?\$/);
    expect(texte).toContain("(estimation)");
    // Le montant affiché est bien celui du calcul, arrondi au dollar.
    const attendu = Math.round(etat(0.15).coutDepassementProjete!);
    const montant = Number(texte.split("~ ")[1]!.replace(/[^\d]/g, ""));
    expect(montant).toBe(attendu);
  });

  it("tarif absent : rien (jamais « 0 $ »), la limite « tarif inconnu » reste", () => {
    const e = etat(null);
    expect(e.depassementProjete).toBeGreaterThan(0);
    expect(libelleDepassementProjete(e)).toBeNull();
    expect(e.limites.some((l) => l.includes("Tarif au kilomètre"))).toBe(true);
  });

  it("aucun dépassement projeté, même avec un tarif : rien", () => {
    const e = etat(0.15, ROULE_PEU);
    expect(e.depassementProjete).toBeLessThan(0);
    expect(libelleDepassementProjete(e)).toBeNull();
  });

  it("rythme pas encore mesurable : rien", () => {
    expect(libelleDepassementProjete(etat(0.15, []))).toBeNull();
  });

  it("une devise que Intl refuse reste lisible au lieu de planter", () => {
    const texte = libelleDepassementProjete({
      depassementProjete: 1000,
      coutDepassementProjete: 100,
      devise: "pas-une-devise",
    });
    expect(texte).toContain("pas-une-devise");
    expect(texte).toContain("(estimation)");
  });
});

describe("outil MCP bail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(maintenant);
    base.lignes = [];
    base.odometre = ROULE_BEAUCOUP;
  });

  async function bail() {
    return (await outilParNom("bail")!.executer({})) as Record<string, unknown>;
  }

  it("avec tarif et dépassement : donne le coût estimé en plus des kilomètres", async () => {
    base.lignes = [{ value: { ...BAIL, coutParKmExcedentaire: 0.15 } }];
    const r = await bail();
    expect(r.coutDepassementProjete).toBeCloseTo(etat(0.15).coutDepassementProjete!, 5);
    expect(r.depassementProjeteKm).toBeCloseTo(etat(0.15).depassementProjete!, 5);
    expect(r.devise).toBe("CAD");
    expect(String(r.coutDepassement)).toContain("(estimation)");
    expect(r.limites).toEqual([]);
  });

  it("sans tarif : aucun champ en dollars, la limite le dit", async () => {
    base.lignes = [{ value: BAIL }];
    const r = await bail();
    expect(r).not.toHaveProperty("coutDepassementProjete");
    expect(r).not.toHaveProperty("coutDepassement");
    expect((r.limites as string[]).some((l) => l.includes("Tarif au kilomètre"))).toBe(true);
  });

  it("avec tarif mais sans dépassement : aucun champ en dollars", async () => {
    base.lignes = [{ value: { ...BAIL, coutParKmExcedentaire: 0.15 } }];
    base.odometre = ROULE_PEU;
    const r = await bail();
    expect(r).not.toHaveProperty("coutDepassementProjete");
  });
});

