// tests/hauteurCarte.test.ts — la carte de l'accueil a la MÊME hauteur que la voiture.
//
// Marc, 21/08 : « carte même hauteur que hauteur voiture ». Mesuré au banc avant/après aux
// sept largeurs d'écran : 38 % sur téléphone, 100 % partout maintenant.
//
// Ce test ne mesure rien — il vérifie que le LIEN entre les deux existe encore. La mesure
// se périme au premier ajustement ; le lien, lui, tient. C'est la différence entre écrire
// `603px` dans la carte et la dériver de la constante de la voiture.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");
// ⚠️ Les commentaires sont retirés AVANT toute assertion : ce fichier en contient qui
// citent des valeurs et des sélecteurs, et un test qui matche un commentaire passe au vert
// en ne prouvant rien. Le piège s'est déjà produit deux fois sur ce dépôt.
const regles = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Le CSS privé de TOUS ses blocs `@media`, accolades comptées. PURE. */
function horsMediaQueries(source: string): string {
  let sortie = "";
  let i = 0;
  while (i < source.length) {
    const debut = source.indexOf("@media", i);
    if (debut === -1) return sortie + source.slice(i);
    sortie += source.slice(i, debut);
    const ouvrante = source.indexOf("{", debut);
    if (ouvrante === -1) return sortie;
    let profondeur = 1;
    let j = ouvrante + 1;
    while (j < source.length && profondeur > 0) {
      if (source[j] === "{") profondeur++;
      else if (source[j] === "}") profondeur--;
      j++;
    }
    i = j;
  }
  return sortie;
}

describe("la taille de la voiture est définie UNE fois", () => {
  it("les deux variables existent", () => {
    expect(regles).toMatch(/--voiture-largeur:\s*[\d.]+rem/);
    expect(regles).toMatch(/--voiture-hauteur:\s*calc\(/);
  });

  it("la hauteur se DÉRIVE de la largeur et du rapport de l'image", () => {
    // 760 × 1685 sont les dimensions du rendu (`geometrieVoiture.ts`). Une hauteur écrite
    // en dur marcherait aujourd'hui et mentirait à la prochaine image.
    const m = regles.match(/--voiture-hauteur:\s*calc\((.*?)\);/);
    expect(m, "--voiture-hauteur doit être un calc()").not.toBeNull();
    expect(m![1]).toContain("var(--voiture-largeur)");
    expect(m![1]).toContain("1685");
    expect(m![1]).toContain("760");
  });

  it("la voiture consomme la variable au lieu d'un nombre en dur", () => {
    const bloc = regles.match(/\.schema-pilote\s*\{[^}]*max-width:[^;]+;/g) ?? [];
    expect(bloc.length, "au moins une déclaration de largeur").toBeGreaterThan(0);
    for (const b of bloc) expect(b).toContain("var(--voiture-largeur)");
  });
});

describe("la carte s'aligne sur la voiture, à TOUTES les largeurs", () => {
  it("sa hauteur vient de la variable, jamais d'un nombre", () => {
    const m = regles.match(/\.hc-carte-lien\s*\{([^}]*)\}/);
    expect(m, ".hc-carte-lien doit exister").not.toBeNull();
    expect(m![1]).toContain("height: var(--voiture-hauteur)");
  });

  it("⚠️ la règle n'est PAS enfermée dans un media query", () => {
    // C'est le défaut EXACT du premier correctif : posé sous `@media (min-width: 1200px)`,
    // il laissait la carte à 38 % de la voiture sur téléphone — le cas que je n'avais pas
    // mesuré. Une hauteur qui ne vaut qu'au-delà d'un palier n'est pas une hauteur.
    //
    // ⚠️ Découper au premier `@media` ne prouve RIEN : `.hc-carte` est déclarée tard dans le
    // fichier, après plusieurs paliers. Il faut RETIRER les blocs `@media` en comptant les
    // accolades, puis vérifier que la règle survit — c'est-à-dire qu'elle vivait dehors.
    expect(horsMediaQueries(regles)).toContain(".hc-carte-lien");
  });

  it("le contenu de la carte remplit ce cadre au lieu de garder son rapport", () => {
    // Sans `aspect-ratio: auto`, le 16/10 de la carte gagnerait et la hauteur serait ignorée.
    const m = regles.match(/\.hc-carte-lien\s*>\s*\.carte-osm[\s\S]*?\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("height: 100%");
    expect(m![1]).toContain("aspect-ratio: auto");
  });
});
