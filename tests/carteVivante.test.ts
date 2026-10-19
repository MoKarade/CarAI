// tests/carteVivante.test.ts — la carte Google VIVANTE (Maps JavaScript API).
//
// Marc, 20/08 : « carte je peux pas zoomer ni me déplacer, inutile ». Ce qui se teste ici
// est la partie PURE : l'URL du SDK (dont un paramètre manquant casse le chargement en
// silence) et les règles d'HONNÊTETÉ du rendu, qui survivent au changement d'API.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CALLBACK_SDK,
  MARQUEUR_DERNIER,
  MARQUEUR_RELEVE,
  MAX_MARQUEURS,
  TRACE_VIVANTE,
  echantillonner,
  urlSdkMaps,
} from "@/lib/carteVivante";

describe("urlSdkMaps — ce que Google EXIGE, et pourquoi", () => {
  const url = () => new URL(urlSdkMaps({ cle: "CLÉ+À/ENCODER", callback: CALLBACK_SDK }));

  it("porte la clé ENCODÉE et vise bien le SDK", () => {
    const u = url();
    expect(u.origin + u.pathname).toBe("https://maps.googleapis.com/maps/api/js");
    expect(u.searchParams.get("key")).toBe("CLÉ+À/ENCODER");
    // La clé passe par URLSearchParams : `+` et `/` DOIVENT être encodés dans la chaîne
    // brute, sinon Google reçoit une autre clé et répond « InvalidKey ».
    expect(u.search).not.toContain("CLÉ+À/ENCODER");
  });

  it("déclare `loading=async` ET un `callback` — l'un sans l'autre casse", () => {
    // Google impose `loading=async` depuis 2023 ; avec lui, le SEUL signal de disponibilité
    // est le `callback`. Sans callback, le script se charge et rien ne dit quand il est
    // prêt : l'écran resterait vide sans la moindre erreur.
    const u = url();
    expect(u.searchParams.get("loading")).toBe("async");
    expect(u.searchParams.get("callback")).toBe(CALLBACK_SDK);
  });

  it("parle français, cadre le Canada, et ne charge aucune bibliothèque en trop", () => {
    const u = url();
    expect(u.searchParams.get("language")).toBe("fr");
    expect(u.searchParams.get("region")).toBe("CA");
    expect(u.searchParams.get("v")).toBe("weekly");
    // Marqueurs et polylignes sont dans le noyau : une `libraries=` serait du poids
    // téléchargé pour rien, à chaque ouverture de la page.
    expect(u.searchParams.get("libraries")).toBeNull();
  });
});

describe("honnêteté du rendu — les règles survivent au changement d'API", () => {
  it("le trait reste SEMI-TRANSPARENT et fin", () => {
    // ⚠️ Un trait entre deux relevés n'est PAS une route mesurée : la bZ ne publie sa
    // position qu'à l'arrêt. L'image statique le disait par un alpha ; la carte vivante
    // le dit par `strokeOpacity`. Ne pas « nettoyer » ça en trait plein.
    expect(TRACE_VIVANTE.strokeOpacity).toBeGreaterThan(0);
    expect(TRACE_VIVANTE.strokeOpacity).toBeLessThan(1);
    expect(TRACE_VIVANTE.strokeWeight).toBeLessThanOrEqual(4);
  });

  it("les marqueurs tranchent sur le fond CLAIR de Google", () => {
    // Le fond de carte de Google est clair quel que soit le thème de l'app (terre
    // ~#f2efe9, eau ~#aadaff). Un bleu pâle y disparaît — mesuré le 20/08.
    const luminance = (hex: string) => {
      const n = Number.parseInt(hex.replace("#", ""), 16);
      return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
    };
    for (const style of [MARQUEUR_RELEVE, MARQUEUR_DERNIER]) {
      expect(Math.abs(luminance("#aadaff") - luminance(style.couleur))).toBeGreaterThan(60);
    }
    // Et la dernière position se distingue du nuage : plus grosse ET d'une autre teinte.
    expect(MARQUEUR_DERNIER.taille).toBeGreaterThan(MARQUEUR_RELEVE.taille);
    expect(MARQUEUR_DERNIER.couleur).not.toBe(MARQUEUR_RELEVE.couleur);
  });
});

describe("echantillonner — réduire un nuage SANS effacer une moitié de la période", () => {
  const suite = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("laisse passer un nuage plus petit que la borne", () => {
    expect(echantillonner(suite(5), 10)).toEqual([0, 1, 2, 3, 4]);
  });

  it("garde TOUJOURS le premier et le dernier", () => {
    // ⚠️ La tentation est `points.slice(-max)` : ça effacerait toute la moitié ancienne de
    // la période en silence. On échantillonne régulièrement, donc les deux bouts restent.
    const reduit = echantillonner(suite(1000), 50);
    expect(reduit).toHaveLength(50);
    expect(reduit[0]).toBe(0);
    expect(reduit[reduit.length - 1]).toBe(999);
  });

  it("répartit RÉGULIÈREMENT, il ne prend pas une tranche", () => {
    const reduit = echantillonner(suite(100), 5);
    expect(reduit).toEqual([0, 25, 50, 74, 99]);
  });

  it("ne casse pas sur les cas dégénérés", () => {
    expect(echantillonner([], 10)).toEqual([]);
    expect(echantillonner(suite(3), 1)).toEqual([2]); // au moins la dernière position
    expect(echantillonner(suite(3), 0)).toEqual([2]);
  });

  it("la borne laisse passer une période chargée sans réduire", () => {
    // Repère réel : 304 positions sur 14 jours (mesuré le 20/08). La borne ne doit pas
    // mordre sur l'usage NORMAL — elle est un filet anti-explosion, pas une politique.
    expect(MAX_MARQUEURS).toBeGreaterThan(304);
  });
});

describe("le chargement du SDK — les pièges qui ne lèvent AUCUNE erreur", () => {
  const source = readFileSync("app/ui/CarteGoogleVivante.tsx", "utf8");

  it("écoute `gm_authFailure` — une clé refusée ne rejette rien", () => {
    // Le script se charge (200), la carte se construit, et l'affichage part en filigrane
    // « for development purposes only ». Aucune promesse ne rejette : sans ce crochet,
    // l'échec serait invisible côté code et Marc verrait une carte barrée.
    expect(source).toMatch(/gm_authFailure/);
  });

  it("borne l'attente — un SDK qui ne répond jamais ne doit pas figer l'écran", () => {
    expect(source).toMatch(/setTimeout\(/);
    expect(source).toMatch(/DELAI_MS/);
  });

  it("laisse une SECONDE chance après un échec", () => {
    // Une promesse ratée gardée en cache empoisonnerait tout remontage (retour d'onglet,
    // navigation) : la carte resterait en repli jusqu'au rechargement complet.
    expect(source).toMatch(/chargement\s*=\s*null/);
  });

  it("le repli est INTERACTIF — jamais une image figée", () => {
    // C'est la régression à empêcher : « je peux pas zoomer ni me déplacer, inutile »
    // vaut pour le repli autant que pour le rendu nominal.
    expect(source).toMatch(/\{children\}/);
    expect(source).not.toMatch(/<img/);
  });

  it("la molette NUE fait défiler la page, elle ne zoome pas la carte", () => {
    // Même règle que les graphiques (20/08) : une carte qui capture la molette rend une
    // page longue infranchissable. `cooperative` est le mode Google qui exige Ctrl/⌘.
    expect(source).toMatch(/gestureHandling: "cooperative"/);
  });

  it("nettoie ses objets au démontage", () => {
    // Marqueurs et polylignes survivent au composant s'ils ne sont pas décrochés : on
    // accumulerait des centaines d'objets à chaque changement de période.
    expect(source).toMatch(/setMap\(null\)/);
  });
});
