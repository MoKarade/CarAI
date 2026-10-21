// tests/nommerLieu.test.ts — CarAI#8 : nommer après coup le lieu d'une recharge inconnue.
//
// Avant : une recharge « lieu inconnu » se nommait en recréant le lieu à la main dans Réglages.
// Après : le geste part de la ligne, avec la position de la recharge. Ces tests couvrent la
// règle (recharge sans lieu, avec tarif, sans tarif, lieu voisin, nom déjà pris) ET ce qu'elle
// change pour le prix — le tarif saisi fait passer une estimation à une mesure, un nom seul
// ne change rien au prix.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SchemaLieu, SchemaLieux, type Lieu } from "@/lib/config";
import { ajouterLieuNomme, RAYON_NOMME_M } from "@/lib/vehicle/nommerLieu";
import { lieuDeLaPosition, prixSession } from "@/lib/vehicle/tarifsBornes";

// Points FICTIFS de la liste blanche de tests/donneesPerso.test.ts.
const BORNE = { lat: 48.35, lng: -77.77 };
const AILLEURS = { lat: 47.7, lng: -77.4 };

const MAISON: Lieu = { nom: "Maison", lat: 48.2, lng: -78.0, rayonM: 120, mode: "kwh", tarif: 0.078 };

const session = { dureeMinutes: 180, energieKwh: 25.7, tarifKwh: 0.078, bornesEstimees: true };

describe("ajouterLieuNomme — le lieu s'ajoute à la liste de Réglages", () => {
  it("recharge sans lieu connu, sans tarif : le lieu est ajouté avec son nom seulement", () => {
    const r = ajouterLieuNomme([], { ...BORNE, nom: "  Borne du centre " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lieux).toHaveLength(1);
    expect(r.lieux[0]).toEqual({ nom: "Borne du centre", ...BORNE, rayonM: RAYON_NOMME_M });
    // Pas de tarif inventé : ni mode ni montant.
    expect(r.lieux[0]).not.toHaveProperty("tarif");
    expect(r.lieux[0]).not.toHaveProperty("mode");
    expect(r.message).toContain("le coût reste une estimation");
  });

  it("avec un tarif : le lieu est tarifé, mode compris", () => {
    const r = ajouterLieuNomme([MAISON], { ...BORNE, nom: "Borne", mode: "kwh", tarif: 0.15 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lieux).toHaveLength(2);
    expect(r.lieux[0]).toEqual(MAISON); // l'existant n'est pas touché
    expect(r.lieux[1]).toMatchObject({ nom: "Borne", mode: "kwh", tarif: 0.15 });
  });

  it("un tarif de 0 est un vrai tarif (borne gratuite), pas une absence de tarif", () => {
    const r = ajouterLieuNomme([], { ...BORNE, nom: "Gratuite", mode: "kwh", tarif: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lieux[0]).toMatchObject({ mode: "kwh", tarif: 0 });
  });

  it("refuse un nom déjà pris, sans tenir compte de la casse (Retirer désigne par le nom)", () => {
    const r = ajouterLieuNomme([MAISON], { ...BORNE, nom: "maison" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain("déjà");
  });

  it("refuse un nom vide, une position inconnue, un tarif sans mode, un tarif illisible", () => {
    expect(ajouterLieuNomme([], { ...BORNE, nom: "   " }).ok).toBe(false);
    expect(ajouterLieuNomme([], { lat: NaN, lng: NaN, nom: "X" }).ok).toBe(false);
    const sansMode = ajouterLieuNomme([], { ...BORNE, nom: "X", tarif: 1 });
    expect(sansMode.ok).toBe(false);
    if (!sansMode.ok) expect(sansMode.erreur).toContain("heure ou au kWh");
    expect(ajouterLieuNomme([], { ...BORNE, nom: "X", mode: "kwh", tarif: NaN }).ok).toBe(false);
    // Un tarif négatif est refusé par le schéma, et le refus se dit.
    const negatif = ajouterLieuNomme([], { ...BORNE, nom: "X", mode: "kwh", tarif: -1 });
    expect(negatif.ok).toBe(false);
    if (!negatif.ok) expect(negatif.erreur).toMatch(/^Refusé/);
  });

  it("un lieu voisin n'empêche pas l'ajout, mais la réponse le dit (le plus proche gagne)", () => {
    // La maison est à ~170 m : hors de son rayon de 120 m (la recharge était donc « inconnue »),
    // mais assez près pour que les deux cercles se chevauchent.
    const maison170 = { ...MAISON, lat: BORNE.lat + 0.00153, lng: BORNE.lng };
    const r = ajouterLieuNomme([maison170], { ...BORNE, nom: "Borne" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lieux).toHaveLength(2);
    expect(r.message).toContain("« Maison » est tout près");
    // Un lieu lointain ne déclenche aucune mention.
    const loin = ajouterLieuNomme([MAISON], { ...BORNE, nom: "Borne" });
    expect(loin.ok && loin.message.includes("tout près")).toBe(false);
  });

  it("rend toujours une liste que le schéma accepte (jamais un lieu à moitié bon)", () => {
    const r = ajouterLieuNomme([MAISON], { ...BORNE, nom: "Borne", mode: "horaire", tarif: 1 });
    expect(r.ok && SchemaLieux.safeParse(r.lieux).success).toBe(true);
  });
});

describe("SchemaLieu — le tarif est facultatif, mais le mode et le tarif vont ensemble", () => {
  const base = { nom: "X", lat: 48.35, lng: -77.77, rayonM: 120 };
  it("accepte un lieu sans tarif, et les lieux déjà enregistrés (mode + tarif)", () => {
    expect(SchemaLieu.safeParse(base).success).toBe(true);
    expect(SchemaLieu.safeParse({ ...base, mode: "horaire", tarif: 1 }).success).toBe(true);
  });
  it("refuse un mode sans tarif et un tarif sans mode", () => {
    expect(SchemaLieu.safeParse({ ...base, mode: "kwh" }).success).toBe(false);
    expect(SchemaLieu.safeParse({ ...base, tarif: 1 }).success).toBe(false);
  });
});

describe("ce que le nommage change pour la recharge", () => {
  const sansTarif = ajouterLieuNomme([], { ...BORNE, nom: "Borne" });
  const avecTarif = ajouterLieuNomme([], { ...BORNE, nom: "Borne", mode: "kwh", tarif: 0.15 });

  it("les recharges au même endroit prennent le nom ; ailleurs, rien", () => {
    if (!sansTarif.ok) throw new Error("préparation");
    expect(lieuDeLaPosition(BORNE, sansTarif.lieux)?.nom).toBe("Borne");
    // « Les suivantes au même endroit » : à quelques mètres, dans le rayon.
    expect(lieuDeLaPosition({ lat: BORNE.lat + 0.0003, lng: BORNE.lng }, sansTarif.lieux)?.nom).toBe("Borne");
    expect(lieuDeLaPosition(AILLEURS, sansTarif.lieux)).toBeNull();
  });

  it("sans tarif : le nom s'affiche, le coût reste exactement celui d'un lieu inconnu", () => {
    if (!sansTarif.ok) throw new Error("préparation");
    const lieu = lieuDeLaPosition(BORNE, sansTarif.lieux);
    const nomme = prixSession({ ...session, lieu });
    const inconnu = prixSession({ ...session, lieu: null });
    expect(nomme).toEqual(inconnu);
    expect(nomme.qualite).toBe("estime");
  });

  it("avec un tarif au kWh : le coût passe de « estimation » à « mesure », source dite", () => {
    if (!avecTarif.ok) throw new Error("préparation");
    const lieu = lieuDeLaPosition(BORNE, avecTarif.lieux);
    const avant = prixSession({ ...session, lieu: null });
    const apres = prixSession({ ...session, lieu });
    expect(avant.qualite).toBe("estime");
    expect(apres.qualite).toBe("mesure");
    expect(apres.montant).toBeCloseTo(25.7 * 0.15, 5);
    expect(apres.explication).toContain("Borne");
    expect(apres.explication).toContain("0.150 $/kWh");
  });

  it("avec un tarif horaire et des bornes estimées : reste un plafond, et le dit (règle du 17/09)", () => {
    const r = ajouterLieuNomme([], { ...BORNE, nom: "Borne", mode: "horaire", tarif: 1 });
    if (!r.ok) throw new Error("préparation");
    const p = prixSession({ ...session, lieu: lieuDeLaPosition(BORNE, r.lieux) });
    expect(p.qualite).toBe("estime");
    expect(p.explication).toContain("AU PLUS");
  });
});

describe("la Server Action revérifie la session (une action est une route publique)", () => {
  const source = readFileSync("app/activite/actions.ts", "utf8");
  it("requireSession() vient avant toute lecture ou écriture de la config", () => {
    const session = source.indexOf("await requireSession()");
    expect(session).toBeGreaterThan(-1);
    expect(session).toBeLessThan(source.indexOf("await lireLieux()"));
    expect(session).toBeLessThan(source.indexOf("await ecrireConfig("));
  });
  it("le formulaire ne s'affiche que pour une recharge sans lieu ET avec une position", () => {
    const page = readFileSync("app/activite/page.tsx", "utf8");
    expect(page).toMatch(/nomLieu === null && position !== null/);
  });
});
