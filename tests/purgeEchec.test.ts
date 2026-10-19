// tests/purgeEchec.test.ts — un échec de suppression se dit en une phrase claire (carte 10
// du 15/10), jamais avec le texte brut de l'erreur technique.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MESSAGE_ECHEC_SUPPRESSION } from "@/lib/vehicle/purgeSimulee";

describe("échec de suppression", () => {
  it("dit que la suppression n'a pas abouti et invite à réessayer", () => {
    expect(MESSAGE_ECHEC_SUPPRESSION).toBe("La suppression n’a pas abouti, réessaie.");
  });

  it("l'écran n'affiche plus err.message", () => {
    const source = readFileSync("app/reglages/purgeSimulee.tsx", "utf8");
    expect(source).toContain("setResultat(MESSAGE_ECHEC_SUPPRESSION)");
    expect(source).not.toContain("err.message");
  });
});
