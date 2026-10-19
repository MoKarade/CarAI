// tests/filtreActivite.test.ts — le filtre de dates d'Activité, et ce qu'il ne doit PAS
// changer.
//
// Marc, 14/09 : « je veux pouvoir voir le prix total, filtrer par date mois etc ». Le
// sélecteur complet existait déjà sur Tendances ; il a été EXTRAIT plutôt que recopié.
// Deux choses se cassent silencieusement dans ce genre de partage, et ce fichier les garde.
//
// ⚠️ 1. LA DESTINATION. Les raccourcis de Tendances pointaient sur `/analyse`, l'ancien nom
// de l'écran. `app/analyse/page.tsx` fait `redirect("/tendances")` — une chaîne littérale,
// donc SANS la query string : le `?periode=` était perdu en route et cliquer « 7j » ne
// faisait rien du tout. Aucune erreur, aucune page blanche, juste la mauvaise fenêtre.
// C'est pour ça que `base` est un paramètre obligatoire, et que ce test le compare à la
// route RÉELLE du fichier qui l'appelle — dérivée du chemin, jamais d'une liste tenue à la
// main, qui se périmerait au premier écran ajouté.
//
// ⚠️ 2. LA PORTÉE DE LA LECTURE. Le cumul « depuis le début » d'Activité se calcule sur
// les sessions LUES. Tant que la lecture était bornée par la période affichée, le cumul
// changeait quand Marc basculait le sélecteur — alors que son propre commentaire promettait
// le contraire. La lecture couvre donc tout l'historique, et le filtre ne touche plus que
// l'affichage.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { blocTelephone, horsMediaQueries, sansCommentairesCss } from "./aides/css";

/** Le source privé de ses commentaires. Les nôtres CITENT les motifs cherchés ici. */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SELECTEUR = "app/ui/SelecteurFenetre.tsx";
const selecteur = readFileSync(SELECTEUR, "utf8");
const selecteurCode = sansCommentaires(selecteur);

describe("le décommenteur, avant de s'en servir", () => {
  it("retire bien les commentaires SANS manger le code", () => {
    // Anti-vacuité : sans ce contrôle, « aucune URL en dur » se prouverait à partir de
    // « il ne reste plus rien ». Le fichier fait plus de la moitié de commentaire.
    expect(selecteur).toContain("/analyse");
    expect(selecteurCode).not.toContain("/analyse");
    expect(selecteurCode).toContain("export function SelecteurFenetre");
    expect(selecteurCode.trim().length).toBeGreaterThan(400);
  });

  it("ne coupe pas une URL sur son `//`", () => {
    // Piège classique d'un décommenteur naïf : `https://…` contient `//`, et une ligne
    // amputée là ferait passer n'importe quelle garde d'absence.
    expect(sansCommentaires('const u = "https://exemple.test/x"; // fin')).toContain(
      "https://exemple.test/x",
    );
  });
});

describe("le sélecteur ne connaît AUCUN écran", () => {
  it("ne porte aucune route en dur : tout part de `base`", () => {
    // Le motif vise une chaîne qui COMMENCE par une barre — la forme d'une route de
    // l'app — dans du code, pas dans de la prose.
    const routesEnDur = selecteurCode.match(/["'`]\/[a-z]/g) ?? [];
    expect(routesEnDur).toEqual([]);
  });

  it("construit ses liens à partir de `base`, et il y en a plusieurs", () => {
    // Contre-épreuve du test précédent : « aucune route en dur » serait aussi vrai d'un
    // composant qui ne ferait plus aucun lien.
    expect(selecteurCode).toContain("${base}?periode=");
    expect(selecteurCode).toContain("action={base}");
  });
});

/** Les pages qui affichent le sélecteur, trouvées par balayage de `app/`. */
function pagesAvecSelecteur(): Array<{ route: string; source: string }> {
  const trouvees: Array<{ route: string; source: string }> = [];
  for (const entree of readdirSync("app", { withFileTypes: true })) {
    if (!entree.isDirectory()) continue;
    const chemin = `app/${entree.name}/page.tsx`;
    let source: string;
    try {
      source = readFileSync(chemin, "utf8");
    } catch {
      continue;
    }
    if (!source.includes("<SelecteurFenetre")) continue;
    trouvees.push({ route: `/${entree.name}`, source: sansCommentaires(source) });
  }
  return trouvees;
}

describe("chaque écran s'envoie à LUI-MÊME", () => {
  const pages = pagesAvecSelecteur();

  it("le balayage trouve bien les deux écrans du jour", () => {
    // Anti-vacuité : une boucle sur une liste vide passe tous les tests du monde.
    expect(pages.map((p) => p.route).sort()).toEqual(["/activite", "/tendances"]);
  });

  it.each(pagesAvecSelecteur())("$route passe sa propre route en `base`", ({ route, source }) => {
    expect(source).toContain(`base="${route}"`);
  });

  it("aucun écran ne s'envoie sur `/analyse`, qui perd la query string", () => {
    // La garde du bug corrigé. `/analyse` existe toujours (il redirige), donc rien ne
    // casserait à l'œil : la page s'afficherait, avec la mauvaise période.
    for (const { route, source } of pages) {
      expect(source, `${route} renvoie vers /analyse`).not.toContain('"/analyse"');
      expect(source, `${route} renvoie vers /analyse`).not.toContain("/analyse?");
    }
  });
});

describe("Activité lit TOUT l'historique, et filtre ensuite", () => {
  const activite = sansCommentaires(readFileSync("app/activite/page.tsx", "utf8"));

  it("les trois lectures d'historique portent la borne complète", () => {
    // Trois lectures nourrissent les recharges : l'état de charge, le niveau de batterie,
    // et les POSITIONS — ces dernières décident du lieu, donc du prix. Une seule d'entre
    // elles restée bornée par la période suffirait à faire retomber les vieilles sessions
    // sur « lieu non reconnu », donc sans prix, donc un cumul sous-compté en silence.
    expect(activite).toContain(
      'serieNumerique("battery_soc", { depuis: null, limite: LIMITE_HISTORIQUE_COMPLET })',
    );
    expect(activite).toContain(
      'serieEtat("charging_status", { depuis: null, limite: LIMITE_HISTORIQUE_COMPLET })',
    );
    expect(activite).toContain(
      "historiquePositions({ depuis: null, limite: LIMITE_HISTORIQUE_COMPLET })",
    );
  });

  it("aucune lecture ne repart d'une borne dérivée de la période", () => {
    // `depuisLecture` était la variable qui portait ce défaut. Son retour signalerait que
    // la lecture s'est re-bornée — et le cumul recommencerait à suivre le filtre.
    expect(activite).not.toContain("depuisLecture");
    expect(activite).not.toContain("depuisDonnees");
  });

  it("le filtre d'affichage passe par le prédicat partagé, bornes hautes comprises", () => {
    // Une comparaison `>= depuis` écrite à la main n'a pas de borne haute : elle marche
    // pour les raccourcis et laisse fuir tout ce qui suit la fin d'une PLAGE.
    expect(activite).toContain("instantDansLaFenetre");
    expect(activite.match(/\.getTime\(\) >= depuis\.getTime\(\)/g) ?? []).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════
// LES CIBLES DU SÉLECTEUR — mesurées au banc Chromium le 14/09, à 360 et 390 px.
//
// AVANT : 9 des 13 cibles sous 44 px (les cinq raccourcis à 31,8 ; les deux champs de
// date à 35,5 ; « Afficher » à 34,1 ; « Effacer » à 22,5). APRÈS : 0 sur 13, aux deux
// largeurs, zéro débordement, et les cinq raccourcis tiennent sur UNE ligne.
//
// Ce que ce test garde n'est pas la mesure — un test unitaire ne fait pas tourner de
// moteur de rendu — mais les DEUX propriétés dont la mesure dépend : la règle existe dans
// le bloc mobile, et elle n'existe PAS en dehors. La seconde compte autant : un media
// query n'ajoute aucune spécificité, donc une règle sortie de son bloc s'appliquerait au
// grand écran sans que rien ne le dise, et le desktop de Tendances bougerait.
// ══════════════════════════════════════════════════════════════════════════════════════

describe("les cibles du sélecteur sur téléphone", () => {
  const css = sansCommentairesCss(readFileSync("app/globals.css", "utf8"));
  const grandEcran = horsMediaQueries(css);

  it("l'extraction laisse du CSS des deux côtés", () => {
    // Anti-vacuité : « la règle n'est pas sur grand écran » se prouverait tout seul si
    // `horsMediaQueries` rendait une chaîne vide.
    expect(grandEcran.length).toBeGreaterThan(20_000);
    expect(css).toMatch(/@media \(max-width: 700px\)/);
    expect(css.length).toBeGreaterThan(grandEcran.length);
  });

  it("les quatre familles de cibles portent une hauteur de 44 px", () => {
    // ⚠️ `blocTelephone`, PAS `css.slice(indexOf("@media (max-width: 700px)"))`.
    // La seconde forme lisait « tout ce qui suit le PREMIER bloc téléphone », ce qui n'est
    // le bloc téléphone que tant qu'il est le dernier gros bloc du fichier — une propriété
    // que rien ne garantit. Le 18/09/2026, l'unification des points de rupture a migré
    // `.panneau-etat` de 46rem vers 700px, à la ligne 764 : le « premier bloc téléphone »
    // a sauté 2 600 lignes plus haut, la tranche s'est mise à contenir le CSS de BASE, et
    // ce test a rougi sur un lot qui ne touchait ni aux raccourcis ni aux cibles tactiles.
    // Il mesurait un PROXY. `blocTelephone` compte les accolades et concatène TOUS les
    // blocs : il est exact par construction, et il existait déjà.
    const mobile = blocTelephone(css);
    for (const selecteur of [".raccourcis a,", '.filtres input[type="date"],', ".filtres a {"]) {
      expect(mobile, `${selecteur} n’est pas dans le bloc mobile`).toContain(selecteur);
    }
    // ⚠️ `min-height` seul ne fait rien sur un `<a>`, qui reste `inline` : sans
    // `inline-flex`, la règle est écrite, verte au test, et sans le moindre effet.
    const bloc = mobile.slice(mobile.indexOf(".raccourcis a,"));
    const regleRaccourcis = bloc.slice(0, bloc.indexOf("}"));
    expect(regleRaccourcis).toContain("inline-flex");
    expect(regleRaccourcis).toContain("min-height: 44px");
    // Deux dimensions, pas une : « 7j » fait trois caractères.
    expect(regleRaccourcis).toContain("min-width: 44px");
  });

  it("aucune de ces règles ne s'applique au GRAND écran", () => {
    // La garde du « le desktop ne bouge pas ». Si ces règles fuient hors du media query,
    // les raccourcis de Tendances grossissent sur l'écran de bureau de Marc.
    const raccourcisGrandEcran = grandEcran.slice(grandEcran.indexOf(".raccourcis a,"));
    expect(raccourcisGrandEcran.slice(0, raccourcisGrandEcran.indexOf("}"))).not.toContain(
      "min-height",
    );
  });
});
