// tests/rejeu.test.ts — la réparation de l'incident du 18/08/2026, et son garde-fou.
//
// ══ CE QUI S'EST PASSÉ ═══════════════════════════════════════════════════════════════
// La migration 0005 supprimait l'historique des métriques « jamais valorisées ». Son SQL
// testait `value_numeric IS NULL AND value_text IS NULL` — en OUBLIANT `value_json`, où
// vivent les positions GPS, les pneus et les ouvrants. Toutes les positions ont été
// supprimées : plus un trajet à l'écran (« 1040 km roulés sans relevé de position »), et
// plus aucun prix de recharge (le prix vient du LIEU, donc d'une position).
//
// Le prédicat JUSTE existait déjà dans `ingest.ts`, à trois lignes de la définition
// amputée. C'est la leçon « une même règle tenue à deux endroits diverge, et le mauvais
// exemplaire gagne » — payée pour de vrai. D'où : UNE fonction (`porteValeur`), et les
// tripwires ci-dessous pour que le SQL ne puisse plus s'en écarter en silence.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { porteValeur } from "@/lib/smartcar/ingest";
import { BUDGET_PAGE_MS, LOT_REJEU } from "@/lib/smartcar/rejeu";
import { signauxDuRaw } from "@/lib/smartcar/rejeu";

describe("porteValeur — la définition UNIQUE de « cette ligne a une valeur »", () => {
  it("une position GPS (value_json seul) PORTE une valeur", () => {
    // LE cas de l'incident. Si ce test tombe, les positions redeviennent supprimables.
    expect(
      porteValeur({
        valueNumeric: null,
        valueText: null,
        valueJson: { latitude: 46.81, longitude: -71.2 },
      }),
    ).toBe(true);
  });

  it("un nombre ou un texte non vide portent une valeur", () => {
    expect(porteValeur({ valueNumeric: 0, valueText: null, valueJson: null })).toBe(true);
    expect(porteValeur({ valueNumeric: null, valueText: "true", valueJson: null })).toBe(true);
  });

  it("une ligne de STATUT pur (aucune des trois colonnes) n'en porte pas", () => {
    expect(porteValeur({ valueNumeric: null, valueText: null, valueJson: null })).toBe(false);
    expect(porteValeur({})).toBe(false);
    // Texte vide = pas une valeur : c'est ce que la migration entendait viser.
    expect(porteValeur({ valueNumeric: null, valueText: "", valueJson: null })).toBe(false);
  });
});

describe("TRIPWIRE — aucune migration ne supprime des mesures sans regarder value_json", () => {
  /**
   * ⚠️ LE COUPABLE, EXEMPTÉ EXPRÈS — et il doit le rester.
   *
   * `0005` porte le bug. On ne le CORRIGE pas, et ce n'est pas de la négligence : Drizzle
   * identifie une migration par le HASH de son contenu. Modifier ce fichier en ferait une
   * migration INCONNUE, que le migrateur appliquerait au prochain démarrage — donc qui
   * SUPPRIMERAIT LES DONNÉES UNE SECONDE FOIS, celles que le rejeu vient de restaurer.
   * Un fichier de migration déjà appliqué est de l'histoire : on l'exempte nommément, on
   * répare par du code neuf (`lib/smartcar/rejeu.ts`), et le garde protège la SUITE.
   */
  const EXEMPTEES = new Set(["0005_purge_signaux_sans_valeur.sql"]);
  const fichiers = readdirSync("drizzle").filter((f) => f.endsWith(".sql"));

  it("il y a bien des migrations à inspecter", () => {
    expect(fichiers.length).toBeGreaterThan(0);
  });

  it("l'exemption vise un fichier qui EXISTE (sinon elle ne protège plus rien)", () => {
    // Une exemption qui pointe un fichier renommé serait un trou silencieux.
    for (const nom of EXEMPTEES) expect(fichiers).toContain(nom);
  });

  it.each(fichiers)("%s : un DELETE sur vehicle_snapshots cite value_json", (nom) => {
    if (EXEMPTEES.has(nom)) return;
    const sql = readFileSync(`drizzle/${nom}`, "utf8");
    const supprime = /DELETE\s+FROM\s+"?vehicle_snapshots"?/i.test(sql);
    if (!supprime) return;
    // Une suppression qui juge « cette ligne est vide » DOIT regarder les trois colonnes.
    expect(
      /value_json/i.test(sql),
      `${nom} supprime des mesures sans considérer value_json — c'est le bug du 18/08`,
    ).toBe(true);
  });

  it("l'inventaire compte les valeurs sur les TROIS colonnes", () => {
    // Même règle, autre langage : ce SQL est la traduction de `porteValeur`. S'ils
    // divergent, /donnees masquerait les positions au lieu de les compter.
    const source = readFileSync("lib/vehicle/inventaire.ts", "utf8");
    const filtre = source.match(/COUNT\(\*\) FILTER \([\s\S]*?\)::int AS "nbValeurs"/)?.[0];
    expect(filtre, "le filtre nbValeurs est introuvable").toBeDefined();
    expect(filtre).toMatch(/value_numeric/);
    expect(filtre).toMatch(/value_text/);
    expect(filtre).toMatch(/value_json/);
  });
});

describe("signauxDuRaw — relire une livraison archivée", () => {
  it("trouve les signaux sous data.signals (la forme réelle de Smartcar)", () => {
    const raw = { eventType: "SIGNAL_UPDATED", data: { signals: [{ code: "a" }, { code: "b" }] } };
    expect(signauxDuRaw(raw)).toEqual([{ code: "a" }, { code: "b" }]);
  });

  it("tolère une enveloppe à plat", () => {
    expect(signauxDuRaw({ signals: [{ code: "a" }] })).toEqual([{ code: "a" }]);
  });

  it("rend null sur une enveloppe inconnue — la livraison est SAUTÉE, jamais devinée", () => {
    expect(signauxDuRaw(null)).toBeNull();
    expect(signauxDuRaw({})).toBeNull();
    expect(signauxDuRaw({ data: {} })).toBeNull();
    expect(signauxDuRaw("texte")).toBeNull();
  });
});

describe("le rejeu date les mesures de la livraison D'ORIGINE, jamais d'aujourd'hui", () => {
  it("passe `receivedAt` de la livraison comme repli de recordedAt", () => {
    // Un signal sans horodatage du véhicule retombe sur `recuLe`. Prendre `new Date()`
    // daterait d'aujourd'hui des mesures vieilles de semaines — une fraîcheur inventée,
    // et une courbe qui s'effondre sur l'instant du rejeu.
    const source = readFileSync("lib/smartcar/rejeu.ts", "utf8");
    expect(source).toMatch(/recuLe: ligne\.receivedAt/);
    expect(source, "un `new Date()` ici fabriquerait une fraîcheur").not.toMatch(
      /recuLe: new Date\(\)/,
    );
  });
});

describe("la reconstruction est AUTOMATIQUE — plus rien à cliquer (Marc, 18/08)", () => {
  it("l'accueil et Activité la déclenchent APRÈS la réponse, pas dedans", () => {
    // « Récupère tous les trajets et recharges et mets dans l'app » : le bouton demandait
    // une action. Le travail part maintenant seul, via after() — hors du chemin critique,
    // sinon chaque affichage paierait les secondes de la reconstruction.
    for (const page of ["app/page.tsx", "app/activite/page.tsx"]) {
      expect(readFileSync(page, "utf8"), `${page} ne déclenche pas la réparation`).toMatch(
        /reparerEnArrierePlan\(\)/,
      );
    }
    const auto = readFileSync("lib/reparationAuto.ts", "utf8");
    expect(auto).toMatch(/after\(/);
    // Un throw ici teinterait un écran qui, lui, fonctionne.
    expect(auto).toMatch(/catch/);
  });

  it("Réglages n'exige AUCUN geste : plus de formulaire de réparation", () => {
    const reglages = readFileSync("app/reglages/page.tsx", "utf8");
    expect(reglages).not.toMatch(/action=\{reparer\}/);
    expect(reglages, "l'état d'avancement reste affiché").toMatch(/rejeuFini/);
  });

  it("le budget de page reste sous la durée de vie d'une invocation", () => {
    // Un after() HÉRITE de la durée de vie de sa fonction (leçon JobAI : trois pages
    // tuées par « Task timed out »). 6 s laisse la marge du rendu ET de la réponse.
    expect(BUDGET_PAGE_MS).toBeLessThanOrEqual(8_000);
  });

  it("le lot reste petit — le budget se vérifie ENTRE deux lots", () => {
    // Un gros lot rendrait la borne grossière : c'est le dépassement qu'on éviterait mal.
    expect(LOT_REJEU).toBeLessThanOrEqual(100);
  });
});

describe("rejouerJusquAuBout — la boucle budgétée", () => {
  it("enchaîne les lots tant qu'il reste du temps, puis rend la main", () => {
    // Le contrat, lu dans le code : la boucle ne s'arrête QUE sur un lot incomplet
    // (la vraie fin) ou sur le budget (une pause, curseur gardé). Un compteur de tours
    // s'arrêterait au milieu en croyant avoir fini.
    const source = readFileSync("lib/smartcar/rejeu.ts", "utf8");
    const corps = source.slice(source.indexOf("export async function rejouerJusquAuBout"));
    expect(corps).toMatch(/if \(!r\.encore\)/);
    expect(corps).toMatch(/budgetMs/);
    // Curseur écrit à CHAQUE lot : une coupure ne doit pas faire recommencer de zéro.
    expect((corps.match(/ecrireConfig\(CLE_REJEU_CURSEUR/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("sort tout de suite quand la réparation est déjà terminée", () => {
    // C'est ce qui rend l'appel gratuit sur toutes les pages, pour toujours.
    const source = readFileSync("lib/smartcar/rejeu.ts", "utf8");
    const corps = source.slice(source.indexOf("export async function rejouerJusquAuBout"));
    expect(corps).toMatch(/if \(curseur === REJEU_TERMINE\) return null/);
  });
});
