// tests/bandeauCarteLia.test.ts — la carte Google garde son clic droit ; la ligne dessous porte
// celui de LIA (Marc, 28/10/2026, option « bandeau sous la carte »).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lire = (chemin: string) => readFileSync(chemin, "utf8");

describe("bandeau sous la carte Google", () => {
  it("déclare son genre à LIA (data-lia-genre), sinon le menu ne sait pas de quelle carte il s'agit", () => {
    const source = lire("app/ui/BandeauCarte.tsx");
    expect(source).toContain("data-lia-genre={genre}");
    expect(source).toContain('className="hint bandeau-carte"');
  });

  it("chaque carte Google a sa ligne dessous, avec un genre qui la nomme", () => {
    expect(lire("app/ui/CarteGoogle.tsx").match(/<BandeauCarte genre="/g)).toHaveLength(2);
    expect(lire("app/activite/page.tsx")).toContain('<BandeauCarte genre="la ligne sous la carte de tous les trajets">');
    expect(lire("app/tendances/page.tsx")).toContain('<BandeauCarte genre="la ligne sous la carte de la zone parcourue">');
    expect(lire("app/page.tsx")).toContain('<Pastilles genre="la ligne sous la carte de la dernière position de la voiture">');
  });

  it("Pastilles ne pose data-lia-genre que si on lui en donne un", () => {
    const source = lire("app/ui/Pastille.tsx");
    expect(source).toContain("genre?: string");
    expect(source).toContain("data-lia-genre={genre}");
  });
});
