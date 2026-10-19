// tests/tarifsBornes.test.ts — le prix d'une recharge selon l'endroit.
//
// Ce qui se joue ici : Marc comparera ces montants à ses vraies factures. Un prix MESURÉ
// qui se mélangerait à un prix ESTIMÉ produirait un total dont personne ne peut dire ce
// qu'il vaut — et c'est le genre de chiffre qu'on ne repère qu'une fois la facture arrivée.
//
// ⚠️ Aucune coordonnée réelle de Marc dans ce fichier : le dépôt est PUBLIC. Les lieux de
// test sont des points arbitraires.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PALIERS_RAPIDE,
  TARIFS_TYPIQUES,
  distanceM,
  lieuDeLaPosition,
  positionPendant,
  palierRapide,
  prixSession,
  cumulerPrix,
  prixExploitable,
  TARIF_DOMESTIQUE_ORDRE_DE_GRANDEUR,
  tarifTypique,
  totaliserPrix,
  type LieuTarife,
  type PrixSession,
} from "@/lib/vehicle/tarifsBornes";

const BOULOT: LieuTarife = {
  nom: "Boulot",
  lat: 46.5,
  lng: -71.5,
  rayonM: 120,
  mode: "horaire",
  tarif: 1.0,
};
const MAISON: LieuTarife = {
  nom: "Maison",
  lat: 46.6,
  lng: -71.6,
  rayonM: 80,
  mode: "kwh",
  tarif: 0.078,
};

describe("distanceM", () => {
  it("mesure une vraie distance, pas un écart de degrés", () => {
    // Un degré de latitude ≈ 111 km, partout.
    expect(distanceM({ lat: 46, lng: -71 }, { lat: 47, lng: -71 })).toBeCloseTo(111_195, -2);
  });

  // ⚠️ À la latitude de Québec, un degré de LONGITUDE vaut ~0,69 fois un degré de latitude.
  // Une comparaison « à plat » sur les degrés apparierait le mauvais lieu.
  it("tient compte du rétrécissement des longitudes vers le nord", () => {
    const lat = distanceM({ lat: 46.8, lng: -71.2 }, { lat: 46.81, lng: -71.2 });
    const lng = distanceM({ lat: 46.8, lng: -71.2 }, { lat: 46.8, lng: -71.19 });
    expect(lng / lat).toBeCloseTo(0.684, 2);
  });

  it("rend zéro sur le même point", () => {
    expect(distanceM({ lat: 46.8, lng: -71.2 }, { lat: 46.8, lng: -71.2 })).toBe(0);
  });
});

describe("lieuDeLaPosition", () => {
  it("reconnaît un lieu quand on est dedans", () => {
    expect(lieuDeLaPosition({ lat: 46.5, lng: -71.5 }, [BOULOT, MAISON])?.nom).toBe("Boulot");
  });

  it("ne reconnaît rien hors du rayon — un lieu voisin n'est pas le bon lieu", () => {
    // ~1,1 km au nord du boulot, dont le rayon est de 120 m.
    expect(lieuDeLaPosition({ lat: 46.51, lng: -71.5 }, [BOULOT, MAISON])).toBeNull();
  });

  // ⚠️ Deux rayons qui se chevauchent doivent départager par la DISTANCE : sinon l'ordre de
  // saisie dans Réglages déciderait du prix.
  it("choisit le PLUS PROCHE, pas le premier de la liste", () => {
    const large: LieuTarife = { ...BOULOT, nom: "Rue", rayonM: 5_000, tarif: 3 };
    const proche: LieuTarife = { ...BOULOT, nom: "Garage", lat: 46.5001, rayonM: 200 };
    expect(lieuDeLaPosition({ lat: 46.5001, lng: -71.5 }, [large, proche])?.nom).toBe("Garage");
    // Et l'ordre inverse donne le même résultat — c'est ce qui le prouve.
    expect(lieuDeLaPosition({ lat: 46.5001, lng: -71.5 }, [proche, large])?.nom).toBe("Garage");
  });

  it("sans position, ne devine aucun lieu", () => {
    expect(lieuDeLaPosition(null, [BOULOT])).toBeNull();
  });
});

describe("prixSession", () => {
  // Le cas d'un lieu à tarif horaire : 1 $/h, facturé au TEMPS BRANCHÉ.
  it("facture une borne HORAIRE au temps, pas à l'énergie", () => {
    const p = prixSession({
      bornesEstimees: false,
      dureeMinutes: 150,
      energieKwh: 12,
      lieu: BOULOT,
      tarifKwh: 0.078,
    });
    expect(p.montant).toBeCloseTo(2.5, 6);
    expect(p.qualite).toBe("mesure");
    expect(p.explication).toContain("Boulot");
  });

  // ⚠️ La distinction qui compte : à durée égale, l'énergie ne change RIEN sur une borne
  // horaire. L'inverse ferait payer une charge lente moins cher qu'une rapide.
  it("sur une borne horaire, l'énergie ne change pas le montant", () => {
    const base = { dureeMinutes: 60, lieu: BOULOT, tarifKwh: 0.078, bornesEstimees: false };
    expect(prixSession({ ...base, energieKwh: 3 }).montant).toBe(
      prixSession({ ...base, energieKwh: 30 }).montant,
    );
  });

  // ⚠️ Une borne HORAIRE multiplie une DURÉE. Quand cette durée est la fenêtre entre deux
  // relevés — le cas de TOUTE session déduite du SOC, donc de toutes aujourd'hui — le
  // montant est un plafond, pas un relevé. Chiffre réel du 17/09 : « 1,00 $/h sur 3 h 52 »
  // affichait 3,86 $ en qualité « mesure » sur une charge dont personne ne connaît la
  // durée vraie.
  it("une borne HORAIRE sur des bornes ESTIMÉES rend un plafond, pas une mesure", () => {
    const p = prixSession({
      bornesEstimees: true,
      dureeMinutes: 81,
      energieKwh: 4,
      lieu: BOULOT,
      tarifKwh: 0.078,
    });
    expect(p.qualite).toBe("estime");
    expect(p.explication).toContain("AU PLUS");
  });

  // ⚠️ Le montant RESTE affiché : un trou dans un cumul coûte plus cher qu'un chiffre dont
  // on dit la valeur (règle du dépôt, arbitrage de Marc du 14/09). Ce qui change est le
  // STATUT du montant, jamais sa présence.
  it("le plafond garde le même montant qu'avant — seul son statut change", () => {
    const commun = { dureeMinutes: 81, energieKwh: 4, lieu: BOULOT, tarifKwh: 0.078 };
    const exact = prixSession({ ...commun, bornesEstimees: false });
    const fenetre = prixSession({ ...commun, bornesEstimees: true });
    expect(fenetre.montant).toBe(exact.montant);
    expect(exact.qualite).toBe("mesure");
  });

  // ⚠️ LE contrôle qui compte : au kWh, la durée n'entre PAS dans le calcul. Une fenêtre de
  // sondage n'altère donc rien, et la maison de Marc — son cas le plus fréquent — doit
  // rester une MESURE. Dégrader tout ce qui est estimé « par prudence » aurait mis une
  // mention d'incertitude sur des montants parfaitement exacts, et une mention qu'on lit
  // partout est une mention qu'on ne lit plus.
  it("au kWh, des bornes estimées ne dégradent RIEN", () => {
    const p = prixSession({
      bornesEstimees: true,
      dureeMinutes: 480,
      energieKwh: 10,
      lieu: MAISON,
      tarifKwh: 0.078,
    });
    expect(p.qualite).toBe("mesure");
    expect(p.montant).toBeCloseTo(0.78, 6);
  });

  it("facture une borne au kWh à l'énergie", () => {
    const p = prixSession({ bornesEstimees: false, dureeMinutes: 480, energieKwh: 40, lieu: MAISON, tarifKwh: null });
    expect(p.montant).toBeCloseTo(3.12, 6);
    expect(p.qualite).toBe("mesure");
  });

  it("un lieu au kWh sans énergie connue ne fabrique pas de montant", () => {
    const p = prixSession({ bornesEstimees: false, dureeMinutes: 480, energieKwh: null, lieu: MAISON, tarifKwh: 0.078 });
    expect(p.montant).toBeNull();
    expect(p.qualite).toBe("inconnu");
  });

  // ⚠️ LE point d'honnêteté. Marc a demandé les estimations en connaissance de cause ; elles
  // doivent rester DISTINGUABLES d'un vrai prix, sinon elles contaminent tout.
  it("étiquette « estime » un prix venu de la table publique", () => {
    const p = prixSession({
      bornesEstimees: false,
      dureeMinutes: 60,
      energieKwh: 10,
      lieu: null,
      tarifKwh: null,
      exploitant: "FLO",
    });
    expect(p.qualite).toBe("estime");
    expect(p.montant).toBeCloseTo(1.5, 6);
    expect(p.explication).toContain("Estimation");
  });

  // Le MESURÉ gagne toujours : un lieu tarifé par Marc écrase la table publique.
  it("le lieu de Marc l'emporte sur le tarif typique de l'exploitant", () => {
    const p = prixSession({
      bornesEstimees: false,
      dureeMinutes: 60,
      energieKwh: 10,
      lieu: BOULOT,
      tarifKwh: null,
      exploitant: "FLO",
    });
    expect(p.qualite).toBe("mesure");
    expect(p.montant).toBeCloseTo(1.0, 6);
  });

  it("sans lieu ni exploitant, le tarif du kWh reste une ESTIMATION", () => {
    const p = prixSession({ bornesEstimees: false, dureeMinutes: 60, energieKwh: 10, lieu: null, tarifKwh: 0.08 });
    expect(p.qualite).toBe("estime");
    expect(p.montant).toBeCloseTo(0.8, 6);
  });

  // ⚠️ Zéro se lirait « gratuit ». On rend `null`, et l'écran affiche « — ».
  //
  // ⚠️⚠️ Ce test ancrait la PHRASE (« enregistre ce lieu ») et il a rougi le 14/09 alors
  // que le fait qu'il défend n'avait pas bougé : c'est le MOTIF du refus qui a changé.
  // Depuis « signalé mais tout estimé », un lieu inconnu ne suffit plus à refuser — il ne
  // reste qu'un seul cas irréductible, celui où l'ÉNERGIE elle-même est inconnue. Une
  // garde ancre le fait, pas la formulation ; celle-ci nomme désormais la grandeur
  // manquante, qui EST le fait.
  it("rend null, jamais zéro, quand même l'énergie est inconnue", () => {
    const p = prixSession({ bornesEstimees: false, dureeMinutes: 60, energieKwh: null, lieu: null, tarifKwh: null });
    expect(p.montant).toBeNull();
    expect(p.qualite).toBe("inconnu");
    expect(p.explication).toContain("nergie inconnue");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════
// « SIGNALÉ MAIS TOUT ESTIMÉ » — arbitrage de Marc, 14/09.
//
// Avant : une recharge hors des lieux connus, à vitesse normale, sans tarif renseigné,
// rendait `inconnu` — donc un TROU dans un cumul qui se veut un total (4 sessions réelles
// sur 27). Marc préfère un ordre de grandeur annoncé. Ce qui se garde ici, c'est que le
// repli soit un repli : dernier de la chaîne, jamais `mesure`, et qui se dit.
// ══════════════════════════════════════════════════════════════════════════════════════

describe("le repli au tarif domestique", () => {
  it("chiffre une session que rien d'autre ne sait chiffrer", () => {
    const p = prixSession({ bornesEstimees: false, dureeMinutes: 90, energieKwh: 10, lieu: null, tarifKwh: null });
    expect(p.montant).toBeCloseTo(10 * TARIF_DOMESTIQUE_ORDRE_DE_GRANDEUR, 6);
    expect(p.qualite).toBe("estime");
  });

  it("ne rend JAMAIS `mesure` — c'est un ordre de grandeur, pas un prix", () => {
    // La frontière qui rend l'arbitrage acceptable : `totaliserPrix` ne mélange jamais les
    // deux, donc ce montant n'entre pas dans le total « mesuré ». S'il basculait en
    // `mesure`, il s'additionnerait aux vrais prix de Marc sans que rien ne le distingue.
    const p = prixSession({ bornesEstimees: false, dureeMinutes: 90, energieKwh: 10, lieu: null, tarifKwh: null });
    expect(p.qualite).not.toBe("mesure");
  });

  it("DIT qu'il estime, et comment le rendre exact", () => {
    // Un montant qui ne s'explique pas est indiscernable d'un prix relevé.
    const p = prixSession({ bornesEstimees: false, dureeMinutes: 90, energieKwh: 10, lieu: null, tarifKwh: null });
    expect(p.explication).toMatch(/[Ee]stimation/);
    expect(p.explication).toContain("Réglages");
  });

  it("est le DERNIER de la chaîne : tout ce qui est connu le supplante", () => {
    // L'ordre compte plus que la valeur. Chacune de ces sources est plus proche de la
    // vérité que l'ordre de grandeur, et chacune doit donc gagner.
    const parLieu = prixSession({
      bornesEstimees: false,
      dureeMinutes: 60,
      energieKwh: 10,
      lieu: { nom: "Maison", lat: 0, lng: 0, rayonM: 80, mode: "kwh", tarif: 0.06 },
      tarifKwh: null,
    });
    expect(parLieu.qualite).toBe("mesure");

    const parDebit = prixSession({
      bornesEstimees: false,
      dureeMinutes: 30,
      energieKwh: 25,
      lieu: null,
      tarifKwh: null,
      puissanceKw: 50,
    });
    expect(parDebit.explication).toContain("rapide");

    const parContrat = prixSession({
      bornesEstimees: false,
      dureeMinutes: 60,
      energieKwh: 10,
      lieu: null,
      tarifKwh: 0.1234,
    });
    expect(parContrat.montant).toBeCloseTo(1.234, 6);
  });

  it("sans énergie, il ne s'applique pas — on n'invente pas la grandeur elle-même", () => {
    // La frontière de ce qui reste refusé : estimer un PRIX suppose de connaître les kWh.
    // Les inventer ferait passer une session entière pour une mesure.
    const p = prixSession({ bornesEstimees: false, dureeMinutes: 60, energieKwh: null, lieu: null, tarifKwh: null });
    expect(p.montant).toBeNull();
  });

  it("l'ordre de grandeur reste dans le champ d'un tarif résidentiel", () => {
    // Pas d'ancrage sur la valeur exacte — elle est de mémoire et changera. Ce qui se
    // garde, c'est qu'elle reste un tarif de MAISON : au-dessus du prix de gros, et très
    // en dessous du moins cher des paliers rapides, sans quoi le repli cesserait d'être
    // un repli et deviendrait un prix de borne.
    expect(TARIF_DOMESTIQUE_ORDRE_DE_GRANDEUR).toBeGreaterThan(0.02);
    const moinsCherRapide = Math.min(...PALIERS_RAPIDE.map((p) => p.tarifKwh));
    expect(TARIF_DOMESTIQUE_ORDRE_DE_GRANDEUR).toBeLessThan(moinsCherRapide / 3);
  });
});

describe("tarifTypique", () => {
  it("reconnaît un exploitant quelle que soit la casse ou l'habillage", () => {
    expect(tarifTypique("FLO")?.exploitant).toBe("flo");
    expect(tarifTypique("  Flo Networks ")?.exploitant).toBe("flo");
    expect(tarifTypique("Circuit électrique")?.exploitant).toBe("circuit électrique");
  });

  it("ne devine rien sur un exploitant qu'elle ne connaît pas", () => {
    expect(tarifTypique("Tesla")).toBeNull();
    expect(tarifTypique("")).toBeNull();
    expect(tarifTypique(null)).toBeNull();
  });

  // ⚠️ Ces tarifs ne sont pas mesurés : chacun DOIT porter une note qui le dit, sinon un
  // montant estimé s'afficherait sans que rien ne le distingue d'un relevé.
  it("chaque tarif typique porte sa note datée", () => {
    for (const t of TARIFS_TYPIQUES) {
      expect(t.note.length, t.exploitant).toBeGreaterThan(10);
      expect(t.note, t.exploitant).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    }
  });
});

describe("totaliserPrix", () => {
  // ⚠️ LE garde du total. Additionner un prix connu et un prix supposé produit un montant
  // dont personne ne peut dire ce qu'il vaut — même famille que « jamais d'agrégat entre
  // unités incomparables », l'incomparable étant ici la CONFIANCE.
  it("SÉPARE le mesuré de l'estimé au lieu de les additionner", () => {
    const total = totaliserPrix([
      { montant: 2.5, qualite: "mesure", explication: "" },
      { montant: 1.5, qualite: "estime", explication: "" },
      { montant: 1.0, qualite: "mesure", explication: "" },
      { montant: null, qualite: "inconnu", explication: "" },
    ]);
    expect(total.mesure).toBeCloseTo(3.5, 6);
    expect(total.estime).toBeCloseTo(1.5, 6);
    expect(total.nbInconnus).toBe(1);
  });

  it("compte les inconnus plutôt que de les traiter comme des zéros", () => {
    const total = totaliserPrix([
      { montant: null, qualite: "inconnu", explication: "" },
      { montant: null, qualite: "inconnu", explication: "" },
    ]);
    expect(total.mesure).toBe(0);
    expect(total.estime).toBe(0);
    expect(total.nbInconnus).toBe(2);
  });
});

describe("positionPendant", () => {
  const P = (h: number, lat: number) => ({ t: new Date(Date.UTC(2026, 7, 13, h)), lat, lng: -71.5 });
  const session = { debut: new Date(Date.UTC(2026, 7, 13, 20)), fin: new Date(Date.UTC(2026, 7, 13, 23)) };

  it("prend le dernier relevé AVANT la fin de la session", () => {
    expect(positionPendant(session, [P(18, 46.1), P(21, 46.2)])?.lat).toBe(46.2);
  });

  // ⚠️ LE piège. La bZ ne publie sa position qu'à l'arrêt : le relevé qui SUIT une recharge
  // est souvent le stationnement d'arrivée du trajet suivant, ailleurs. Prendre « le plus
  // proche dans le temps » apparierait la maison à une recharge faite au travail.
  it("IGNORE un relevé postérieur, même s'il est plus proche dans le temps", () => {
    // 19 h est à 1 h du début ; 23 h 30 est à 30 min de la fin — mais c'est APRÈS.
    const apres = { t: new Date(Date.UTC(2026, 7, 13, 23, 30)), lat: 46.9, lng: -71.5 };
    expect(positionPendant(session, [P(19, 46.1), apres])?.lat).toBe(46.1);
  });

  it("refuse un relevé trop vieux plutôt que d'apparier au hasard", () => {
    // Trois jours avant : il ne dit rien de cette session.
    const vieux = { t: new Date(Date.UTC(2026, 7, 10, 12)), lat: 46.1, lng: -71.5 };
    expect(positionPendant(session, [vieux])).toBeNull();
  });

  it("sans aucun relevé, ne devine pas de position", () => {
    expect(positionPendant(session, [])).toBeNull();
  });
});

describe("le prix de la recharge rapide suit le DÉBIT", () => {
  // Marc, 14/09 : « pour le prix de l'électricité je veux que ce soit par rapport au débit
  // de charge ».
  //
  // ⚠️ CE QUE CE BLOC PROTÈGE, mesuré sur le code d'avant avec exactement ce que passent
  // les trois appelants de production : une recharge rapide de 50 kWh en 30 minutes
  // (débit 100 kW) était facturée 3,91 $ — le tarif du kWh domestique. Le même cas rend
  // maintenant 22,50 $. L'écart n'est pas un arrondi, c'est un facteur 5,75.

  const rapide = (energieKwh: number, puissanceKw: number) =>
    prixSession({ bornesEstimees: false, dureeMinutes: 30, energieKwh, lieu: null, tarifKwh: 0.0782, puissanceKw });

  it("les paliers sont ORDONNÉS, et le tarif monte avec la puissance", () => {
    // ⚠️ C'est la seule chose SOLIDE de cette table : les valeurs sont des ordres de
    // grandeur de mémoire (Marc a choisi cette option en connaissance de cause), mais le
    // SENS de la relation ne se négocie pas. Une inversion ferait payer une borne rapide
    // moins cher qu'une lente.
    for (let i = 1; i < PALIERS_RAPIDE.length; i++) {
      const plusPuissant = PALIERS_RAPIDE[i - 1]!;
      const moins = PALIERS_RAPIDE[i]!;
      expect(plusPuissant.nominaleKw).toBeGreaterThan(moins.nominaleKw);
      expect(plusPuissant.seuilKw).toBeGreaterThan(moins.seuilKw);
      expect(plusPuissant.tarifKwh).toBeGreaterThan(moins.tarifKwh);
    }
  });

  it("chaque seuil est le MILIEU entre deux puissances nominales", () => {
    // ⚠️ Les seuils sont DÉRIVÉS, pas choisis : on classe sur un débit MESURÉ alors que
    // les paliers portent des puissances NOMINALES, et aucune borne n'atteint sa nominale
    // en moyenne sur une session entière. Écrire 100 et 180 aurait supposé le contraire.
    const nominales = PALIERS_RAPIDE.map((p) => p.nominaleKw);
    for (let i = 0; i < PALIERS_RAPIDE.length - 1; i++) {
      const attendu = (nominales[i]! + nominales[i + 1]!) / 2;
      expect(PALIERS_RAPIDE[i]!.seuilKw, `seuil du palier ${nominales[i]} kW`).toBe(attendu);
    }
  });

  it("le palier le plus PUISSANT gagne — un débit élevé ne tombe pas dans le petit", () => {
    // ⚠️ Le piège exact : parcourus dans l'autre sens, 200 kW tomberait dans le palier
    // 50 kW (le premier dont il dépasse le seuil) et serait facturé au tarif le plus bas.
    expect(palierRapide(200)?.nominaleKw).toBe(180);
    expect(palierRapide(150)?.nominaleKw).toBe(180);
    expect(palierRapide(100)?.nominaleKw).toBe(100);
    expect(palierRapide(80)?.nominaleKw).toBe(100);
    expect(palierRapide(50)?.nominaleKw).toBe(50);
    expect(palierRapide(20)?.nominaleKw).toBe(50);
  });

  it("sous le seuil de la recharge rapide, aucun palier", () => {
    // Un niveau 2 ou un niveau 1 garde le chemin d'avant : ce lot ne change QUE le rapide.
    expect(palierRapide(19.9)).toBeNull();
    expect(palierRapide(7)).toBeNull();
    expect(palierRapide(1.4)).toBeNull();
    expect(palierRapide(0)).toBeNull();
  });

  it("un débit absent ou absurde ne fabrique pas de palier", () => {
    // Absence ≠ zéro : sans débit connu, on retombe sur le comportement d'avant plutôt
    // que d'inventer une classe de borne.
    expect(palierRapide(null)).toBeNull();
    expect(palierRapide(undefined)).toBeNull();
    expect(palierRapide(Number.NaN)).toBeNull();
    expect(palierRapide(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("le prix d'une charge rapide est plusieurs fois celui du tarif domestique", () => {
    // On ancre le RAPPORT, pas le montant : les tarifs de la table sont des ordres de
    // grandeur qui se corrigeront, la relation « le rapide coûte beaucoup plus cher »
    // est le fait que Marc a demandé de rendre vrai.
    const domestique = prixSession({
      bornesEstimees: false,
      dureeMinutes: 30,
      energieKwh: 50,
      lieu: null,
      tarifKwh: 0.0782,
    });
    const auDebit = rapide(50, 100);
    expect(domestique.montant).not.toBeNull();
    expect(auDebit.montant).not.toBeNull();
    expect(auDebit.montant! / domestique.montant!).toBeGreaterThan(3);
  });

  it("le prix suit le palier, donc le débit", () => {
    const a = rapide(50, 25)!.montant!;
    const b = rapide(50, 100)!.montant!;
    const c = rapide(50, 200)!.montant!;
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it("une charge rapide reste une ESTIMATION, et le dit", () => {
    const p = rapide(50, 100);
    expect(p.qualite).toBe("estime");
    // Le débit mesuré et le palier retenu sont DANS l'explication : sans eux, personne ne
    // peut juger si le montant est plausible.
    expect(p.explication).toMatch(/100 kW/);
    expect(p.explication).toMatch(/minorant/i);
  });

  it("sans énergie connue, aucun montant — jamais zéro", () => {
    // Un 0 $ se lirait « gratuit ». Le rapide se facture au kWh : sans kWh, on ne sait pas.
    const p = prixSession({
      bornesEstimees: false,
      dureeMinutes: 30,
      energieKwh: null,
      lieu: null,
      tarifKwh: 0.0782,
      puissanceKw: 100,
    });
    expect(p.montant).toBeNull();
    expect(p.qualite).toBe("inconnu");
  });

  it("un LIEU tarifé par Marc gagne TOUJOURS, même sur une charge rapide", () => {
    // ⚠️ L'ordre des sources n'est pas négociable : charger vite chez soi reste facturé au
    // tarif de chez soi. Le mesuré gagne sur l'estimé, et un palier est un estimé.
    const maison: LieuTarife = {
      nom: "Maison",
      lat: 46.8,
      lng: -71.2,
      rayonM: 50,
      mode: "kwh",
      tarif: 0.0782,
    };
    const p = prixSession({
      bornesEstimees: false,
      dureeMinutes: 30,
      energieKwh: 50,
      lieu: maison,
      tarifKwh: 0.0782,
      puissanceKw: 100,
    });
    expect(p.qualite).toBe("mesure");
    expect(p.montant).toBeCloseTo(50 * 0.0782, 6);
  });

  it("sans débit passé, le comportement d'AVANT est intact", () => {
    // ⚠️ Le paramètre est optionnel exprès : un appelant qui ne le passe pas doit obtenir
    // exactement ce qu'il obtenait. C'est ce qui rend le branchement des trois écrans
    // vérifiable un par un plutôt que d'un bloc.
    const avant = prixSession({
      bornesEstimees: false,
      dureeMinutes: 30,
      energieKwh: 50,
      lieu: null,
      tarifKwh: 0.0782,
    });
    expect(avant.montant).toBeCloseTo(50 * 0.0782, 6);
  });
});

describe("le débit arrive vraiment jusqu'au prix, dans les TROIS écrans", () => {
  // ⚠️ POURQUOI CE BLOC EXISTE. `prixSession` est pure et testée ; ses APPELANTS ne le sont
  // pas. Le paramètre `puissanceKw` est optionnel — c'est voulu — donc un appelant qui
  // cesse de le passer retombe en SILENCE sur le tarif domestique, avec toutes les
  // assertions ci-dessus au vert. C'est exactement le trou « entre deux moitiés testées »
  // que l'écosystème a déjà payé : la fonction marche, la chaîne est débranchée.
  //
  // Un scan de source est le seul outil qui voit un appelant enfoui dans une page serveur.

  const APPELANTS = ["app/page.tsx", "app/activite/page.tsx", "lib/mcp/outils.ts"];

  it.each(APPELANTS)("%s passe le débit mesuré à prixSession", (fichier) => {
    const source = readFileSync(fichier, "utf8");
    // ⚠️ Source DÉCOMMENTÉE : ces fichiers portent des commentaires qui citent
    // `puissanceKw` pour expliquer le branchement, et un test qui matche un commentaire
    // passe au vert en ne prouvant rien. Le piège est documenté deux fois dans ce dépôt.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code, `${fichier} n'appelle plus prixSession`).toMatch(/prixSession\(/);
    expect(code, `${fichier} n'alimente pas puissanceKw`).toMatch(
      /puissanceKw:\s*estimerBorne\([^)]*\)\?\.puissanceKw/,
    );
  });

  it("le décommentage ne vide pas les fichiers scannés", () => {
    // Anti-vacuité : sans ça, « le motif est absent » se prouverait à partir de
    // « il ne reste plus rien à lire ».
    for (const fichier of APPELANTS) {
      const code = readFileSync(fichier, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(code.replace(/\s/g, "").length, `${fichier} est vide après décommentage`).toBeGreaterThan(
        500,
      );
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════
// LA COURBE DE CUMUL — « courbe aussi de prix à rajouter » (Marc, 14/09).
//
// Ce qui se joue : la courbe est posée SOUS le total, sur le même écran. Si les deux ne
// tombent pas sur le même chiffre, l'un des deux ment et rien ne dit lequel. D'où
// l'invariant central ci-dessous, qui les confronte plutôt que de les vérifier chacun
// dans son coin.
// ══════════════════════════════════════════════════════════════════════════════════════

function prixMesure(montant: number): PrixSession {
  return { montant, qualite: "mesure", explication: "test" };
}
function prixEstime(montant: number): PrixSession {
  return { montant, qualite: "estime", explication: "test" };
}
const PRIX_INCONNU: PrixSession = { montant: null, qualite: "inconnu", explication: "test" };

const J = (jour: number) => new Date(`2026-08-${String(jour).padStart(2, "0")}T12:00:00.000Z`);

describe("cumulerPrix", () => {
  it("trie du plus ANCIEN au plus récent, même si l'entrée est décroissante", () => {
    // `reconstituerCharges` rend les sessions du plus récent au plus ancien. Une courbe
    // qui garderait cet ordre monterait à l'envers : le cumul finirait à son plus petit.
    const { points } = cumulerPrix([
      { debut: J(12), prix: prixMesure(3) },
      { debut: J(10), prix: prixMesure(2) },
      { debut: J(8), prix: prixMesure(1) },
    ]);
    expect(points.map((p) => p.t.getTime())).toEqual([J(8), J(10), J(12)].map((d) => d.getTime()));
    expect(points.map((p) => p.mesure)).toEqual([1, 3, 6]);
  });

  it("ne trie PAS le tableau de l'appelant", () => {
    // Le même tableau nourrit le fil affiché : le réordonner ici retournerait la journée
    // de Marc à l'écran, sans que rien ne relie la cause à l'effet.
    const entree = [
      { debut: J(12), prix: prixMesure(3) },
      { debut: J(8), prix: prixMesure(1) },
    ];
    cumulerPrix(entree);
    expect(entree.map((s) => s.debut.getTime())).toEqual([J(12).getTime(), J(8).getTime()]);
  });

  it("cumule le MESURÉ et l'ESTIMÉ séparément, jamais ensemble", () => {
    const { points } = cumulerPrix([
      { debut: J(8), prix: prixMesure(10) },
      { debut: J(9), prix: prixEstime(5) },
      { debut: J(10), prix: prixMesure(2) },
    ]);
    expect(points.map((p) => p.mesure)).toEqual([10, 10, 12]);
    expect(points.map((p) => p.estime)).toEqual([0, 5, 5]);
    // La somme des deux n'est calculée NULLE PART : si elle l'était, ce serait le chiffre
    // que `totaliserPrix` refuse de produire depuis le premier jour.
    expect(points.at(-1)).not.toHaveProperty("total");
  });

  it("une recharge SANS PRIX ne fait pas de point — et surtout pas un point à zéro", () => {
    // Un palier sur un cumul se lit « celle-là était gratuite ». C'est le mensonge que
    // `montant: null` existe pour éviter : elle est comptée à part, pas aplatie.
    const { points, nbIgnorees } = cumulerPrix([
      { debut: J(8), prix: prixMesure(10) },
      { debut: J(9), prix: PRIX_INCONNU },
      { debut: J(10), prix: prixMesure(2) },
    ]);
    expect(nbIgnorees).toBe(1);
    expect(points).toHaveLength(2);
    expect(points.map((p) => p.t.getTime())).toEqual([J(8).getTime(), J(10).getTime()]);
  });

  it("un montant de ZÉRO est une mesure, pas une absence", () => {
    // Une borne gratuite existe. Elle produit un point (plat), contrairement à un prix
    // inconnu : « je sais que ça n'a rien coûté » et « je ne sais pas » ne se ressemblent
    // que dans l'affichage, jamais dans les données.
    const { points, nbIgnorees } = cumulerPrix([
      { debut: J(8), prix: prixMesure(4) },
      { debut: J(9), prix: prixMesure(0) },
    ]);
    expect(nbIgnorees).toBe(0);
    expect(points.map((p) => p.mesure)).toEqual([4, 4]);
  });

  it("sans aucune session, rend une courbe vide plutôt que de lever", () => {
    expect(cumulerPrix([])).toEqual({ points: [], nbIgnorees: 0 });
  });

  it("⚠️ INVARIANT : le DERNIER point vaut exactement le total affiché au-dessus", () => {
    // C'est la garde qui compte. La courbe et la tuile sont sur le même écran, nourries
    // par les mêmes sessions : elles doivent tomber au même endroit, sinon Marc voit deux
    // montants pour une seule question. Exclure les mêmes sessions est la moitié du
    // travail — d'où `prixExploitable`, partagé par les deux.
    const sessions = [
      { debut: J(8), prix: prixMesure(10.5) },
      { debut: J(9), prix: PRIX_INCONNU },
      { debut: J(10), prix: prixEstime(3.25) },
      { debut: J(11), prix: prixMesure(1.25) },
      { debut: J(12), prix: prixEstime(0.5) },
    ];
    const { points, nbIgnorees } = cumulerPrix(sessions);
    const totaux = totaliserPrix(sessions.map((s) => s.prix));
    expect(points.at(-1)!.mesure).toBeCloseTo(totaux.mesure, 10);
    expect(points.at(-1)!.estime).toBeCloseTo(totaux.estime, 10);
    expect(nbIgnorees).toBe(totaux.nbInconnus);
  });

  it("⚠️ l'invariant tient aussi quand TOUT est inconnu", () => {
    // Cas limite qui a sa propre façon de casser : pas de dernier point du tout. Un
    // `points.at(-1)!.mesure` écrit sans y penser lèverait ici, pas dans le cas nominal.
    const sessions = [
      { debut: J(8), prix: PRIX_INCONNU },
      { debut: J(9), prix: PRIX_INCONNU },
    ];
    const { points, nbIgnorees } = cumulerPrix(sessions);
    const totaux = totaliserPrix(sessions.map((s) => s.prix));
    expect(points).toHaveLength(0);
    expect(nbIgnorees).toBe(totaux.nbInconnus);
    expect(totaux.mesure).toBe(0);
  });
});

describe("prixExploitable", () => {
  it("écarte ce qui n'a pas de montant, garde un zéro véritable", () => {
    expect(prixExploitable(prixMesure(0))).toBe(true);
    expect(prixExploitable(prixMesure(12))).toBe(true);
    expect(prixExploitable(prixEstime(3))).toBe(true);
    expect(prixExploitable(PRIX_INCONNU)).toBe(false);
    // Un montant posé avec une qualité « inconnu » est une incohérence : on refuse le
    // montant, pas l'inverse. Le contraire ferait entrer dans un total un chiffre dont le
    // producteur vient de dire qu'il ne le connaît pas.
    expect(prixExploitable({ montant: 9, qualite: "inconnu", explication: "" })).toBe(false);
  });
});
