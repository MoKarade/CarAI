// tests/statutCharge.test.ts — « est-ce que la voiture charge, oui ou non ? »
//
// Marc, 20/08 : « dans accueil je veux voir si le véhicule est en charge ou non ». La
// réponse existe même quand elle est NON — c'est ce que l'ancien bandeau ne savait pas
// dire, puisqu'il DÉDUISAIT la charge d'un SOC qui monte et disparaissait sinon.
//
// Les cas de ce fichier viennent des VRAIES mesures de la bZ, relevées le 20/08 via le
// connecteur MCP : `charging_status` true (64 min), `charging_status_detail` "CHARGING",
// `charge_plugged_in` true. Et Marc a trois minuteries de charge configurées, donc
// « branchée mais pas en charge » est chez lui un état normal, pas une anomalie.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FRAICHEUR_STATUT_MINUTES, statutDeCharge } from "@/lib/vehicle/charges";

const m = (
  metricType: string,
  valeur: boolean | number | string | null,
  ageMinutes = 10,
) => ({
  metricType,
  valueNumeric: typeof valeur === "number" ? valeur : typeof valeur === "boolean" ? (valeur ? 1 : 0) : null,
  valueText: typeof valeur === "string" ? valeur : typeof valeur === "boolean" ? String(valeur) : null,
  ageMinutes,
});

describe("statutDeCharge — le FAIT que la voiture déclare", () => {
  it("dit EN CHARGE sur les vraies mesures du 20/08", () => {
    const s = statutDeCharge([
      m("charging_status", true, 64),
      m("charging_status_detail", "CHARGING", 64),
      m("charge_plugged_in", true, 64),
      m("battery_soc", 70, 64),
    ]);
    expect(s.mode).toBe("en-charge");
    expect(s.detail).toBe("CHARGING");
    expect(s.ageMinutes).toBe(64);
    expect(s.perime).toBe(false);
  });

  it("distingue BRANCHÉE-EN-ATTENTE de DÉBRANCHÉE", () => {
    // ⚠️ Le cas qui compte pour Marc : ses minuteries (08:00→00:00, 13:00→17:00,
    // 18:15→06:40) laissent la voiture branchée sans charger. Confondre les deux ferait
    // croire à un câble oublié — ou à un câble branché qui ne l'est pas.
    const enAttente = statutDeCharge([
      m("charging_status", false),
      m("charge_plugged_in", true),
    ]);
    expect(enAttente.mode).toBe("branchee-en-attente");

    const debranchee = statutDeCharge([
      m("charging_status", false),
      m("charge_plugged_in", false),
    ]);
    expect(debranchee.mode).toBe("debranchee");
  });

  it("n'affirme PAS « débranchée » quand le câble est inconnu", () => {
    // Sans relevé de câble, dire « débranchée » inventerait un fait. Le mode dédié dit
    // exactement ce qu'on sait : pas en charge, et rien de plus.
    const s = statutDeCharge([m("charging_status", false)]);
    expect(s.mode).toBe("pas-en-charge");
  });

  it("dit INCONNU plutôt que de deviner depuis le câble seul", () => {
    // Un câble branché ne prouve pas qu'une charge tourne — c'est même le contraire chez
    // Marc la moitié du temps.
    const s = statutDeCharge([m("charge_plugged_in", true)]);
    expect(s.mode).toBe("inconnu");
    expect(s.ageMinutes).toBeNull();
  });

  it("lit aussi bien le booléen NUMÉRIQUE que le TEXTE", () => {
    // La bZ publie les deux colonnes (1 / "true"). Une lecture qui n'en couvrirait qu'une
    // renverrait « inconnu » sur une donnée parfaitement présente — la classe de bug qui a
    // déjà coûté la capacité de batterie (lue en numérique alors qu'elle est en JSON).
    expect(statutDeCharge([{ metricType: "charging_status", valueNumeric: 1, valueText: null, ageMinutes: 5 }]).mode).toBe("en-charge");
    expect(statutDeCharge([{ metricType: "charging_status", valueNumeric: null, valueText: "true", ageMinutes: 5 }]).mode).toBe("en-charge");
    expect(statutDeCharge([{ metricType: "charging_status", valueNumeric: null, valueText: "TRUE", ageMinutes: 5 }]).mode).toBe("en-charge");
    // Un texte que personne ne sait interpréter ne devient PAS `false` par défaut.
    expect(statutDeCharge([{ metricType: "charging_status", valueNumeric: null, valueText: "peut-être", ageMinutes: 5 }]).mode).toBe("inconnu");
  });
});

describe("statutDeCharge — la fraîcheur, dite et non cachée", () => {
  it("marque PÉRIMÉ au-delà de la fenêtre, sans se taire pour autant", () => {
    // Se taire est précisément le défaut signalé. On rend le dernier état CONNU, et
    // l'appelant le formule au passé grâce à ce drapeau.
    const vieux = statutDeCharge([m("charging_status", true, FRAICHEUR_STATUT_MINUTES + 1)]);
    expect(vieux.mode).toBe("en-charge");
    expect(vieux.perime).toBe(true);

    const frais = statutDeCharge([m("charging_status", true, FRAICHEUR_STATUT_MINUTES - 1)]);
    expect(frais.perime).toBe(false);
  });

  it("annonce l'âge du PLUS VIEUX des relevés qui fondent la conclusion", () => {
    // ⚠️ « Débranchée » s'appuie sur DEUX mesures. Afficher la fraîcheur de la plus récente
    // ferait passer pour actuel un raisonnement à moitié périmé.
    const s = statutDeCharge([
      m("charging_status", false, 80),
      m("charge_plugged_in", false, 5),
    ]);
    expect(s.mode).toBe("debranchee");
    expect(s.ageMinutes).toBe(80);
  });

  it("prend la mesure la plus RÉCENTE quand la métrique en a plusieurs", () => {
    const s = statutDeCharge([
      m("charging_status", false, 300),
      m("charging_status", true, 12),
    ]);
    expect(s.mode).toBe("en-charge");
    expect(s.ageMinutes).toBe(12);
  });

  it("le seuil est DÉRIVÉ de la constante, jamais recopié", () => {
    // La bZ publie aux 30-60 min : la fenêtre doit laisser passer un cycle normal, sinon
    // l'accueil annoncerait « périmé » en régime nominal.
    expect(FRAICHEUR_STATUT_MINUTES).toBeGreaterThan(60);
  });
});

describe("statutDeCharge — cas dégénérés", () => {
  it("aucune mesure du tout", () => {
    const s = statutDeCharge([]);
    expect(s.mode).toBe("inconnu");
    expect(s.ageMinutes).toBeNull();
    expect(s.detail).toBeNull();
    expect(s.perime).toBe(false);
  });

  it("un détail vide ne devient pas une chaîne vide affichée", () => {
    const s = statutDeCharge([
      m("charging_status", true),
      { metricType: "charging_status_detail", valueNumeric: null, valueText: "   ", ageMinutes: 5 },
    ]);
    expect(s.detail).toBeNull();
  });
});

describe("l'accueil montre le statut MÊME quand la réponse est non", () => {
  const accueil = readFileSync("app/page.tsx", "utf8");

  // ⚠️ CE TEST A CHANGÉ DE CIBLE, pas d'invariant. Il gardait le BANDEAU de charge ; Marc
  // l'a fait supprimer le 21/08 (« toutes les infos doivent être sur la voiture »), et son
  // contenu vit désormais dans la pastille de la trappe. Un test qui décrit un composant
  // meurt avec lui ; celui qui décrit une RÈGLE lui survit — la règle étant : « en charge
  // ou non » a une réponse sur l'accueil même quand aucune déduction n'aboutit.

  it("le statut de charge est calculé SANS condition", () => {
    // La régression à empêcher : le statut redevenant `bandeauCharge && …`, c'est-à-dire
    // absent dès que le niveau ne monte plus — exactement quand on veut lire « pas en
    // charge ». Le calcul doit être inconditionnel, quoi qu'on en fasse ensuite.
    expect(accueil).toMatch(/const statutCharge = statutDeCharge\(/);
    expect(accueil).not.toMatch(/statutCharge\s*=\s*[^;]*\?\s*statutDeCharge/);
  });

  it("ce statut atteint la VOITURE, où l'information vit maintenant", () => {
    // `finCharge` en dérive et descend jusqu'au point de la trappe : c'est le chemin qui
    // porte « en charge » et l'heure de fin sur la carrosserie.
    expect(accueil).toMatch(/const finCharge = statutCharge\.finAnnoncee/);
    expect(accueil).toMatch(/finCharge=\{finCharge\}/);
  });

  it("le rythme MESURÉ est un COMPLÉMENT, jamais la source du statut", () => {
    // `bandeauCharge` peut légitimement être `null` (le niveau ne monte pas). Il ne doit
    // donc jamais conditionner ce qui dit « en charge ou non » — seulement l'enrichir.
    expect(accueil).toMatch(/rythmeCharge=\{rythmeCharge\}/);
    expect(accueil).not.toMatch(/bandeauCharge && <Heros/);
  });
});


// ── LA FIN DE CHARGE, ANNONCÉE PAR LA VOITURE ──────────────────────────────────────────
//
// Marc, 20/08 : « je vois pas le temps de charge prévu ». La voiture le publie
// (`charge_time_remaining`), mais l'app le jetait — à raison hors charge, où la bZ ne remet
// pas le compteur à zéro et rediffuse la dernière valeur de la session précédente
// (constaté le 19/08 : 250 annoncées sur une batterie à 100 %, câble débranché).
describe("finAnnoncee — le compte à rebours de la voiture", () => {
  const releve = (minutes: number | null, ageMinutes = 10) => ({
    metricType: "charge_time_remaining",
    valueNumeric: minutes,
    valueText: null,
    ageMinutes,
    recordedAt: new Date("2026-08-20T14:17:50Z"),
  });

  it("annonce une fin quand la voiture charge", () => {
    const s = statutDeCharge([m("charging_status", true, 10), releve(250)]);
    expect(s.finAnnoncee).not.toBeNull();
    expect(s.finAnnoncee!.minutesRestantes).toBe(250);
  });

  it("compte depuis le RELEVÉ, jamais depuis maintenant", () => {
    // ⚠️ Le relevé de Marc avait 64 minutes quand je l'ai lu. Compter 250 min à partir de
    // « maintenant » décalerait la fin d'une heure entière — et elle serait FAUSSE d'autant
    // plus longtemps que la voiture publie lentement (30-60 min chez elle).
    const s = statutDeCharge([m("charging_status", true, 64), releve(250, 64)]);
    const attendu = new Date("2026-08-20T14:17:50Z").getTime() + 250 * 60_000;
    expect(s.finAnnoncee!.instant.getTime()).toBe(attendu);
  });

  it("NE publie RIEN hors charge — la valeur y est un reste figé", () => {
    // Le cas exact du 19/08 : 250 annoncées, batterie pleine, câble débranché.
    for (const etat of [
      [m("charging_status", false), m("charge_plugged_in", false), releve(250)],
      [m("charge_plugged_in", true), releve(250)], // statut inconnu
    ]) {
      expect(statutDeCharge(etat).finAnnoncee).toBeNull();
    }
  });

  it("refuse ce qui ne peut pas être vrai", () => {
    const enCharge = m("charging_status", true, 10);
    expect(statutDeCharge([enCharge, releve(null)]).finAnnoncee).toBeNull();
    expect(statutDeCharge([enCharge, releve(0)]).finAnnoncee).toBeNull();
    expect(statutDeCharge([enCharge, releve(-30)]).finAnnoncee).toBeNull();
    // Au-delà de deux jours : aucune charge domestique ne dure ça, donc on ne sait pas lire.
    expect(statutDeCharge([enCharge, releve(48 * 60 + 1)]).finAnnoncee).toBeNull();
    expect(statutDeCharge([enCharge, releve(48 * 60)]).finAnnoncee).not.toBeNull();
  });

  it("sans instant de mesure, pas de fin — on ne la fabrique pas", () => {
    const s = statutDeCharge([
      m("charging_status", true, 10),
      { metricType: "charge_time_remaining", valueNumeric: 250, valueText: null, ageMinutes: 10 },
    ]);
    expect(s.finAnnoncee).toBeNull();
  });

  it("la lecture en MINUTES tient l'épreuve arithmétique du 20/08", () => {
    // Batterie à 70 % de 57,7 kWh, 250 annoncées. Il reste ~17 kWh ; sur ~3,7 kW cela
    // prend ~4,7 h. 250 minutes font 4 h 10 : le même ordre de grandeur. En secondes ce
    // serait 4 minutes (impossible), en heures dix jours (absurde).
    const resteKwh = 57.7 * 0.3;
    const heuresPlausibles = resteKwh / 3.7;
    const heuresSiMinutes = 250 / 60;
    expect(Math.abs(heuresSiMinutes - heuresPlausibles)).toBeLessThan(1.5);
    expect(250 / 3600).toBeLessThan(0.2); // en secondes : 4 min, hors de portée
  });
});
