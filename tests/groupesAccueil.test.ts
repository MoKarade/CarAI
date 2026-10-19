// tests/groupesAccueil.test.ts — le regroupement de l'accueil est MOBILE, et il le reste.
//
// Marc, 13/09 : « encore un peu trop terne, trop plat, trop d'info de partout, pas assez
// regroupé » — et, au cadrage du même jour, « le desktop ne bouge pas ».
//
// Les deux tiennent ensemble grâce à UNE mécanique : hors media query, `.grp` vaut
// `display: contents` (la boîte du groupe disparaît, ses enfants coulent exactement comme
// avant dans `.carte`), les titres de groupe sont masqués, et le bandeau « l'essentiel »
// n'existe pas. Mesuré au banc à 1280 px : 200 boîtes, coordonnées identiques au pixel,
// même hauteur de page (1 681 px) qu'avant le lot.
//
// ⚠️ POURQUOI CE TEST EXISTE, ET IL A DÉJÀ TIRÉ UNE FOIS. Écrite `.grp-titre`, la règle
// de masquage (0,1,0) perdait contre `.carte h2` (0,1,1), qui pose `display: flex` ET
// `margin: 2rem 0 0.75rem`. Résultat mesuré : les quatre titres s'affichaient sur grand
// écran, et sur téléphone ils emportaient 2rem de marge haute chacun. Un media query
// n'ajoute aucune spécificité — c'est le piège que `globals.css` dit avoir déjà payé deux
// fois, et il s'est représenté ici. Ce qui est verrouillé, c'est donc la SPÉCIFICITÉ, pas
// la simple présence de la règle.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// ⚠️ Découpeur PARTAGÉ depuis le 14/09 : deux fichiers de garde le lisent (cf. aides/css).
import { horsMediaQueries } from "./aides/css";
import { clarteOklab } from "./aides/couleurs";

const css = readFileSync("app/globals.css", "utf8");
// ⚠️ Commentaires retirés AVANT toute assertion : ce fichier en contient qui citent les
// sélecteurs dont on parle, et un test qui matche un commentaire passe au vert en ne
// prouvant rien. Le piège s'est déjà produit deux fois sur ce dépôt.
const regles = css.replace(/\/\*[\s\S]*?\*\//g, "");

const base = horsMediaQueries(regles);

describe("le décommentage et l'extraction ne sont pas vides", () => {
  it("il reste du vrai CSS après avoir retiré commentaires et media queries", () => {
    // Anti-vacuité : sans ça, « la règle n'apparaît pas » se prouverait à partir de
    // « il n'y a plus rien à lire ».
    expect(base.length).toBeGreaterThan(20_000);
    expect(base).toMatch(/\.schema-pilote\s*\{/);
    expect(regles).toMatch(/@media \(max-width: 700px\)/);
  });
});

describe("hors téléphone, le regroupement n'existe pas", () => {
  it("`.grp` vaut `display: contents` dans le CSS de BASE", () => {
    expect(base, "sans ça, chaque groupe ajoute une boîte et le desktop bouge").toMatch(
      /\.grp\s*\{[^}]*display:\s*contents/,
    );
  });

  it("⚠️ le bandeau « l'essentiel » est VISIBLE partout — l'inverse de ce qu'il affirmait", () => {
    // ⚠️ CE TEST S'EST INVERSÉ LE 18/09/2026, il n'a pas été supprimé. Il exigeait
    // `display: none` dans le CSS de base, au motif que le bandeau « contredirait la
    // décision du 20/08 (tout ce que la voiture sait se pose SUR elle) sur un écran large ».
    //
    // Ce qui a changé n'est pas le raisonnement mais sa PRÉMISSE : le 20/08, le grand écran
    // était l'usage secondaire. Interrogé le 18/09 sur la refonte d'interface, Marc a
    // répondu « moitié-moitié » (PC / téléphone) et « un premier écran très court, le
    // détail en dessous » pour LES DEUX. Un premier écran qui n'existe que sur la moitié
    // des visites n'est pas un premier écran.
    //
    // Le supprimer laisserait croire que la question ne s'est jamais posée — or elle s'est
    // posée deux fois, et la réponse a changé parce que l'usage a changé. C'est ce que ce
    // commentaire garde ; l'assertion, elle, garde le fait du jour.
    expect(base).toMatch(/\.essentiel\s*\{[^}]*display:\s*grid/);
    expect(base, "un display:none résiduel le re-masquerait en silence").not.toMatch(
      /\.essentiel\s*\{[^}]*display:\s*none/,
    );
  });

  it("le masquage des titres passe par un sélecteur d'ENFANT, pas par la classe seule", () => {
    // ⚠️ C'est l'assertion qui compte. `.carte h2` vaut (0,1,1) ; une classe seule (0,1,0)
    // perd, et le titre reste affiché sur grand écran.
    expect(base, "`.grp-titre` seul perd contre `.carte h2` — il faut `.grp > .grp-titre`").toMatch(
      /\.grp\s*>\s*\.grp-titre\s*\{[^}]*display:\s*none/,
    );
  });

  it("aucune règle de base ne PEINT un groupe", () => {
    // Fond, bordure, ombre, marge : tout ça n'a le droit d'exister que sous media query.
    // Une seule de ces propriétés au niveau de base et le desktop change d'apparence.
    const declBase = base.match(/\.grp(?:-\w+)?\s*\{[^}]*\}/g) ?? [];
    const peintures = declBase.filter((d) => /background|border|box-shadow|padding|margin/.test(d));
    expect(peintures, `règles de base qui peignent un groupe : ${JSON.stringify(peintures)}`).toEqual(
      [],
    );
  });
});

describe("sur téléphone, le regroupement existe vraiment", () => {
  const mobile = (regles.match(/@media \(max-width: 700px\)\s*\{[\s\S]*$/) ?? [""])[0];

  it("les quatre groupes sont peints", () => {
    expect(mobile).toMatch(/\.grp\s*\{[^}]*display:\s*block/);
    expect(mobile).toMatch(/\.grp\s*\{[^}]*background:/);
    for (const sujet of ["grp-voiture", "grp-alertes", "grp-mois", "grp-bail"]) {
      expect(mobile, `${sujet} n'a pas sa teinte`).toMatch(
        new RegExp(`\\.${sujet}\\s*\\{[^}]*background:`),
      );
    }
  });

  it("les titres reviennent, avec la même spécificité", () => {
    expect(mobile).toMatch(/\.grp\s*>\s*\.grp-titre\s*\{[^}]*display:\s*flex/);
  });

  it("la teinte des groupes ne touche PAS à la clarté du fond", () => {
    // ⚠️ C'est ce qui rend la couleur gratuite en lisibilité : seule la chroma monte.
    // Mesuré : titres à 7,2-7,4 de contraste sur les quatre fonds (seuil AA 4,5).
    // Depuis CarAI#217 les fonds sont des jetons hexadécimaux (`--groupe-*`) : on lit leur clarté
    // OKLab. Le 8 bits arrondit (±0,2 point mesuré) : la tolérance est de 0,5 point.
    const jetons = [...mobile.matchAll(/\.grp-\w+\s*\{[^}]*background:\s*var\((--groupe-[a-z]+)\)/g)].map(
      (m) => m[1]!,
    );
    expect(jetons.length, "les quatre teintes de groupe").toBe(4);
    const fonds = jetons.map((jeton) => {
      const m = new RegExp(`${jeton}:\\s*(#[0-9a-f]{6})\\s*;`).exec(css);
      expect(m, `${jeton} n'est pas défini en hexadécimal`).not.toBeNull();
      return clarteOklab(m![1]!);
    });
    for (const f of fonds) {
      expect(Math.abs(f - 21.5), `clartés trouvées : ${JSON.stringify(fonds)}`).toBeLessThan(0.5);
    }
  });

  it("la grille des tuiles est FIXÉE à deux colonnes", () => {
    // `auto-fit` repliait les quatre petites en colonne une fois dans un groupe : la page
    // est montée de 3 151 à 3 640 px, l'inverse de ce qu'on cherche.
    expect(mobile).toMatch(/\.tuiles\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*1fr\)/);
    expect(mobile).toMatch(/\.tuile-vedette\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
  });
});
