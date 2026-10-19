// tests/pointsVoiture.test.ts — la disposition des informations SUR la voiture.
//
// Ces tests ne jugent pas le goût : ils vérifient les deux façons dont un placement peut
// rendre une information INUTILISABLE — être recouverte par une autre, ou sortir du cadre.
// Les deux se voient à l'œil sur un écran et se ratent à la revue de code.

import { describe, expect, it } from "vitest";
import {
  ANCRES,
  CLASSE_PAR_POINT,
  HAUTEUR_PASTILLE_PCT,
  HAUTEUR_PASTILLE_PCT_MOBILE,
  LARGEURS_PCT,
  LARGEURS_PCT_MOBILE,
  MARGE_Y,
  METRIQUES_DESKTOP,
  METRIQUES_MOBILE,
  SEUIL_BORD_PCT,
  ancresHorsCadre,
  ancresQuiSeChevauchent,
  cotePastille,
  ecartAncres,
  margeVerticaleMin,
  seChevauchent,
  type Ancre,
  type ClasseLargeur,
  type IdPoint,
} from "@/lib/vehicle/pointsVoiture";

describe("les points ne se marchent pas dessus", () => {
  it("aucune paire d'ancres n'est trop proche", () => {
    // ⚠️ Le message porte les paires fautives : un test qui dit juste « faux » oblige à
    // refaire à la main le calcul que le code vient de faire.
    const paires = ancresQuiSeChevauchent();
    expect(paires, `paires trop proches : ${JSON.stringify(paires)}`).toEqual([]);
  });

  it("le garde DISCRIMINE — deux ancres collées sont bien détectées", () => {
    const colles: Record<IdPoint, Ancre> = { ...ANCRES, verrou: { ...ANCRES.ouvrants } };
    expect(ancresQuiSeChevauchent(colles)).toContainEqual(["verrou", "ouvrants"]);
  });

  it("il attrape le cas qui l'avait BERNÉ : proches en X, presque alignés en Y", () => {
    // ⚠️ Le garde d'avant comparait la distance entre CENTRES : deux pastilles à 12 points
    // d'écart horizontal et 2 de décalage vertical passaient au vert en se recouvrant de
    // moitié à l'écran. C'est le cas exact que ce test verrouille.
    const presque: Record<IdPoint, Ancre> = {
      ...ANCRES,
      charge: { x: 40, y: 24 },
      synchro: { x: 52, y: 26 },
    };
    expect(ancresQuiSeChevauchent(presque)).toContainEqual(["charge", "synchro"]);
  });

  it("toutes les ancres tiennent dans le cadre", () => {
    expect(ancresHorsCadre()).toEqual([]);
  });

  it("le garde de cadre DISCRIMINE — une ancre au bord est signalée", () => {
    const auBord: Record<IdPoint, Ancre> = { ...ANCRES, charge: { x: 1, y: 50 } };
    expect(ancresHorsCadre(auBord)).toEqual(["charge"]);
  });

  it("seules les pastilles ÉTROITES s'approchent du bord", () => {
    // ⚠️ La marge de bord est la DEMI-largeur du point : une LARGE posée aussi près
    // déborderait. Les quatre pressions sont les seules à x < 25.
    const auBord = (Object.keys(ANCRES) as IdPoint[]).filter(
      (id) => ANCRES[id].x < 25 || ANCRES[id].x > 75,
    );
    expect(auBord.sort()).toEqual([
      "pneu-arriere-droite",
      "pneu-arriere-gauche",
      "pneu-avant-droite",
      "pneu-avant-gauche",
    ]);
  });
});

describe("le placement DIT quelque chose", () => {
  it("chaque pression est du CÔTÉ de sa roue, et à sa hauteur", () => {
    // Gauche à gauche, droite à droite : une pression affichée du mauvais côté ferait
    // regarder le mauvais pneu, ce qui est pire que de ne rien afficher.
    expect(ANCRES["pneu-avant-gauche"].x).toBeLessThan(50);
    expect(ANCRES["pneu-arriere-gauche"].x).toBeLessThan(50);
    expect(ANCRES["pneu-avant-droite"].x).toBeGreaterThan(50);
    expect(ANCRES["pneu-arriere-droite"].x).toBeGreaterThan(50);
    // Avant devant, arrière derrière (le capot est en haut du dessin).
    expect(ANCRES["pneu-avant-gauche"].y).toBeLessThan(ANCRES["pneu-arriere-gauche"].y);
    expect(ANCRES["pneu-avant-droite"].y).toBeLessThan(ANCRES["pneu-arriere-droite"].y);
  });

  it("les deux roues d'un même essieu sont à la MÊME hauteur", () => {
    expect(ANCRES["pneu-avant-gauche"].y).toBe(ANCRES["pneu-avant-droite"].y);
    expect(ANCRES["pneu-arriere-gauche"].y).toBe(ANCRES["pneu-arriere-droite"].y);
  });

  it("l'état de la voiture ENTIÈRE est au centre, pas dans un coin", () => {
    // Le verrou ne concerne aucune roue en particulier : le poser à un coin le ferait lire
    // comme un défaut local.
    expect(ANCRES.verrou.x).toBe(50);
    expect(ANCRES.autonomie.x).toBe(50);
    expect(ANCRES.odometre.x).toBe(50);
  });

  it("l'avant porte ce qui regarde la route, l'arrière ce qui regarde le passé", () => {
    // Autonomie et charge au capot ; odomètre au hayon. Ce n'est pas décoratif : c'est ce
    // qui rend la carrosserie lisible sans légende.
    expect(ANCRES.autonomie.y).toBeLessThan(ANCRES.verrou.y);
    expect(ANCRES.charge.y).toBeLessThan(ANCRES.verrou.y);
    expect(ANCRES.odometre.y).toBeGreaterThan(ANCRES.verrou.y);
  });
});

describe("les constantes de disposition", () => {
  it("les largeurs sont ORDONNÉES et restent des pastilles", () => {
    // ⚠️ Elles viennent d'une MESURE au banc. Un test ne peut vérifier que la cohérence :
    // l'ordre des classes, et qu'aucune ne mange la moitié du cadre.
    expect(LARGEURS_PCT.etroite).toBeLessThan(LARGEURS_PCT.normale);
    expect(LARGEURS_PCT.normale).toBeLessThan(LARGEURS_PCT.large);
    expect(LARGEURS_PCT.large).toBeLessThan(50);
    expect(HAUTEUR_PASTILLE_PCT).toBeGreaterThan(1);
    expect(HAUTEUR_PASTILLE_PCT).toBeLessThan(12);
    expect(MARGE_Y).toBe(HAUTEUR_PASTILLE_PCT / 2);
  });

  it("chaque point déclare sa classe de largeur", () => {
    expect(Object.keys(CLASSE_PAR_POINT).sort()).toEqual(Object.keys(ANCRES).sort());
  });

  it("la CHARGE est déclarée large — elle porte son heure de fin en charge", () => {
    // ⚠️ La classe décrit le PIRE cas, jamais l'affichage du moment : une disposition
    // valide batterie pleine et cassée en charge ne se verrait qu'une fois branché.
    expect(CLASSE_PAR_POINT.charge).toBe("large");
  });

  it("deux ÉTROITES peuvent cohabiter là où deux LARGES ne pourraient pas", () => {
    // ⚠️ L'écart est DÉRIVÉ des constantes, jamais recopié : codé « 34 » d'après leurs
    // valeurs du jour, ce test est tombé au premier rajustement (les largeurs sont passées
    // de 20/46 à 16/34 après mesure au banc) alors que la propriété qu'il décrit, elle,
    // n'avait pas bougé d'un pouce.
    //
    // Choisi entre les deux demi-sommes : trop grand pour que deux étroites se gênent,
    // trop petit pour que deux larges s'évitent.
    const ecart = (LARGEURS_PCT.etroite + LARGEURS_PCT.large) / 2;
    expect(ecart).toBeGreaterThan(LARGEURS_PCT.etroite);
    expect(ecart).toBeLessThan(LARGEURS_PCT.large);
    const a = { x: 20, y: 50 };
    const b = { x: 20 + ecart, y: 50 };
    expect(seChevauchent(a, b, "etroite", "etroite")).toBe(false);
    expect(seChevauchent(a, b, "large", "large")).toBe(true);
  });

  it("ecartAncres mesure bien une distance", () => {
    expect(ecartAncres({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(ecartAncres({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(0);
  });
});

describe("la même disposition, vue du TÉLÉPHONE", () => {
  // ⚠️ POURQUOI CE BLOC EXISTE. Les gardes ci-dessus tournaient sur les seules constantes
  // du desktop. Quand les pastilles ont grossi sur téléphone (Marc, 13/09 : « fais les
  // boutons et tout plus gros »), elles ont continué de dire « ça tient » — en mesurant une
  // disposition qui n'existe plus sur cet écran. Un garde qui ne connaît qu'un rendu certifie
  // l'autre sans l'avoir regardé.

  it("aucune paire ne se recouvre avec les pastilles du téléphone", () => {
    const paires = ancresQuiSeChevauchent(ANCRES, CLASSE_PAR_POINT, METRIQUES_MOBILE);
    expect(paires, `paires trop proches sur mobile : ${JSON.stringify(paires)}`).toEqual([]);
  });

  it("toutes les ancres tiennent dans le cadre du téléphone", () => {
    expect(ancresHorsCadre(ANCRES, METRIQUES_MOBILE)).toEqual([]);
  });

  it("la marge la plus faible reste POSITIVE, et c'est autonomie × charge", () => {
    // ⚠️ Ce que ce test surveille n'est PAS le vert, c'est la MARGE. Mesurée au banc
    // Chromium (390 × 844, cadre 320 × 709 px) au pire cas de contenu : 4 px entre
    // l'autonomie et la charge, soit 0,3 point de pourcentage. Positif, mais c'est le
    // point faible de la disposition — un libellé plus long ou une pastille un peu plus
    // haute le ferait passer sous zéro, et un booléen dirait « ça tient » jusqu'à la
    // dernière fraction de point avant la casse.
    //
    // Le seuil n'est PAS la valeur du jour : exiger « > 0,3 » ferait rougir ce test à la
    // première amélioration. Ce qui est verrouillé, c'est le signe, plus l'identité du
    // couple contraignant — si ce n'est plus lui, c'est que la disposition a changé
    // ailleurs et que la mesure ci-dessus ne décrit plus rien.
    const { marge, paire } = margeVerticaleMin(ANCRES, CLASSE_PAR_POINT, METRIQUES_MOBILE);
    expect(marge, `marge minimale mobile : ${marge.toFixed(2)} point(s), paire ${JSON.stringify(paire)}`).toBeGreaterThan(0);
    expect(paire?.slice().sort()).toEqual(["autonomie", "charge"]);
    expect(marge).toBeCloseTo(0.3, 5);
  });

  it("le MÊME couple est le plus serré sur les deux rendus", () => {
    // Le téléphone est plus serré que l'ordinateur (pastilles plus hautes, cadre à peine
    // plus grand) — mais c'est le même endroit qui cède en premier. C'est ce qui rend la
    // mesure mobile utilisable comme unique point de surveillance.
    const bureau = margeVerticaleMin(ANCRES, CLASSE_PAR_POINT, METRIQUES_DESKTOP);
    const mobile = margeVerticaleMin(ANCRES, CLASSE_PAR_POINT, METRIQUES_MOBILE);
    expect(bureau.paire?.slice().sort()).toEqual(mobile.paire?.slice().sort());
    expect(mobile.marge).toBeLessThan(bureau.marge);
  });

  it("le garde mobile DISCRIMINE — un écart valide au bureau, cassé au téléphone", () => {
    // ⚠️ C'est la perturbation qui compte : un écart vertical de 5,5 points passe le garde
    // du bureau (pastille de 4,7 points de haut) et casse celui du téléphone (6,7). Si ce
    // cas rendait la même chose des deux côtés, c'est que le paramètre `metriques` n'est
    // pas lu et que tout le bloc ci-dessus mesure le desktop sous un autre nom.
    const serre: Record<IdPoint, Ancre> = { ...ANCRES, ouvrants: { x: 50, y: 51.5 } };
    expect(ancresQuiSeChevauchent(serre, CLASSE_PAR_POINT, METRIQUES_DESKTOP)).not.toContainEqual([
      "verrou",
      "ouvrants",
    ]);
    expect(ancresQuiSeChevauchent(serre, CLASSE_PAR_POINT, METRIQUES_MOBILE)).toContainEqual([
      "verrou",
      "ouvrants",
    ]);
  });

  it("le garde de cadre mobile DISCRIMINE aussi", () => {
    // Une LARGE posée à 22,8 % du bord tient au bureau (demi-largeur 22,5) et déborde au
    // téléphone (23). Même raison que ci-dessus : prouver que ce sont bien les largeurs
    // mobiles qui sont lues, pas celles du bureau avec une étiquette mobile.
    const auBord: Record<IdPoint, Ancre> = { ...ANCRES, charge: { x: 22.8, y: 50 } };
    expect(ancresHorsCadre(auBord, METRIQUES_DESKTOP)).toEqual([]);
    expect(ancresHorsCadre(auBord, METRIQUES_MOBILE)).toEqual(["charge"]);
  });

  it("une pastille de téléphone n'est JAMAIS plus petite qu'au bureau", () => {
    // ⚠️ La demande était « plus gros », et c'est une propriété qui se perd en silence : il
    // suffit qu'un rajustement du desktop dépasse le mobile pour que le modèle mobile
    // devienne le plus LAXISTE des deux — donc qu'il cesse de décrire le pire cas alors même
    // qu'il porte le nom de l'écran le plus contraint.
    expect(HAUTEUR_PASTILLE_PCT_MOBILE).toBeGreaterThan(HAUTEUR_PASTILLE_PCT);
    for (const classe of Object.keys(LARGEURS_PCT) as ClasseLargeur[]) {
      expect(
        LARGEURS_PCT_MOBILE[classe],
        `la classe « ${classe} » est plus étroite sur téléphone que sur ordinateur`,
      ).toBeGreaterThanOrEqual(LARGEURS_PCT[classe]);
    }
  });

  it("les métriques nommées portent bien les constantes correspondantes", () => {
    // Un aiguillage inversé (mobile qui pointe les valeurs du bureau) laisserait TOUT le
    // reste de ce bloc au vert : chaque assertion resterait vraie, sur le mauvais rendu.
    expect(METRIQUES_DESKTOP).toEqual({ largeurs: LARGEURS_PCT, hauteur: HAUTEUR_PASTILLE_PCT });
    expect(METRIQUES_MOBILE).toEqual({
      largeurs: LARGEURS_PCT_MOBILE,
      hauteur: HAUTEUR_PASTILLE_PCT_MOBILE,
    });
  });

  it("le rendu par DÉFAUT reste celui du bureau", () => {
    // Les appels sans argument (tout le bloc historique en haut de ce fichier) doivent
    // continuer de juger le desktop. Le jour où le défaut basculerait, les tests d'origine
    // changeraient de sujet sans changer d'une ligne.
    expect(ancresQuiSeChevauchent()).toEqual(ancresQuiSeChevauchent(ANCRES, CLASSE_PAR_POINT, METRIQUES_DESKTOP));
    expect(margeVerticaleMin().marge).toBeCloseTo(
      margeVerticaleMin(ANCRES, CLASSE_PAR_POINT, METRIQUES_DESKTOP).marge,
      10,
    );
    expect(seChevauchent({ x: 50, y: 46 }, { x: 50, y: 51.5 }, "large", "normale")).toBe(false);
  });
});

describe("la bulle d'explication reste à l'écran", () => {
  // ⚠️ POURQUOI. Mesuré au banc à 390 px : centrée sur son point, une bulle de 68vw
  // sortait de l'écran de 36 px quand la voiture faisait 17rem et de 53 px à 20rem — sur
  // les QUATRE pressions, c'est-à-dire les points les plus excentrés. Rien ne le signale :
  // le texte est simplement coupé. `cotePastille` décide du côté d'accroche, et ces
  // assertions verrouillent la PROPRIÉTÉ (« la bulle tient dans le cadre »), jamais la
  // liste des points qui en avaient besoin le jour où on l'a écrite.

  // ⚠️ PREMIER JET FAUX, ET IL FAUT L'ÉCRIRE. Mon modèle mesurait « la bulle sort-elle du
  // CADRE de la voiture ? » et accusait la charge (x = 68) — que le banc, lui, voyait
  // tenir à 5 px près. Les deux grandeurs n'ont pas la même référence : la bulle est
  // dimensionnée en `vw` (68vw) alors que sa position est en % du CADRE, et le cadre est
  // encastré dans l'écran. Ce qui compte est l'ÉCRAN, jamais le cadre. Le modèle ci-dessous
  // est donc en pixels de viewport, comme le CSS.

  /** Largeur de la voiture sur téléphone : 20rem, bornée par l'écran. */
  const cadrePx = (vw: number) => Math.min(320, vw);
  /** `width: min(17rem, 68vw)` — la règle exacte de `.pt-bulle`. */
  const bullePx = (vw: number) => Math.min(272, 0.68 * vw);

  /**
   * Où s'étend la bulle d'un point, EN PIXELS D'ÉCRAN, une fois accrochée du côté que
   * `cotePastille` désigne. Reproduit le CSS : centrée par défaut (`left: 50%` +
   * `translateX(-50%)`), alignée sur un bord de la pastille près d'un bord d'écran.
   */
  const etendueBulle = (ancre: Ancre, vw: number, classe: ClasseLargeur, centreeToujours = false) => {
    const W = cadrePx(vw);
    const L = (vw - W) / 2;
    const B = bullePx(vw);
    const centre = L + (ancre.x / 100) * W;
    const demiPastille = ((LARGEURS_PCT_MOBILE[classe] / 100) * W) / 2;
    const cote = centreeToujours ? "centre" : cotePastille(ancre);
    if (cote === "gauche") return { g: centre - demiPastille, d: centre - demiPastille + B };
    if (cote === "droite") return { g: centre + demiPastille - B, d: centre + demiPastille };
    return { g: centre - B / 2, d: centre + B / 2 };
  };

  const horsEcran = (vw: number, centreeToujours = false) =>
    (Object.keys(ANCRES) as IdPoint[])
      .filter((id) => {
        const { g, d } = etendueBulle(ANCRES[id], vw, CLASSE_PAR_POINT[id], centreeToujours);
        return g < -0.5 || d > vw + 0.5;
      })
      .sort();

  it("aucune bulle ne sort de l'écran, à aucune largeur de téléphone", () => {
    for (const vw of [360, 390, 430]) {
      const dehors = horsEcran(vw);
      expect(dehors, `à ${vw} px, bulles hors écran : ${JSON.stringify(dehors)}`).toEqual([]);
    }
  });

  it("le garde DISCRIMINE — centrées, ce sont les quatre pressions qui sortaient", () => {
    // ⚠️ C'est le défaut RÉEL d'avant ce lot, et le modèle ci-dessus retrouve EXACTEMENT
    // les quatre points que le banc Chromium avait mesurés comme coupés (36 px à 17rem,
    // 53 px à 20rem). Deux instruments indépendants qui tombent d'accord sur la même
    // liste : c'est ce qui rend ce modèle utilisable comme garde.
    expect(horsEcran(390, true)).toEqual([
      "pneu-arriere-droite",
      "pneu-arriere-gauche",
      "pneu-avant-droite",
      "pneu-avant-gauche",
    ]);
  });

  it("le côté se DÉRIVE de la position, il ne se déclare pas", () => {
    expect(cotePastille({ x: 0, y: 50 })).toBe("gauche");
    expect(cotePastille({ x: SEUIL_BORD_PCT - 0.1, y: 50 })).toBe("gauche");
    expect(cotePastille({ x: SEUIL_BORD_PCT, y: 50 })).toBe("centre");
    expect(cotePastille({ x: 50, y: 50 })).toBe("centre");
    expect(cotePastille({ x: 100 - SEUIL_BORD_PCT, y: 50 })).toBe("centre");
    expect(cotePastille({ x: 100 - SEUIL_BORD_PCT + 0.1, y: 50 })).toBe("droite");
    expect(cotePastille({ x: 100, y: 50 })).toBe("droite");
  });

  it("la règle est SYMÉTRIQUE — un point et son miroir s'accrochent en miroir", () => {
    // Sinon un côté de la carrosserie serait protégé et l'autre non, et ça ne se verrait
    // qu'en tapant la pastille du mauvais côté.
    for (let x = 0; x <= 100; x += 0.5) {
      const g = cotePastille({ x, y: 50 });
      const d = cotePastille({ x: 100 - x, y: 50 });
      const attendu = g === "gauche" ? "droite" : g === "droite" ? "gauche" : "centre";
      expect(d, `x=${x} donne ${g}, son miroir ${100 - x} donne ${d}`).toBe(attendu);
    }
  });

  it("le seuil laisse de la MARGE aux largeurs de téléphone réelles", () => {
    // ⚠️ Le seuil vient d'un calcul, pas d'un chiffre rond choisi au jugé. Une bulle
    // centrée sort par la gauche quand `cadreGauche + x/100 × cadre − 0,34 × vw < 0`,
    // avec la voiture centrée (`cadreGauche = (vw − cadre) / 2`). Re-dérivé ici pour les
    // trois largeurs courantes : le seuil retenu doit être AU-DESSUS des trois, sinon il
    // laisserait passer un cas qui coupe vraiment.
    const CADRE_PX = 320; // 20rem, la largeur mobile
    const xQuiCoupe = (vw: number) => {
      const cadre = Math.min(CADRE_PX, vw);
      const gauche = (vw - cadre) / 2;
      // gauche + x/100 × cadre − 0,34 × vw = 0
      return ((0.34 * vw - gauche) / cadre) * 100;
    };
    for (const vw of [360, 390, 430]) {
      expect(
        SEUIL_BORD_PCT,
        `à ${vw} px, une bulle centrée coupe sous x = ${xQuiCoupe(vw).toFixed(1)} %`,
      ).toBeGreaterThan(xQuiCoupe(vw));
    }
  });
});
