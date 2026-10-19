// tests/baseNonBranchee.test.ts — les pages disent « la base de données n'est pas branchée »
// en mots simples, sans nommer la variable technique (carte 6 du 15/10).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PAGES = ["app/activite/page.tsx", "app/donnees/page.tsx", "app/tendances/page.tsx", "app/reglages/page.tsx"];

describe("base non branchée", () => {
  it.each(PAGES)("%s ne cite plus DATABASE_URL", (page) => {
    const source = readFileSync(page, "utf8");
    expect(source).not.toContain("DATABASE_URL");
    expect(source).toContain("La base de données n’est pas branchée");
  });
});
