// tests/pollJournalPublic.test.ts — le journal du poll Smartcar ne porte jamais le corps de la réponse.
//
// Le dépôt est PUBLIC : les journaux d'Actions sont lisibles de tous. Le corps rendu par
// /api/cron/smartcar-poll (comptes de signaux, motifs d'échec) n'a rien à y faire ; seuls le code
// HTTP et un verdict court s'y écrivent. Le détail vit dans la page Données de l'app.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WORKFLOW = ".github/workflows/smartcar-poll.yml";

/** Les lignes du script qui nomment `$corps` sans le garder pour elles seules (hors affectation et grep -q). */
function usagesDuCorpsQuiLeJournalisent(script: string): string[] {
  return script
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !l.startsWith("#"))
    .filter((l) => /\$\{?corps\b/.test(l))
    .filter((l) => !/^(el)?if echo "\$corps" \| grep -q '"ok":(true|false)'; then$/.test(l));
}

describe("le journal du workflow de poll n'écrit pas le corps de la réponse", () => {
  const yaml = readFileSync(WORKFLOW, "utf8");

  it("n'utilise `$corps` que pour en tirer le verdict (grep -q), jamais pour l'écrire", () => {
    expect(usagesDuCorpsQuiLeJournalisent(yaml)).toEqual([]);
  });

  it("n'active ni la trace du shell ni l'écho des commandes", () => {
    const actives = yaml
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("#"));
    expect(actives.filter((l) => /\bset\s+-[a-z]*x/.test(l))).toEqual([]);
    expect(actives.filter((l) => /::debug::|ACTIONS_STEP_DEBUG/.test(l))).toEqual([]);
  });

  it("tourne sur les machines GitHub, jamais sur le robot du PC (dépôt public)", () => {
    const actives = yaml
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => !l.startsWith("#"));
    expect(actives.filter((l) => /self-hosted|pc-marc/.test(l))).toEqual([]);
    expect(actives).toContain("runs-on: ubuntu-latest");
  });

  it("écrit le verdict court sous trois formes seulement", () => {
    for (const verdict of ["verdict : ok=false", "verdict : ok=true", "verdict : illisible"]) {
      expect(yaml).toContain(`echo "${verdict}"`);
    }
  });

  it("le contrôle refuse bien un script qui écrit le corps (garde-fou du test lui-même)", () => {
    expect(usagesDuCorpsQuiLeJournalisent('echo "$corps"')).toEqual(['echo "$corps"']);
    expect(usagesDuCorpsQuiLeJournalisent('echo "corps : ${corps}"')).toHaveLength(1);
    expect(usagesDuCorpsQuiLeJournalisent("printf '%s' \"$corps\"")).toHaveLength(1);
    expect(usagesDuCorpsQuiLeJournalisent('if echo "$corps" | grep -q \'"ok":false\'; then')).toEqual([]);
  });
});
