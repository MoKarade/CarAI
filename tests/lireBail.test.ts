// tests/lireBail.test.ts — sans bail en base, `lireBail()` rend null (aucun repli dans le code) et
// l'outil MCP `etatBail` le dit au lieu de chiffrer (CarAI#239). La base est une doublure.

import { beforeEach, describe, expect, it, vi } from "vitest";

const base = vi.hoisted(() => ({ lignes: [] as { value: unknown }[] }));

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
  historiqueOdometre: async () => [],
}));

import { lireBail } from "@/lib/config";
import { etatBail } from "../mcp/tools/history.tools";
import { MESSAGE_BAIL_NON_RENSEIGNE } from "@/lib/vehicle/lease";

const BAIL_FICTIF = {
  debut: "2027-03-02",
  dureeMois: 36,
  kilometrageAutorise: 90_000,
  coutParKmExcedentaire: null,
  devise: "CAD",
  kilometrageInitial: 30,
  tarifKwh: null,
};

describe("lireBail sans repli", () => {
  beforeEach(() => {
    base.lignes = [];
  });

  it("rend null quand rien n'est enregistré", async () => {
    expect(await lireBail()).toBeNull();
  });

  it("rend null (et le dit dans les journaux) quand la valeur en base est hors schéma", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    base.lignes = [{ value: { debut: 12 } }];
    expect(await lireBail()).toBeNull();
    expect(erreur).toHaveBeenCalled();
    erreur.mockRestore();
  });

  it("rend les termes enregistrés, tels quels", async () => {
    base.lignes = [{ value: BAIL_FICTIF }];
    expect(await lireBail()).toEqual(BAIL_FICTIF);
  });
});

describe("outil MCP etatBail", () => {
  beforeEach(() => {
    base.lignes = [];
  });

  it("dit « bail non renseigné » sans bail en base, sans aucun chiffre", async () => {
    expect(await etatBail()).toEqual({ renseigne: false, resume: MESSAGE_BAIL_NON_RENSEIGNE });
  });

  it("chiffre normalement avec un bail en base", async () => {
    base.lignes = [{ value: BAIL_FICTIF }];
    const r = (await etatBail()) as { allocationTotale: number; resume: string };
    expect(r.allocationTotale).toBe(90_000);
    expect(r.resume).not.toBe(MESSAGE_BAIL_NON_RENSEIGNE);
  });
});
