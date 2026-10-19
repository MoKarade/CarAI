// tests/donneesMobile.test.ts — l'écran Données au doigt, et le TROU d'une famille de
// règles qui énumère des types de contrôle.
//
// Marc, refonte mobile : « trop petit à taper · ça déborde en largeur · trop d'infos d'un
// coup · les formulaires sont pénibles ». Mesuré au banc Chromium le 14/09, sur le VRAI
// `app/globals.css` et le balisage exact de l'écran, à 360 et 390 px :
//   • les TROIS menus déroulants du formulaire de filtres : **29,6 px de haut** et
//     **14,1 px de police** — pendant que le bouton « Filtrer » et les deux liens
//     d'export juste à côté faisaient déjà leurs 44 px ;
//   • les deux liens de pagination (« ← Précédente », « Suivante → ») : **16 px**, pour
//     naviguer dans 125 pages ;
//   • zéro débordement de la PAGE.
//
// ══ LA LEÇON DE CE LOT ════════════════════════════════════════════════════════════════
//
// Le bloc mobile portait déjà `.filtres input[type="date"]`, `.filtres button` et
// `.filtres a` — écrits pour le sélecteur de fenêtre, qui n'a pas de menu déroulant. Le
// formulaire de Données, lui, n'est QUE des menus déroulants. Une famille de règles qui
// ÉNUMÈRE les types de contrôle en oublie un, et l'oubli ne se voit que sur l'écran qui
// l'emploie. D'où la garde de FAMILLE ci-dessous : elle DÉRIVE du code la liste des
// contrôles réellement employés dans un `.filtres`, et exige que le bloc mobile les
// couvre tous. Une liste écrite à la main se périmerait au premier écran ajouté.
//
// ⚠️ LES TABLEAUX NE SONT PAS TOUCHÉS, ET C'EST UNE MESURE, PAS UN OUBLI. Le tableau de
// mesures fait 688 px dans 325 px visibles ; il défile dans son cadre (`.defilement`,
// `overflow-x: auto`), et la page, elle, ne défile pas latéralement. Essai fait au banc :
// laisser les cellules revenir à la ligne (`white-space: normal`) ne le fait PAS tenir
// (426 px, il déborde encore de 101) et lui coûte **+93 % de hauteur** (201 → 387 px),
// la page passant de 2 414 à 2 907 px. Le remède était pire que le mal.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  blocTelephone,
  horsMediaQueries,
  regleCss,
  sansCommentairesCss,
} from "./aides/css";
import {
  controlesEmployes,
  couvertureMobile,
  porteesDeLaClasse,
  sansCommentairesJsx,
} from "./aides/controles";
import { fichiersTsx } from "./aides/fichiers";

const CSS = readFileSync("app/globals.css", "utf8");
const cssNu = sansCommentairesCss(CSS);
const telephone = blocTelephone(cssNu);
const grandEcran = horsMediaQueries(cssNu);

/**
 * Les corps de TOUTES les règles dont le sélecteur — groupé ou non — vise exactement
 * `selecteur`.
 *
 * ⚠️ POURQUOI PAS `regleCss`. Ma première version de la garde « la hauteur des menus ne
 * fuit pas hors du bloc téléphone » cherchait `.filtres select {` et rendait `null` :
 * elle était VACUEUSE, parce que la règle de base s'écrit `.filtres select,\n.filtres
 * button { … }` — un sélecteur GROUPÉ, que ce motif ne voit pas. Mesuré par mutation :
 * ajouter `min-height: 44px` à cette règle de base laissait le test VERT. Une garde
 * satisfaite par la FORME du sélecteur ne garde rien.
 */
function reglesVisant(source: string, selecteur: string): string[] {
  const corps: string[] = [];
  for (const bloc of source.split("}")) {
    const i = bloc.indexOf("{");
    if (i === -1) continue;
    const selecteurs = bloc
      .slice(0, i)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (selecteurs.includes(selecteur)) corps.push(bloc.slice(i + 1));
  }
  return corps;
}

describe("les lecteurs, avant de s'en servir", () => {
  it("le bloc téléphone contient du CSS, et pas tout le fichier", () => {
    expect(telephone.length).toBeGreaterThan(1000);
    expect(telephone.length).toBeLessThan(cssNu.length / 2);
    expect(telephone).toContain(".onglets");
    expect(grandEcran.length).toBeGreaterThan(cssNu.length / 2);
    expect(grandEcran).not.toContain("max-width: 700px");
  });
});

describe("les menus déroulants des filtres", () => {
  it("font 44 px et 1rem sur téléphone", () => {
    const r = regleCss(telephone, ".filtres select");
    expect(r).not.toBeNull();
    expect(r).toContain("min-height: 44px");
    // 16 px est le SEUIL du zoom automatique d'iOS, pas une préférence esthétique.
    expect(r).toContain("font-size: 1rem");
  });

  it("gardent leur taille sur grand écran", () => {
    const visant = reglesVisant(grandEcran, ".filtres select");
    // Anti-vacuité : la règle de base EXISTE (elle pose la police, la bordure, le
    // rayon). Si le recensement n'en trouvait aucune, l'absence de `min-height` se
    // prouverait à partir de « il n'y a rien à regarder ».
    expect(visant.length).toBeGreaterThan(0);
    expect(visant.join("")).not.toContain("min-height");
  });
});

describe("la garde de FAMILLE — aucun type de contrôle oublié", () => {
  // Les contrôles TAPABLES employés dans un `.filtres`, DÉRIVÉS du code : une liste
  // écrite à la main se périmerait au premier écran ajouté — c'est exactement ce qui
  // avait laissé les menus déroulants à 29,6 px.
  //
  // ⚠️ Le recensement est PARTAGÉ avec `reglagesMobile.test.ts` (`aides/controles.ts`).
  // Il vivait ici en premier ; le porter à deux endroits aurait donné deux recenseurs
  // dont un seul connaîtrait le prochain cas tordu — la même histoire que `aides/css.ts`.
  const employes = controlesEmployes(
    fichiersTsx("app").flatMap((f) =>
      porteesDeLaClasse(sansCommentairesJsx(readFileSync(f, "utf8")), "filtres"),
    ),
  );

  it("le recensement trouve bien quelque chose (anti-vacuité)", () => {
    // Sans ce contrôle, « tous les types sont couverts » se prouverait à partir de
    // « aucun type n'a été trouvé ».
    expect([...employes].sort()).toEqual(["a", "button", "input", "select"]);
  });

  it("le bloc téléphone couvre CHAQUE type employé", () => {
    for (const balise of employes) {
      const c = couvertureMobile(telephone, "filtres", balise);
      expect(c.regles, `aucune règle mobile pour \`.filtres ${balise}\``).toBeGreaterThan(0);
      expect(c.hauteur, `\`.filtres ${balise}\` n'atteint pas 44 px`).toBe(true);
    }
  });

  it("⚠️ la POLICE des champs d'un `.filtres` vient d'ailleurs, et c'est mesuré", () => {
    // Contrairement à l'écran Réglages, la famille `.filtres` ne porte `font-size: 1rem`
    // que sur `select`. Ce n'est pas un trou : mesuré le 14/09, aucun champ de saisie
    // d'un `.filtres` n'est nu — ceux du sélecteur de fenêtre sont pris par
    // `.selecteur-fenetre .filtres input`, ceux du formulaire de lieu par
    // `.form-lieu input`, et le seul `<input>` du formulaire de Données est `hidden`.
    // La garde ÉCRIT cet état pour qu'un futur champ de saisie ajouté à un `.filtres`
    // sans conteneur plus spécifique se remarque ici plutôt qu'en tapant dessus.
    expect(couvertureMobile(telephone, "filtres", "select").police).toBe(true);
    expect(couvertureMobile(telephone, "filtres", "input").police).toBe(false);
    expect(regleCss(telephone, ".selecteur-fenetre .filtres input,\n  .selecteur-fenetre .filtres button"))
      .toContain("font-size: 1rem");
  });
});

describe("la pagination d'un tableau de 125 pages", () => {
  it("les deux liens portent leur RELATION, pas une énième classe", () => {
    const page = sansCommentairesJsx(readFileSync("app/donnees/page.tsx", "utf8"));
    expect(page).toContain('<a rel="prev"');
    expect(page).toContain('<a rel="next"');
  });

  it("la relation les rend tapables sur téléphone", () => {
    const r = regleCss(telephone, 'a[rel="prev"],\n  a[rel="next"]');
    expect(r).not.toBeNull();
    expect(r).toContain("min-height: 44px");
    // ⚠️ `min-height` seul ne fait RIEN sur un `<a>` : il reste `inline`, donc sans
    // hauteur propre. Le piège est déjà écrit dans `globals.css`, il se re-paie ici.
    expect(r).toContain("inline-flex");
  });

  it("rien de tout ça ne s'applique sur grand écran", () => {
    expect(grandEcran).not.toContain('a[rel="prev"]');
  });
});

describe("les tableaux défilent dans leur cadre — décision MESURÉE", () => {
  it("le cadre défile horizontalement", () => {
    expect(regleCss(grandEcran, ".defilement")).toContain("overflow-x: auto");
  });

  it("les cellules ne reviennent PAS à la ligne, y compris sur téléphone", () => {
    // Essai fait au banc : `white-space: normal` sur téléphone ne fait pas tenir le
    // tableau (426 px dans 325) et lui coûte +93 % de hauteur. Le remède est pire que le
    // mal — cette garde empêche de le « corriger » sans re-mesurer.
    expect(regleCss(grandEcran, ".tableau th,\n.tableau td")).toContain("white-space: nowrap");
    expect(telephone).not.toContain("white-space: normal");
  });
});
