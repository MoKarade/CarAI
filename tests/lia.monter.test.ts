// tests/lia.monter.test.ts — LIA est montée sur toutes les pages, sans condition de session
// (Marc, 23/10/2026 : « présente tout le temps »). Verrou de source : la condition vivait dans le layout,
// c'est là qu'elle reviendrait.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const racine = join(__dirname, "..");
const layout = readFileSync(join(racine, "app", "layout.tsx"), "utf8");

describe("LIA montée sans condition de session", () => {
  it("le layout rend <LiaDemarrage /> sans condition", () => {
    expect(layout).toMatch(/^\s*<LiaDemarrage \/>\s*$/m);
    expect(layout).not.toMatch(/\{[^}]*\?\s*<LiaDemarrage/);
    expect(layout).not.toMatch(/&&\s*<LiaDemarrage/);
  });

  it("le layout ne lit pas la session : plus de liaAutorisee ni de requireSession", () => {
    expect(layout).not.toContain("liaAutorisee");
    expect(layout).not.toContain("requireSession");
    expect(existsSync(join(racine, "lib", "lia", "monter.ts"))).toBe(false);
  });

  it("LIA reste sur /login : la page de connexion n'a pas son propre gabarit", () => {
    expect(existsSync(join(racine, "app", "login", "layout.tsx"))).toBe(false);
  });
});
