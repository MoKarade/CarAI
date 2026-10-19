// tests/reglagesMobile.test.ts — « les formulaires sont pénibles » (Marc, 13/09).
//
// Mesuré au banc Chromium avant de toucher quoi que ce soit, à 360 et 390 px, avec le vrai
// `globals.css` et le balisage de `app/reglages/*.tsx` — et validé d'abord sur un témoin
// connu (la barre du bas, 54,1 px depuis le lot 2) :
//
//   • 12 des 14 cibles de l'écran sous 44 px — champs du contrat à 42 (deux de trop),
//     « Enregistrer » à 43,6 (quatre DIXIÈMES de trop), champs d'ajout de lieu à 21,
//     sélecteur à 29,6, « Retirer » à 25,6 ;
//   • TROIS champs sous 16 px (13,3 et 14,1) ;
//   • page de 2 006 px de haut.
//
// Après : 0 cible sous 44 px, 0 champ sous 16 px, et −321 px de page grâce au repli.
//
// ⚠️ LE POINT QUI COMPTE LE PLUS NE SE VOIT SUR AUCUNE CAPTURE. Sous 16 px, iOS ZOOME tout
// seul quand on met un champ au point : on tape un tarif, la page saute, on la recadre à la
// main. C'est ça, « pénible » — et une capture d'écran d'un champ à 13 px est parfaitement
// lisible. Seule la mesure le trouve, d'où cette garde plutôt qu'un coup d'œil.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blocTelephone, horsMediaQueries, regleCss, sansCommentairesCss } from "./aides/css";
import {
  CONTROLES_DE_SAISIE,
  controlesEmployes,
  couvertureMobile,
  porteesDeLaClasse,
  sansCommentairesJsx,
} from "./aides/controles";
import { fichiersTsx } from "./aides/fichiers";

const css = sansCommentairesCss(readFileSync("app/globals.css", "utf8"));
const grandEcran = horsMediaQueries(css);
// ⚠️ `blocTelephone` plutôt que `css.slice(indexOf(…))` — la ligne 81 de ce fichier
// disait déjà que la tranche était « une approximation », et le 18/09/2026 elle a cessé
// d'approcher : migrer `.panneau-etat` vers 700px a fait remonter le premier bloc
// téléphone de 2 600 lignes, et la tranche s'est mise à contenir le CSS de base. Un
// lecteur exact existait à côté ; il est maintenant employé partout dans ce fichier.
const mobile = blocTelephone(css);
const page = readFileSync("app/reglages/page.tsx", "utf8");

/** Le bloc de déclarations qui suit un sélecteur, dans la portée donnée. PURE. */
function regle(source: string, selecteur: string): string {
  const i = source.indexOf(selecteur);
  if (i === -1) return "";
  const ouvrante = source.indexOf("{", i);
  return ouvrante === -1 ? "" : source.slice(ouvrante, source.indexOf("}", ouvrante));
}

describe("les lectures ne sont pas vides", () => {
  it("le CSS se sépare bien en deux, et la page se lit", () => {
    // Anti-vacuité : sans ça, chaque « la règle n'est pas ailleurs » se prouverait à partir
    // de « il n'y a plus rien à lire ».
    expect(grandEcran.length).toBeGreaterThan(20_000);
    expect(mobile.length).toBeGreaterThan(2_000);
    expect(css.length).toBeGreaterThan(grandEcran.length);
    expect(page).toContain("export default async function");
  });
});

describe("les champs se tapent, et iOS ne zoome pas", () => {
  it("les champs et boutons de l'écran portent 44 px ET une police de 1rem", () => {
    const bloc = regle(mobile, ".reglages input,");
    expect(bloc, "règle des champs absente du bloc mobile").not.toBe("");
    expect(bloc).toContain("min-height: 44px");
    // ⚠️ C'est CETTE ligne qui empêche le zoom d'iOS. Sans elle, les cibles seraient à la
    // bonne taille et la saisie resterait pénible — deux défauts distincts qu'un seul
    // sélecteur corrige, et qu'il faut donc garder tous les deux.
    expect(bloc, "sans police de 1rem, iOS zoome à la mise au point").toContain(
      "font-size: 1rem",
    );
  });

  it("les trois cibles HORS formulaire sont couvertes", () => {
    // Elles ne relèvent pas de la garde de FAMILLE (plus bas) : ce ne sont pas des
    // contrôles d'un conteneur de formulaire, mais un lien déguisé en bouton, le résumé
    // d'un bloc replié et les trois pastilles de santé — des cibles qu'on tape et
    // qu'aucun recensement d'`<input>` ou de `<button>` ne trouverait.
    expect(regle(mobile, ".lien-bouton {")).toContain("min-height: 44px");
    expect(regle(mobile, ".replie > summary {")).toContain("min-height: 44px");

    // ⚠️ LES PASTILLES DE SANTÉ SONT RONDES, donc `min-height` NE LES TOUCHE PAS : leur
    // taille vient de `width`/`height: 2.5rem`, soit 40 x 40 px — mesuré le 14/09 sur le
    // CSS SERVI EN PRODUCTION, aux trois largeurs. Les DEUX dimensions se reprennent.
    //
    // ⚠️ Et la lecture se fait sur `blocTelephone`, pas sur `mobile` : `mobile` est une
    // TRANCHE qui part du premier `@media` et contient donc aussi la règle de BASE de ces
    // pastilles, écrite plus loin dans le fichier. Une garde qui lirait la mauvaise des
    // deux passerait quoi qu'il arrive.
    const pastille = regleCss(blocTelephone(css), ".indicateur > summary");
    expect(pastille, "aucune règle mobile pour les pastilles de santé").not.toBeNull();
    expect(pastille).toContain("width: 44px");
    expect(pastille).toContain("height: 44px");
  });

  it("aucune de ces règles n'atteint le GRAND écran", () => {
    // Le desktop a été prouvé identique au banc (60 boîtes, 0 écart, même hauteur). Ce qui
    // le garantit dans la durée, c'est que ces règles restent dans leur media query.
    expect(regle(grandEcran, ".reglages input,")).toBe("");
    expect(regle(grandEcran, ".lien-bouton {")).not.toContain("min-height");
    // Les pastilles gardent leurs 2,5 rem sur grand écran : mesuré à 1280 px, 108 boîtes,
    // 0 écart, hauteur de page identique au pixel.
    expect(regle(grandEcran, ".indicateur > summary {")).toContain("2.5rem");
  });
});

describe("la garde de FAMILLE — aucun type de contrôle oublié", () => {
  // ⚠️ POURQUOI DÉRIVER DU CODE PLUTÔT QU'ÉNUMÉRER À LA MAIN.
  //
  // Ce fichier a longtemps vérifié une LISTE écrite à la main — « `.reglages button`,
  // `.form-lieu input`, `.form-lieu select` et `.form-lieu button` figurent bien dans la
  // règle ». Deux choses l'ont condamnée, et la seconde est la vraie.
  //
  // 1. Elle a rougi À TORT le 14/09 : elle repérait sa règle par son CORPS, et le lot
  //    Données venait d'écrire `.filtres select { min-height: 44px; font-size: 1rem }` —
  //    corps IDENTIQUE, 198 caractères plus haut dans le fichier. Un corps n'est pas une
  //    identité.
  // 2. Une liste écrite à la main ne sait rien de ce que l'écran gagnera demain. C'est
  //    exactement le défaut que le lot Données a trouvé chez lui : le bloc mobile portait
  //    `.filtres input[type="date"]`, `.filtres button` et `.filtres a` — écrits pour le
  //    sélecteur de fenêtre —, et le formulaire de Données, qui n'est QUE des menus
  //    déroulants, était resté à 29,6 px de haut et 14,1 px de police, juste à côté de
  //    contrôles parfaitement dimensionnés.
  //
  // MESURÉ ICI le 14/09 : `.reglages` n'emploie AUCUN menu déroulant (que des `<input>`
  // et le bouton d'enregistrement), et la règle n'en porte donc pas. Le jour où le
  // formulaire du contrat en reçoit un, il naîtra à 29,6 px — et c'est CE test qui
  // rougira, au lieu que Marc le découvre sous les néons d'un stationnement.

  const parConteneur = new Map<string, Set<string>>();
  for (const classe of ["reglages", "form-lieu"]) {
    const portees = fichiersTsx("app").flatMap((f) =>
      porteesDeLaClasse(sansCommentairesJsx(readFileSync(f, "utf8")), classe),
    );
    parConteneur.set(classe, controlesEmployes(portees));
  }
  // Le bouton « Enregistrer » vit dans l'enveloppe client `FormulaireReglages` (carte 1 du
  // 15/10), hors de la portée lue dans la page : on le compte ici, sinon la garde
  // « bouton » de `.reglages` ne vérifierait plus rien.
  expect(readFileSync("app/reglages/FormulaireReglages.tsx", "utf8")).toContain(
    '<button type="submit"',
  );
  parConteneur.get("reglages")!.add("button");

  it("le bornage de la portée s'arrête à la balise fermante", () => {
    // Anti-vacuité DISCRIMINANTE, dans les deux sens. Le formulaire est suivi de trois
    // blocs repliés (purge, connecteur MCP, journal) : une portée « jusqu'à la fin du
    // fichier » les avalerait et exigerait un jour `.reglages a` pour un lien qui n'est
    // pas dans le formulaire. Une portée vide, elle, rendrait toute la garde muette.
    const [portee] = porteesDeLaClasse(
      sansCommentairesJsx(readFileSync("app/reglages/page.tsx", "utf8")),
      "reglages",
    );
    expect(portee, "la portée de `.reglages` est introuvable").toBeDefined();
    expect(portee, "le formulaire du contrat n'est pas dans la portée").toContain(
      'name="tarifKwh"',
    );
    expect(portee, "la portée déborde sur les blocs repliés qui SUIVENT le formulaire")
      .not.toContain("Connecteur MCP");
  });

  it("le recensement trouve les contrôles des deux conteneurs", () => {
    // Borne INFÉRIEURE, volontairement : figer la liste exacte ferait rougir ce test-ci
    // le jour d'un ajout, alors que le seul rouge utile est celui de la couverture, qui
    // nomme le type non couvert. Un formulaire sans champ ni bouton n'existe pas — ces
    // deux-là sont donc un plancher qui ne se périme pas.
    expect([...parConteneur.get("reglages")!].sort()).toEqual(
      expect.arrayContaining(["button", "input"]),
    );
    expect([...parConteneur.get("form-lieu")!].sort()).toEqual(
      expect.arrayContaining(["button", "input", "select"]),
    );
  });

  it("le bloc téléphone couvre CHAQUE type employé, hauteur ET police", () => {
    for (const [classe, employes] of parConteneur) {
      for (const balise of employes) {
        const c = couvertureMobile(blocTelephone(css), classe, balise);
        expect(c.regles, `aucune règle mobile pour \`.${classe} ${balise}\``)
          .toBeGreaterThan(0);
        expect(c.hauteur, `\`.${classe} ${balise}\` n'atteint pas 44 px`).toBe(true);
        // La police n'a de sens que là où l'on SAISIT : c'est elle qui décide du zoom
        // automatique d'iOS, pas la taille de la cible. Un `<button>` ou un `<a>` n'a
        // pas de mise au point qui zoome.
        if ((CONTROLES_DE_SAISIE as readonly string[]).includes(balise)) {
          expect(c.police, `\`.${classe} ${balise}\` fera zoomer iOS`).toBe(true);
        }
      }
    }
  });
});

describe("les blocs rares sont repliés", () => {
  it("les trois vivent dans un <details> de la classe PARTAGÉE", () => {
    // `.replie` existait déjà (Tendances, 13/08) et son commentaire décrit ce besoin mot
    // pour mot. Mon premier jet créait une classe jumelle : c'est le genre de doublon qui
    // ne casse rien et qui fait diverger deux styles en trois mois.
    expect(page.match(/className="replie"/g) ?? []).toHaveLength(3);
    for (const titre of ["Purge du véhicule de test", "Connecteur MCP", "Dernières commandes"]) {
      expect(page, `${titre} n'est pas dans un résumé`).toMatch(
        new RegExp(`<summary>[\\s\\S]{0,120}${titre}`),
      );
    }
  });

  it("ce qu'on vient chercher reste DÉPLIÉ", () => {
    // Le repli ne doit pas avaler le formulaire du contrat ni les lieux : c'est pour eux
    // qu'on ouvre cet écran. Une garde qui ne vérifie que « ça se replie » serait contente
    // d'un écran entièrement replié.
    const avantPremierRepli = page.slice(0, page.indexOf('className="replie"'));
    expect(avantPremierRepli).toContain('className="reglages"');
    expect(avantPremierRepli).toContain("<LieuxDeRecharge />");
  });
});

describe("le bandeau du tarif manquant", () => {
  it("ne s'affiche que tant que le tarif manque", () => {
    // Un avertissement permanent est un avertissement mort : celui-ci est conditionné à
    // l'absence, donc il disparaît de lui-même quand le champ est rempli.
    expect(page).toContain("depart.tarifKwh === undefined && (");
    expect(page).toContain('className="bandeau-manque"');
    expect(regle(css, ".bandeau-manque {")).toContain("border-left");
  });

  it("la page n'affirme plus ce que l'app a cessé de faire", () => {
    // Le texte promettait « — au lieu d'un chiffre inventé » et l'en-tête « aucune valeur
    // par défaut n'est INVENTÉE ». Depuis « signalé mais tout estimé », c'est faux : une
    // recharge sans tarif est chiffrée à un ordre de grandeur. Une doc qui décrit l'inverse
    // du code est pire qu'une absence de doc — et elle ne rougit nulle part.
    expect(page).not.toContain("au lieu d’un chiffre inventé");
    expect(page).not.toContain("les recharges restent en kWh sans montant");
  });
});
