// tests/jetonsCss.test.ts — aucun `var(--jeton)` ne pointe dans le vide.
//
// ⚠️ POURQUOI CETTE GARDE EXISTE, et elle est née d'une faute de ce lot-ci : en écrivant les
// styles du bail en dollars, j'ai employé `var(--texte-doux)` et `var(--texte)`. Les jetons
// de ce dépôt s'appelaient `--text-soft` et `--text` (aujourd'hui `--texte-doux` et `--texte`, CarAI#217). Un `var()` inexistant est un **no-op
// SILENCIEUX** : la règle s'applique, la déclaration est simplement ignorée, la couleur est
// héritée — et RIEN ne le signale. Ni le typecheck, ni le lint, ni le build. C'est la même
// classe que le « shade hors palette » que l'écosystème a déjà payée ailleurs.
//
// Ce que la garde NE fait pas : juger la valeur d'un jeton. Elle vérifie une seule chose —
// que tout jeton employé est déclaré quelque part.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync("app/globals.css", "utf8");

/** Les jetons DÉCLARÉS en CSS : `--x: …` dans n'importe quel bloc. */
function declaresCss(source: string): Set<string> {
  return new Set([...source.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]!));
}

/**
 * Les jetons posés en STYLE INLINE depuis le TSX (`style={{ ["--x"]: … }}`).
 *
 * ⚠️ Sans eux la garde ferait des faux positifs sur du code parfaitement sain : `--x` et
 * `--y` des pastilles de graphique sont posés par `app/ui/Graphique.tsx`, jamais par le CSS.
 * Une garde qui crie sur du code vivant apprend à être ignorée.
 */
function declaresTsx(): Set<string> {
  const trouves = new Set<string>();
  const parcourir = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const chemin = join(dir, e.name);
      if (e.isDirectory()) parcourir(chemin);
      else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) {
        for (const m of readFileSync(chemin, "utf8").matchAll(/["'](--[a-zA-Z0-9-]+)["']\s*(?:as\s+string\s*)?\]?\s*:/g)) {
          trouves.add(m[1]!);
        }
      }
    }
  };
  parcourir("app");
  return trouves;
}

function employes(source: string): string[] {
  return [...new Set([...source.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1]!))];
}

describe("jetons CSS", () => {
  it("voit réellement des jetons — sinon « aucun manquant » ne prouverait rien", () => {
    // Anti-vacuité : une garde qui ne trouve rien à vérifier est toujours verte.
    expect(declaresCss(CSS).size).toBeGreaterThan(25);
    expect(employes(CSS).length).toBeGreaterThan(25);
  });

  it("chaque var(--jeton) employé est DÉCLARÉ — un var() inexistant est un no-op silencieux", () => {
    const connus = new Set([...declaresCss(CSS), ...declaresTsx()]);
    const manquants = employes(CSS).filter((j) => !connus.has(j));
    expect(manquants, `jetons employés mais jamais déclarés : ${manquants.join(", ")}`).toEqual([]);
  });

  it("reconnaît bien les jetons posés en style inline (sinon elle crierait sur du code sain)", () => {
    // Témoin nommé : `--x` n'existe QUE dans le TSX. S'il n'était pas vu, le test précédent
    // rougirait sur `app/ui/Graphique.tsx`, qui est parfaitement correct.
    expect(declaresTsx().has("--x")).toBe(true);
  });
});
