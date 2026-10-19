// tests/docVercel.test.ts — la doc et `vercel.json` disent-ils la même chose ?
//
// ⚠️ POURQUOI CE FICHIER EXISTE, ET IL A COÛTÉ UNE DEMI-JOURNÉE. Le 21/08, `vercel.json`
// reçoit un `ignoreCommand` et la désactivation des previews des branches `claude/*`.
// `CLAUDE.md`, écrit la veille, affirmait « CarAI ne l'a pas encore » — resté faux trois
// semaines. Le 14/09, je l'ai lu, cru, et transmis à Marc comme un fait : j'ai diagnostiqué
// une panne de déploiement là où il n'y avait qu'un build volontairement sauté, et je lui
// ai demandé de « regarder le rendu sur son téléphone » alors qu'aucune URL de
// prévisualisation n'existe pour une branche Claude.
//
// Rien ne pouvait le signaler : une doc qui contredit un fichier de configuration n'est
// pas rouge, elle est juste fausse. Ce que ces tests gardent, c'est donc la CORRESPONDANCE
// entre les deux — pas le texte, pas la config, le fait qu'ils parlent du même monde.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  ignoreCommand?: string;
  git?: { deploymentEnabled?: Record<string, boolean> };
};
// La documentation du dépôt = le CLAUDE.md court + le texte complet de l'ancien CLAUDE.md, déplacé INCHANGÉ dans docs/claude/ (étape 2 de la structure commune).
// Ce test lit ces fichiers : ils sont déclarés dans DOCS_LUES_PAR_LES_TESTS de la CI (jamais la voie rapide).
const claude = ["CLAUDE.md", ...readdirSync("docs/claude").sort().map((f) => `docs/claude/${f}`)].map((f) => readFileSync(f, "utf8")).join("\n");

/**
 * Le texte privé de ce qu'il CITE (guillemets français). PURE.
 *
 * ⚠️ Écrit parce que la garde d'absence ci-dessous a rougi sur la correction elle-même :
 * le paragraphe qui explique le défaut RECOPIE la phrase fautive entre guillemets, et un
 * scan naïf ne distingue pas « le dépôt affirme X » de « le dépôt raconte avoir affirmé X ».
 * C'est le piège que ce dépôt et ses voisins ont déjà payé plusieurs fois — une garde
 * d'absence contredit mécaniquement une bonne documentation, puisque la meilleure façon
 * d'expliquer une phrase interdite est de l'écrire. On lit donc le texte HORS citations :
 * une citation est délimitée, une affirmation ne l'est pas.
 */
function sansCitations(texte: string): string {
  return texte.replace(/«[^»]*»/g, "");
}

/**
 * Les deux apostrophes ramenées à une seule. PURE.
 *
 * ⚠️ Le français en a deux — la droite `'` et la typographique `’` — et elles se
 * ressemblent à l'écran sans jamais s'apparier. Ce test a rougi une première fois pour
 * cette seule raison : le motif cherchait l'une, le fichier portait l'autre. Tout scan de
 * prose française normalise avant de comparer, sinon il rend des faux négatifs SILENCIEUX
 * — ce qui, pour une garde d'absence, veut dire « vert quoi qu'il arrive ».
 */
function normaliser(texte: string): string {
  return texte.replace(/’/g, "'");
}
const claudeAffirme = normaliser(sansCitations(claude));
const claudeBrut = normaliser(claude);

describe("vercel.json porte bien ce que ces tests gardent", () => {
  it("les deux réglages existent — sinon tout ce qui suit est vide", () => {
    // Anti-vacuité. Le jour où l'un des deux est retiré, c'est ICI qu'on l'apprend, et la
    // garde correspondante se retire avec lui plutôt que de rester verte sans objet.
    expect(config.ignoreCommand, "plus d'ignoreCommand : retirer la garde ci-dessous").toBeTruthy();
    expect(
      Object.keys(config.git?.deploymentEnabled ?? {}),
      "plus de branche désactivée : retirer la garde ci-dessous",
    ).not.toHaveLength(0);
  });
});

describe("l'ignoreCommand", () => {
  it("désigne un script qui EXISTE", () => {
    // Un `ignoreCommand` qui pointe vers un fichier absent ne rate pas bruyamment : le
    // script échoue, Vercel prend l'échec pour « ne pas ignorer », et on construit tout —
    // donc on brûle le quota qu'il devait protéger, sans qu'aucun voyant ne change.
    const chemin = config.ignoreCommand!.trim().split(/\s+/).at(-1)!;
    expect(chemin).toMatch(/^scripts\//);
    expect(existsSync(chemin), `${chemin} est référencé par vercel.json mais absent`).toBe(true);
  });

  it("est NOMMÉ dans CLAUDE.md, qui explique quand un build est sauté", () => {
    // La doc doit décrire ce qui gouverne les déploiements. Sans le nom du script, une
    // session qui voit un déploiement `CANCELED` n'a aucun moyen de savoir que c'est
    // normal — et c'est exactement l'erreur de diagnostic du 14/09.
    const chemin = config.ignoreCommand!.trim().split(/\s+/).at(-1)!;
    const nom = chemin.split("/").at(-1)!;
    expect(claude, `CLAUDE.md ne nomme pas ${nom}`).toContain(nom);
  });

  it("CLAUDE.md n'affirme PAS que le dépôt en est dépourvu", () => {
    // La phrase exacte qui a menti trois semaines. Elle est gardée telle quelle : une
    // garde qui cherche une formulation précise vaut ce que vaut sa liste, mais celle-ci
    // a réellement coûté quelque chose, et son coût de maintenance est nul.
    const faux = "CarAI ne l'a pas encore";
    expect(
      claudeAffirme,
      `CLAUDE.md affirme « ${faux} », contredit par vercel.json`,
    ).not.toContain(faux);
  });

  it("le retrait des citations ne vide pas le fichier, et la citation SURVIT", () => {
    // Anti-vacuité en deux temps. Sans le premier, « la phrase n'est pas affirmée » se
    // prouverait à partir de « il ne reste plus rien à lire ». Sans le second, on ne
    // saurait pas que le texte conserve bel et bien son récit du défaut — c'est lui qui
    // empêche la prochaine session de réécrire la même phrase en la croyant neuve.
    expect(claudeAffirme.length).toBeGreaterThan(claude.length * 0.8);
    expect(claudeAffirme).toContain("## 6 bis.");
    expect(claudeBrut).toContain("ne l'a pas encore");
  });
});

describe("les branches sans prévisualisation", () => {
  const desactivees = Object.entries(config.git?.deploymentEnabled ?? {})
    .filter(([, actif]) => actif === false)
    .map(([motif]) => motif);

  it("le motif désactivé est DIT dans CLAUDE.md, avec le nom du réglage", () => {
    // Deux choses distinctes, et il faut les deux : le nom du réglage pour qu'on sache où
    // regarder, et le motif pour qu'on sache QUELLES branches n'ont pas d'URL de test.
    // Sans ça, la prochaine session promettra encore une prévisualisation qui n'existe pas.
    expect(claude).toContain("deploymentEnabled");
    for (const motif of desactivees) {
      const racine = motif.replace(/\*+$/, "");
      expect(claude, `CLAUDE.md ne dit pas que « ${motif} » ne déploie pas`).toContain(racine);
    }
  });

  it("les branches de travail de ce dépôt sont bien celles qui sont couvertes", () => {
    // Contrôle de cohérence : la convention du dépôt est `claude/<slug>` (CLAUDE.md §3).
    // Si le motif désactivé ne les visait plus, la garde ci-dessus parlerait dans le vide.
    expect(desactivees.some((m) => "claude/exemple".startsWith(m.replace(/\*+$/, "")))).toBe(true);
  });
});
