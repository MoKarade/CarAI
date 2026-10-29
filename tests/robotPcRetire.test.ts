// tests/robotPcRetire.test.ts — aucun workflow ne vise le robot du PC de Marc (CarAI#14).
//
// Le dépôt est PUBLIC : la CI tourne sur les machines GitHub. Un `runs-on` vers `self-hosted` ou
// `pc-marc` ferait servir du code de PR par le PC de Marc ; ce verrou le refuse dans tout workflow.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DOSSIER = ".github/workflows";

/** Les lignes actives (hors commentaires) qui nomment le robot du PC. */
export function lignesRobotPc(yaml: string): string[] {
  return yaml
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !l.startsWith("#") && /self-hosted|pc-marc/.test(l));
}

describe("le robot du PC ne sert plus le dépôt (CarAI#14)", () => {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith(".yml"));

  it("il y a des workflows à vérifier", () => {
    expect(fichiers.length).toBeGreaterThan(0);
  });

  it.each(fichiers)("%s ne vise ni self-hosted ni pc-marc", (fichier) => {
    expect(lignesRobotPc(readFileSync(`${DOSSIER}/${fichier}`, "utf8"))).toEqual([]);
  });

  it("refuse un workflow qui viserait le robot du PC", () => {
    expect(lignesRobotPc(`jobs:\n  a:\n    runs-on: [self-hosted, pc-marc]\n`)).toHaveLength(1);
    expect(lignesRobotPc(`jobs:\n  a:\n    runs-on: fromJSON('["self-hosted"]')\n`)).toHaveLength(1);
  });

  it("laisse passer ubuntu-latest et les commentaires qui en parlent", () => {
    expect(lignesRobotPc(`# jamais self-hosted\njobs:\n  a:\n    runs-on: ubuntu-latest\n`)).toEqual([]);
  });
});
