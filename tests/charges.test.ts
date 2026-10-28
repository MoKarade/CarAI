// tests/charges.test.ts — reconstitution des sessions de recharge.
//
// La bZ refuse `charge-energyadded`, `charge-wattage`, `charge-amperage` et
// `charge-voltage` : aucune mesure d'énergie ne nous parviendra jamais. Tout ce qui est
// annoncé en kWh est donc CALCULÉ depuis l'état de charge, et ces tests portent surtout
// sur les cas où le module doit refuser de calculer plutôt que d'annoncer un chiffre.

import { describe, expect, it } from "vitest";
import {
  chargesDepuisSoc,
  estimerBorne,
  libelleEstimationBorne,
  reconstituerCharges,
  resumerCharges,
  socProche,
  DUREE_MIN_MINUTES,
  HAUSSE_MIN_POINTS,
  KM_MAX_PENDANT_CHARGE,
  TROU_MINUTES,
  type PointCharge,
  type PointSoc,
  type SessionCharge, estimerFinCharge } from "@/lib/vehicle/charges";

/** Instant à `min` minutes après 20 h UTC le 11 août. */
const T = (min: number) => new Date(Date.UTC(2026, 7, 11, 20, min, 0));
const C = (min: number, enCharge: boolean): PointCharge => ({ t: T(min), enCharge });
const S = (min: number, pourcent: number): PointSoc => ({ t: T(min), pourcent });

describe("reconstituerCharges", () => {
  it("reconstitue une session à partir des relevés « en charge »", () => {
    const sessions = reconstituerCharges({
      etatsCharge: [C(0, false), C(10, true), C(40, true), C(70, true), C(100, false)],
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.debut).toEqual(T(10));
    expect(sessions[0]!.fin).toEqual(T(70));
    expect(sessions[0]!.dureeMinutes).toBe(60);
  });

  // ⚠️ Le poll passe aux 30 min. Sans tolérance, une charge de nuit se fractionnerait en
  // une dizaine de sessions et le compte des « recharges par semaine » deviendrait absurde.
  it("ne fractionne PAS une session à la cadence du poll", () => {
    const sessions = reconstituerCharges({
      etatsCharge: [C(0, true), C(30, true), C(60, true), C(90, true)],
    });
    expect(sessions).toHaveLength(1);
  });

  it("un relevé « pas en charge » ferme franchement la session", () => {
    const sessions = reconstituerCharges({
      etatsCharge: [C(0, true), C(20, true), C(30, false), C(40, true), C(60, true)],
    });
    expect(sessions).toHaveLength(2);
  });

  it("sépare deux sessions séparées par un trou plus long que la tolérance", () => {
    const sessions = reconstituerCharges({
      etatsCharge: [C(0, true), C(20, true), C(20 + TROU_MINUTES + 10, true), C(20 + TROU_MINUTES + 40, true)],
    });
    expect(sessions).toHaveLength(2);
  });

  it("écarte une plage trop courte pour être une vraie charge", () => {
    const sessions = reconstituerCharges({
      etatsCharge: [C(0, true), C(DUREE_MIN_MINUTES - 1, true)],
    });
    expect(sessions).toEqual([]);
  });

  it("estime l'énergie depuis le SOC et la capacité, et DIT que c'est une estimation", () => {
    const sessions = reconstituerCharges({
      etatsCharge: [C(10, true), C(40, true), C(70, true)],
      socs: [S(10, 30), S(70, 80)],
      capaciteKwh: 71.4,
    });
    expect(sessions[0]!.deltaSocPoints).toBe(50);
    // 50 % de 71,4 kWh.
    expect(sessions[0]!.energieKwh!).toBeCloseTo(35.7, 1);
    // ⚠️ Toujours vrai : la bZ ne publie pas l'énergie livrée, on la DÉDUIT. Le champ
    // existe pour que l'écran ne puisse pas présenter un calcul comme une mesure.
    expect(sessions[0]!.energieEstimee).toBe(true);
  });

  it("REFUSE d'estimer sans capacité, sans SOC, ou avec un SOC hors tolérance", () => {
    const etatsCharge = [C(10, true), C(40, true), C(70, true)];

    // Pas de capacité connue.
    expect(
      reconstituerCharges({ etatsCharge, socs: [S(10, 30), S(70, 80)] })[0]!.energieKwh,
    ).toBeNull();

    // Pas de SOC du tout.
    expect(reconstituerCharges({ etatsCharge, capaciteKwh: 71.4 })[0]!.energieKwh).toBeNull();

    // SOC de la veille : l'apparier fabriquerait une quantité d'énergie sans rapport.
    const veille = [{ t: new Date(Date.UTC(2026, 7, 10, 20, 0, 0)), pourcent: 30 }];
    expect(
      reconstituerCharges({ etatsCharge, socs: veille, capaciteKwh: 71.4 })[0]!.energieKwh,
    ).toBeNull();
  });

  it("REFUSE un SOC qui BAISSE pendant une charge — appariement douteux, pas charge négative", () => {
    const sessions = reconstituerCharges({
      etatsCharge: [C(10, true), C(40, true), C(70, true)],
      socs: [S(10, 80), S(70, 30)],
      capaciteKwh: 71.4,
    });
    expect(sessions[0]!.deltaSocPoints).toBeNull();
    expect(sessions[0]!.energieKwh).toBeNull();
  });

  it("ne chiffre le COÛT que si le tarif est connu", () => {
    const base = {
      etatsCharge: [C(10, true), C(40, true), C(70, true)],
      socs: [S(10, 30), S(70, 80)],
      capaciteKwh: 71.4,
    };
    // Sans tarif : l'énergie est là, le montant non. Un prix du kWh écrit en dur
    // produirait un montant faux qui aurait l'air juste.
    expect(reconstituerCharges(base)[0]!.coût).toBeNull();
    expect(reconstituerCharges({ ...base, tarifKwh: 0.1 })[0]!.coût).toBeCloseTo(3.57, 2);
  });

  it("rend les sessions de la plus récente à la plus ancienne", () => {
    const sessions = reconstituerCharges({
      etatsCharge: [C(0, true), C(20, true), C(25, false), C(200, true), C(230, true)],
    });
    expect(sessions[0]!.debut.getTime()).toBeGreaterThan(sessions[1]!.debut.getTime());
  });
});

describe("socProche", () => {
  it("prend le relevé le plus proche dans la tolérance, sinon rien", () => {
    const socs = [S(0, 30), S(15, 45)];
    expect(socProche(socs, T(12))).toBe(45);
    expect(socProche(socs, T(500))).toBeNull();
    expect(socProche([], T(0))).toBeNull();
  });
});

// ══ « LA RECHARGE JE VOIS RIEN DU TOUT » (Marc, 12/08) ════════════════════════════════
//
// Cause mesurée : `charge-ischarging` est en ERROR (UPSTREAM) chez Toyota. Le module ne
// savait reconstituer que depuis ce signal — donc zéro session, écran vide, alors que la
// voiture chargeait et que le SOC le montrait. La reconstitution part maintenant du SOC.
describe("chargesDepuisSoc", () => {
  const O = (min: number, km: number) => ({ km, mesureLe: T(min) });

  it("voit une charge de nuit dans une simple remontée du SOC", () => {
    // Deux relevés : la voiture s'endort à 22 %, se réveille à 88 %. Aucun statut de charge
    // n'a jamais été publié — et pourtant il s'est bien passé quelque chose.
    const sessions = chargesDepuisSoc({ socs: [S(0, 22), S(600, 88)] });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.socDebut).toBe(22);
    expect(sessions[0]!.socFin).toBe(88);
  });

  it("enchaîne les relevés d'une même montée en UNE session", () => {
    const sessions = chargesDepuisSoc({ socs: [S(0, 20), S(30, 35), S(60, 55), S(90, 80)] });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.debut).toEqual(T(0));
    expect(sessions[0]!.fin).toEqual(T(90));
  });

  it("sépare deux branchements par la décharge qui les sépare", () => {
    const sessions = chargesDepuisSoc({
      socs: [S(0, 30), S(60, 80), S(120, 45), S(180, 90)],
    });
    expect(sessions).toHaveLength(2);
  });

  // ⚠️ LA garde : une voiture qui roule ne se recharge pas au net. Sans l'odomètre, une
  // longue descente en récupération fabriquerait une session qui n'a jamais eu lieu.
  it("ÉCARTE une remontée pendant que le compteur avance — c'est de la récupération", () => {
    const socs = [S(0, 40), S(60, 50)];
    expect(chargesDepuisSoc({ socs })).toHaveLength(1);
    expect(
      chargesDepuisSoc({ socs, historiqueOdometre: [O(0, 1000), O(60, 1040)] }),
    ).toHaveLength(0);
  });

  it("garde une remontée quand le compteur n'a PAS bougé — voiture branchée", () => {
    const sessions = chargesDepuisSoc({
      socs: [S(0, 40), S(60, 70)],
      historiqueOdometre: [O(0, 1000), O(60, 1000 + KM_MAX_PENDANT_CHARGE / 2)],
    });
    expect(sessions).toHaveLength(1);
  });

  it("le seuil se dérive de la CONSTANTE, des deux côtés", () => {
    expect(
      chargesDepuisSoc({ socs: [S(0, 50), S(60, 50 + HAUSSE_MIN_POINTS + 1)] }),
    ).toHaveLength(1);
    expect(
      chargesDepuisSoc({ socs: [S(0, 50), S(60, 50 + HAUSSE_MIN_POINTS - 1)] }),
    ).toHaveLength(0);
  });

  it("rien à déduire d'une série vide ou plate", () => {
    expect(chargesDepuisSoc({ socs: [] })).toEqual([]);
    expect(chargesDepuisSoc({ socs: [S(0, 60), S(60, 60), S(120, 60)] })).toEqual([]);
  });
});

describe("chargesDepuisSoc — un PALIER n'est pas une fin de charge", () => {
  // ⚠️ Relevés FICTIFS (règle du dépôt : aucun relevé réel dans un fichier versionné), mais
  // de la même forme qu'une vraie nuit branchée : l'écran en tirait TROIS recharges — 40→45,
  // 45→48, 48→52 — pour une seule nuit où le câble n'avait pas bougé. C'est ce que Marc
  // voyait quand il disait « c'est vraiment pas fiable, pas assez précis ».
  const NUIT_TYPE = [
    { h: 0, m: 10, soc: 40 },
    { h: 3, m: 20, soc: 45 },
    { h: 4, m: 5, soc: 45 }, // palier de 45 min
    { h: 6, m: 30, soc: 48 },
    { h: 7, m: 10, soc: 48 }, // palier de 40 min
    { h: 9, m: 40, soc: 52 },
  ].map(({ h, m, soc }) => ({ t: new Date(Date.UTC(2026, 0, 10, h, m, 0)), pourcent: soc }));

  it("recolle une nuit branchée en UNE session", () => {
    const sessions = chargesDepuisSoc({ socs: NUIT_TYPE });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.socDebut).toBe(40);
    expect(sessions[0]!.socFin).toBe(52);
  });

  // ⚠️ Le contrôle qui compte vraiment : un palier se TRAVERSE, il ne s'ACCUMULE pas. Une
  // voiture laissée branchée des heures après la fin de charge ne doit pas allonger la
  // session — sur une borne facturée à l'heure, chaque minute en trop devient un montant.
  it("la fin de session reste la dernière MONTÉE, pas le dernier relevé", () => {
    const socs: PointSoc[] = [S(0, 80), S(30, 90), S(60, 90), S(100, 90)];
    const sessions = chargesDepuisSoc({ socs });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.fin).toEqual(T(30));
  });

  // ⚠️ Ce cas DÉRIVE ses instants de `TROU_MINUTES`, donc il se déplace avec elle :
  // mesuré, porter la constante à 100 000 min ne le fait PAS rougir. Il protège la
  // RELATION (au-delà de la tolérance, ça coupe), jamais la VALEUR. C'est « recolle une
  // nuit branchée » qui protège la valeur, avec ses paliers réels de 45 et 50 min écrits
  // en dur : abaisser la tolérance à 30 min le fait tomber (mesuré). Les deux sont
  // nécessaires, et aucun ne remplace l'autre.
  it("un palier plus long que la tolérance sépare bien deux branchements", () => {
    const socs: PointSoc[] = [
      S(0, 70),
      S(30, 80),
      S(30 + TROU_MINUTES + 20, 80),
      S(30 + TROU_MINUTES + 50, 90),
    ];
    expect(chargesDepuisSoc({ socs })).toHaveLength(2);
  });

  // La garde d'origine ne doit pas avoir bougé : traverser un palier n'autorise pas à
  // traverser un TRAJET. Sans ça, une descente en récupération se collerait à la charge
  // qui la précède.
  // ⚠️ Contrôle NÉGATIF, et il ne discrimine pas le correctif : mesuré, il passe aussi
  // bien sur le code d'avant. C'est son rôle — prouver que traverser un palier n'a pas
  // ouvert la porte à traverser un trajet. Un seul des cinq cas de ce bloc rougit sur le
  // code d'avant, et c'est voulu.
  it("un trajet coupe la session même quand le SOC stagne", () => {
    const socs: PointSoc[] = [S(0, 70), S(30, 80), S(60, 80), S(90, 90)];
    const historiqueOdometre = [
      { mesureLe: T(0), km: 1000 },
      { mesureLe: T(30), km: 1000 },
      { mesureLe: T(60), km: 1040 },
      { mesureLe: T(90), km: 1040 },
    ];
    expect(chargesDepuisSoc({ socs, historiqueOdometre })).toHaveLength(2);
  });

  it("une BAISSE ferme la session, palier ou pas", () => {
    const socs: PointSoc[] = [S(0, 70), S(30, 80), S(60, 74), S(90, 84)];
    const sessions = chargesDepuisSoc({ socs });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.socFin).toBe(80);
    expect(sessions[1]!.socDebut).toBe(74);
  });
});

describe("reconstituerCharges — les deux sources", () => {
  // Le test qui EST le bug de Marc : aucun statut de charge, et pourtant une recharge.
  it("remplit l'écran SANS aucun relevé de statut", () => {
    const sessions = reconstituerCharges({
      etatsCharge: [],
      socs: [S(0, 25), S(600, 85)],
      capaciteKwh: 71.4,
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.source).toBe("soc");
    expect(sessions[0]!.deltaSocPoints).toBe(60);
    expect(sessions[0]!.energieKwh!).toBeCloseTo(0.6 * 71.4, 5);
    // ⚠️ Les bornes sont une fenêtre : l'écran doit le dire, pas afficher « 10 h de charge ».
    expect(sessions[0]!.bornesEstimees).toBe(true);
  });

  // ⚠️ Sans cette règle, un branchement vu par les DEUX sources compterait deux fois — et
  // l'énergie totale, celle qui finira en dollars, serait doublée.
  it("ne compte PAS deux fois un branchement vu par le statut ET par le SOC", () => {
    const sessions = reconstituerCharges({
      etatsCharge: [C(0, false), C(10, true), C(70, true), C(100, false)],
      socs: [S(10, 30), S(70, 75)],
      capaciteKwh: 71.4,
    });
    expect(sessions).toHaveLength(1);
    // La version DÉCLARÉE l'emporte : ses bornes sont des instants observés.
    expect(sessions[0]!.source).toBe("statut");
    expect(sessions[0]!.bornesEstimees).toBe(false);
  });

  it("ajoute une charge que le statut a manquée, sans toucher à celle qu'il a vue", () => {
    const sessions = reconstituerCharges({
      etatsCharge: [C(0, false), C(10, true), C(70, true), C(100, false)],
      socs: [S(10, 30), S(70, 75), S(1000, 40), S(1200, 90)],
      capaciteKwh: 71.4,
    });
    expect(sessions).toHaveLength(2);
    expect(sessions.map((s) => s.source).sort()).toEqual(["soc", "statut"]);
  });
});

// ══ « QUEL TYPE DE BORNE » (Marc, 13/08) ══════════════════════════════════════════════
//
// `charge-wattage`/`-amperage`/`-voltage` sont refusés en ERROR (COMPATIBILITY) : rien de
// plus à récupérer. Seule piste : déduire la puissance implicite (kWh ÷ h) de ce qu'on a
// déjà, et la classer par bande d'usage.
describe("estimerBorne", () => {
  const session = (
    energieKwh: number | null,
    dureeMinutes: number,
    bornesEstimees = false,
  ): Pick<SessionCharge, "energieKwh" | "dureeMinutes" | "bornesEstimees"> => ({
    energieKwh,
    dureeMinutes,
    bornesEstimees,
  });

  it("refuse sans énergie connue", () => {
    expect(estimerBorne(session(null, 60))).toBeNull();
  });

  it("refuse une durée nulle ou négative", () => {
    expect(estimerBorne(session(5, 0))).toBeNull();
    expect(estimerBorne(session(5, -10))).toBeNull();
  });

  it("classe Niveau 1 sous 2,5 kW", () => {
    // 2 kWh en 2 h = 1 kW.
    const estimation = estimerBorne(session(2, 120));
    expect(estimation?.type).toBe("niveau1");
    expect(estimation?.puissanceKw).toBeCloseTo(1, 5);
  });

  it("classe Niveau 2 entre 2,5 kW et 20 kW", () => {
    // 7 kWh en 1 h = 7 kW.
    const estimation = estimerBorne(session(7, 60));
    expect(estimation?.type).toBe("niveau2");
    expect(estimation?.puissanceKw).toBeCloseTo(7, 5);
  });

  it("classe Rapide (DC) à partir de 20 kW", () => {
    // 30 kWh en 30 min = 60 kW.
    const estimation = estimerBorne(session(30, 30));
    expect(estimation?.type).toBe("rapide");
    expect(estimation?.puissanceKw).toBeCloseTo(60, 5);
  });

  it("les seuils se dérivent de la CONSTANTE, des deux côtés", () => {
    expect(estimerBorne(session(1.2, 30))?.type).toBe("niveau1"); // 2,4 kW
    expect(estimerBorne(session(1.3, 30))?.type).toBe("niveau2"); // 2,6 kW
    expect(estimerBorne(session(9.9, 30))?.type).toBe("niveau2"); // 19,8 kW
    expect(estimerBorne(session(10.1, 30))?.type).toBe("rapide"); // 20,2 kW
  });

  it("REFUSE une puissance implausible — fenêtre trop courte pour être fiable", () => {
    // 50 kWh en 1 minute = 3000 kW : aucun chargeur commercial n'atteint ça.
    expect(estimerBorne(session(50, 1))).toBeNull();
  });

  it("porte le caractère MINORANT quand les bornes sont une fenêtre estimée", () => {
    expect(estimerBorne(session(10, 60, false))?.minimale).toBe(false);
    expect(estimerBorne(session(10, 60, true))?.minimale).toBe(true);
  });
});

describe("libelleEstimationBorne", () => {
  const session = (
    energieKwh: number | null,
    dureeMinutes: number,
    bornesEstimees = false,
  ): Pick<SessionCharge, "energieKwh" | "dureeMinutes" | "bornesEstimees"> => ({
    energieKwh,
    dureeMinutes,
    bornesEstimees,
  });

  it("rend « — » quand la borne n'est pas estimable", () => {
    expect(libelleEstimationBorne(session(null, 60))).toBe("—");
  });

  it("nomme le type et la puissance, sans préfixe pour des bornes exactes", () => {
    expect(libelleEstimationBorne(session(7, 60, false))).toBe("Niveau 2 (~7.0 kW)");
  });

  it("préfixe « ≥ » quand la fenêtre — donc la puissance — est un minorant", () => {
    expect(libelleEstimationBorne(session(7, 60, true))).toBe("≥ Niveau 2 (~7.0 kW)");
  });

  it("nomme Rapide (DC) et Niveau 1 correctement", () => {
    expect(libelleEstimationBorne(session(30, 30, false))).toBe("Rapide (DC) (~60.0 kW)");
    expect(libelleEstimationBorne(session(2, 120, false))).toBe("Niveau 1 (~1.0 kW)");
  });
});

describe("resumerCharges", () => {
  const session = (energie: number | null, cout: number | null, jour: number): SessionCharge => ({
    debut: new Date(Date.UTC(2026, 7, jour, 20, 0, 0)),
    fin: new Date(Date.UTC(2026, 7, jour, 22, 0, 0)),
    dureeMinutes: 120,
    socDebut: 30,
    socFin: 80,
    deltaSocPoints: 50,
    energieKwh: energie,
    energieEstimee: true,
    coût: cout,
    source: "statut",
    bornesEstimees: false,
  });

  // ⚠️ LE point du résumé : un total qui ignore silencieusement les sessions non chiffrées
  // SOUS-ESTIME la consommation en ayant l'air complet. C'est pire qu'une absence.
  it("REFUSE un total partiel quand une session n'est pas chiffrable", () => {
    const resume = resumerCharges([session(10, 1, 1), session(null, null, 3)]);
    expect(resume.nbSessions).toBe(2);
    expect(resume.energieTotaleKwh).toBeNull();
    expect(resume.coutTotal).toBeNull();
  });

  it("totalise quand TOUTES les sessions sont chiffrées", () => {
    const resume = resumerCharges([session(10, 1, 1), session(20, 2, 3)]);
    expect(resume.energieTotaleKwh).toBe(30);
    expect(resume.coutTotal).toBe(3);
  });

  it("calcule une fréquence hebdomadaire sur une fenêtre suffisante", () => {
    // 3 sessions sur 14 jours ⇒ 1,5 par semaine.
    const resume = resumerCharges([session(10, null, 1), session(10, null, 8), session(10, null, 15)]);
    expect(resume.fenetreJours).toBeCloseTo(14, 1);
    expect(resume.parSemaine!).toBeCloseTo(1.5, 1);
  });

  it("REFUSE d'extrapoler une fréquence sur moins d'un jour d'observation", () => {
    // « 7 recharges par semaine » déduites d'une seule charge d'hier serait une invention.
    expect(resumerCharges([session(10, null, 1)]).parSemaine).toBeNull();
  });

  it("aucune session : rien n'est affirmé", () => {
    const resume = resumerCharges([]);
    expect(resume.nbSessions).toBe(0);
    expect(resume.energieTotaleKwh).toBeNull();
    expect(resume.parSemaine).toBeNull();
  });
});

// ── Estimation du temps restant (ajoutée le 14/08 : « je veux un estimé de temps ») ──
//
// L'essentiel de ces tests porte sur les cas où la fonction REFUSE de répondre. C'est là
// que se joue le no-fake-data : un « ~2 h » affiché sans donnée pour le soutenir serait
// une invention, et c'est précisément ce qu'un utilisateur croirait sur parole.

describe("estimerFinCharge", () => {
  const T = new Date("2026-08-14T18:00:00.000Z");
  const ilYA = (min: number) => new Date(T.getTime() - min * 60_000);

  it("estime au rythme observé et situe la fin", () => {
    const e = estimerFinCharge({
      // +20 points en 60 min → 20 pts/h ; de 60 à 80 il reste 20 pts → 60 min.
      soc: [
        { t: ilYA(60), pourcent: 40 },
        { t: ilYA(0), pourcent: 60 },
      ],
      ciblePourcent: 80,
      maintenant: T,
    })!;
    expect(e.rythmePointsParHeure).toBeCloseTo(20, 6);
    expect(e.minutesRestantes).toBeCloseTo(60, 6);
    expect(e.finEstimee.getTime()).toBeCloseTo(T.getTime() + 3_600_000, -3);
    expect(e.ciblePourcent).toBe(80);
  });

  it("refuse sur un seul relevé — un point ne donne aucun rythme", () => {
    expect(
      estimerFinCharge({ soc: [{ t: ilYA(0), pourcent: 50 }], maintenant: T }),
    ).toBeNull();
  });

  it("refuse quand le SOC n'augmente pas", () => {
    expect(
      estimerFinCharge({
        soc: [
          { t: ilYA(60), pourcent: 70 },
          { t: ilYA(0), pourcent: 70 },
        ],
        maintenant: T,
      }),
    ).toBeNull();
    expect(
      estimerFinCharge({
        soc: [
          { t: ilYA(60), pourcent: 70 },
          { t: ilYA(0), pourcent: 62 },
        ],
        maintenant: T,
      }),
    ).toBeNull();
  });

  it("refuse sur un écart trop court pour signifier quoi que ce soit", () => {
    expect(
      estimerFinCharge({
        soc: [
          { t: ilYA(4), pourcent: 50 },
          { t: ilYA(0), pourcent: 52 },
        ],
        maintenant: T,
      }),
    ).toBeNull();
  });

  it("refuse quand les relevés sont trop vieux pour décrire la charge en cours", () => {
    expect(
      estimerFinCharge({
        soc: [
          { t: ilYA(300), pourcent: 40 },
          { t: ilYA(240), pourcent: 60 },
        ],
        maintenant: T,
      }),
    ).toBeNull();
  });

  it("refuse quand la cible est déjà atteinte", () => {
    expect(
      estimerFinCharge({
        soc: [
          { t: ilYA(60), pourcent: 70 },
          { t: ilYA(0), pourcent: 82 },
        ],
        ciblePourcent: 80,
        maintenant: T,
      }),
    ).toBeNull();
  });

  // Le rythme se mesure sur la MONTÉE la plus récente : un palier de stationnement
  // antérieur écraserait la moyenne et allongerait faussement l'estimation.
  it("ignore un palier antérieur et ne mesure que la montée en cours", () => {
    const e = estimerFinCharge({
      soc: [
        { t: ilYA(600), pourcent: 30 },
        { t: ilYA(540), pourcent: 30 },
        { t: ilYA(60), pourcent: 30 },
        { t: ilYA(0), pourcent: 50 },
      ],
      ciblePourcent: 70,
      maintenant: T,
    })!;
    expect(e.rythmePointsParHeure).toBeCloseTo(20, 6);
  });

  it("dit que l'estimation est OPTIMISTE au-dessus de 80 %, et pourquoi", () => {
    const e = estimerFinCharge({
      soc: [
        { t: ilYA(60), pourcent: 60 },
        { t: ilYA(0), pourcent: 80 },
      ],
      ciblePourcent: 100,
      maintenant: T,
    })!;
    expect(e.fiabilite).toBe("optimiste");
    expect(e.reserves.join(" ")).toContain("plus tardive");
  });

  it("annonce TOUJOURS que le chiffre est déduit, jamais donné par la voiture", () => {
    const e = estimerFinCharge({
      soc: [
        { t: ilYA(60), pourcent: 40 },
        { t: ilYA(0), pourcent: 60 },
      ],
      ciblePourcent: 80,
      maintenant: T,
    })!;
    expect(e.reserves.join(" ")).toContain("ne publie pas de temps restant");
  });

  it("vise 100 % par défaut quand aucune limite n'est connue", () => {
    const e = estimerFinCharge({
      soc: [
        { t: ilYA(60), pourcent: 40 },
        { t: ilYA(0), pourcent: 60 },
      ],
      maintenant: T,
    })!;
    expect(e.ciblePourcent).toBe(100);
  });
});
