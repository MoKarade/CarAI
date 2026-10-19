// tests/csv.test.ts — l'export est une surface d'EXÉCUTION, pas un dump (leçon JobAI).

import { describe, expect, it } from "vitest";
import { champCsv, documentCsv, ligneCsv } from "@/lib/csv";

describe("champCsv — neutralisation des formules", () => {
  it("préfixe une formule potentielle d'une apostrophe", () => {
    // `=SUM(A1:A9)` dans une cellule est ÉVALUÉ à l'ouverture par Excel, LibreOffice et
    // Google Sheets. Idem `@`, `+`, `-` en tête.
    expect(champCsv("=SUM(A1:A9)")).toBe('"\'=SUM(A1:A9)"');
    expect(champCsv("@import")).toBe('"\'@import"');
    expect(champCsv("+alerte")).toBe('"\'+alerte"');
    expect(champCsv("-cmd|calc")).toBe('"\'-cmd|calc"');
  });

  it("ne neutralise JAMAIS un nombre négatif — « -5.2 » est une donnée, pas une formule", () => {
    expect(champCsv("-5.2")).toBe('"-5.2"');
    expect(champCsv(-5.2)).toBe('"-5.2"');
    expect(champCsv("+12")).toBe('"+12"');
  });

  it("échappe les guillemets et garde les retours à la ligne dans la cellule", () => {
    expect(champCsv('dit "bonjour"')).toBe('"dit ""bonjour"""');
    expect(champCsv("ligne1\nligne2")).toBe('"ligne1\nligne2"');
  });

  it("null et undefined deviennent la cellule vide", () => {
    expect(champCsv(null)).toBe('""');
    expect(champCsv(undefined)).toBe('""');
  });
});

describe("documentCsv — un fichier pour tableur, pas pour parseur", () => {
  it("BOM UTF-8 en tête, CRLF, en-têtes puis lignes", () => {
    // BOM en ÉCHAPPEMENT explicite : un U+FEFF littéral dans un test est invisible, et
    // un éditeur peut le retirer sans que personne ne le voie (même piège que dans lib/csv).
    const doc = documentCsv(["a", "b"], [["x", 1]]);
    expect(doc.startsWith("\uFEFF")).toBe(true);
    expect(doc).toBe('\uFEFF"a","b"\r\n"x","1"\r\n');
  });

  it("ligneCsv assemble sans BOM — c'est ce que les pages suivantes du flux utilisent", () => {
    expect(ligneCsv(["x", null, 2])).toBe('"x","","2"');
    expect(ligneCsv(["x"]).startsWith("\uFEFF")).toBe(false);
  });
});
