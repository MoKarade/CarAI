// tests/migrations.test.ts — le cooldown après un échec de migration (29/09/2026).
//
// Contexte : une panne Neon (quota HTTP 402, donc SOUTENUE, pas un blip réseau) a fait
// retenter `assurerMigrations()` la migration COMPLÈTE à CHAQUE requête pendant des heures
// — ~1 240 requêtes/24 h mesurées en production pendant l'incident — martelant une base déjà
// à quota au lieu de la laisser respirer. `dansCooldown` est la décision PURE qui empêche
// ça, testée sans base : la partie impure (le vrai appel réseau) n'est pas retestée ici.

import { describe, it, expect } from "vitest";
import { dansCooldown, COOLDOWN_ECHEC_MS } from "../lib/migrations";

describe("dansCooldown — pas de nouvelle tentative juste après un échec", () => {
  it("aucun échec récent (jamais tenté) : pas de cooldown", () => {
    expect(dansCooldown(null, Date.now())).toBe(false);
  });

  it("échec il y a 30 s, cooldown de 60 s : encore dans le cooldown", () => {
    const maintenant = 1_000_000;
    expect(dansCooldown(maintenant - 30_000, maintenant, 60_000)).toBe(true);
  });

  it("échec il y a exactement le cooldown : n'est plus dedans (borne stricte)", () => {
    const maintenant = 1_000_000;
    expect(dansCooldown(maintenant - 60_000, maintenant, 60_000)).toBe(false);
  });

  it("échec il y a plus que le cooldown : peut retenter", () => {
    const maintenant = 1_000_000;
    expect(dansCooldown(maintenant - 60_001, maintenant, 60_000)).toBe(false);
  });

  it("le cooldown par défaut est bien celui exporté (COOLDOWN_ECHEC_MS)", () => {
    const maintenant = 1_000_000;
    expect(dansCooldown(maintenant - 1, maintenant)).toBe(true);
    expect(dansCooldown(maintenant - COOLDOWN_ECHEC_MS, maintenant)).toBe(false);
  });
});
