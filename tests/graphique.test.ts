// tests/graphique.test.ts — géométrie des courbes zoomables (fonctions pures).
//
// Ce que ces tests protègent, dans l'ordre de ce que Marc a demandé le 14/08 :
//   « une échelle identique, même quand je zoome » → deux séries, même instant, même x ;
//   « voir les heures »                            → graduations alignées sur SON fuseau ;
//   « zoomer »                                     → l'instant sous le curseur ne bouge pas.
//
// L'axe du temps est la seule chose partagée entre courbes. L'axe Y reste propre à chacune
// — superposer des %, des km et des kPa n'aurait aucun sens.

import { describe, expect, it } from "vitest";
import {
  DUREE_MIN_MS,
  ZOOM_COMPLET,
  analyserSerie,
  appliquerZoom,
  decalageFuseauMs,
  deplacerZoom,
  fenetreCommune,
  heureLocale,
  pasDeTemps,
  pointLePlusProche,
  projeter,
  reperesTemps,
  zoomerAutour,
} from "@/lib/vehicle/graphique";
import type { PointSerie } from "@/lib/vehicle/analyse";

const T0 = Date.UTC(2026, 7, 10, 12, 0, 0); // 10 août 2026, 08:00 à Québec (UTC−4)
const h = (n: number) => T0 + n * 3_600_000;
const serie = (paires: Array<[number, number]>): PointSerie[] =>
  paires.map(([heure, valeur]) => ({ t: new Date(h(heure)), valeur }));

describe("fenetreCommune", () => {
  it("englobe TOUTES les séries, pas seulement la première", () => {
    const f = fenetreCommune([
      serie([[2, 10], [4, 20]]),
      serie([[0, 1], [9, 2]]), // déborde des deux côtés
    ]);
    expect(f).toEqual({ t0: h(0), t1: h(9) });
  });

  it("rend null quand rien n'a été mesuré — pas d'axe inventé sous des courbes absentes", () => {
    expect(fenetreCommune([])).toBeNull();
    expect(fenetreCommune([[], []])).toBeNull();
  });

  it("ouvre une fenêtre minimale autour d'un instant unique", () => {
    const f = fenetreCommune([serie([[3, 42]])])!;
    expect(f.t1 - f.t0).toBe(DUREE_MIN_MS);
    expect((f.t0 + f.t1) / 2).toBe(h(3));
  });
});

describe("échelle identique entre courbes — LA demande de Marc", () => {
  it("place le MÊME instant à la MÊME abscisse sur deux séries différentes", () => {
    const charge = serie([[0, 80], [4, 60], [8, 55]]);
    // Pression : autre unité, autres valeurs, un point de moins — et un instant commun (4).
    const pression = serie([[2, 240], [4, 238], [8, 236]]);

    const fenetre = fenetreCommune([charge, pression])!;
    const tc = projeter(charge, fenetre)!;
    const tp = projeter(pression, fenetre)!;

    const xCharge = tc.points.find((p) => p.t === h(4))!.x;
    const xPression = tp.points.find((p) => p.t === h(4))!.x;
    expect(xCharge).toBe(xPression);

    // Le bug qu'on évite : chaque courbe calée sur SES bornes. La pression commençant à
    // h(2), elle démarrerait à x=0 alors que la charge y est déjà à un quart du tracé.
    expect(tp.points[0]!.x).toBeGreaterThan(0);
  });

  it("garde les abscisses alignées APRÈS zoom", () => {
    const a = serie([[0, 1], [3, 5], [6, 9]]);
    const b = serie([[0, 100], [3, 200], [6, 300]]);
    const totale = fenetreCommune([a, b])!;
    const zoomee = appliquerZoom(totale, { debut: 0.25, fin: 0.75 });

    const xa = projeter(a, zoomee)!.points.find((p) => p.t === h(3))!.x;
    const xb = projeter(b, zoomee)!.points.find((p) => p.t === h(3))!.x;
    expect(xa).toBe(xb);
  });

  it("garde un axe Y PROPRE à chaque courbe — % et kPa ne se superposent pas", () => {
    const fenetre = fenetreCommune([serie([[0, 60], [6, 80]])])!;
    const pourcent = projeter(serie([[0, 60], [6, 80]]), fenetre)!;
    const kpa = projeter(serie([[0, 230], [6, 250]]), fenetre)!;
    expect(pourcent.maxY).not.toBe(kpa.maxY);
  });
});

describe("zoom", () => {
  const totale = { t0: h(0), t1: h(24) };

  it("ZOOM_COMPLET rend la fenêtre entière", () => {
    expect(appliquerZoom(totale, ZOOM_COMPLET)).toEqual(totale);
  });

  it("remet les bornes dans l'ordre si elles arrivent inversées", () => {
    expect(appliquerZoom(totale, { debut: 0.8, fin: 0.2 })).toEqual(
      appliquerZoom(totale, { debut: 0.2, fin: 0.8 }),
    );
  });

  it("ne descend jamais sous la durée minimale", () => {
    const f = appliquerZoom(totale, { debut: 0.5, fin: 0.5001 });
    expect(f.t1 - f.t0).toBeGreaterThanOrEqual(DUREE_MIN_MS);
  });

  it("ne sort jamais du domaine, même serré contre un bord", () => {
    const debut = appliquerZoom(totale, { debut: 0, fin: 0.00001 });
    expect(debut.t0).toBeGreaterThanOrEqual(totale.t0);
    const fin = appliquerZoom(totale, { debut: 0.99999, fin: 1 });
    expect(fin.t1).toBeLessThanOrEqual(totale.t1);
  });

  // La propriété qui fait la différence entre un zoom utilisable et un zoom qui fait fuir
  // ce qu'on regarde : l'instant sous le curseur reste sous le curseur.
  it("zoomerAutour garde l'instant d'ancrage à sa place", () => {
    const avant = { debut: 0.2, fin: 0.8 };
    const ancre = 0.5; // milieu de la fenêtre visible → fraction 0.5 du domaine
    const instantAvant = avant.debut + ancre * (avant.fin - avant.debut);

    const apres = zoomerAutour(avant, ancre, 0.5);
    const instantApres = apres.debut + ancre * (apres.fin - apres.debut);

    expect(instantApres).toBeCloseTo(instantAvant, 10);
    expect(apres.fin - apres.debut).toBeCloseTo(0.3, 10);
  });

  it("zoomerAutour se recadre au bord sans déborder", () => {
    const apres = zoomerAutour({ debut: 0, fin: 0.2 }, 0, 2);
    expect(apres.debut).toBeGreaterThanOrEqual(0);
    expect(apres.fin).toBeLessThanOrEqual(1);
  });

  it("deplacerZoom garde la largeur et bute aux bords", () => {
    expect(deplacerZoom({ debut: 0.4, fin: 0.6 }, 0.1)).toEqual({ debut: 0.5, fin: 0.7 });
    expect(deplacerZoom({ debut: 0, fin: 0.2 }, -0.5)).toEqual({ debut: 0, fin: 0.2 });
    expect(deplacerZoom({ debut: 0.8, fin: 1 }, 0.5)).toEqual({ debut: 0.8, fin: 1 });
  });
});

describe("graduations de temps", () => {
  it("choisit un pas plus fin quand on zoome — c'est ce qui fait apparaître les heures", () => {
    const large = pasDeTemps(30 * 86_400_000);
    const serre = pasDeTemps(4 * 3_600_000);
    expect(serre).toBeLessThan(large);
    expect(serre).toBeLessThanOrEqual(3_600_000);
  });

  // ⚠️ LE PIÈGE : arrondir sur l'epoch aligne sur minuit UTC. À Québec (UTC−4), les
  // graduations quotidiennes tomberaient à 20 h la veille. Ce test échoue si on retire
  // la correction de fuseau.
  it("aligne les graduations sur des heures RONDES LOCALES, pas sur l'UTC", () => {
    const fenetre = { t0: h(0), t1: h(12) };
    const reperes = reperesTemps(fenetre, 800, { fuseau: "America/Toronto" });
    expect(reperes.length).toBeGreaterThan(1);

    for (const r of reperes) {
      expect(heureLocale(r.t, "America/Toronto").m).toBe(0);
    }
  });

  it("étiquette en heures sur une fenêtre courte", () => {
    const reperes = reperesTemps({ t0: h(0), t1: h(6) }, 800);
    expect(reperes.some((r) => /^\d{2}:\d{2}$/.test(r.libelle))).toBe(true);
  });

  it("étiquette en dates sur une fenêtre longue", () => {
    const reperes = reperesTemps({ t0: h(0), t1: h(24 * 30) }, 800);
    expect(reperes.every((r) => r.jour)).toBe(true);
  });

  it("ne boucle pas et reste dans la fenêtre", () => {
    const fenetre = { t0: h(0), t1: h(48) };
    const reperes = reperesTemps(fenetre, 800);
    expect(reperes.length).toBeLessThanOrEqual(64);
    for (const r of reperes) {
      expect(r.t).toBeGreaterThanOrEqual(fenetre.t0);
      expect(r.t).toBeLessThanOrEqual(fenetre.t1);
      expect(r.x).toBeGreaterThanOrEqual(0);
    }
  });

  it("rend une liste vide plutôt qu'une grille absurde sur une fenêtre nulle", () => {
    expect(reperesTemps({ t0: h(1), t1: h(1) }, 800)).toEqual([]);
    expect(reperesTemps({ t0: h(0), t1: h(4) }, 0)).toEqual([]);
  });

  it("lit le décalage du fuseau au lieu de coder −4 en dur (heure avancée)", () => {
    // Août : heure avancée de l'Est, UTC−4.
    expect(decalageFuseauMs(Date.UTC(2026, 7, 10), "America/Toronto")).toBe(-4 * 3_600_000);
    // Janvier : heure normale, UTC−5. Une constante en dur se tromperait ici.
    expect(decalageFuseauMs(Date.UTC(2026, 0, 10), "America/Toronto")).toBe(-5 * 3_600_000);
  });
});

describe("projeter", () => {
  it("ne garde que les points DANS la fenêtre", () => {
    const t = projeter(serie([[0, 1], [5, 2], [10, 3]]), { t0: h(4), t1: h(6) })!;
    expect(t.points).toHaveLength(1);
    expect(t.points[0]!.valeur).toBe(2);
  });

  it("rend null quand la fenêtre ne couvre aucune mesure", () => {
    expect(projeter(serie([[0, 1]]), { t0: h(5), t1: h(6) })).toBeNull();
  });

  it("cale l'axe Y sur les valeurs VISIBLES, pas sur toute la série", () => {
    const points = serie([[0, 20], [5, 78], [6, 81]]);
    const zoome = projeter(points, { t0: h(4), t1: h(7) })!;
    // Sans ce comportement, les 20 % du début écraseraient la variation 78→81.
    expect(zoome.minY).toBeGreaterThan(70);
  });

  it("dessine une ligne centrée pour une série plate, sans division par zéro", () => {
    const t = projeter(serie([[0, 50], [3, 50], [6, 50]]), { t0: h(0), t1: h(6) })!;
    expect(t.points.every((p) => Number.isFinite(p.y))).toBe(true);
    expect(t.minY).toBeLessThan(50);
    expect(t.maxY).toBeGreaterThan(50);
  });

  it("rend des repères Y étiquetables, du bas vers le haut", () => {
    const t = projeter(serie([[0, 0], [6, 100]]), { t0: h(0), t1: h(6) }, { nbReperes: 5 })!;
    expect(t.reperes).toHaveLength(5);
    expect(t.reperes[0]!.valeur).toBeCloseTo(t.minY, 6);
    expect(t.reperes[4]!.valeur).toBeCloseTo(t.maxY, 6);
  });
});

describe("pointLePlusProche", () => {
  // Le survol doit lire une VRAIE mesure. Interpoler afficherait un chiffre que le
  // véhicule n'a jamais produit — la fausse donnée qu'on s'interdit.
  it("rend une mesure réelle de la série, jamais une interpolation", () => {
    const t = projeter(serie([[0, 10], [6, 20]]), { t0: h(0), t1: h(6) })!;
    const p = pointLePlusProche(t, t.largeur / 2)!;
    expect([10, 20]).toContain(p.valeur);
  });

  it("rend null sur une trace vide", () => {
    expect(pointLePlusProche({ ...projeter(serie([[0, 1]]), { t0: h(0), t1: h(1) })!, points: [] }, 0)).toBeNull();
  });
});

describe("analyserSerie", () => {
  it("refuse de conclure sur moins de trois mesures", () => {
    const a = analyserSerie(serie([[0, 10], [3, 90]]))!;
    expect(a.tendance).toBe("indeterminee");
    expect(a.delta).toBe(80); // l'écart reste factuel, c'est la TENDANCE qui ne l'est pas
    expect(analyserSerie(serie([[0, 10]]))!.tendance).toBe("indeterminee");
  });

  it("voit une hausse et une baisse", () => {
    expect(analyserSerie(serie([[0, 10], [3, 40], [6, 90]]))!.tendance).toBe("hausse");
    expect(analyserSerie(serie([[0, 90], [3, 40], [6, 10]]))!.tendance).toBe("baisse");
  });

  it("juge « stable » relativement à l'amplitude, pas à une constante", () => {
    // Amplitude 10, écart net de 10 → ce n'est PAS stable.
    expect(analyserSerie(serie([[0, 70], [3, 75], [6, 80]]))!.tendance).toBe("hausse");
    // Même écart absolu (0,4) mais sur une amplitude de 20 → bruit.
    const a = analyserSerie(serie([[0, 70], [3, 90], [6, 70.4]]))!;
    expect(a.tendance).toBe("stable");
  });

  it("rend des statistiques justes et trie par le temps", () => {
    const a = analyserSerie([
      { t: new Date(h(6)), valeur: 30 },
      { t: new Date(h(0)), valeur: 10 },
      { t: new Date(h(3)), valeur: 20 },
    ])!;
    expect(a.min).toBe(10);
    expect(a.max).toBe(30);
    expect(a.moyenne).toBe(20);
    expect(a.amplitude).toBe(20);
    expect(a.nbPoints).toBe(3);
    expect(a.premier).toBe(h(0));
    expect(a.dernier).toBe(h(6));
    expect(a.delta).toBe(20);
  });

  it("rend null sans mesure, et ignore les valeurs non finies", () => {
    expect(analyserSerie([])).toBeNull();
    expect(analyserSerie([{ t: new Date(h(0)), valeur: Number.NaN }])).toBeNull();
  });
});
