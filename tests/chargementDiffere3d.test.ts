// tests/chargementDiffere3d.test.ts — `three` reste-t-il HORS du bundle de l'accueil ?
//
// ⚠️ POURQUOI CETTE GARDE. Le moteur de rendu et le modèle pèsent plus que tout le reste de
// l'app réuni. Un seul `import` statique de `Voiture3D` — ou de `three` — quelque part dans
// `app/` ou `lib/` les ferait descendre sur le téléphone de Marc à CHAQUE ouverture de
// l'accueil. Et ça ne casserait RIEN : même écran, mêmes tests verts, même CI verte. Le
// seul symptôme serait une page qui met plus longtemps à s'afficher, sur un écran qu'on
// regarde en marchant vers sa voiture.
//
// C'est exactement la classe de défaut que ce dépôt attrape par un scan de source, jamais
// par la vigilance.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sansCommentairesJsx } from "./aides/controles";
import { fichiersSource } from "./aides/fichiers";

const PORTEE = ["app", "lib", "mcp"];
const PORTE_D_ENTREE = "app/ui/VueVoiture3D.tsx";
const LE_CANVAS = "app/ui/Voiture3D.tsx";

function sourceNue(chemin: string): string {
  return sansCommentairesJsx(readFileSync(chemin, "utf8"));
}

const SOURCES = PORTEE.flatMap(fichiersSource).map((chemin) => ({
  chemin,
  code: sourceNue(chemin),
}));

describe("le décommentage sur lequel tout repose", () => {
  // ⚠️ Anti-vacuité. Nos en-têtes CITENT les motifs cherchés ici (« import statique »,
  // « three »). Sans décommentage, la garde rougirait sur l'explication de sa propre
  // existence ; si le décommentage mangeait tout, elle ne trouverait plus rien et « aucun
  // offender » se lirait comme une preuve. Les deux sens sont donc vérifiés.
  const porte = sourceNue(PORTE_D_ENTREE);

  it("retire bien les commentaires", () => {
    // Ce mot n'existe dans ce fichier QUE dans un commentaire — cherché, pas supposé.
    expect(readFileSync(PORTE_D_ENTREE, "utf8")).toContain("stationnement");
    expect(porte).not.toContain("stationnement");
  });

  it("laisse le code debout", () => {
    expect(porte).toContain("export function VueVoiture3D");
    expect(SOURCES.length).toBeGreaterThan(50);
  });
});

describe("le moteur de rendu", () => {
  it("n'est importé STATIQUEMENT nulle part", () => {
    const offenders = SOURCES.filter(({ code }) => /from\s+["']three/.test(code)).map(
      ({ chemin }) => chemin,
    );
    expect(offenders).toEqual([]);
  });

  it("n'est chargé que par un import DYNAMIQUE, et seulement dans le canvas", () => {
    const chargeurs = SOURCES.filter(({ code }) => /import\(\s*["']three/.test(code)).map(
      ({ chemin }) => chemin,
    );
    expect(chargeurs).toEqual([LE_CANVAS]);
  });
});

describe("le canvas 3D", () => {
  // ⚠️ LE `/` DEVANT `Voiture3D` N'EST PAS DÉCORATIF. Sans lui, le motif matche aussi
  // `"@/app/ui/VueVoiture3D"` — le nom de la PORTE D'ENTRÉE contient celui du canvas. Ma
  // première version rougissait donc sur `app/page.tsx`, qui n'importe que la porte, et le
  // remède tentant aurait été d'exempter `page.tsx` : la garde aurait alors cessé de voir
  // l'accueil, c'est-à-dire précisément le fichier qu'elle protège.
  const CHEMIN_VERS_LE_CANVAS = /["'][^"']*\/Voiture3D["']/;

  it("n'est importé que par sa porte d'entrée", () => {
    const importeurs = SOURCES.filter(
      ({ chemin, code }) => chemin !== LE_CANVAS && CHEMIN_VERS_LE_CANVAS.test(code),
    ).map(({ chemin }) => chemin);
    expect(importeurs).toEqual([PORTE_D_ENTREE]);
  });

  it("ne confond pas la porte d'entrée avec le canvas — leurs noms se ressemblent", () => {
    expect(CHEMIN_VERS_LE_CANVAS.test('from "@/app/ui/VueVoiture3D"')).toBe(false);
    expect(CHEMIN_VERS_LE_CANVAS.test('from "@/app/ui/Voiture3D"')).toBe(true);
    expect(CHEMIN_VERS_LE_CANVAS.test('import("./Voiture3D")')).toBe(true);
  });

  it("y est chargé par `dynamic`, jamais par un import statique", () => {
    const porte = sourceNue(PORTE_D_ENTREE);
    expect(porte).not.toMatch(/import\s+\w+\s+from\s+["']\.\/Voiture3D["']/);
    expect(porte).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\(["']\.\/Voiture3D["']\)/);
  });

  // ⚠️ Sans `ssr: false`, Next tente de rendre le composant sur le SERVEUR : `three` y
  // repart dans le bundle serveur et le rendu échoue sur l'absence de `window` — au
  // mieux. Ce n'est pas un réglage de confort.
  it("est déclaré sans rendu serveur", () => {
    expect(sourceNue(PORTE_D_ENTREE)).toMatch(/ssr:\s*false/);
  });
});
