// tests/lease.test.ts — suivi du bail (Doc 4 §3.4).
//
// C'est le calcul qui alimentera une décision financière de Marc (racheter du kilométrage,
// renégocier, rouler moins). Les tests portent donc autant sur ce que le module REFUSE
// d'affirmer que sur ce qu'il calcule.

import { describe, expect, it } from "vitest";
import {
  ajouterMois,
  avanceSurLeBail,
  calculerEtatBail,
  resumerBail,
  rythmeKmParJour,
  AVANCE_ALERTE_POINTS,
  AVANCE_ATTENTION_POINTS,
} from "@/lib/vehicle/lease";
import type { EtatBail } from "@/lib/vehicle/lease";

const BAIL = {
  debut: "2027-07-14",
  dureeMois: 48,
  kilometrageAutorise: 90_000,
  coutParKmExcedentaire: null,
  devise: "CAD",
};

function jour(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

describe("ajouterMois", () => {
  it("ajoute des mois simples", () => {
    expect(ajouterMois(jour("2027-07-14"), 48).toISOString().slice(0, 10)).toBe("2031-07-14");
  });

  it("gère une fin de mois qui n'existe pas dans le mois cible", () => {
    // 31 janvier + 1 mois : février n'a pas de 31. Sans ce garde, JS déborde sur mars.
    expect(ajouterMois(jour("2027-01-31"), 1).toISOString().slice(0, 10)).toBe("2027-02-28");
  });
});

describe("rythmeKmParJour", () => {
  it("mesure une pente sur plusieurs points", () => {
    const rythme = rythmeKmParJour([
      { km: 1000, mesureLe: jour("2027-07-14") },
      { km: 1500, mesureLe: jour("2027-07-24") },
      { km: 2000, mesureLe: jour("2027-08-03") },
    ]);
    expect(rythme).toBeCloseTo(50, 5);
  });

  it("utilise TOUS les points, pas seulement les extrêmes", () => {
    // Un point aberrant au milieu doit peser sur la régression. Une formule
    // (dernier − premier) / durée l'ignorerait complètement.
    const avec = rythmeKmParJour([
      { km: 0, mesureLe: jour("2027-07-01") },
      { km: 900, mesureLe: jour("2027-07-02") },
      { km: 100, mesureLe: jour("2027-07-11") },
    ]);
    const sans = rythmeKmParJour([
      { km: 0, mesureLe: jour("2027-07-01") },
      { km: 100, mesureLe: jour("2027-07-11") },
    ]);
    expect(avec).not.toBeCloseTo(sans!, 3);
  });

  it("avoue son ignorance avec moins de deux points", () => {
    expect(rythmeKmParJour([{ km: 1000, mesureLe: jour("2027-07-14") }])).toBeNull();
    expect(rythmeKmParJour([])).toBeNull();
  });

  it("refuse une pente négative plutôt que d'annoncer un odomètre qui recule", () => {
    const rythme = rythmeKmParJour([
      { km: 2000, mesureLe: jour("2027-07-14") },
      { km: 1000, mesureLe: jour("2027-07-24") },
    ]);
    expect(rythme).toBeNull();
  });

  it("rend null quand toutes les mesures tombent au même instant", () => {
    const rythme = rythmeKmParJour([
      { km: 1000, mesureLe: jour("2027-07-14") },
      { km: 1200, mesureLe: jour("2027-07-14") },
    ]);
    expect(rythme).toBeNull();
  });
});

describe("calculerEtatBail", () => {
  it("projette un dépassement au rythme observé", () => {
    // 100 km/jour sur 48 mois ≈ 146 000 km, largement au-dessus de 90 000.
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 0, mesureLe: jour("2027-07-14") },
        { km: 2200, mesureLe: jour("2027-08-05") },
      ],
      maintenant: jour("2027-08-05"),
    });

    expect(etat.rythmeKmParJour).toBeCloseTo(100, 0);
    expect(etat.projectionFinBail).toBeGreaterThan(90_000);
    expect(etat.depassementProjete).toBeGreaterThan(0);
  });

  it("NE CHIFFRE PAS le dépassement quand le tarif au km est inconnu, et le DIT", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 0, mesureLe: jour("2027-07-14") },
        { km: 2200, mesureLe: jour("2027-08-05") },
      ],
      maintenant: jour("2027-08-05"),
    });

    expect(etat.depassementProjete).toBeGreaterThan(0);
    expect(etat.coutDepassementProjete).toBeNull();
    expect(etat.limites.some((l) => l.includes("Tarif au kilomètre"))).toBe(true);
  });

  it("chiffre le dépassement dès que le tarif est connu", () => {
    const etat = calculerEtatBail({
      bail: { ...BAIL, coutParKmExcedentaire: 0.15 },
      historiqueOdometre: [
        { km: 0, mesureLe: jour("2027-07-14") },
        { km: 2200, mesureLe: jour("2027-08-05") },
      ],
      maintenant: jour("2027-08-05"),
    });

    expect(etat.coutDepassementProjete).toBeCloseTo(etat.depassementProjete! * 0.15, 5);
    expect(etat.limites.some((l) => l.includes("Tarif au kilomètre"))).toBe(false);
  });

  it("annonce une marge quand le rythme tient dans l'allocation", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 0, mesureLe: jour("2027-07-14") },
        { km: 1100, mesureLe: jour("2027-08-05") },
      ],
      maintenant: jour("2027-08-05"),
    });

    expect(etat.depassementProjete).toBeLessThan(0);
    expect(resumerBail(etat)).toContain("marge projetée");
  });

  it("sans aucun relevé : rien n'est inventé, et la limite est nommée", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [],
      maintenant: jour("2027-08-05"),
    });

    expect(etat.kilometrageActuel).toBeNull();
    expect(etat.consommePourcent).toBeNull();
    expect(etat.projectionFinBail).toBeNull();
    expect(etat.limites.some((l) => l.includes("Aucun relevé"))).toBe(true);
    expect(resumerBail(etat)).toContain("Kilométrage inconnu");
  });

  it("avec un seul relevé : le kilométrage est connu, le rythme non", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [{ km: 2200, mesureLe: jour("2027-08-05") }],
      maintenant: jour("2027-08-05"),
    });

    expect(etat.kilometrageActuel).toBe(2200);
    expect(etat.rythmeKmParJour).toBeNull();
    expect(etat.projectionFinBail).toBeNull();
    expect(etat.limites.some((l) => l.includes("Un seul relevé"))).toBe(true);
  });

  it("expose le temps écoulé, seul point de comparaison honnête du kilométrage consommé", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [{ km: 2200, mesureLe: jour("2027-08-05") }],
      maintenant: jour("2027-08-05"),
    });

    // 22 jours sur ~1461 : le bail est à peine entamé. Comparer « 2 % consommé » à
    // « 1,5 % écoulé » a du sens ; comparer 2 % à 100 % n'en aurait aucun.
    expect(etat.ecoulePourcent).toBeGreaterThan(1);
    expect(etat.ecoulePourcent).toBeLessThan(3);
    expect(etat.joursRestants).toBeGreaterThan(1400);
  });
});

// ── LA FENÊTRE DE MESURE ────────────────────────────────────────────────────────────
//
// Situation type (relevés fictifs) : le bail commence quelques semaines avant
// le premier relevé de CarAI, et la fenêtre observée est plus calme que les trois
// semaines précédentes. La projection ne doit pas présenter ce creux comme le rythme du
// bail — c'est ce qui a produit un dépassement projeté très inférieur à celui que le
// kilométrage depuis la signature annonçait.
describe("calculerEtatBail — couverture de la mesure du rythme", () => {
  // Odomètre fictif : 3 500 km au 12 août, dont ~520 km seulement vus par CarAI.
  const FENETRE_CARAI = [
    { km: 2980, mesureLe: jour("2027-08-06") },
    { km: 3130, mesureLe: jour("2027-08-08") },
    { km: 3320, mesureLe: jour("2027-08-10") },
    { km: 3500, mesureLe: jour("2027-08-12") },
  ];

  it("NOMME la fenêtre trop courte quand l'odomètre de signature est inconnu", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: FENETRE_CARAI,
      maintenant: jour("2027-08-12"),
    });

    expect(etat.rythmeAncreSurSignature).toBe(false);
    // 6 jours mesurés contre 29 jours de bail écoulés.
    expect(etat.couvertureRythmeJours).toBeCloseTo(6, 0);
    expect(etat.limites.some((l) => l.includes("jour(s) d'historique"))).toBe(true);
  });

  it("ANCRE le rythme sur la signature quand l'odomètre initial est connu, et la projection monte", () => {
    const sansAncre = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: FENETRE_CARAI,
      maintenant: jour("2027-08-12"),
    });
    const avecAncre = calculerEtatBail({
      bail: { ...BAIL, kilometrageInitial: 12 },
      historiqueOdometre: FENETRE_CARAI,
      maintenant: jour("2027-08-12"),
    });

    expect(avecAncre.rythmeAncreSurSignature).toBe(true);
    // Invariant, pas une constante à recopier : ancrée, la mesure couvre TOUT le bail
    // écoulé — au jour d'arrondi près, l'ancre étant posée à minuit.
    expect(avecAncre.couvertureRythmeJours!).toBeGreaterThanOrEqual(avecAncre.joursEcoules);
    expect(avecAncre.couvertureRythmeJours!).toBeLessThan(avecAncre.joursEcoules + 1);
    // Le cœur du correctif : la fenêtre CarAI mesure ~87 km/j, le bail entier ~120 km/j.
    // Sans l'ancre, la projection sous-estimait le dépassement de dizaines de milliers de km.
    expect(sansAncre.rythmeKmParJour!).toBeLessThan(95);
    expect(avecAncre.rythmeKmParJour!).toBeGreaterThan(110);
    expect(avecAncre.projectionFinBail!).toBeGreaterThan(sansAncre.projectionFinBail! + 40_000);
    // Une fois ancré, plus rien à signaler sur la couverture.
    expect(avecAncre.limites.some((l) => l.includes("jour(s) d'historique"))).toBe(false);
  });

  it("ne crie PAS au loup quand l'historique couvre déjà l'essentiel du bail écoulé", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 20, mesureLe: jour("2027-07-15") },
        { km: 3500, mesureLe: jour("2027-08-12") },
      ],
      maintenant: jour("2027-08-12"),
    });

    expect(etat.limites.some((l) => l.includes("jour(s) d'historique"))).toBe(false);
  });
});

// ══ LE CHIFFRE ACTIONNABLE ═══════════════════════════════════════════════════════════
//
// « Combien je peux rouler par jour à partir de maintenant sans payer ? » — la moyenne du
// contrat n'y répond pas, elle ignore l'avance déjà prise.
describe("rythmeRestantAutoriseKmParJour", () => {
  it("tient compte de ce qui est DÉJÀ consommé, contrairement à la moyenne du contrat", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 20, mesureLe: jour("2027-07-15") },
        { km: 3500, mesureLe: jour("2027-08-12") },
      ],
      maintenant: jour("2027-08-12"),
    });

    // Moyenne du contrat : 90 000 / 1461 ≈ 61,6 km/j — la même du premier au dernier jour.
    expect(etat.rythmeAutoriseKmParJour).toBeCloseTo(61.6, 0);

    // Restant : (90 000 − 3 500) / jours restants. Déjà en avance, donc PLUS BAS que la
    // moyenne — c'est exactement l'information que la moyenne masque.
    expect(etat.rythmeRestantAutoriseKmParJour!).toBeLessThan(etat.rythmeAutoriseKmParJour);
    expect(etat.rythmeRestantAutoriseKmParJour!).toBeCloseTo(
      (90_000 - 3500) / etat.joursRestants,
      1,
    );

    // Et l'écart : à ~120 km/j observés contre ~60 restants, il dépasse d'une soixantaine.
    expect(etat.ecartKmParJour!).toBeGreaterThan(30);
  });

  it("PLANCHE à zéro quand l'allocation est déjà épuisée — jamais un budget négatif", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 100, mesureLe: jour("2027-07-15") },
        { km: 120_000, mesureLe: jour("2027-08-12") },
      ],
      maintenant: jour("2027-08-12"),
    });
    // Chaque kilomètre est désormais facturé. « −5 km/jour » ne veut rien dire.
    expect(etat.rythmeRestantAutoriseKmParJour).toBe(0);
  });

  it("rend null sur un bail ÉCHU — jamais l'infini d'une division par zéro jour", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [{ km: 50_000, mesureLe: jour("2031-07-14") }],
      // Après l'échéance : plus aucun jour restant.
      maintenant: jour("2031-08-01"),
    });
    expect(etat.joursRestants).toBe(0);
    // Un Infinity se serait affiché comme « roule tant que tu veux ».
    expect(etat.rythmeRestantAutoriseKmParJour).toBeNull();
    expect(etat.ecartKmParJour).toBeNull();
  });

  it("sans relevé d'odomètre, rien n'est affirmé", () => {
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [],
      maintenant: jour("2027-08-12"),
    });
    expect(etat.rythmeRestantAutoriseKmParJour).toBeNull();
    expect(etat.ecartKmParJour).toBeNull();
  });
});

describe("avanceSurLeBail — le forfait se lit CONTRE le temps écoulé", () => {
  const etat = (consomme: number | null, ecoule: number): EtatBail =>
    ({ consommePourcent: consomme, ecoulePourcent: ecoule }) as EtatBail;

  it("rend null sans relevé — jamais un 0 % qui affirme que la voiture n'a pas roulé", () => {
    expect(avanceSurLeBail(etat(null, 40))).toBeNull();
  });

  it("consommer AUTANT que le temps écoulé est sain, même à 90 %", () => {
    // Le piège que cette fonction existe pour éviter : un pourcentage élevé n'est pas une
    // alerte. 90 % du forfait après 90 % du bail, c'est exactement le rythme du contrat.
    const a = avanceSurLeBail(etat(90, 90))!;
    expect(a.gravite).toBe("ok");
    expect(a.ecartPoints).toBe(0);
  });

  it("et consommer PEU peut être une alerte, si le bail vient de commencer", () => {
    // Le cas réel de Marc au 18/09 mis à l'extrême : un petit pourcentage, un temps écoulé
    // plus petit encore. C'est l'ÉCART qui parle, jamais la valeur absolue.
    expect(avanceSurLeBail(etat(20, 4))!.gravite).toBe("alerte");
  });

  it("les deux seuils tirent du bon côté, dérivés des constantes", () => {
    expect(avanceSurLeBail(etat(10 + AVANCE_ATTENTION_POINTS, 10))!.gravite).toBe("ok");
    expect(avanceSurLeBail(etat(10 + AVANCE_ATTENTION_POINTS + 0.1, 10))!.gravite).toBe(
      "attention",
    );
    expect(avanceSurLeBail(etat(10 + AVANCE_ALERTE_POINTS, 10))!.gravite).toBe("attention");
    expect(avanceSurLeBail(etat(10 + AVANCE_ALERTE_POINTS + 0.1, 10))!.gravite).toBe("alerte");
  });

  it("une AVANCE négative (en retard sur le forfait) reste ok", () => {
    const a = avanceSurLeBail(etat(4.5, 40))!;
    expect(a.ecartPoints).toBeCloseTo(-35.5, 5);
    expect(a.gravite).toBe("ok");
  });
});
