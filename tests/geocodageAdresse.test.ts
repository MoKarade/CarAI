// tests/geocodageAdresse.test.ts — le géocodage DIRECT (adresse → point).
//
// Ce qui compte ici n'est pas le chemin heureux : c'est que chaque échec dise LEQUEL. Une
// panne réseau et une adresse introuvable appellent des gestes OPPOSÉS — réessayer, ou
// corriger sa saisie. Les confondre enverrait Marc récrire une adresse parfaitement bonne.

import { describe, expect, it } from "vitest";
import { pointDeLAdresse, premierPoint } from "@/lib/geocodage";

const REPONSE_OK = {
  results: [
    {
      formatted_address: "1 rue Exemple, Ville-Exemple, QC",
      geometry: { location: { lat: 46.8139, lng: -71.208 } },
    },
  ],
};

const faux = (donnees: unknown, ok = true) =>
  (async () => ({ ok, json: async () => donnees })) as unknown as typeof fetch;

describe("premierPoint — lire la réponse sans se faire avoir", () => {
  it("prend le premier résultat exploitable", () => {
    expect(premierPoint(REPONSE_OK)).toEqual({
      lat: 46.8139,
      lng: -71.208,
      libelle: "1 rue Exemple, Ville-Exemple, QC",
    });
  });

  it("⚠️ REFUSE une coordonnée non numérique plutôt que de la convertir", () => {
    // `Number(null)` vaut 0, et 0,0 est un point valide au large de l'Afrique — le genre
    // de coordonnée fantôme que ce dépôt a déjà dû purger de sa base.
    const pourri = { results: [{ geometry: { location: { lat: null, lng: "-71" } } }] };
    expect(premierPoint(pourri)).toBeNull();
  });

  it("saute un résultat sans géométrie et prend le suivant", () => {
    const melange = { results: [{ formatted_address: "sans point" }, REPONSE_OK.results[0]] };
    expect(premierPoint(melange)?.lat).toBe(46.8139);
  });

  it("rend null sur tout ce qui n'est pas une réponse", () => {
    for (const rien of [null, undefined, 42, "texte", {}, { results: [] }, { results: "non" }]) {
      expect(premierPoint(rien), String(rien)).toBeNull();
    }
  });
});

describe("pointDeLAdresse — chaque échec porte sa raison", () => {
  it("trouve le point d'une adresse", async () => {
    const r = await pointDeLAdresse("1 rue Exemple", { cle: "k", fetchImpl: faux(REPONSE_OK) });
    expect(r).toEqual({
      ok: true,
      lat: 46.8139,
      lng: -71.208,
      libelle: "1 rue Exemple, Ville-Exemple, QC",
    });
  });

  it("sans clé : `sans-cle`, et AUCUN appel réseau", async () => {
    let appele = false;
    const espion = (async () => {
      appele = true;
      return { ok: true, json: async () => REPONSE_OK };
    }) as unknown as typeof fetch;
    const r = await pointDeLAdresse("1 rue Exemple", { cle: null, fetchImpl: espion });
    expect(r).toEqual({ ok: false, raison: "sans-cle" });
    expect(appele, "rien ne doit partir sans clé").toBe(false);
  });

  it("adresse vide : `introuvable`, sans déranger Google", async () => {
    let appele = false;
    const espion = (async () => {
      appele = true;
      return { ok: true, json: async () => REPONSE_OK };
    }) as unknown as typeof fetch;
    expect(await pointDeLAdresse("   ", { cle: "k", fetchImpl: espion })).toEqual({
      ok: false,
      raison: "introuvable",
    });
    expect(appele).toBe(false);
  });

  it("zéro résultat : `introuvable` — la saisie est à corriger", async () => {
    const r = await pointDeLAdresse("zzz", { cle: "k", fetchImpl: faux({ results: [] }) });
    expect(r).toEqual({ ok: false, raison: "introuvable" });
  });

  it("HTTP en échec : `panne` — l'adresse, elle, est peut-être bonne", async () => {
    const r = await pointDeLAdresse("1 rue Exemple", { cle: "k", fetchImpl: faux({}, false) });
    expect(r).toEqual({ ok: false, raison: "panne" });
  });

  it("réseau qui lève : `panne`, et rien ne remonte à l'appelant", async () => {
    const casse = (async () => {
      throw new Error("réseau");
    }) as unknown as typeof fetch;
    const r = await pointDeLAdresse("1 rue Exemple", { cle: "k", fetchImpl: casse });
    expect(r).toEqual({ ok: false, raison: "panne" });
  });

  it("⚠️ `panne` et `introuvable` ne se confondent JAMAIS", async () => {
    const panne = await pointDeLAdresse("a", { cle: "k", fetchImpl: faux({}, false) });
    const vide = await pointDeLAdresse("a", { cle: "k", fetchImpl: faux({ results: [] }) });
    expect(panne).not.toEqual(vide);
  });
});
