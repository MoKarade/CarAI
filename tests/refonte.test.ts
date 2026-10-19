// tests/refonte.test.ts — les tripwires de la refonte constructeur (17/08/2026).
//
// Trois bugs VUS À L'ÉCRAN par Marc (captures), invisibles au gate — chacun verrouillé :
//
//   1. « texte fucké » : le composant de badges réutilisait la classe `pastille`, qui
//      appartenait déjà aux puces de légende (un rond de 0,6 em). La règle historique
//      `width: 0.6em` restait la plus forte sur cette propriété → chaque badge faisait
//      0,6 em et les textes se superposaient. Même famille que `tuile` vs `tuile-osm`.
//   2. « le bouton ⓘ est beaucoup trop gros » : `.graphique svg { width: 100% }` attrapait
//      TOUS les svg du bloc, y compris l'icône du ⓘ, gonflée à la taille d'une courbe.
//   3. Le thème : sombre ASSUMÉ (décision explicite de Marc) — un `@media
//      (prefers-color-scheme)` réintroduit referait dériver un thème clair qu'on ne voit
//      jamais.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");

describe("collision de classes — `pastille` appartient aux puces de légende", () => {
  // Les composants de la refonte : aucun n'a le droit d'employer la classe `pastille`.
  const composantsRefonte = [
    "app/ui/Pastille.tsx",
    "app/ui/IndicateursVoiture.tsx",
    "app/ui/Icones.tsx",
  ];

  it.each(composantsRefonte)("%s n'utilise pas la classe CSS `pastille`", (f) => {
    const source = readFileSync(f, "utf8");
    // Le NOM DE COMPOSANT `Pastille` reste permis — c'est la CLASSE CSS qui collisionne.
    expect(source, "la classe `pastille` appartient aux puces de légende (0,6 em)").not.toMatch(
      /className=["'`{[^}]*\bpastille\b/,
    );
  });

  it("le composant de badges emploie bien la classe `insigne`", () => {
    expect(readFileSync("app/ui/Pastille.tsx", "utf8")).toMatch(/insigne/);
  });

  it("les puces de légende gardent leur règle historique (rond de 0,6 em)", () => {
    // Si quelqu'un « nettoie » la vieille règle en croyant qu'elle est morte, les légendes
    // de cartes et de graphiques perdent leurs puces.
    expect(css).toMatch(/\.pastille \{[^}]*width: 0\.6em/s);
  });

  it("les insignes ont leur propre règle, avec un rayon de badge", () => {
    expect(css).toMatch(/\.insigne \{[^}]*border-radius: 999px/s);
  });
});

describe("le ⓘ garde sa taille — les règles larges de svg ne l'attrapent plus", () => {
  it("la règle des graphes est SCOPÉE à svg.graphe, jamais à svg nu", () => {
    // `.graphique svg {` nu remettrait le ⓘ à 100 % de largeur (capture Marc, 17/08).
    expect(css).toMatch(/\.graphique svg\.graphe \{/);
    expect(css, "un `.graphique svg {` non scopé regonflerait le ⓘ").not.toMatch(
      /\.graphique svg \{/,
    );
  });

  it("chaque svg de graphe de Graphique.tsx porte la classe `graphe`", () => {
    const source = readFileSync("app/ui/Graphique.tsx", "utf8");
    const svgOuvrants = source.match(/<svg[\s\n]/g) ?? [];
    const scopés = source.match(/className="graphe"/g) ?? [];
    expect(scopés.length, "un svg de graphe sans classe échappe au dimensionnement").toBe(
      svgOuvrants.length,
    );
  });

  it("la taille du ⓘ est ÉPINGLÉE dans .itap — insensible aux règles voisines", () => {
    expect(css).toMatch(/\.itap > summary svg \{[^}]*width: 0\.95rem/s);
  });
});

describe("sombre assumé — décision explicite de Marc, 17/08", () => {
  it("plus aucun @media (prefers-color-scheme) dans le CSS", () => {
    // La règle du CLAUDE.md global (« suivre le système ») est remplacée POUR CARAI par
    // le choix explicite de Marc au cadrage. Un bloc réintroduit recréerait un thème
    // clair que personne ne regarde — et qui dérive en silence.
    expect(css).not.toMatch(/@media \(prefers-color-scheme/);
  });

  it("color-scheme est dark, et le manifest est aligné", () => {
    expect(css).toMatch(/color-scheme: dark;/);
    const manifest = readFileSync("app/manifest.ts", "utf8");
    expect(manifest).toMatch(/#060911/);
  });
});

describe("la carte Google — le repli reste câblé", () => {
  it("cleMapsEmbed rend null sans clé, et la page garde la carte OSM en repli", () => {
    const accueil = readFileSync("app/page.tsx", "utf8");
    // Les deux branches doivent exister : CarteGoogle AVEC clé, Carte (OSM) SANS.
    expect(accueil).toMatch(/CarteGoogle/);
    expect(accueil).toMatch(/<Carte vue=/);
  });

  it("la vue d'ensemble d'Activité passe par Google — l'OSM reste le repli", () => {
    // Marc, 17/08 : « quand je clique sur tous les trajets c'est l'ancienne map qui
    // apparaît, je veux pas ça » → Google d'abord. Marc, 20/08 : « je peux pas zoomer
    // ni me déplacer, inutile » → une carte VIVANTE (Maps JavaScript API), plus l'image
    // Static. CarteInteractive (OSM) reste câblée derrière : elle zoome aussi.
    const activite = readFileSync("app/activite/page.tsx", "utf8");
    expect(activite).toMatch(/CarteGoogleVivante/);
    expect(activite).toMatch(/CarteInteractive/);
  });

  it("l'accueil affiche EN CLAIR la dernière mise à jour des données", () => {
    // Marc, 17/08 : « je veux que ce soit indiqué clairement c'est quand la dernière
    // update » — un badge toujours visible, plus seulement une icône au tap.
    const accueil = readFileSync("app/page.tsx", "utf8");
    expect(accueil).toMatch(/<DerniereMaj instant=/);
  });
});

describe("commandes : appui maintenu, ZÉRO rechargement (Marc, 18/08)", () => {
  const schema = readFileSync("app/ui/SchemaInteractif.tsx", "utf8");
  const action = readFileSync("app/actions/commandes.ts", "utf8");

  it("le schéma passe par le bouton PARTAGÉ, il ne réimplémente pas l'appui", () => {
    // Le geste a été extrait le 19/08 pour être partagé avec la purge. Si quelqu'un le
    // recopiait ici, les deux copies divergeraient — et la durée du remplissage CSS,
    // verrouillée plus bas sur UNE constante, ne protégerait plus que l'une des deux.
    expect(schema).toContain("BoutonMaintenir");
    expect(schema, "l'appui ne se réimplémente pas ici").not.toMatch(/DUREE_APPUI_MS\s*=/);
  });

  it("l'action RETOURNE le résultat — plus de redirect ni de revalidatePath", () => {
    // « Je veux pas que ça refresh la page ni la carte » : un `redirect` rechargerait
    // TOUT, carte comprise, et un `revalidatePath` re-rendrait l'accueil sous la feuille.
    // On cherche les APPELS, pas les mentions : un commentaire a le droit de raconter
    // pourquoi ils ont disparu (même piège que le tripwire `.eyebrow`, déjà payé).
    expect(action).not.toMatch(/\bredirect\(/);
    expect(action).not.toMatch(/\brevalidatePath\(/);
    expect(action).toMatch(/export async function commanderInline/);
  });

  it("les gardes serveur restent AVANT l'envoi, dans l'ordre", () => {
    // L'appui long est une commodité de SAISIE : ce qui protège reste côté serveur.
    // Comparaison sur les APPELS — les imports sont groupés en tête, dans un ordre qui
    // n'a rien à voir avec celui de l'exécution.
    const iSession = action.indexOf("await requireSession()");
    const iCatalogue = action.indexOf("autoriserCommande({");
    const iEnvoi = action.indexOf("envoyerCommande({");
    expect(iSession).toBeGreaterThan(-1);
    expect(iCatalogue).toBeGreaterThan(iSession);
    expect(iEnvoi).toBeGreaterThan(iCatalogue);
  });

  it("la durée de l'appui et celle du remplissage CSS sont la même", () => {
    // Un remplissage plus court promettrait un envoi qui n'a pas encore eu lieu ; plus
    // long, il laisserait croire que le geste a échoué. Deux valeurs, un seul sens.
    //
    // ⚠️ La constante vit dans app/ui/BoutonMaintenir.tsx depuis le 19/08 : le geste a été
    // extrait pour être partagé avec la purge des données de test. L'invariant est
    // inchangé, seule son adresse a bougé — et c'est ce test qui l'a signalé au lieu de
    // laisser les deux durées diverger en silence.
    const bouton = readFileSync("app/ui/BoutonMaintenir.tsx", "utf8");
    const duree = bouton.match(/DUREE_APPUI_MS = (\d+)/)?.[1];
    expect(duree, "DUREE_APPUI_MS introuvable dans BoutonMaintenir.tsx").toBeDefined();
    expect(css).toMatch(
      new RegExp(
        `\\.maintenir\\.enfonce \\.maintenir-remplissage \\{[^}]*transition: width ${duree}ms`,
        "s",
      ),
    );
  });
});

describe("la zone parcourue de Tendances passe par Google (Marc, 18/08)", () => {
  it("Tendances tente Google, et REVIENT au tracé quand l'image échoue", () => {
    // « Dans zone parcourue dans l'onglet Tendances je vois juste le tracé, aucune carte. »
    //
    // ⚠️ Le repli ne suffisait pas à couvrir le VRAI cas (Marc, 20/08 : « ça marche
    // jamais »). Sans clé, on tombait bien sur le SVG ; mais AVEC une clé qui n'a pas la
    // Maps Static API activée, on affichait une image cassée dont le texte alternatif
    // récitait une consigne d'administration Google. Le repli doit se déclencher sur
    // l'ÉCHEC de l'image, pas seulement sur l'absence de clé — ce que seul le navigateur
    // peut constater, d'où le composant client.
    //
    // ⚠️ 20/08, suite : le repli ne doit pas être une IMAGE. « Je peux pas zoomer ni me
    // déplacer, inutile » vaut pour le repli autant que pour le rendu nominal — les DEUX
    // niveaux sont désormais interactifs (Google vivant, puis la carte CarAI sur tuiles
    // OSM). Aucun chemin ne peut redonner une carte figée.
    const tendances = readFileSync("app/tendances/page.tsx", "utf8");
    expect(tendances).toMatch(/CarteGoogleVivante/);
    expect(tendances, "le repli est la carte INTERACTIVE, pas une image").toMatch(
      /CarteInteractive/,
    );
    expect(
      tendances,
      "un nuage de relevés d'arrêt ne se relie pas par un trait",
    ).toMatch(/sansChemin/);

    const vivante = readFileSync("app/ui/CarteGoogleVivante.tsx", "utf8");
    expect(vivante, "le repli se déclenche sur l'échec du SDK, pas seulement sans clé").toMatch(
      /setEtat\("echec"\)/,
    );
    expect(
      vivante,
      "une clé refusée ne rejette RIEN : seul gm_authFailure le signale",
    ).toMatch(/gm_authFailure/);
    expect(vivante, "la carte vivante doit être un composant CLIENT").toMatch(/^"use client"/);
  });
});

describe("le titre de page est SEUL — plus de sur-titre (Marc, 17/08)", () => {
  // « enlève le hubperso.com · CarAI pour tout partout, juste un beau titre ». Le
  // sur-titre revenait facilement : les cinq pages ont chacune LEUR Coquille, et un
  // copier-coller d'une ancienne suffirait à le réintroduire sur une seule page.
  const pages = [
    "app/page.tsx",
    "app/activite/page.tsx",
    "app/tendances/page.tsx",
    "app/reglages/page.tsx",
    "app/donnees/page.tsx",
  ];

  it.each(pages)("%s n'affiche plus « hubperso.com · CarAI »", (f) => {
    expect(readFileSync(f, "utf8")).not.toMatch(/hubperso\.com · CarAI/);
  });

  it("la classe `eyebrow` est morte — retirée des pages ET du CSS", () => {
    for (const f of pages) {
      expect(readFileSync(f, "utf8"), `${f} réintroduit le sur-titre`).not.toMatch(/eyebrow/);
    }
    // La forme d'une RÈGLE, pas la simple mention : un commentaire du CSS a le droit de
    // raconter que `.eyebrow` a existé (même piège que le tripwire `pastille`, vécu 2×).
    expect(css).not.toMatch(/\.eyebrow\s*\{/);
  });

  it("le h1 porte sa barre d'accent dégradée — c'est elle qui fait « beau titre »", () => {
    expect(css).toMatch(/h1::after \{[^}]*background: var\(--degrade\)/s);
  });
});
