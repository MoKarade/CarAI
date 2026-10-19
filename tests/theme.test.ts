// tests/theme.test.ts — verrou du socle visuel commun, version SOMBRE SEUL (CarAI#217).
//
// Repris de app-template (`tests/theme.test.ts`, tâche #39), de BatchChef et de JobAI#116 : les couleurs
// vivent dans `app/globals.css`, en variables hexadécimales, et NULLE PART ailleurs. Ce qui change ici :
//   · sombre seul (décision de Marc, 17/08/2026) : pas de bloc `@media` clair/sombre à comparer ;
//   · trois noms du vocabulaire commun existent DÉJÀ ici avec un autre sens (voir PRIS_AILLEURS) ;
//   · quelques fichiers TypeScript ont une raison NOMMÉE de porter une couleur (EXCEPTIONS_TS).
//
// Pourquoi un test et pas une relecture — incident BatchChef du 14/08/2026 : une passe de refonte avait
// laissé 21 `bg-white` figés sous un texte clair hérité. Une couleur figée est parfaitement lisible dans
// le thème pour lequel on l'a écrite : aucune relecture ne la voit, aucune erreur ne se lève.
// `tests/jetonsCss.test.ts` garde, lui, qu'aucun `var(--jeton)` ne pointe dans le vide.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { contraste } from "./aides/couleurs";
import { sansCommentairesCss } from "./aides/css";

const RACINE = process.cwd();

/** PÉRIMÈTRE POSITIF : les dossiers qui produisent du balisage ou une couleur. */
const DOSSIERS_RENDUS = ["app", "components", "lib"];

function fichiersDe(dossier: string): string[] {
  const absolu = join(RACINE, dossier);
  try {
    statSync(absolu);
  } catch {
    return [];
  }
  return readdirSync(absolu, { recursive: true, encoding: "utf8" })
    .map((f) => join(dossier, f).split("\\").join("/"))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

const FICHIERS = DOSSIERS_RENDUS.flatMap(fichiersDe).sort();

function lire(chemin: string): string {
  return readFileSync(join(RACINE, chemin), "utf8");
}

/** Retire les commentaires (une couleur citée dans un commentaire n'est pas une couleur rendue). */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

const CSS_BRUT = lire("app/globals.css");
const CSS = sansCommentairesCss(CSS_BRUT);

/** Corps de chaque bloc `:root { … }` (les jetons y sont à plat : aucune accolade imbriquée). */
const BLOCS_ROOT = [...CSS.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
const ROOT = BLOCS_ROOT.join("\n");
const HORS_ROOT = CSS.replace(/:root\s*\{[^}]*\}/g, "");

/** `--nom: #rrggbb;` ou `#rrggbbaa;` — les couleurs sont en hexadécimal, ce qui les rend mesurables. */
function couleurs(source: string): [string, string][] {
  return [...source.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})(?:[0-9a-f]{2})?\s*;/gim)].map(
    (m) => [m[1] ?? "", (m[2] ?? "").toLowerCase()] as [string, string],
  );
}
const JETONS = Object.fromEntries(couleurs(ROOT)) as Record<string, string>;

describe("socle visuel — aucune couleur hors des jetons", () => {
  it("voit bien les fichiers de rendu et la feuille (sinon le garde est vert à vide)", () => {
    expect(FICHIERS.length).toBeGreaterThan(20);
    expect(FICHIERS).toContain("app/page.tsx");
    expect(FICHIERS).toContain("app/login/page.tsx");
    expect(CSS_BRUT.length).toBeGreaterThan(100_000);
    expect(BLOCS_ROOT.length).toBeGreaterThanOrEqual(3);
  });

  it("aucune classe de palette Tailwind (CarAI n'en utilise pas : une seule trahirait le sombre)", () => {
    const palettes =
      "white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
    const proprietes =
      "bg|text|border|placeholder|ring|from|to|via|divide|decoration|outline|accent|caret|fill|stroke|shadow";
    const motif = new RegExp(`\\b(?:${proprietes})-(?:${palettes})(?:-\\d{2,3})?(?:/\\d{1,3})?\\b`, "g");
    const fautes = FICHIERS.filter((f) => f.endsWith(".tsx")).flatMap((f) =>
      [...sansCommentaires(lire(f)).matchAll(/className=("[^"]*"|\{`[^`]*`\})/g)]
        .flatMap((m) => m[1]?.match(motif) ?? [])
        .map((x) => `${f} — ${x}`),
    );
    expect(fautes, `Couleurs figées :\n${fautes.join("\n")}`).toEqual([]);
  });

  it("aucune valeur de couleur (#hex, oklch, hsl…) dans un fichier TypeScript, sauf exception nommée", () => {
    // Chaque exception a son fichier ET sa raison. Un fichier absent de cette liste ne porte aucune couleur.
    const EXCEPTIONS_TS: Record<string, string> = {
      "lib/hubSummary.ts":
        "`app.color` est un champ du CONTRAT du hub (couleur d'accent du widget), pas une couleur de l'interface",
      "lib/carteVivante.ts":
        "l'API Google Maps prend des chaînes de couleur en JavaScript (tracé, marqueurs) : elle ne lit pas var(--…)",
      "app/manifest.ts": "le manifeste est du JSON servi à l'OS : égalité avec `--fond` vérifiée plus bas",
      "app/layout.tsx": "`viewport.themeColor` : même raison, même vérification",
      "app/api/mcp/authorize/route.ts":
        "page de consentement OAuth autonome : du HTML rendu SANS la feuille globale, qui porte son propre petit thème",
    };
    const motif =
      /(?<![\w&])#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b|(?<![\w&])#[0-9a-fA-F]{3}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g;
    const fautes = FICHIERS.filter((f) => !(f in EXCEPTIONS_TS)).flatMap((f) =>
      sansCommentaires(lire(f))
        .split("\n")
        .flatMap((ligne, i) => (ligne.match(motif) ?? []).map((x) => `${f}:${i + 1} — ${x}`)),
    );
    expect(fautes, `Couleurs en dur (déclare un jeton dans globals.css) :\n${fautes.join("\n")}`).toEqual([]);
    // Non-vacuité : chaque exception existe bel et bien (sinon la liste vieillit en silence).
    for (const f of Object.keys(EXCEPTIONS_TS)) expect(FICHIERS, `exception périmée : ${f}`).toContain(f);
  });

  it("dans la feuille, aucune couleur écrite hors des blocs `:root`", () => {
    // Les teintes translucides se tirent d'un jeton : `color-mix(in srgb, var(--erreur-texte) 40%, transparent)`.
    const fautes = [
      ...(HORS_ROOT.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []),
      ...(HORS_ROOT.match(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g) ?? []),
    ];
    expect(fautes, "déclare un jeton dans `:root` plutôt qu'une valeur dans une règle").toEqual([]);
  });

  it("le manifeste et la barre système prennent la couleur de `--fond` (une seule source)", () => {
    const fond = JETONS["--fond"];
    expect(fond).toMatch(/^#[0-9a-f]{6}$/);
    expect(lire("app/manifest.ts")).toContain(`background_color: "${fond}"`);
    expect(lire("app/manifest.ts")).toContain(`theme_color: "${fond}"`);
    expect(lire("app/layout.tsx")).toContain(`themeColor: "${fond}"`);
  });
});

describe("socle visuel — jetons et vocabulaire communs", () => {
  it("chaque couleur est définie une seule fois", () => {
    // ⚠️ Avant CarAI#217, `--serie-0` à `--serie-3` étaient écrits deux fois (la seconde définition,
    // plus bas dans la feuille, gagnait : la première était morte). Une couleur à deux valeurs ne dit
    // plus laquelle est la vraie.
    const noms = couleurs(ROOT).map(([n]) => n);
    expect(noms.length, "trop peu de jetons lus, le garde serait vide").toBeGreaterThan(50);
    const doublons = noms.filter((n, i) => noms.indexOf(n) !== i);
    expect(doublons, "jetons définis deux fois").toEqual([]);
  });

  it("porte les jetons du socle (un renommage casserait les forks en silence)", () => {
    for (const requis of [
      "--fond",
      "--surface",
      "--surface-douce",
      "--bordure",
      "--bordure-champ",
      "--texte",
      "--texte-doux",
      "--accent",
      "--accent-fonce",
      "--sur-accent",
      "--repere",
      "--repere-doux",
      "--succes-fond",
      "--succes-texte",
      "--alerte-fond",
      "--alerte-texte",
      "--erreur-fond",
      "--erreur-texte",
    ]) {
      expect(Object.keys(JETONS), `jeton manquant : ${requis}`).toContain(requis);
    }
  });

  it("déclare le sombre au navigateur et ne suit pas le système", () => {
    expect(ROOT).toMatch(/color-scheme:\s*dark\s*;/);
    expect(CSS).not.toMatch(/prefers-color-scheme/);
  });

  it("porte le vocabulaire commun, hors les noms que CarAI a déjà pris", () => {
    // Ces noms existent DÉJÀ ici comme modificateurs d'autres composants (voir le commentaire de
    // globals.css, « Vocabulaire commun du socle ») : on ne les redéfinit pas, on le dit.
    const PRIS_AILLEURS: Record<string, string> = {
      alerte: "modificateur d'état de `.verdict`, `.tuile`, `.schema-bouton`, `.alertes li` : pas la paire fond/texte du socle",
      erreur: "modificateur d'état de `.cl-message` : pas la paire fond/texte du socle",
      pastille: "la pastille de carte (`.pastille.depart`) et d'une série de graphique, pas celle du socle",
      etiquette: "prise par `.chiffres .etiquette` (la légende d'un chiffre), pas le libellé de champ du socle",
    };
    const classes = new Set([...CSS.matchAll(/\.([a-z][a-z0-9-]*)/gi)].map((m) => m[1]));
    const requises = [
      "carte",
      "bouton",
      "bouton-principal",
      "bouton-second",
      "bouton-danger",
      "champ",
      "doux",
      "succes",
      "texte-succes",
      "texte-erreur",
      "bandeau",
      "surtitre",
    ];
    for (const requise of requises) {
      expect(classes, `classe manquante : .${requise}`).toContain(requise);
    }
    // Le vocabulaire du socle, intégral : chaque nom est soit défini, soit une exception NOMMÉE.
    const SOCLE = [
      ...requises,
      "alerte",
      "erreur",
      "pastille",
      "etiquette",
    ];
    for (const nom of SOCLE) {
      expect(
        classes.has(nom) || nom in PRIS_AILLEURS,
        `.${nom} n'est ni défini ni listé dans PRIS_AILLEURS`,
      ).toBe(true);
    }
    for (const nom of Object.keys(PRIS_AILLEURS)) expect(classes, `.${nom} a disparu`).toContain(nom);
  });

  it("`.card` n'existe plus : la surface s'appelle `.carte`", () => {
    expect(CSS).not.toMatch(/\.card(?![\w-])/);
    for (const f of FICHIERS.filter((x) => x.endsWith(".tsx"))) {
      expect(sansCommentaires(lire(f)), `${f} pose encore la classe \`card\``).not.toMatch(
        /className=("[^"]*|\{`[^`]*)\bcard\b/,
      );
    }
  });
});

describe("socle visuel — contrastes (sombre)", () => {
  // [premier plan, arrière-plan, minimum]. 4,5 = texte ; 3 = composant d'interface (1.4.11).
  const COUPLES: [string, string, number][] = [
    ["--texte", "--fond", 4.5],
    ["--texte", "--fond-2", 4.5],
    ["--texte", "--surface", 4.5],
    ["--texte", "--surface-douce", 4.5],
    ["--texte-doux", "--fond", 4.5],
    ["--texte-doux", "--surface", 4.5],
    ["--texte-doux", "--surface-douce", 4.5],
    ["--texte-faible", "--fond", 4.5],
    ["--texte-faible", "--surface", 4.5],
    ["--texte-faible", "--surface-douce", 4.5],
    ["--sur-accent", "--accent", 4.5],
    ["--sur-accent", "--accent-fonce", 4.5],
    ["--accent", "--fond", 4.5],
    ["--accent", "--surface", 4.5],
    ["--repere", "--fond", 4.5],
    ["--repere", "--surface", 4.5],
    ["--repere", "--repere-doux", 4.5],
    ["--succes-texte", "--succes-fond", 4.5],
    ["--succes-texte", "--surface", 4.5],
    ["--alerte-texte", "--alerte-fond", 4.5],
    ["--alerte-texte", "--surface", 4.5],
    ["--erreur-texte", "--erreur-fond", 4.5],
    ["--erreur-texte", "--surface", 4.5],
    ["--bordure-champ", "--surface", 3],
    ["--bordure-champ", "--fond", 3],
    ["--bordure-champ", "--surface-douce", 3],
    ["--accent", "--fond", 3],
  ];

  function tropBas(couples: [string, string, number][]): string[] {
    const fautes: string[] = [];
    for (const [a, b, min] of couples) {
      const fa = JETONS[a];
      const fb = JETONS[b];
      if (!fa || !fb) {
        fautes.push(`${a} / ${b} : jeton introuvable`);
        continue;
      }
      const r = contraste(fa, fb);
      if (r < min) fautes.push(`${a} ${fa} / ${b} ${fb} : ${r.toFixed(2)}:1 < ${min}:1`);
    }
    return fautes;
  }

  it("les couples texte/fond passent le WCAG (texte 4,5:1 ; contour et accent 3:1)", () => {
    const fautes = tropBas(COUPLES);
    expect(fautes, `Contrastes insuffisants :\n${fautes.join("\n")}`).toEqual([]);
  });
});

describe("socle visuel — cibles tactiles et champs", () => {
  /** Corps de la règle `.classe { … }` (la première, hors pseudo-classes). */
  function regle(classe: string): string {
    const m = CSS.match(new RegExp(`(?:^|\\})\\s*\\.${classe}\\s*\\{([^}]*)\\}`));
    expect(m, `règle .${classe} introuvable`).not.toBeNull();
    return m?.[1] ?? "";
  }
  const REM = 16;

  it("`.bouton` et `.champ` font au moins 44 px de haut", () => {
    for (const classe of ["bouton", "champ"]) {
      const m = regle(classe).match(/min-height:\s*([\d.]+)rem/);
      expect(m, `.${classe} : min-height en rem attendu`).not.toBeNull();
      expect(Number(m?.[1]) * REM, `.${classe} : hauteur minimale en px`).toBeGreaterThanOrEqual(44);
    }
  });

  it("`.champ` est à 16 px au moins (en dessous, iOS zoome tout seul)", () => {
    const m = regle("champ").match(/font-size:\s*([\d.]+)rem/);
    expect(m, ".champ : font-size en rem attendu").not.toBeNull();
    expect(Number(m?.[1]) * REM).toBeGreaterThanOrEqual(16);
  });
});
