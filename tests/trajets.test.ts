// tests/trajets.test.ts — reconstitution des trajets depuis les positions.
//
// C'est de l'INFORMATION dérivée : chaque trajet affiché est une affirmation sur ce que
// Marc a fait de sa journée, et sa distance nourrit le suivi du bail. Les tests portent
// donc autant sur ce que le module REFUSE d'affirmer (une distance inventée, un trajet de
// 40 m) que sur son découpage.
//
// ══ CE QUE CE FICHIER VERROUILLE EN PRIORITÉ ═════════════════════════════════════════
//
// Le « les km sont pas bons » du 12/08/2026 venait de DEUX défauts opposés de l'ancien
// découpage, tous deux invisibles à l'écran :
//   • des trajets ENTIERS disparaissaient (un groupe réduit à un seul relevé était jeté) ;
//   • d'autres étaient comptés en DOUBLE (deux trajets dans la même fenêtre d'odomètre
//     recevaient chacun la totalité de ses kilomètres).
// Les deux ont leur test de non-régression ci-dessous, et chacun ÉCHOUE sur l'ancienne
// logique — c'est ce qui les rend utiles.

import { describe, expect, it } from "vitest";
import {
  AGE_ODO_MAX_JOURS,
  affinerFenetre,
  bornerFenetre,
  incertitudeMinutes,
  INCERTITUDE_MAX_MINUTES,
  decouperSegments,
  decouperTrajets,
  estArret,
  etapesIntermediaires,
  formaterDuree,
  grouperParJour,
  instantDuTrajet,
  libelleDuree,
  lienItineraire,
  longueurDuChemin,
  odometreALinstant,
  profilerReleves,
  reconcilier,
  trajetsDansLaFenetre,
  MAX_ETAPES,
  TOLERANCE_ODO_MINUTES,
} from "@/lib/vehicle/trajets";
import type { PointPosition } from "@/lib/vehicle/position";

/** Position à `min` minutes après 8 h UTC le 12 août. */
const P = (min: number, lat: number, lng: number, type: string | null = null): PointPosition => ({
  t: new Date(Date.UTC(2026, 7, 12, 8, min, 0)),
  lat,
  lng,
  type,
});

/** Le 12 août, à l'heure et la minute données. */
const Q = (h: number, m = 0) => new Date(Date.UTC(2026, 7, 12, h, m, 0));
const odo = (km: number, quand: Date) => ({ km, mesureLe: quand });

// Un déplacement d'environ 1,1 km par centième de degré de latitude autour de Québec.
const BASE_LAT = 46.8;
const BASE_LNG = -71.2;

describe("odometreALinstant", () => {
  const historique = [odo(100, Q(7)), odo(108, Q(8)), odo(130, Q(10))];

  it("rend le relevé PILE à l'instant demandé", () => {
    expect(odometreALinstant(historique, Q(8))).toBe(108);
  });

  it("rend le dernier relevé ANTÉRIEUR quand rien n'est proche", () => {
    // Un compteur ne bouge que si la voiture roule : entre deux trajets il est FIGÉ, donc
    // le relevé de 8 h vaut encore à 9 h.
    expect(odometreALinstant(historique, Q(9))).toBe(108);
  });

  // ⚠️ Position et odomètre viennent du même réveil du véhicule, pas de la même
  // milliseconde. Ne regarder qu'en arrière raterait le relevé d'arrivée de quelques
  // secondes et attribuerait le trajet au segment suivant.
  it("accepte un relevé légèrement POSTÉRIEUR, dans la tolérance", () => {
    const juste = [odo(200, new Date(Q(9).getTime() + 30_000))];
    expect(odometreALinstant(juste, Q(9))).toBe(200);
  });

  it("ne va PAS chercher au-delà de la tolérance vers l'avant", () => {
    const tard = [odo(200, new Date(Q(9).getTime() + (TOLERANCE_ODO_MINUTES + 5) * 60_000))];
    expect(odometreALinstant(tard, Q(9))).toBeNull();
  });

  // ⚠️ C'EST LA PROPRIÉTÉ QUI FAIT TOUT TENIR. La fonction ne dépend que de l'instant :
  // deux segments qui se touchent partagent donc la même valeur à leur frontière, et leurs
  // deltas se télescopent. Sans elle, les kilomètres se comptent deux fois.
  it("télescope : la somme des segments vaut la différence des deux bouts", () => {
    const instants = [Q(7), Q(7, 30), Q(8), Q(8, 45), Q(9), Q(10)];
    const valeurs = instants.map((t) => odometreALinstant(historique, t)!);
    let somme = 0;
    for (let i = 1; i < valeurs.length; i += 1) somme += valeurs[i]! - valeurs[i - 1]!;
    expect(somme).toBe(valeurs[valeurs.length - 1]! - valeurs[0]!);
    expect(somme).toBe(30); // 130 − 100
  });

  it("ne recule jamais quand l'instant avance", () => {
    let precedent = -Infinity;
    for (let m = 0; m <= 240; m += 5) {
      const v = odometreALinstant(historique, new Date(Q(7).getTime() + m * 60_000));
      if (v === null) continue;
      expect(v).toBeGreaterThanOrEqual(precedent);
      precedent = v;
    }
  });

  it("REFUSE un relevé trop vieux — flux coupé, pas voiture immobile", () => {
    const vieux = [odo(100, new Date(Q(8).getTime() - (AGE_ODO_MAX_JOURS + 1) * 86_400_000))];
    expect(odometreALinstant(vieux, Q(8))).toBeNull();
    expect(odometreALinstant([], Q(8))).toBeNull();
  });
});

// ══ « LES HEURES SONT JAMAIS LES BONNES » (Marc, 13/08) ══════════════════════════════
//
// Exemple vécu : Marc part à 6 h 50, l'app affichait « 22 h 28 → 08 h 05 » (les deux
// pings de stationnement qui encadrent le trajet). Le module ne peut pas deviner 6 h 50
// sans donnée — mais s'il EXISTE un relevé d'odomètre entre les deux pings, il doit s'en
// servir pour resserrer l'encadrement plutôt que d'afficher le ping de la veille.
describe("affinerFenetre", () => {
  it("resserre le DÉBUT sur le dernier relevé encore à l'ancienne valeur", () => {
    // Garée à 22 h (150 km), toujours 150 km à 6 h 30 — le vrai départ est donc APRÈS
    // 6 h 30, pas à 22 h. `odoFin` (300) n'est atteint par aucun relevé intermédiaire :
    // rien à resserrer côté arrivée, seul le départ bouge.
    const historique = [odo(150, Q(6, 30)), odo(260, Q(7, 0))];
    const { debut, fin } = affinerFenetre(historique, Q(-2), Q(8), 150, 300); // Q(-2)=22h la veille
    expect(debut).toEqual(Q(6, 30));
    expect(fin).toEqual(Q(8));
  });

  it("resserre la FIN sur le premier relevé déjà à la nouvelle valeur", () => {
    const historique = [odo(150, Q(6, 30)), odo(260, Q(7, 0)), odo(260, Q(7, 30))];
    const { fin } = affinerFenetre(historique, Q(-2), Q(9), 150, 260);
    expect(fin).toEqual(Q(7, 0));
  });

  it("resserre les DEUX bornes à la fois quand les relevés le permettent", () => {
    const historique = [odo(150, Q(6, 30)), odo(180, Q(6, 45)), odo(260, Q(7, 15))];
    const { debut, fin } = affinerFenetre(historique, Q(-2), Q(9), 150, 260);
    expect(debut).toEqual(Q(6, 30));
    expect(fin).toEqual(Q(7, 15));
  });

  // ⚠️ LE cas de Marc, exactement : aucun relevé entre les deux pings ⇒ rien ne bouge.
  it("sans relevé INTERMÉDIAIRE, les bornes ressortent INCHANGÉES", () => {
    const { debut, fin } = affinerFenetre([odo(150, Q(6, 30))], Q(-2), Q(9), 100, 260);
    expect(debut).toEqual(Q(-2));
    expect(fin).toEqual(Q(9));
  });

  it("ne peut jamais ÉLARGIR — seulement resserrer", () => {
    // Un relevé hors de (debut, fin) ne doit avoir aucun effet.
    const { debut, fin } = affinerFenetre([odo(150, Q(-3))], Q(-2), Q(9), 150, 260);
    expect(debut).toEqual(Q(-2));
    expect(fin).toEqual(Q(9));
  });

  it("sans odomètre aux bornes, rien à resserrer", () => {
    const historique = [odo(150, Q(6, 30))];
    expect(affinerFenetre(historique, Q(-2), Q(9), null, 260)).toEqual({ debut: Q(-2), fin: Q(9) });
    expect(affinerFenetre(historique, Q(-2), Q(9), 150, null)).toEqual({ debut: Q(-2), fin: Q(9) });
  });
});

describe("decouperSegments", () => {
  it("couvre toute la période sans chevauchement — les segments se suivent bout à bout", () => {
    const positions = [P(0, BASE_LAT, BASE_LNG), P(20, BASE_LAT + 0.05, BASE_LNG), P(60, BASE_LAT + 0.1, BASE_LNG)];
    const segments = decouperSegments(positions);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.arrivee).toBe(segments[1]!.depart);
  });

  // ⚠️ La géométrie voit une immobilité là où la voiture a fait vingt kilomètres : c'est
  // le cas de l'aller-retour qui revient se garer au même endroit.
  it("voit un ALLER-RETOUR que la ligne droite manquerait — le compteur tranche", () => {
    const positions = [P(0, BASE_LAT, BASE_LNG), P(40, BASE_LAT, BASE_LNG)];
    const segments = decouperSegments(positions, {
      historiqueOdometre: [odo(1000, Q(8)), odo(1022, Q(8, 40))],
    });
    expect(segments[0]!.distanceGps).toBeLessThan(0.1);
    expect(segments[0]!.deltaOdo).toBe(22);
    expect(segments[0]!.bouge).toBe(true);
  });

  // ⚠️ Le contraire du test précédent : quand les deux se contredisent FRANCHEMENT, c'est
  // le relevé d'odomètre qui manque, pas le trajet. Croire le compteur l'effacerait.
  it("ÉCARTE un compteur immobile qui contredit un vrai déplacement", () => {
    const positions = [P(0, BASE_LAT, BASE_LNG), P(20, BASE_LAT + 0.05, BASE_LNG)];
    const segments = decouperSegments(positions, { historiqueOdometre: [odo(1000, Q(6))] });
    expect(segments[0]!.deltaOdo).toBeNull();
    expect(segments[0]!.bouge).toBe(true);
  });

  it("un relevé de STATIONNEMENT ferme le chemin : ce qui suit n'est plus décrit", () => {
    const positions = [
      P(0, BASE_LAT, BASE_LNG, "LAST_PARKED"),
      P(20, BASE_LAT + 0.05, BASE_LNG, "LAST_PARKED"),
    ];
    expect(decouperSegments(positions)[0]!.cheminConnu).toBe(false);
    expect(estArret(positions[0]!)).toBe(true);
  });
});

describe("decouperTrajets", () => {
  it("découpe sur une immobilité et garde l'ordre chronologique", () => {
    const trajets = decouperTrajets([
      P(0, BASE_LAT, BASE_LNG),
      P(10, BASE_LAT + 0.05, BASE_LNG),
      // 90 minutes sans bouger : la voiture était garée, c'est un nouveau trajet.
      P(100, BASE_LAT + 0.05, BASE_LNG),
      P(115, BASE_LAT + 0.1, BASE_LNG),
    ]);

    expect(trajets).toHaveLength(2);
    expect(trajets[0]!.debut.getUTCMinutes()).toBe(0);
    expect(trajets[1]!.debut.getUTCMinutes()).toBe(40); // 8h100min = 9h40
  });

  // ⚠️ Le poll passe aux 30 min : un long trajet peut n'être vu que par un relevé par
  // demi-heure. Un seuil trop court le hacherait en morceaux.
  it("ne découpe PAS un trajet vu à la cadence du poll (30 min entre relevés)", () => {
    const trajets = decouperTrajets([
      P(0, BASE_LAT, BASE_LNG),
      P(30, BASE_LAT + 0.2, BASE_LNG),
      P(60, BASE_LAT + 0.4, BASE_LNG),
    ]);
    expect(trajets).toHaveLength(1);
    expect(trajets[0]!.points).toHaveLength(3);
  });

  // ══ LE DÉFAUT DU 18/09/2026 : LE SEUIL DE PAUSE COUPAIT TOUS LES TRAJETS ══════════
  //
  // Mesuré sur les 34 trajets réels des 7 jours précédents : TOUS avaient exactement
  // 2 relevés, aucun n'en avait trois. La bZ republie sa position toutes les ~50 minutes
  // en roulant, et `PAUSE_MINUTES` valait 45 — donc chaque segment fermait son trajet.
  // L'aller Maison → Travail du 18/09 (110 km) sortait en TROIS trajets de 6, 91 et 13 km,
  // séparés d'« arrêts » de 38 secondes, et la carte n'en montrait que le dernier.
  //
  // ⚠️ Ce test est celui qui MANQUAIT : aucune fixture n'exerçait la coupure par durée
  // avec un compteur qui AVANCE. Les deux tests voisins ferment par immobilité (`bouge`),
  // pas par le seuil — c'est pourquoi tripler celui-ci ne faisait rougir personne.
  it("recolle un déplacement continu vu à la cadence RÉELLE de la bZ (~50 min)", () => {
    const trajets = decouperTrajets([
      P(0, BASE_LAT, BASE_LNG),
      P(49, BASE_LAT + 0.05, BASE_LNG),
      P(98, BASE_LAT + 0.1, BASE_LNG),
      P(111, BASE_LAT + 0.12, BASE_LNG),
    ]);

    expect(trajets).toHaveLength(1);
    expect(trajets[0]!.points).toHaveLength(4);
  });

  it("coupe encore un segment plus long que le seuil, même en mouvement", () => {
    // Le seuil n'a pas disparu, il a été re-mesuré : au-delà, le chemin redevient inconnu.
    const trajets = decouperTrajets([
      P(0, BASE_LAT, BASE_LNG),
      P(150, BASE_LAT + 0.2, BASE_LNG),
      P(160, BASE_LAT + 0.22, BASE_LNG),
    ]);

    expect(trajets).toHaveLength(2);
  });

  it("ÉCARTE le bruit GPS autour d'une place de stationnement", () => {
    const trajets = decouperTrajets([
      P(0, BASE_LAT, BASE_LNG),
      P(5, BASE_LAT + 0.0001, BASE_LNG + 0.0001),
      P(10, BASE_LAT, BASE_LNG),
    ]);
    expect(trajets).toEqual([]);
  });

  it("un point isolé ne fait pas un trajet", () => {
    expect(decouperTrajets([P(0, BASE_LAT, BASE_LNG)])).toEqual([]);
    expect(decouperTrajets([])).toEqual([]);
  });

  // ══ NON-RÉGRESSION N°1 : LES TRAJETS QUI DISPARAISSAIENT ═══════════════════════════
  //
  // La voiture ne publie sa position, pour l'essentiel, qu'à l'ARRÊT. Un aller le matin et
  // un retour le soir sont donc deux relevés séparés de plusieurs heures. L'ancien
  // découpage les mettait dans deux groupes d'UN SEUL point et jetait les deux
  // (`groupe.length < 2`) : la journée entière valait zéro kilomètre à l'écran.
  it("garde l'aller du matin ET le retour du soir, séparés de neuf heures", () => {
    const maisonVeille = { ...P(0, BASE_LAT, BASE_LNG, "LAST_PARKED"), t: Q(0) };
    const travail = { ...P(0, BASE_LAT + 0.1, BASE_LNG, "LAST_PARKED"), t: Q(12) };
    const maisonSoir = { ...P(0, BASE_LAT, BASE_LNG, "LAST_PARKED"), t: Q(21) };

    const trajets = decouperTrajets([maisonVeille, travail, maisonSoir], {
      historiqueOdometre: [odo(3000, Q(0)), odo(3014, Q(12)), odo(3028, Q(21))],
    });

    expect(trajets).toHaveLength(2);
    expect(trajets[0]!.distanceKm).toBe(14);
    expect(trajets[1]!.distanceKm).toBe(14);
    expect(trajets.every((t) => !t.distanceEstimee)).toBe(true);
    // Le retour revient au point de départ : la géométrie du trajet complet vaut zéro,
    // et pourtant 28 km ont bien été parcourus.
    expect(trajets.reduce((s, t) => s + t.distanceKm, 0)).toBe(28);
  });

  // ══ NON-RÉGRESSION N°2 : LES KILOMÈTRES COMPTÉS DEUX FOIS ══════════════════════════
  //
  // L'ancien appariement attribuait à CHAQUE trajet le delta de compteur de toute la
  // fenêtre qui l'encadrait (dernier relevé avant le départ → premier après l'arrivée).
  // Deux trajets dans la même fenêtre recevaient donc 40 km chacun : 80 km affichés,
  // annoncés comme EXACTS, pour 40 km réels.
  it("ne compte JAMAIS deux fois les kilomètres d'une même fenêtre d'odomètre", () => {
    const positions = [
      P(0, BASE_LAT, BASE_LNG),
      P(20, BASE_LAT + 0.05, BASE_LNG),
      P(120, BASE_LAT + 0.05, BASE_LNG),
      P(140, BASE_LAT, BASE_LNG),
    ];
    const historique = [odo(3000, Q(7)), odo(3040, Q(11))];

    const trajets = decouperTrajets(positions, { historiqueOdometre: historique });
    const total = trajets.reduce((s, t) => s + t.distanceKm, 0);

    expect(total).toBeLessThan(40);
    // Et l'app ne prétend pas à l'exactitude sur un total qu'elle ne peut pas attribuer.
    expect(trajets.every((t) => t.distanceEstimee)).toBe(true);

    // Ce que le compteur dit, lui, est affiché à part — c'est la réconciliation.
    const bilan = reconcilier(trajets, historique);
    expect(bilan.kmCompteur).toBe(40);
    expect(bilan.ecartKm!).toBeGreaterThan(0);
  });

  // ⚠️ Le cœur de l'honnêteté du module : d'où vient la distance affichée.
  it("préfère l'ODOMÈTRE (exact) à la géométrie (borne inférieure), et le DIT", () => {
    const positions = [P(0, BASE_LAT, BASE_LNG), P(20, BASE_LAT + 0.05, BASE_LNG)];

    const sansOdo = decouperTrajets(positions);
    expect(sansOdo[0]!.distanceEstimee).toBe(true);
    // À vol d'oiseau : ~5,5 km pour 0,05° de latitude.
    expect(sansOdo[0]!.distanceKm).toBeGreaterThan(5);
    expect(sansOdo[0]!.distanceKm).toBeLessThan(6);

    const avecOdo = decouperTrajets(positions, {
      historiqueOdometre: [odo(3500, Q(8)), odo(3508, Q(8, 20))],
    });
    // Le compteur dit 8 km — la route tourne, la ligne droite en valait 5,5.
    expect(avecOdo[0]!.distanceEstimee).toBe(false);
    expect(avecOdo[0]!.distanceKm).toBe(8);
    expect(avecOdo[0]!.odoDebut).toBe(3500);
    expect(avecOdo[0]!.odoFin).toBe(3508);
  });

  it("REFUSE un delta d'odomètre NÉGATIF — un compteur ne recule pas", () => {
    const trajets = decouperTrajets([P(0, BASE_LAT, BASE_LNG), P(20, BASE_LAT + 0.05, BASE_LNG)], {
      historiqueOdometre: [odo(3508, Q(8)), odo(3500, Q(8, 20))],
    });
    expect(trajets[0]!.distanceEstimee).toBe(true);
  });

  it("calcule durée et vitesse moyenne quand la durée EST un temps de conduite", () => {
    const trajets = decouperTrajets([P(0, BASE_LAT, BASE_LNG), P(30, BASE_LAT + 0.25, BASE_LNG)]);
    expect(trajets[0]!.dureeMinutes).toBe(30);
    expect(trajets[0]!.dureeEstFenetre).toBe(false);
    // ~27,8 km en 30 min ⇒ ~56 km/h.
    expect(trajets[0]!.vitesseMoyenne!).toBeGreaterThan(50);
    expect(trajets[0]!.vitesseMoyenne!).toBeLessThan(60);

    // Deux relevés au MÊME instant : aucune vitesse ne peut être affirmée.
    const instantane = decouperTrajets([
      { ...P(0, BASE_LAT, BASE_LNG) },
      { ...P(0, BASE_LAT + 0.05, BASE_LNG) },
    ]);
    expect(instantane[0]!.vitesseMoyenne).toBeNull();
  });

  // ⚠️ Un relevé de stationnement est horodaté à l'ARRIVÉE. L'écart entre deux relevés
  // contient donc le temps GARÉ, et une « vitesse moyenne » calculée dessus est un chiffre
  // faux qui a l'air d'une mesure : 12 km en six heures afficherait 2 km/h.
  it("SE TAIT sur la vitesse quand la durée est une fenêtre de stationnement", () => {
    const trajets = decouperTrajets([
      { ...P(0, BASE_LAT, BASE_LNG, "LAST_PARKED"), t: Q(8) },
      { ...P(0, BASE_LAT + 0.1, BASE_LNG, "LAST_PARKED"), t: Q(14) },
    ]);
    expect(trajets[0]!.dureeEstFenetre).toBe(true);
    expect(trajets[0]!.vitesseMoyenne).toBeNull();
  });

  // ⚠️ « Ça devrait pas faire vol d'oiseau » (Marc, 12/08). Le module ne peut pas inventer
  // la rue suivie — mais il doit DIRE qu'il ne la connaît pas, pour que la carte cesse de
  // présenter une ligne droite comme un trajet.
  it("signale que le chemin entre deux stationnements n'est PAS enregistré", () => {
    const gares = decouperTrajets([
      { ...P(0, BASE_LAT, BASE_LNG, "LAST_PARKED"), t: Q(8) },
      { ...P(0, BASE_LAT + 0.1, BASE_LNG, "LAST_PARKED"), t: Q(9) },
    ]);
    expect(gares[0]!.cheminInconnu).toBe(true);

    // Des relevés rapprochés pris en roulant, eux, décrivent vraiment la route.
    const enRoute = decouperTrajets([
      P(0, BASE_LAT, BASE_LNG, "REAL_TIME"),
      P(10, BASE_LAT + 0.05, BASE_LNG, "REAL_TIME"),
      P(20, BASE_LAT + 0.1, BASE_LNG, "REAL_TIME"),
    ]);
    expect(enRoute[0]!.cheminInconnu).toBe(false);
    expect(enRoute[0]!.points).toHaveLength(3);
  });

  it("coupe à chaque STATIONNEMENT plutôt que de fondre deux destinations en une", () => {
    const trajets = decouperTrajets([
      { ...P(0, BASE_LAT, BASE_LNG, "LAST_PARKED"), t: Q(8) },
      { ...P(0, BASE_LAT + 0.05, BASE_LNG, "LAST_PARKED"), t: Q(8, 20) },
      { ...P(0, BASE_LAT + 0.1, BASE_LNG, "LAST_PARKED"), t: Q(8, 40) },
    ]);
    expect(trajets).toHaveLength(2);
  });

  // ⚠️ Bout en bout, l'exemple de Marc du 13/08 : le trajet AFFICHÉ doit se resserrer sur
  // l'heure réelle de départ dès qu'un relevé d'odomètre intermédiaire le permet.
  it("resserre l'heure de départ AFFICHÉE quand l'odomètre le permet", () => {
    const garee = { ...P(0, BASE_LAT, BASE_LNG, "LAST_PARKED"), t: Q(-2) }; // 22 h la veille
    const arrivee = { ...P(0, BASE_LAT + 0.5, BASE_LNG, "LAST_PARKED"), t: Q(9) }; // 8 h le matin
    const trajets = decouperTrajets([garee, arrivee], {
      historiqueOdometre: [
        odo(3629, Q(-2)), // au ping de stationnement lui-même : odoDebut du segment
        odo(3629, Q(6, 20)), // toujours 3629 à 6 h 20
        odo(3738, Q(7, 5)), // déjà 3738 à 7 h 05 — le vrai départ est entre les deux
        odo(3738, Q(9)), // au ping d'arrivée lui-même : odoFin du segment
      ],
    });
    expect(trajets).toHaveLength(1);
    expect(trajets[0]!.debut).toEqual(Q(6, 20));
    expect(trajets[0]!.fin).toEqual(Q(7, 5));
    expect(trajets[0]!.dureeEstFenetre).toBe(true); // reste un encadrement, resserré ou pas
    // 45 min encadrées au lieu des 11 h du ping brut : la durée AFFICHÉE suit le resserrage.
    expect(trajets[0]!.dureeMinutes).toBe(45);
  });
});

describe("reconcilier", () => {
  it("confronte le total reconstitué au COMPTEUR et nomme l'écart", () => {
    const positions = [P(0, BASE_LAT, BASE_LNG), P(20, BASE_LAT + 0.05, BASE_LNG)];
    const historique = [odo(3000, Q(8)), odo(3008, Q(8, 20)), odo(3020, Q(12))];
    const trajets = decouperTrajets(positions, { historiqueOdometre: historique });

    const bilan = reconcilier(trajets, historique);
    expect(bilan.kmCompteur).toBe(20); // 3020 − 3000
    expect(bilan.kmTrajets).toBe(8);
    // 12 km roulés sans qu'aucune position ne les accompagne : c'est ÇA qu'il faut dire.
    expect(bilan.ecartKm).toBe(12);
  });

  it("n'affirme rien avec moins de deux relevés de compteur", () => {
    const bilan = reconcilier([], [odo(3000, Q(8))]);
    expect(bilan.kmCompteur).toBeNull();
    expect(bilan.ecartKm).toBeNull();
    expect(bilan.nbRelevesOdometre).toBe(1);
  });

  it("se limite à la FENÊTRE demandée", () => {
    const historique = [odo(1000, Q(2)), odo(3000, Q(8)), odo(3020, Q(12))];
    const bilan = reconcilier([], historique, Q(7));
    expect(bilan.kmCompteur).toBe(20);
    expect(bilan.nbRelevesOdometre).toBe(2);
  });
});

describe("profilerReleves", () => {
  // ⚠️ Un outil de diagnostic qui se tait quand il ne trouve rien ne diagnostique rien : il
  // doit répondre SURTOUT dans le cas « tout au stationnement », celui qui explique qu'aucune
  // carte ne puisse montrer la rue suivie.
  it("compte les relevés par type, y compris quand tout est à l'arrêt", () => {
    const profil = profilerReleves([
      P(0, BASE_LAT, BASE_LNG, "LAST_PARKED"),
      P(10, BASE_LAT, BASE_LNG, "LAST_PARKED"),
      P(20, BASE_LAT, BASE_LNG, "REAL_TIME"),
      P(30, BASE_LAT, BASE_LNG, null),
    ]);
    expect(profil).toEqual({ total: 4, stationnement: 2, enRoute: 1, sansType: 1 });
    expect(profilerReleves([])).toEqual({ total: 0, stationnement: 0, enRoute: 0, sansType: 0 });
  });
});

describe("etapesIntermediaires et lienItineraire", () => {
  it("garde au plus 9 étapes — au-delà, Maps ignore la requête ENTIÈRE", () => {
    const points = Array.from({ length: 40 }, (_, i) => P(i, BASE_LAT + i * 0.01, BASE_LNG));
    const etapes = etapesIntermediaires(points);
    expect(etapes.length).toBeLessThanOrEqual(MAX_ETAPES);
    expect(etapes.length).toBe(MAX_ETAPES);
  });

  it("échantillonne sur TOUT le trajet, pas seulement son début", () => {
    const points = Array.from({ length: 40 }, (_, i) => P(i, BASE_LAT + i * 0.01, BASE_LNG));
    const etapes = etapesIntermediaires(points);
    const derniereEtape = etapes[etapes.length - 1]!;
    expect(derniereEtape.lat).toBeGreaterThan(BASE_LAT + 20 * 0.01);
  });

  it("un trajet court n'a pas d'étape superflue", () => {
    expect(etapesIntermediaires([P(0, 46.8, -71.2), P(5, 46.85, -71.2)])).toEqual([]);
  });

  it("compose une URL d'ITINÉRAIRE, pas un simple point", () => {
    const trajet = decouperTrajets([
      P(0, 46.8, -71.2),
      P(10, 46.85, -71.25),
      P(20, 46.9, -71.3),
    ])[0]!;
    const url = lienItineraire(trajet);

    expect(url).toContain("google.com/maps/dir/");
    expect(url).toContain("origin=46.8%2C-71.2");
    expect(url).toContain("destination=46.9%2C-71.3");
    expect(url).toContain("waypoints=");
    expect(url).toContain("travelmode=driving");
  });
});

// ══ « ÇA NE MET PAS MON TRAJET D'AUJOURD'HUI » (Marc, 12/08) ═══════════════════════════
//
// Deux causes, toutes deux propres au régime « la voiture ne publie sa position qu'à
// l'arrêt » — donc invisibles tant qu'on raisonne sur une trace continue.
describe("instantDuTrajet et trajetsDansLaFenetre", () => {
  // Le relevé de départ est le stationnement de la VEILLE : son horodatage est celui de
  // l'arrivée d'hier soir. Dater le trajet avec lui le classe au mauvais jour.
  const hierSoir = { ...P(0, BASE_LAT, BASE_LNG, "LAST_PARKED"), t: Q(1) }; // 11/08 21 h locale
  const cetteApresMidi = { ...P(0, BASE_LAT + 0.1, BASE_LNG, "LAST_PARKED"), t: Q(18) }; // 12/08 14 h

  const trajet = decouperTrajets([hierSoir, cetteApresMidi], {
    historiqueOdometre: [odo(3000, Q(1)), odo(3012, Q(18))],
  })[0]!;

  it("date le trajet sur son ARRIVÉE quand le départ est un stationnement", () => {
    expect(trajet.dureeEstFenetre).toBe(true);
    expect(instantDuTrajet(trajet)).toEqual(trajet.fin);
  });

  it("le classe donc AUJOURD'HUI, pas hier", () => {
    const journees = grouperParJour([trajet]);
    expect(journees[0]!.jour).toBe("2026-08-12");
  });

  it("garde `debut` quand c'est un VRAI départ (trace continue)", () => {
    const continu = decouperTrajets([
      P(0, BASE_LAT, BASE_LNG, "REAL_TIME"),
      P(20, BASE_LAT + 0.05, BASE_LNG, "REAL_TIME"),
    ])[0]!;
    expect(continu.dureeEstFenetre).toBe(false);
    expect(instantDuTrajet(continu)).toEqual(continu.debut);
  });

  // ⚠️ Le corollaire : on doit LIRE plus large que la fenêtre pour trouver l'ancre, puis
  // refermer sur la date du trajet. Filtrer les positions à « depuis » supprimerait le
  // relevé de la veille — et le trajet du jour avec.
  it("retient un trajet dont le DÉPART précède la fenêtre mais dont l'arrivée est dedans", () => {
    const fenetre = new Date(Q(12).getTime()); // ce matin
    expect(trajetsDansLaFenetre([trajet], fenetre)).toHaveLength(1);
    // Et referme bien : une fenêtre postérieure à l'arrivée ne le retient pas.
    expect(trajetsDansLaFenetre([trajet], new Date(Q(20).getTime()))).toHaveLength(0);
    expect(trajetsDansLaFenetre([trajet], null)).toHaveLength(1);
  });

  // La preuve que la marge de lecture est nécessaire : sans elle, il ne reste qu'un relevé.
  it("sans la marge de lecture, il ne resterait qu'un relevé isolé — donc zéro trajet", () => {
    const fenetre = Q(12).getTime();
    const tronque = [hierSoir, cetteApresMidi].filter((p) => p.t.getTime() >= fenetre);
    expect(tronque).toHaveLength(1);
    expect(decouperTrajets(tronque)).toEqual([]);
  });
});

describe("grouperParJour", () => {
  it("groupe dans le FUSEAU de Marc, pas en UTC", () => {
    // 12 août 01:00 UTC = 11 août 21:00 à Toronto. Grouper en UTC classerait ce trajet
    // au mauvais jour (leçon JobAI : Vercel tourne en UTC, Marc vit à UTC−4).
    const tard: PointPosition[] = [
      { t: new Date(Date.UTC(2026, 7, 12, 1, 0, 0)), lat: 46.8, lng: -71.2, type: null },
      { t: new Date(Date.UTC(2026, 7, 12, 1, 20, 0)), lat: 46.85, lng: -71.2, type: null },
    ];
    const journees = grouperParJour(decouperTrajets(tard));
    expect(journees[0]!.jour).toBe("2026-08-11");
  });

  it("totalise les kilomètres et la durée du jour, plus récent d'abord", () => {
    const trajets = decouperTrajets([
      P(0, BASE_LAT, BASE_LNG),
      P(20, BASE_LAT + 0.05, BASE_LNG),
      P(200, BASE_LAT + 0.05, BASE_LNG),
      P(220, BASE_LAT + 0.1, BASE_LNG),
    ]);
    const journees = grouperParJour(trajets);

    expect(journees).toHaveLength(1);
    expect(journees[0]!.trajets).toHaveLength(2);
    expect(journees[0]!.totalKm).toBeCloseTo(trajets[0]!.distanceKm + trajets[1]!.distanceKm, 5);
    // Plus récent en tête : c'est ce qu'on cherche en ouvrant la page.
    expect(journees[0]!.trajets[0]!.debut.getTime()).toBeGreaterThan(
      journees[0]!.trajets[1]!.debut.getTime(),
    );
  });
});

describe("longueurDuChemin et formaterDuree", () => {
  it("cumule les segments plutôt que la ligne droite des extrémités", () => {
    // Aller-retour : la ligne droite bout à bout vaut 0, le chemin parcouru non.
    const allerRetour = longueurDuChemin([
      P(0, 46.8, -71.2),
      P(10, 46.9, -71.2),
      P(20, 46.8, -71.2),
    ]);
    expect(allerRetour).toBeGreaterThan(20);
  });

  it("dit les durées en clair", () => {
    expect(formaterDuree(35)).toBe("35 min");
    expect(formaterDuree(60)).toBe("1 h");
    expect(formaterDuree(72)).toBe("1 h 12");
    expect(formaterDuree(125)).toBe("2 h 05");
  });

  it("dit « durée inconnue » plutôt que « 0 min » quand la durée n'est pas mesurée", () => {
    expect(libelleDuree(35)).toBe("35 min");
    expect(libelleDuree(72)).toBe("1 h 12");
    expect(libelleDuree(0)).toBe("durée inconnue");
    expect(libelleDuree(-3)).toBe("durée inconnue");
    expect(libelleDuree(Number.NaN)).toBe("durée inconnue");
    expect(libelleDuree(0.2)).toBe("< 1 min");
    expect(libelleDuree(0.2)).not.toContain("0 min");
  });
});

// ══ « LES HEURES SONT TOUJOURS PAS BONNES » (Marc, 13/08, APRÈS un premier correctif) ══
//
// Le premier correctif n'utilisait qu'UNE borne (le dernier relevé encore à l'odomètre de
// départ). Sur une nuit ordinaire la voiture ne publie RIEN : aucun relevé intermédiaire,
// donc aucun resserrement, donc le départ restait collé au ping de la veille. Ces tests
// verrouillent la borne HAUTE — le premier relevé où le compteur a DÉJÀ bougé — qui est la
// seule information exploitable dans ce cas.
describe("bornerFenetre — l'encadrement du départ, des DEUX côtés", () => {
  const Q = (h: number, min = 0) => new Date(Date.UTC(2026, 7, 13, h, min, 0));
  const odo = (km: number, t: Date) => ({ km, mesureLe: t });

  it("la borne HAUTE vient du premier relevé où le compteur a bougé", () => {
    // Garée à 22 h la veille (odo 1000), relevé à 7 h qui montre déjà 1010 : le départ a
    // forcément eu lieu AVANT 7 h. C'est ce que l'ancien code ne disait pas.
    const b = bornerFenetre([odo(1010, Q(7))], Q(0), Q(9), 1000, 1024);
    expect(b.departAuPlusTot).toEqual(Q(0));
    expect(b.departAuPlusTard).toEqual(Q(7));
  });

  it("les deux bornes se resserrent quand la voiture publie pendant la nuit", () => {
    // Nuit de recharge : la voiture est réveillée et publie. 6 h = encore là ; 7 h = partie.
    const b = bornerFenetre(
      [odo(1000, Q(3)), odo(1000, Q(6)), odo(1012, Q(7))],
      Q(0),
      Q(9),
      1000,
      1024,
    );
    expect(b.departAuPlusTot).toEqual(Q(6));
    expect(b.departAuPlusTard).toEqual(Q(7));
  });

  // ⚠️ LE cas de Marc : rien de la nuit. On ne peut RIEN resserrer, et il faut le dire.
  it("sans aucun relevé de la nuit, l'encadrement reste LARGE — et ne ment pas", () => {
    const b = bornerFenetre([], Q(0), Q(9), 1000, 1024);
    expect(b.departAuPlusTot).toEqual(Q(0));
    expect(b.departAuPlusTard).toEqual(Q(9));
    expect(incertitudeMinutes(b.departAuPlusTot, b.departAuPlusTard)).toBe(9 * 60);
    // Et cette largeur DOIT dépasser le seuil d'affichage : l'écran montrera un intervalle,
    // jamais « 00 h 00 » présenté comme une heure de départ.
    expect(9 * 60).toBeGreaterThan(INCERTITUDE_MAX_MINUTES);
  });

  it("encadre aussi l'ARRIVÉE des deux côtés", () => {
    const b = bornerFenetre(
      [odo(1010, Q(7)), odo(1024, Q(8))],
      Q(0),
      Q(9),
      1000,
      1024,
    );
    expect(b.arriveeAuPlusTot).toEqual(Q(7));
    expect(b.arriveeAuPlusTard).toEqual(Q(8));
  });

  it("sans odomètre exploitable, aucune borne n'est inventée", () => {
    const b = bornerFenetre([odo(1010, Q(7))], Q(0), Q(9), null, 1024);
    expect(b.departAuPlusTot).toEqual(Q(0));
    expect(b.departAuPlusTard).toEqual(Q(9));
  });

  it("un encadrement ne s'inverse jamais, même sur des relevés incohérents", () => {
    // Compteur qui RECULE : les bornes retombent sur la fenêtre large plutôt que sur une
    // borne absurde (départ après l'arrivée).
    const b = bornerFenetre([odo(900, Q(4)), odo(880, Q(6))], Q(0), Q(9), 1000, 1024);
    expect(b.departAuPlusTard.getTime()).toBeGreaterThanOrEqual(b.departAuPlusTot.getTime());
    expect(b.arriveeAuPlusTard.getTime()).toBeGreaterThanOrEqual(b.arriveeAuPlusTot.getTime());
  });

  it("decouperTrajets porte l'incertitude jusqu'au trajet", () => {
    const pos = (h: number, lat: number, type: string | null) => ({
      t: Q(h),
      lat,
      lng: -71.2,
      type,
    });
    // Deux stationnements encadrant une nuit, avec UN relevé au matin qui a déjà bougé.
    const trajets = decouperTrajets(
      [pos(0, 46.8, "LAST_PARKED"), pos(9, 46.9, "LAST_PARKED")],
      {
        historiqueOdometre: [
          odo(1000, Q(0)),
          odo(1010, Q(7)),
          odo(1024, Q(9)),
        ],
      },
    );
    expect(trajets).toHaveLength(1);
    const t = trajets[0]!;
    expect(t.dureeEstFenetre).toBe(true);
    // Le départ est encadré par [00 h, 07 h] : large, mais BORNÉ — l'ancien code laissait
    // la borne haute à 9 h.
    expect(t.departAuPlusTard).toEqual(Q(7));
    expect(t.departIncertitudeMinutes).toBe(7 * 60);
  });

  it("une heure MESURÉE ne porte aucune incertitude", () => {
    const pos = (h: number, min: number, lat: number, type: string | null) => ({
      t: Q(h, min),
      lat,
      lng: -71.2,
      type,
    });
    // Départ pris EN ROULANT (pas un stationnement) : l'horodatage est celui du relevé.
    const trajets = decouperTrajets(
      [pos(8, 0, 46.8, null), pos(8, 30, 46.9, "LAST_PARKED")],
      { historiqueOdometre: [odo(1000, Q(8, 0)), odo(1024, Q(8, 30))] },
    );
    expect(trajets[0]!.dureeEstFenetre).toBe(false);
    expect(trajets[0]!.departIncertitudeMinutes).toBe(0);
    expect(trajets[0]!.arriveeIncertitudeMinutes).toBe(0);
  });
});
