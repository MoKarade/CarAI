// tests/montants.test.ts — l'irritant n° 1 de Marc, le 15/09 : « le 20 $ + ~30 $ ».
//
// Deux montants collés dans la valeur d'une tuile, sur l'accueil ET sur Activité, écrits
// deux fois. Les FONDRE en un seul total était exclu : `totaliserPrix` l'interdit, et sur
// un jeu typique (20 $ mesurés, 30 $ estimés) l'estimé pèse 60 % du tout
// — un « 50 $ » unique serait donc à 60 % une supposition présentée comme une dépense.
// La lisibilité vient de la MISE EN PAGE, et c'est ce que ce fichier verrouille.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { estimeLibelle } from "../lib/vehicle/montants";
import { regleCss, sansCommentairesCss } from "./aides/css";

const css = sansCommentairesCss(readFileSync("app/globals.css", "utf8"));
/** Le source privé de ses commentaires — les nôtres CITENT le motif interdit. */
const sansCommentaires = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("qui porte la valeur de la tuile", () => {
  it("le MESURÉ porte la tuile, l'estimé descend d'une ligne", () => {
    expect(estimeLibelle({ mesure: 20, estime: 30 })).toEqual({
      principal: 20,
      tildePrincipal: false,
      secondaire: 30,
    });
  });

  it("sans estimé, un seul chiffre et pas de seconde ligne", () => {
    expect(estimeLibelle({ mesure: 12, estime: 0 })).toEqual({
      principal: 12,
      tildePrincipal: false,
      secondaire: null,
    });
  });

  it("⚠️ QUE de l'estimé : c'est LUI qui porte la tuile, avec son tilde", () => {
    // Sinon la tuile afficherait « 0 $ » sur un mois où Marc a bel et bien rechargé —
    // faux dans l'autre sens, et plus difficile à repérer qu'un chiffre trop gros.
    expect(estimeLibelle({ mesure: 0, estime: 30 })).toEqual({
      principal: 30,
      tildePrincipal: true,
      secondaire: null,
    });
  });

  it("rien du tout rend null — c'est à l'appelant de dire « 0 $ » ou « — »", () => {
    // L'accueil distingue « aucune session » de « des sessions sans prix » : il a le
    // compte, pas ce module.
    expect(estimeLibelle({ mesure: 0, estime: 0 }).principal).toBeNull();
  });

  it("les deux montants ne sont JAMAIS additionnés", () => {
    const r = estimeLibelle({ mesure: 20, estime: 30 });
    // La somme des deux vaudrait 50 : elle n'apparaît NULLE PART dans ce que le module rend.
    expect(r.principal).toBe(20);
    expect(r.secondaire).toBe(30);
    expect([r.principal, r.secondaire]).not.toContain(50);
  });
});

describe("l'irritant ne peut pas revenir", () => {
  it("aucun écran ne recolle deux montants dans une valeur de tuile", () => {
    // Le motif exact de la forme retirée : `dollars(x)` suivi d'un « + » puis d'un `~`.
    for (const fichier of ["app/page.tsx", "app/activite/page.tsx"]) {
      const src = sansCommentaires(readFileSync(fichier, "utf8"));
      expect(src, `${fichier} recolle un montant estimé à un montant mesuré`).not.toMatch(
        /\$\{.*dollars\(.*\).*\}.*\+.*~/,
      );
    }
  });

  it("le formateur de montants ne vit plus qu'à UN endroit", () => {
    // Il était défini dans les deux écrans, mot pour mot. Une règle tenue à deux endroits
    // est une règle et demie : le jour où l'un passe à trois décimales, l'autre non.
    for (const fichier of ["app/page.tsx", "app/activite/page.tsx"]) {
      const src = sansCommentaires(readFileSync(fichier, "utf8"));
      expect(src, `${fichier} redéfinit \`dollars\``).not.toMatch(/const dollars\s*=/);
      expect(src).toContain('from "@/app/ui/Montant"');
    }
  });
});

describe("les surfaces neuves ont leur style", () => {
  it("la part estimée a sa propre ligne, plus petite et en texte faible", () => {
    const r = regleCss(css, ".tuile-estime");
    expect(r, "`.tuile-estime` n'existe pas — la seconde ligne serait invisible").not.toBeNull();
    expect(r).toContain("font-size");
    expect(r).toContain("var(--texte-faible)");
  });

  it("le détail des recharges est une LISTE, pas un tableau", () => {
    // Quatre champs dont deux longs ne tiennent pas en colonnes à 360 px, et le lot
    // Données a mesuré ce que coûte un tableau qui déborde.
    expect(regleCss(css, ".liste-sessions")).not.toBeNull();
    expect(regleCss(css, ".liste-sessions li")).toContain("grid");
  });
});
