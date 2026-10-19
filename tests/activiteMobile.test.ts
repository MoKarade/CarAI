// tests/activiteMobile.test.ts — l'écran Activité au doigt, et ce que le repli n'a pas
// le droit de taire.
//
// Marc, refonte mobile : « trop petit à taper · ça déborde en largeur · trop d'infos d'un
// coup · les formulaires sont pénibles ». Mesuré au banc Chromium le 14/09, sur le VRAI
// `app/globals.css` et le balisage exact de l'écran, à 360 et 390 px :
//   • les DEUX seules actions du fil — « Voir » et « Maps » — faisaient 26 × 16 px et
//     36 × 16 px. Le minimum tenable au doigt est 44 px ;
//   • les deux champs de date du sélecteur étaient à 14,1 px : sous 16 px, iOS ZOOME la
//     page à la mise au point, et il faut repincer pour revenir ;
//   • les liens de secours des états vides (« Voir les 7 derniers jours ») : 16 px ;
//   • zéro débordement en largeur — cet irritant-là n'existait pas ici, et le dire vaut
//     mieux que de « corriger » ce qui marche.
// Après : 0 cible sous 44 px, 0 champ sous 16 px, 78 px rendus avant le fil.
//
// ══ CE QUE CE FICHIER GARDE, ET POURQUOI ═════════════════════════════════════════════
//
// 1. Les règles vivent dans le bloc TÉLÉPHONE et nulle part ailleurs. Un media query
//    n'ajoute AUCUNE spécificité : une règle sortie de son bloc par mégarde s'applique à
//    toutes les largeurs sans que rien ne le signale. Ce fichier vérifie donc les deux
//    sens — présente sous 700 px, absente du CSS de base.
// 2. Le repli de la concordance ne TAIT rien. Elle est repliée depuis le 14/09 parce
//    qu'elle poussait le fil 213 px plus bas ; son résumé porte donc le verdict COMPLET,
//    écart compris. Un titre neutre (« Concordance ») aurait caché exactement ce que ce
//    bloc existe pour dire.
// 3. Le résumé et l'explication dérivent du MÊME jugement. Deux ternaires écrits côte à
//    côte finissent par diverger — c'est le défaut que ce dépôt a déjà payé plusieurs fois
//    (« une règle tenue à deux endroits est une règle et demie »).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  blocTelephone,
  horsMediaQueries,
  regleCss,
  sansCommentairesCss,
} from "./aides/css";
import { jugerConcordance, type Reconciliation } from "@/lib/vehicle/trajets";

const CSS = readFileSync("app/globals.css", "utf8");
const cssNu = sansCommentairesCss(CSS);
const PAGE = readFileSync("app/activite/page.tsx", "utf8");

/** Le source privé de ses commentaires — les nôtres CITENT les motifs cherchés ici. */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const pageCode = sansCommentaires(PAGE);

const telephone = blocTelephone(cssNu);
const grandEcran = horsMediaQueries(cssNu);

describe("les lecteurs, avant de s'en servir", () => {
  it("le bloc téléphone contient du CSS, et pas tout le fichier", () => {
    // Anti-vacuité des deux côtés : une garde de PRÉSENCE se prouverait à partir de « le
    // bloc contient tout », et une garde d'ABSENCE à partir de « il ne reste rien ».
    expect(telephone.length).toBeGreaterThan(1000);
    expect(telephone.length).toBeLessThan(cssNu.length / 2);
    expect(telephone).toContain(".onglets");
    expect(grandEcran.length).toBeGreaterThan(cssNu.length / 2);
    expect(grandEcran).not.toContain("max-width: 700px");
  });

  it("le décommenteur retire les commentaires sans manger le code", () => {
    expect(PAGE).toContain("lien-action");
    expect(pageCode).toContain("export default async function Activite");
    expect(pageCode.trim().length).toBeGreaterThan(5000);
    expect(sansCommentaires('const u = "https://exemple.test/x"; // fin')).toContain(
      "https://exemple.test/x",
    );
  });
});

describe("les cibles du fil se tapent au doigt", () => {
  it("les liens d'une rangée font au moins 44 px, en hauteur ET en largeur", () => {
    const r = regleCss(telephone, ".evenement .liens a");
    expect(r).not.toBeNull();
    expect(r).toContain("min-height: 44px");
    // La largeur autant que la hauteur : « Voir » faisait 26 px de large, et une cible
    // étroite se rate latéralement même quand elle est haute.
    expect(r).toContain("min-width: 44px");
  });

  it("la colonne des liens reste alignée à droite (la rangée ne se décale pas)", () => {
    expect(regleCss(telephone, ".evenement .liens")).toContain("justify-content: flex-end");
  });

  it("aucune de ces règles n'existe sur grand écran", () => {
    // ⚠️ `.evenement .liens` EXISTE déjà au niveau de base (grid-area, taille, nowrap) —
    // ma première version de ce test l'exigeait absente et rougissait sur du CSS sain.
    // Ce qui ne doit pas fuir hors du bloc téléphone, ce sont les propriétés AJOUTÉES.
    expect(regleCss(grandEcran, ".evenement .liens a")).toBeNull();
    const base = regleCss(grandEcran, ".evenement .liens");
    expect(base).not.toBeNull();
    expect(base).not.toContain("justify-content");
    expect(base).not.toContain("display: flex");
  });
});

describe("les champs de date ne font plus zoomer iOS", () => {
  it("la police des champs du sélecteur atteint 1rem sur téléphone", () => {
    const r = regleCss(telephone, ".selecteur-fenetre .filtres input,\n  .selecteur-fenetre .filtres button");
    expect(r).not.toBeNull();
    // 16 px est le SEUIL du zoom automatique d'iOS, pas une préférence esthétique.
    expect(r).toContain("font-size: 1rem");
    expect(r).toContain("min-height: 44px");
  });

  it("la règle vise le sélecteur, pas tous les `.filtres` de l'app", () => {
    // `app/reglages/FormulaireLieu` a ses propres filtres, réglés par leur bloc à eux :
    // une règle sur `.filtres` seul les emporterait sans que personne ne l'ait demandé.
    expect(telephone).toContain(".selecteur-fenetre .filtres input");
    expect(regleCss(telephone, ".filtres input")).toBeNull();
  });

  it("rien de tout ça ne s'applique sur grand écran", () => {
    expect(grandEcran).not.toContain(".selecteur-fenetre .filtres input");
  });
});

describe("le lien de secours d'un état vide est une vraie cible", () => {
  it("`.lien-action` fait 44 px sur téléphone", () => {
    expect(regleCss(telephone, ".lien-action")).toContain("min-height: 44px");
  });

  it("`.lien-action` ne porte AUCUNE règle sur grand écran : le lien reste dans sa phrase", () => {
    expect(grandEcran).not.toContain(".lien-action");
  });

  it("les deux liens de secours d'Activité la portent", () => {
    // Ce sont les seules actions de l'écran quand il n'y a rien à montrer.
    expect(pageCode).toContain('<a className="lien-action" href="/activite?periode=tout">');
    expect(pageCode).toContain('<a className="lien-action" href="/activite?periode=7j">');
  });
});

describe("la concordance est repliée, mais elle ne tait rien", () => {
  it("c'est un repli, et il garde son identité visuelle", () => {
    expect(pageCode).toContain('<details className="replie concordance">');
  });

  it("le résumé porte le VERDICT, pas un titre neutre", () => {
    expect(pageCode).toContain("<summary>{resumeConcordance(v)}</summary>");
    // Un titre neutre cacherait précisément l'information que ce bloc existe pour dire.
    expect(pageCode).not.toContain("<summary>Concordance</summary>");
  });

  it("le résumé et l'explication dérivent du MÊME jugement", () => {
    // Une seule lecture du bilan dans tout l'écran : le reste passe par `v`.
    expect(pageCode).toContain("const v = jugerConcordance(bilan);");
    expect(pageCode).not.toContain("const concorde =");
    expect(pageCode).not.toContain("bilan.ecartKm");
  });
});

describe("jugerConcordance — le jugement, sans une seule chaîne de texte", () => {
  const bilan = (p: Partial<Reconciliation>): Reconciliation => ({
    kmCompteur: 100,
    kmTrajets: 100,
    ecartKm: 0,
    odoDebut: 0,
    odoFin: 100,
    nbRelevesOdometre: 2,
    ...p,
  });

  it("sans compteur, il dit combien de relevés il a vus", () => {
    expect(jugerConcordance(bilan({ kmCompteur: null, ecartKm: null, nbRelevesOdometre: 0 })))
      .toEqual({ genre: "sans-compteur", nbReleves: 0 });
    expect(jugerConcordance(bilan({ kmCompteur: null, ecartKm: null, nbRelevesOdometre: 1 })))
      .toEqual({ genre: "sans-compteur", nbReleves: 1 });
  });

  it("sous 1 km d'écart, ça concorde — c'est l'arrondi du GPS, pas un km manquant", () => {
    expect(jugerConcordance(bilan({ ecartKm: 0.9 })).genre).toBe("concorde");
    expect(jugerConcordance(bilan({ ecartKm: -0.9 })).genre).toBe("concorde");
  });

  it("au-delà, il distingue les km MANQUANTS du détail EN TROP", () => {
    // Les deux sens ne veulent pas dire la même chose : l'un est du roulage sans
    // position publiée (il compte pour le bail), l'autre une anomalie de reconstitution.
    expect(jugerConcordance(bilan({ kmCompteur: 128, kmTrajets: 126, ecartKm: 2 }))).toEqual({
      genre: "manque",
      kmCompteur: 128,
      kmTrajets: 126,
      ecartKm: 2,
    });
    expect(jugerConcordance(bilan({ kmCompteur: 126, kmTrajets: 128, ecartKm: -2 }))).toEqual({
      genre: "surplus",
      kmCompteur: 126,
      kmTrajets: 128,
      ecartKm: 2,
    });
  });

  it("un écart inconnu avec un compteur connu n'invente PAS un zéro", () => {
    // `ecartKm: null` ne devrait pas arriver là, mais le rendre « 0 km d'écart » serait
    // une affirmation. « Concorde » n'ajoute aucun chiffre faux.
    const v = jugerConcordance(bilan({ ecartKm: null }));
    expect(v.genre).toBe("concorde");
    expect(JSON.stringify(v)).not.toContain("ecartKm");
  });
});
