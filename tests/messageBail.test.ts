// tests/messageBail.test.ts — un message par état, et ils ne se ressemblent pas.
//
// La garde qui compte n'est pas « le texte est correct » (il changera) mais « les SEPT états
// produisent SEPT messages DISTINCTS » : c'est la seule propriété qui empêche de retomber sur
// un tiret unique qui enverrait Marc chercher au mauvais endroit.

import { describe, expect, it } from "vitest";
import { messageBail } from "@/lib/vehicle/messageBail";
import type { LectureBail } from "@/lib/financeai/bail";

const ETATS: LectureBail[] = [
  { statut: "non-configure" },
  { statut: "injoignable", detail: "ECONNREFUSED" },
  { statut: "refuse" },
  { statut: "absent" },
  { statut: "ambigu", candidates: ["bZ", "Corolla"] },
  { statut: "invalide", detail: "hors schéma" },
];

describe("messageBail", () => {
  it("rend null — et RIEN d'autre — quand les montants sont là", () => {
    expect(messageBail({ statut: "ok", bail: {} as never }, true)).toBeNull();
  });

  it("parle quand la lecture a réussi mais que la MENSUALITÉ manque (état « ok » trompeur)", () => {
    const m = messageBail({ statut: "ok", bail: {} as never }, false);
    expect(m).not.toBeNull();
    expect(m!.texte).toContain("mensualité");
    expect(m!.aConfigurer).toBe(true);
  });

  it("produit un message pour CHACUN des six états d'échec", () => {
    for (const e of ETATS) {
      const m = messageBail(e, false);
      expect(m, `état ${e.statut}`).not.toBeNull();
      expect(m!.texte.length, `état ${e.statut}`).toBeGreaterThan(20);
    }
  });

  it("les messages sont tous DISTINCTS — c'est là toute l'utilité", () => {
    const textes = ETATS.map((e) => messageBail(e, false)!.texte);
    expect(new Set(textes).size).toBe(ETATS.length);
  });

  it("distingue « à configurer » d'un état PASSAGER — le PC éteint n'est pas une erreur de Marc", () => {
    expect(messageBail({ statut: "injoignable", detail: "x" }, false)!.aConfigurer).toBe(false);
    expect(messageBail({ statut: "non-configure" }, false)!.aConfigurer).toBe(true);
    expect(messageBail({ statut: "refuse" }, false)!.aConfigurer).toBe(true);
  });

  it("l'ambiguïté NOMME les candidates — sinon Marc ne peut pas choisir", () => {
    const m = messageBail({ statut: "ambigu", candidates: ["bZ", "Corolla"] }, false)!;
    expect(m.texte).toContain("bZ");
    expect(m.texte).toContain("Corolla");
    expect(m.texte).toContain("FINANCEAI_VEHICULE_DETTE");
  });
});
