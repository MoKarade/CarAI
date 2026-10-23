// tests/liaMouvement.test.ts — LIA est UNE seule, identique dans toutes les apps (Marc, 23/10/2026) :
// le mouvement et la pastille d'humeur viennent de lia-ui, l'app n'en règle aucun, et elle est
// présente tout le temps (démarrée hors du rendu). Verrou de source : ces options ne sont lues qu'au
// démarrage par lia-ui, un test de rendu ne les verrait pas.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const racine = join(__dirname, "..");
const source = readFileSync(join(racine, "components", "LiaDemarrage.tsx"), "utf8");
const layout = readFileSync(join(racine, "app", "layout.tsx"), "utf8");
const paquet = readFileSync(join(racine, "package.json"), "utf8");

/** Le code sans les commentaires de ligne : le « jamais dans un effet » de l'en-tête ne doit pas fausser les tests. */
const code = source
  .split("\n")
  .filter((ligne) => !ligne.trim().startsWith("//"))
  .join("\n");

describe("LiaDemarrage : réglages communs", () => {
  it("ne règle ni le mouvement réduit ni la pastille d'humeur (défauts du paquet)", () => {
    expect(source).not.toContain("quandMouvementReduit");
    expect(source).not.toContain("humeurVisible");
  });

  it("utilise lia-ui v0.16.0 ou plus récent (démarrage hors du rendu)", () => {
    const m = /"@mokarade\/lia-ui": "github:MoKarade\/lia-ui#v(\d+)\.(\d+)\.(\d+)"/.exec(paquet);
    expect(m).not.toBeNull();
    const [major = 0, minor = 0] = (m ?? []).slice(1).map(Number);
    expect(major > 0 || minor >= 16).toBe(true);
  });
});

describe("LiaDemarrage : présente tout le temps, une seule voie", () => {
  it("démarre par demarrerLia au chargement du module, pas dans un effet ni un composant", () => {
    expect(code).toContain('from "@mokarade/lia-ui/boot"');
    expect(code).toContain("demarrerLia(");
    expect(code).not.toMatch(/useEffect|useLayoutEffect/);
    expect(code).toMatch(/if \(typeof window !== "undefined"\) \{\s*demarrerLia\(/);
  });

  it("une seule voie : ni <Lia /> ni le sous-chemin react, nulle part dans l'app", () => {
    expect(code).not.toContain("@mokarade/lia-ui/react");
    expect(layout).not.toContain("@mokarade/lia-ui/react");
    expect(existsSync(join(racine, "components", "LiaMontee.tsx"))).toBe(false);
  });

  it("le layout ne rend LiaDemarrage que pour une session admise (jamais sur /login)", () => {
    expect(layout).toContain("liaAutorisee");
    expect(layout).toContain("{lia ? <LiaDemarrage /> : null}");
  });
});
