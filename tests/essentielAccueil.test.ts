// tests/essentielAccueil.test.ts — le premier écran de l'accueil, tel que Marc l'a défini.
//
// Deux décisions du 18/09/2026, prises nommément, et que rien d'autre ne tient :
//
//   1. TROIS CHIFFRES, ET CEUX-LÀ. À la question « si tu ne pouvais voir que trois chiffres
//      en ouvrant l'app, lesquels ? », Marc a répondu « charge (en cours ou non, et combien
//      de charge), coût total actuel, autonomie ». Ce n'est donc pas une sélection parmi
//      d'autres possibles : c'est la réponse à « pourquoi j'ouvre CarAI ». Un quatrième
//      chiffre ajouté sans qu'il en retire un ferait de ce bandeau un tableau de plus.
//
//   2. « CE QUI CLOCHE » N'EXISTE QUE S'IL Y A QUELQUE CHOSE (« visible seulement s'il y a
//      quelque chose »). L'écran affichait « Rien à signaler » sous un titre « Ce qui
//      cloche », tous les jours de l'année. Un avertissement permanent est un avertissement
//      mort — leçon payée sur DriveAI, re-payée ici.
//
// ⚠️ LE SCAN LIT LA SOURCE DÉCOMMENTÉE. Les commentaires de `app/page.tsx` citent le
// libellé « Aujourd'hui » qui vient d'être retiré, et citent « Rien à signaler » pour
// raconter ce qui a disparu. Une garde qui lirait le brut se prouverait fausse sur
// l'explication de sa propre existence.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** Le TSX privé de ses commentaires. PURE. */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Les libellés RENDUS par un tableau de chiffres — jamais ceux de sa déclaration de type.
 * PURE.
 */
export function libellesRendus(source: string): string[] {
  return [...source.matchAll(/libelle:\s*([^\n]+),\n/g)].map((m) => m[1]!.trim());
}

const brut = readFileSync("app/page.tsx", "utf8");
const code = sansCommentaires(brut);

/**
 * Le corps d'une fonction de premier niveau, accolades comptées. PURE.
 *
 * ⚠️ IL FAUT D'ABORD SAUTER LA LISTE DE PARAMÈTRES. Mon premier jet prenait « la première
 * accolade après `function Nom(` » — et pour `function Essentiel({ soc, enCharge, … })`,
 * cette accolade est celle de la DESTRUCTURATION. Le lecteur rendait donc la signature au
 * lieu du corps (48 caractères pour `Essentiel`, ` alertes ` pour `Alertes`), et mes
 * assertions rougissaient sur un code parfaitement juste.
 *
 * Ce qui l'a laissé passer : mes cas de discrimination employaient `function A()`, la forme
 * la PLUS SIMPLE du dépôt, quand toutes les fonctions visées portent des props destructurées.
 * Une preuve de discrimination ne vaut que sur un cas REPRÉSENTATIF — les cas tordus sont
 * ajoutés plus bas.
 */
export function corpsDeFonction(source: string, nom: string): string | null {
  const debut = source.indexOf(`function ${nom}(`);
  if (debut === -1) return null;
  // Parcourir les parenthèses de la signature jusqu'à leur fermeture.
  let parentheses = 0;
  let i = source.indexOf("(", debut);
  for (; i < source.length; i++) {
    if (source[i] === "(") parentheses++;
    else if (source[i] === ")") {
      parentheses--;
      if (parentheses === 0) break;
    }
  }
  const ouvrante = source.indexOf("{", i);
  if (ouvrante === -1) return null;
  let profondeur = 0;
  for (let i = ouvrante; i < source.length; i++) {
    if (source[i] === "{") profondeur++;
    else if (source[i] === "}") {
      profondeur--;
      if (profondeur === 0) return source.slice(ouvrante + 1, i);
    }
  }
  return null;
}

describe("le décommenteur, avant de s'en servir", () => {
  it("retire les commentaires SANS manger le code", () => {
    // Anti-vacuité : sans ça, chaque « le code ne contient plus X » se prouverait à partir
    // de « il ne reste plus rien à lire ».
    // ⚠️ Le témoin doit être une chaîne qui n'existe QUE dans un commentaire. Mon premier
    // jet prenait « Aujourd'hui », en croyant le libellé retiré du bandeau — il vit
    // toujours, et à raison, dans la tuile « Ce mois-ci » : le test rougissait sur du code
    // sain. Un témoin se choisit en le CHERCHANT dans le fichier, pas de mémoire.
    expect(brut).toContain("QUATRE GROUPES");
    expect(code).not.toContain("QUATRE GROUPES");
    expect(code).toContain("function Essentiel(");
    expect(code).toContain("function Alertes(");
    expect(code.length).toBeGreaterThan(brut.length * 0.4);
  });
});

describe("les trois chiffres du coup d'œil", () => {
  const essentiel = corpsDeFonction(code, "Essentiel");

  it("le corps d'`Essentiel` se lit", () => {
    expect(essentiel).not.toBeNull();
    expect(essentiel!.length).toBeGreaterThan(200);
  });

  it("⚠️ EXACTEMENT trois chiffres, pas quatre", () => {
    // Compté sur les `libelle:` du tableau — c'est ce qui est RENDU, pas une intention.
    //
    // ⚠️ LE MOTIF EXIGE LA VIRGULE DU LITTÉRAL. Mon premier jet comptait QUATRE entrées
    // pour trois chiffres : il attrapait aussi `libelle: string;` de la DÉCLARATION DE TYPE
    // du tableau, trois lignes plus haut. C'est le piège déjà payé dans l'écosystème — un
    // scan qui compte les occurrences d'un champ compte sa fabrication ET sa déclaration.
    // La virgule de fin les sépare : un littéral d'objet la porte, une déclaration de type
    // porte un point-virgule.
    expect(libellesRendus(essentiel!)).toHaveLength(3);
  });

  it("ce sont la charge, le coût et l'autonomie — nommément", () => {
    expect(essentiel).toContain('"Autonomie"');
    expect(essentiel).toContain('"Versé au bail"');
    // La charge porte son ÉTAT dans son libellé : « En charge » quand la voiture le dit.
    expect(essentiel).toContain('enCharge ? "En charge" : "Charge"');
  });

  it("⚠️ l'état de charge vient de ce que la voiture DIT, pas d'un câble branché", () => {
    // `branchee-en-attente` est le mode normal chez Marc (minuterie) : le confondre avec
    // « en charge » ferait battre le pouls toute la nuit sur une voiture à l'arrêt.
    expect(code).toContain('statutCharge.mode === "en-charge"');
  });

  it("⚠️ AUCUNE phrase dans le bandeau — Marc : « pas trop de texte ou blabla »", () => {
    // Les porteurs de prose du dépôt. S'ils apparaissent ici, le bandeau a recommencé à
    // expliquer, et ce n'est pas son rôle : la fin de charge annoncée et les réserves du
    // calcul vivent un cran plus bas.
    for (const prose of ["<p", "className=\"hint\"", "className=\"lead\"", "<InfoTap"]) {
      expect(essentiel, `« ${prose} » n’a rien à faire dans l’essentiel`).not.toContain(prose);
    }
  });
});

describe("« Ce qui cloche » ne s'affiche que s'il y a quelque chose", () => {
  const alertes = corpsDeFonction(code, "Alertes");

  it("une liste vide ne rend RIEN", () => {
    expect(alertes).toContain("alertes.length === 0");
    expect(alertes).toContain("return null");
  });

  it("le titre voyage AVEC la liste — sinon il resterait orphelin", () => {
    // Le composant rend sa section entière, titre compris. C'est ce qui permet au site
    // d'appel de ne rien tester.
    expect(alertes).toContain('className="grp grp-alertes"');
    expect(alertes).toContain("Ce qui cloche");
  });

  it("⚠️ UN SEUL endroit décide de la présence", () => {
    // Deux endroits qui testent la même absence, c'est une règle et demie : celui qu'on
    // oublierait laisserait soit un titre au-dessus du vide, soit une section fantôme.
    expect(code).toContain("<Alertes alertes={alertes} />");
    expect(code, "le site d'appel ne doit pas re-tester la longueur").not.toMatch(
      /alertes\.length\s*>\s*0\s*&&\s*\(?\s*<Alertes/,
    );
  });

  it("plus de pastille « Rien à signaler »", () => {
    expect(code).not.toContain("Rien à signaler");
  });
});

describe("le lecteur de corps DISCRIMINE", () => {
  it("rend le corps, et pas le fichier entier", () => {
    const faux = "function A() {\n  return 1;\n}\nfunction B() {\n  return 2;\n}\n";
    expect(corpsDeFonction(faux, "A")!.trim()).toBe("return 1;");
    expect(corpsDeFonction(faux, "B")!.trim()).toBe("return 2;");
  });

  it("compte les accolades IMBRIQUÉES", () => {
    const faux = "function A() {\n  if (x) { y(); }\n  return 1;\n}\nfunction B() {}\n";
    expect(corpsDeFonction(faux, "A")).toContain("return 1;");
    expect(corpsDeFonction(faux, "A")).not.toContain("function B");
  });

  it("⚠️ saute la DESTRUCTURATION des props — la forme de TOUT ce fichier", () => {
    // Le cas qui a démasqué le premier jet. Sans le saut de la signature, le lecteur rend
    // « soc, autonomieKm » au lieu du corps.
    const faux = "function A({ soc, autonomieKm }: { soc: number }) {\n  return soc;\n}\n";
    expect(corpsDeFonction(faux, "A")!.trim()).toBe("return soc;");
  });

  it("survit à une parenthèse DANS la signature", () => {
    const faux = "function A({ f = (x: number) => x }: Props) {\n  return f(1);\n}\n";
    expect(corpsDeFonction(faux, "A")!.trim()).toBe("return f(1);");
  });

  it("⚠️ le compteur de libellés ignore la DÉCLARATION DE TYPE", () => {
    const faux = [
      "const chiffres: {",
      "    libelle: string;",
      "    ton: string;",
      "  }[] = [",
      '    { libelle: "A", ton: "ok" },',
      '    { libelle: "B", ton: "ok" },',
      "  ];",
      "",
    ].join("\n");
    // Deux libellés RENDUS, malgré un `libelle: string;` de déclaration juste au-dessus.
    // Le motif s'arrête à la virgule de fin de ligne, donc il capture la fin du littéral —
    // ce qui compte ici est le COMPTE, pas la découpe.
    const trouves = libellesRendus(faux);
    expect(trouves).toHaveLength(2);
    expect(trouves[0]).toContain('"A"');
    expect(trouves[1]).toContain('"B"');
    expect(trouves.join(" ")).not.toContain("string");
  });

  it("rend `null` sur une fonction absente", () => {
    expect(corpsDeFonction("function A() {}", "Zzz")).toBeNull();
  });
});
