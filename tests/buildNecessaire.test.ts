// tests/buildNecessaire.test.ts — le script d'`ignoreCommand` décide-t-il bien, commit par commit ?
//
// ⚠️ POURQUOI CE FICHIER EXISTE. Le 19/10, Marc change `CRON_SECRET` dans Vercel et clique
// « Redeploy » : quatre déploiements de production d'affilée sont annulés (`CANCELED`), la route
// du poll Smartcar répond toujours 401 et le cron externe échoue. Le script avait raison selon
// sa règle (le diff ne contenait que des tests et de la doc) ; sa règle ignorait seulement qu'un
// changement de variable ne change AUCUN fichier. Jusque-là, le script n'était vérifié qu'à la
// main (« rejouer le script sur les vrais commits ») : ce test le rejoue sur un dépôt jetable.
//
// Convention Vercel, à ne pas inverser : exit 0 = build IGNORÉ, exit 1 = build LANCÉ.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const SCRIPT = resolve("scripts/build-necessaire.sh");

let depot = "";
const shas: Record<string, string> = {};

/** Le SHA d'un commit nommé ; échoue franchement s'il n'existe pas (pas de `undefined` muet). */
function sha(nom: string): string {
  const v = shas[nom];
  if (!v) throw new Error(`commit inconnu : ${nom}`);
  return v;
}

function git(...args: string[]): string {
  const r = spawnSync("git", args, {
    cwd: depot,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.invalid",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.invalid",
    },
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} : ${r.stderr}`);
  return r.stdout.trim();
}

/** Un commit qui écrit ces fichiers ; rend son SHA. */
function commit(nom: string, fichiers: Record<string, string>): void {
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(depot, chemin)), { recursive: true });
    writeFileSync(join(depot, chemin), contenu);
  }
  git("add", "-A");
  git("commit", "-q", "-m", nom);
  shas[nom] = git("rev-parse", "HEAD");
}

/** Rejoue le script. `base`/`tete` = les deux arguments facultatifs ; `env` = ce que Vercel fournit. */
function rejouer(base?: string, tete?: string, env: Record<string, string> = {}) {
  const args = [SCRIPT, ...(base ? [base] : []), ...(tete ? [tete] : [])];
  const r = spawnSync("bash", args, {
    cwd: depot,
    encoding: "utf8",
    env: { ...process.env, VERCEL_GIT_PREVIOUS_SHA: "", ...env },
  });
  return { code: r.status, sortie: `${r.stdout}${r.stderr}` };
}

beforeAll(() => {
  depot = mkdtempSync(join(tmpdir(), "build-necessaire-"));
  git("init", "-q", "-b", "main");
  commit("socle", { "app/page.tsx": "export default 1;\n", "README.md": "a\n" });
  commit("doc", { "docs/note.md": "doc\n" });
  commit("tests", { "tests/a.test.ts": "x\n" });
  commit("outillage", { "scripts/outil.sh": "echo\n", ".github/workflows/ci.yml": "on: push\n" });
  commit("source", { "app/page.tsx": "export default 2;\n" });
  commit("reconstruction", { "vercel-rebuild.txt": "2026-10-19\n", "tests/b.test.ts": "y\n" });
  commit("doc-apres", { "docs/autre.md": "doc 2\n" });
});

afterAll(() => {
  if (depot) rmSync(depot, { recursive: true, force: true });
});

describe("scripts/build-necessaire.sh : ce qui est IGNORÉ (exit 0)", () => {
  it.each([
    ["de la documentation", "socle", "doc"],
    ["des tests", "doc", "tests"],
    ["de l'outillage et des workflows", "tests", "outillage"],
    ["une plage entière sans rien de servi", "socle", "outillage"],
  ])("%s", (_nom, de, a) => {
    const r = rejouer(sha(de), sha(a));
    expect(r.code, r.sortie).toBe(0);
    expect(r.sortie).toContain("build ignoré");
  });
});

describe("scripts/build-necessaire.sh : ce qui LANCE le build (exit 1)", () => {
  it("un fichier servi (anti-vacuité : le script ne répond pas « ignorer » à tout)", () => {
    const r = rejouer(sha("outillage"), sha("source"));
    expect(r.code, r.sortie).toBe(1);
    expect(r.sortie).toContain("app/page.tsx");
  });

  it("un fichier servi au milieu d'une plage qui se termine par de la doc (commit enjambé)", () => {
    const r = rejouer(sha("outillage"), sha("doc-apres"));
    expect(r.code, r.sortie).toBe(1);
  });

  it("le fichier de reconstruction, même accompagné de tests : c'est lui qu'on touche après un changement de variable", () => {
    const r = rejouer(sha("source"), sha("reconstruction"));
    expect(r.code, r.sortie).toBe(1);
    expect(r.sortie).toContain("reconstruction demandée");
  });

  it("un diff vide (Redeploy du commit déjà construit) : rien à comparer = on construit", () => {
    const r = rejouer(sha("source"), sha("source"));
    expect(r.code, r.sortie).toBe(1);
  });

  it("une plage illisible : dans le doute on construit, on ne saute jamais", () => {
    const r = rejouer("0000000000000000000000000000000000000000", sha("source"));
    expect(r.code, r.sortie).toBe(1);
  });
});

describe("scripts/build-necessaire.sh : le mode Vercel (sans arguments)", () => {
  it("compare à VERCEL_GIT_PREVIOUS_SHA : tout ce qui n'a pas été construit compte", () => {
    // HEAD = « doc-apres » (doc seule), mais le dernier commit construit est avant « source ».
    const r = rejouer(undefined, undefined, { VERCEL_GIT_PREVIOUS_SHA: sha("outillage") });
    expect(r.code, r.sortie).toBe(1);
  });

  it("dernier commit construit = HEAD : diff vide, on construit (Redeploy du dernier déploiement)", () => {
    const r = rejouer(undefined, undefined, { VERCEL_GIT_PREVIOUS_SHA: git("rev-parse", "HEAD") });
    expect(r.code, r.sortie).toBe(1);
  });

  it("dernier commit construit juste avant une plage de doc seule : ignoré", () => {
    const r = rejouer(undefined, undefined, { VERCEL_GIT_PREVIOUS_SHA: sha("reconstruction") });
    expect(r.code, r.sortie).toBe(0);
  });

  it("sans SHA précédent : retombe sur HEAD^", () => {
    const r = rejouer();
    expect(r.code, r.sortie).toBe(0); // HEAD = doc seule
  });

  it("le journal dit QUELLE plage a été comparée", () => {
    const r = rejouer(sha("socle"), sha("doc"));
    expect(r.sortie).toMatch(/comparaison : [0-9a-f]+ -> [0-9a-f]+/);
  });
});
