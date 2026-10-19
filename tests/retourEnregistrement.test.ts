// tests/retourEnregistrement.test.ts — le bouton « Enregistrer » des Réglages DIT ce qui
// s'est passé (carte 1 du 15/10). Avant : la réponse du serveur était perdue, et l'action
// recevait le formulaire à la place de son état précédent.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FormulaireReglages,
  RetourEnregistrement,
} from "@/app/reglages/FormulaireReglages";

const rendre = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("RetourEnregistrement", () => {
  it("ne montre rien avant le premier envoi", () => {
    const html = rendre(
      createElement(RetourEnregistrement, {
        etat: { statut: "vierge", messages: [] },
      }),
    );
    expect(html).not.toContain("cl-message");
  });

  it("montre le succès en vert", () => {
    const html = rendre(
      createElement(RetourEnregistrement, {
        etat: { statut: "ok", messages: ["Réglages enregistrés."] },
      }),
    );
    expect(html).toContain("cl-message ok");
    expect(html).toContain("Réglages enregistrés.");
  });

  it("montre chaque erreur en rouge", () => {
    const html = rendre(
      createElement(RetourEnregistrement, {
        etat: { statut: "erreur", messages: ["Durée invalide.", "Date absente."] },
      }),
    );
    expect(html).toContain("cl-message erreur");
    expect(html).toContain("Durée invalide.");
    expect(html).toContain("Date absente.");
  });
});

describe("FormulaireReglages", () => {
  it("affiche le bouton « Enregistrer » et le contenu du formulaire", () => {
    const html = rendre(
      createElement(
        FormulaireReglages,
        {
          action: async () => ({ statut: "ok" as const, messages: [] }),
        },
        createElement("input", { name: "tarifKwh" }),
      ),
    );
    expect(html).toContain("Enregistrer");
    expect(html).toContain('name="tarifKwh"');
    expect(html).not.toContain("Enregistrement…");
  });
});
