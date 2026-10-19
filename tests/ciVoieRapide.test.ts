// tests/ciVoieRapide.test.ts — la CI garde ses règles d'économie SANS perdre ses contrôles (étape 2 de la structure commune).
// Lit .github/workflows/ci.yml et les tests comme DONNÉE. Règles :
//  - jamais de `paths:` (un check requis filtré ne tournerait pas et bloquerait la PR) ;
//  - push sur la branche par défaut seulement, concurrency avec annulation des runs périmés d'une PR ;
//  - voie rapide : les étapes lourdes sont sautées par `if:`, JAMAIS la sécurité (gitleaks, Semgrep), jamais la documentation légère ;
//  - tout document de docs/ (ou CLAUDE.md) LU par un test est déclaré dans DOCS_LUES_PAR_LES_TESTS : il ne prend jamais la voie rapide.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ci = readFileSync(".github/workflows/ci.yml", "utf8").replace(/\r\n/g, "\n");
const code = ci
  .split("\n")
  .filter((l) => !l.trim().startsWith("#"))
  .join("\n");
const SAUTE = "if: steps.voie.outputs.rapide != 'true'";

/** Bloc d'un job (de `  nom:` au job suivant), commentaires retirés. */
function job(nom: string): string {
  const debut = code.indexOf(`\n  ${nom}:\n`);
  expect(debut, `job ${nom}`).toBeGreaterThan(-1);
  const suite = code.slice(debut + 1).split(/\n {2}[a-z]+:\n/);
  return suite[0] ?? "";
}

/** Étape `- name: X` (ou `- uses: X`) : de son tiret au tiret suivant. */
function etape(bloc: string, debut: string): string {
  const i = bloc.indexOf(debut);
  expect(i, `étape ${debut}`).toBeGreaterThan(-1);
  return bloc.slice(i).split("\n      - ")[0] ?? "";
}

describe("déclencheurs et concurrency de la CI", () => {
  it("n'a jamais de `paths:` (check requis)", () => {
    expect(code).not.toMatch(/\bpaths(-ignore)?\s*:/);
  });

  it("push sur main seulement (jamais master, jamais une branche de PR)", () => {
    expect(code).toMatch(/push:\n {4}branches: \[main\]\n/);
    expect(code).not.toContain("master");
  });

  it("annule les runs périmés d'une PR sans jamais annuler un push sur main", () => {
    expect(code).toContain("group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}");
    expect(code).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });
});

describe("voie rapide : ce qui est sauté, ce qui ne l'est jamais", () => {
  it("chaque job de PR décide de la voie rapide avant de sauter quoi que ce soit", () => {
    for (const nom of ["gate", "audit", "qualite"]) {
      const b = job(nom);
      expect(b, nom).toContain("id: voie");
      expect(b, nom).toContain("node .github/ci/voie-rapide.mjs");
      expect(b, nom).toContain("fetch-depth: 0");
      expect(b.indexOf("id: voie"), nom).toBeLessThan(b.indexOf(SAUTE));
    }
  });

  it("le gate saute install, typecheck, lint, tests et build ; jamais la convention ni la documentation légère", () => {
    const g = job("gate");
    for (const n of ["- name: Dépendances", "- name: Typecheck", "- name: Lint", "- name: Tests", "- name: Build"]) expect(etape(g, n), n).toContain(SAUTE);
    for (const n of ["- name: La convention de compte-rendu", "- name: Documentation légère", "- name: Voie rapide"]) expect(etape(g, n), n).not.toContain("if:");
    expect(etape(g, "- name: Documentation légère")).toContain("verifier-longueur.mjs CLAUDE.md");
    expect(etape(g, "- name: Documentation légère")).toContain("generer-index.mjs --verifier");
  });

  it("la qualité saute ses portes ; l'audit saute son installation", () => {
    expect(etape(job("qualite"), "- name: Portes qualité")).toContain(SAUTE);
    expect(etape(job("audit"), "- name: npm audit")).toContain(SAUTE);
  });

  it("la sécurité (gitleaks, Semgrep) n'est JAMAIS sautée : un secret peut se cacher dans un document", () => {
    const s = job("securite");
    expect(s).not.toContain("steps.voie");
    expect(s).not.toContain("voie-rapide");
    expect(s).toContain("gitleaks");
    expect(s).toContain("semgrep");
  });
});

describe("documents lus par des tests", () => {
  const declares = /DOCS_LUES_PAR_LES_TESTS: (.+)/.exec(code)?.[1]?.split(",").map((x) => x.trim()) ?? [];

  /** Documents lus par un test : littéraux `readFileSync("docs/…")`, et références à CLAUDE.md ou à docs/claude/ (lus par boucle : docVercel.test.ts). */
  function luesParLesTests(): string[] {
    const trouves = new Set<string>();
    for (const f of readdirSync("tests", { recursive: true }) as string[]) {
      if (!f.endsWith(".ts") || f === "ciVoieRapide.test.ts") continue;
      const texte = readFileSync(join("tests", f), "utf8");
      for (const m of texte.matchAll(/readFileSync\(\s*"((?:docs\/|CLAUDE\.md|README\.md|BACKLOG\.md|HANDOVER\.md)[^"]*)"/g)) trouves.add(m[1] as string);
      if (texte.includes("docs/claude")) trouves.add("docs/claude/");
    }
    return [...trouves];
  }

  /** Un document est déclaré s'il est listé tel quel, ou couvert par un dossier déclaré (entrée terminée par /). */
  const couvert = (chemin: string) => (declares as string[]).some((e) => chemin === e || (e.endsWith("/") && chemin.startsWith(e)));

  it("chaque document lu par un test est déclaré dans le workflow (tous les jobs qui décident de la voie)", () => {
    const lues = luesParLesTests();
    expect(lues.length, "le test ne voit plus aucune lecture : la détection est cassée ?").toBeGreaterThan(0);
    for (const chemin of lues) expect(couvert(chemin), `${chemin} lu par un test mais absent de DOCS_LUES_PAR_LES_TESTS`).toBe(true);
    expect(couvert("CLAUDE.md")).toBe(true);
    expect(couvert("docs/claude/01-principes.md")).toBe(true);
  });

  it("la même liste dans les trois jobs", () => {
    const toutes = [...code.matchAll(/DOCS_LUES_PAR_LES_TESTS: (.+)/g)].map((m) => m[1]);
    expect(toutes).toHaveLength(3);
    expect(new Set(toutes).size).toBe(1);
  });
});
