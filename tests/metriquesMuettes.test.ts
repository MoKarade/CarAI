// tests/metriquesMuettes.test.ts — « supprime celles qui n'ont pas de data » (Marc, 19/08).
//
// La règle est simple et le piège est toujours le même : `value_json`. Une métrique dont les
// valeurs vivent UNIQUEMENT en JSON — position, pression des pneus, état des ouvrants —
// passe pour muette dès qu'on ne regarde que les colonnes numérique et texte. C'est
// exactement ce qu'a fait la migration 0005, et ce que 0006 ne doit pas refaire.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { estMuette } from "@/lib/vehicle/analyse";

const compte = (nbNumerique = 0, nbTexte = 0, nbJson = 0) => ({ nbNumerique, nbTexte, nbJson });

describe("estMuette", () => {
  it("désigne une métrique qui n'a JAMAIS rien livré", () => {
    expect(estMuette(compte())).toBe(true);
  });

  it("ne touche PAS une métrique qui ne vit qu'en JSON", () => {
    // Le cœur du test. Position, pneus, ouvrants : leurs valeurs sont dans value_json et
    // nulle part ailleurs. Les classer muettes les ferait disparaître de l'app.
    expect(estMuette(compte(0, 0, 120)), "les positions ne sont pas muettes").toBe(false);
  });

  it("ne touche pas une métrique numérique ni une métrique texte", () => {
    expect(estMuette(compte(42, 0, 0))).toBe(false);
    expect(estMuette(compte(0, 42, 0))).toBe(false);
  });

  it("une SEULE valeur suffit à sauver toute l'histoire de la métrique", () => {
    expect(estMuette(compte(1, 0, 0))).toBe(false);
    expect(estMuette(compte(0, 0, 1))).toBe(false);
  });
});

describe("migration 0006", () => {
  const brut = readFileSync("drizzle/0006_purge_metriques_muettes.sql", "utf8");
  // ⚠️ Les COMMENTAIRES sont retirés avant toute vérification. Sans ça, le test passait en
  // trouvant « value_json » dans l'en-tête explicatif alors que la clause SQL ne le testait
  // plus — prouvé par mutation le 19/08. Un tripwire qui lit un commentaire ne verrouille
  // rien : il verrouille la prose qui décrit le code, pas le code.
  const sql = brut
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");

  it("teste LES TROIS colonnes de valeur DANS LA CLAUSE, pas dans un commentaire", () => {
    // Sans `value_json`, la migration supprimerait l'historique des positions et des
    // pressions. C'est la faute de 0005, et elle ne se voit qu'après coup.
    for (const colonne of ["value_numeric", "value_text", "value_json"]) {
      expect(sql, `${colonne} doit être testée par le SQL lui-même`).toContain(colonne);
    }
  });

  it("supprime par MÉTRIQUE entière, jamais ligne à ligne", () => {
    // Un DELETE ligne à ligne retirerait les lignes vides d'une métrique VIVANTE — donc
    // l'information « la voiture a répondu sans valeur ce jour-là », qui est un fait.
    expect(sql).toMatch(/GROUP BY "metric_type"/);
    expect(sql).toMatch(/HAVING bool_and/);
  });

  it("est déclarée dans le journal Drizzle", () => {
    const journal = readFileSync("drizzle/meta/_journal.json", "utf8");
    expect(journal).toContain("0006_purge_metriques_muettes");
  });
});
