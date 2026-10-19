// tests/analyse.test.ts — l'état vivant des signaux et les courbes, sur le VRAI schéma.

import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { vehicleSnapshots } from "@/lib/db/schema";
import {
  aplatirJson,
  classerSignal,
  decimalesPour,
  dernierEtatStructure,
  estMetriquePosition,
  etatDesSignaux,
  formeDeMetrique,
  metriquesDisponibles,
  motifDuRefus,
  serieEtat,
  LIMITE_HISTORIQUE_COMPLET,
  serieNumerique,
  traceDouble,
  sousEchantillonner,
  traceBail,
  traceSvg,
  aireSvg,
  traceMulti,
  bandesSurvol,
  rouesDuJson,
  type EtatSignal,
  type PointSerie,
} from "@/lib/vehicle/analyse";
import { resumerStatutsSignaux } from "@/lib/smartcar/signals";
import { calculerEtatBail } from "@/lib/vehicle/lease";
import { baseDeTest } from "./aides/basePGlite";

const dbTest = baseDeTest([vehicleSnapshots]).base;
const dbx = dbTest as unknown as Parameters<typeof etatDesSignaux>[0];

const T = (h: number) => new Date(Date.UTC(2026, 7, 6, h, 0, 0));

describe("etatDesSignaux — le DERNIER statut fait foi", () => {
  it("un signal passé d'ERROR à SUCCESS est classé sur sa ligne la plus récente", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "smartcar", metricType: "battery_soc", signalCode: "tractionbattery-stateofcharge", signalStatus: "ERROR", valueNumeric: null },
      { recordedAt: T(12), source: "smartcar", metricType: "battery_soc", signalCode: "tractionbattery-stateofcharge", signalStatus: "SUCCESS", valueNumeric: 75 },
      { recordedAt: T(12), source: "smartcar", metricType: "sunroof_status", signalCode: "closure-sunroof", signalStatus: "ERROR", valueNumeric: null },
    ]);

    const etats = await etatDesSignaux(dbx);
    const soc = etats.find((e) => e.signalCode === "tractionbattery-stateofcharge")!;
    expect(soc.dernierStatut).toBe("SUCCESS");
    expect(soc.porteValeur).toBe(true);
    expect(soc.nbMesures).toBe(2);
    expect(classerSignal(soc)).toBe("fonctionne");

    const toit = etats.find((e) => e.signalCode === "closure-sunroof")!;
    expect(classerSignal(toit)).toBe("refuse");
  });

  it("SUCCESS sans valeur n'est ni « fonctionne » ni « refusé » — c'est dit tel quel", () => {
    const etat: EtatSignal = {
      signalCode: "x",
      metricType: "x",
      source: "smartcar",
      dernierStatut: "SUCCESS",
      derniereMesure: T(12),
      porteValeur: false,
      nbMesures: 3,
    };
    expect(classerSignal(etat)).toBe("sans_valeur");
    // Sans statut déclaré mais avec valeur : fonctionne (les premières livraisons
    // n'avaient pas la colonne statut).
    expect(classerSignal({ ...etat, dernierStatut: null, porteValeur: true })).toBe(
      "fonctionne",
    );
    // UNKNOWN n'est PAS un refus : « le véhicule gère la donnée mais n'en a pas fourni
    // de valide cette fois-ci » (Doc 2 §5.3) — même sémantique que dans l'ingestion.
    expect(classerSignal({ ...etat, dernierStatut: "UNKNOWN" })).toBe("sans_valeur");
    // Un ERROR enrichi de son motif reste un refus.
    expect(classerSignal({ ...etat, dernierStatut: "ERROR (COMPATIBILITY)" })).toBe("refuse");
  });

  // Ce classement commande un geste irréversible côté Marc : décocher un signal dans la
  // console Smartcar. Confondre COMPATIBILITY (à retirer, ne marchera jamais) et
  // PERMISSION (à récupérer par un re-Connect) lui ferait fermer la porte de la clim et
  // de la vitesse pour rien.
  it("distingue les motifs de refus, parce qu'ils appellent des gestes OPPOSÉS", () => {
    const base: EtatSignal = {
      signalCode: "x",
      metricType: "x",
      source: "smartcar",
      dernierStatut: null,
      derniereMesure: T(12),
      porteValeur: false,
      nbMesures: 1,
    };
    const motif = (statut: string) => motifDuRefus({ ...base, dernierStatut: statut });

    expect(motif("ERROR (COMPATIBILITY)")).toBe("compatibilite");
    expect(motif("ERROR (PERMISSION)")).toBe("permission");
    expect(motif("ERROR (UPSTREAM)")).toBe("amont");
    // Un ERROR nu ne se range dans aucune des trois : on ne devine pas un geste.
    expect(motif("ERROR")).toBe("autre");
    // Insensible à la casse : le motif vient de la source, pas de sa graphie.
    expect(motif("error (permission)")).toBe("permission");
  });

  it("deux SOURCES portant le même code sont deux états distincts", async () => {
    await dbTest.execute(sql`DELETE FROM vehicle_snapshots`);
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "smartcar", metricType: "battery_soc", signalCode: "code-partage", signalStatus: "SUCCESS", valueNumeric: 75 },
      { recordedAt: T(12), source: "toyota_na", metricType: "battery_soc", signalCode: "code-partage", signalStatus: "ERROR", valueNumeric: null },
    ]);
    const etats = await etatDesSignaux(dbx);
    const parSource = etats.filter((e) => e.signalCode === "code-partage");
    // Sans la source dans le DISTINCT, l'état toyota (plus récent) aurait MASQUÉ le
    // smartcar fonctionnel.
    expect(parSource).toHaveLength(2);
  });
});

describe("serieNumerique — du plus ancien au plus récent, avec son unité", () => {
  it("ordonne, filtre depuis, ignore les lignes sans valeur numérique", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "smartcar", metricType: "battery_soc", valueNumeric: 70, unit: "percent" },
      { recordedAt: T(11), source: "smartcar", metricType: "battery_soc", valueNumeric: null, valueText: "?" },
      { recordedAt: T(12), source: "smartcar", metricType: "battery_soc", valueNumeric: 74, unit: "percent" },
      { recordedAt: T(13), source: "smartcar", metricType: "odometer", valueNumeric: 2800 },
    ]);

    const { points, unite } = await serieNumerique("battery_soc", { dbx });
    expect(points.map((p) => p.valeur)).toEqual([70, 74]);
    expect(unite).toBe("percent");

    const fenetre = await serieNumerique("battery_soc", { depuis: T(11), dbx });
    expect(fenetre.points.map((p) => p.valeur)).toEqual([74]);
  });

  it("la LIMITE garde le côté RÉCENT — une courbe ne se fige jamais sur le passé", async () => {
    // `LIMIT` en ordre croissant aurait gardé les plus VIEUX points : la courbe se
    // serait figée en silence dès qu'une série dépasse la borne (finding HIGH de la
    // revue du 06/08 — la leçon DriveAI des bornes de tête, sous un autre visage).
    await dbTest.insert(vehicleSnapshots).values(
      [10, 11, 12, 13, 14].map((h) => ({
        recordedAt: T(h),
        source: "smartcar" as const,
        metricType: "battery_soc",
        valueNumeric: h,
      })),
    );

    const { points } = await serieNumerique("battery_soc", { limite: 3, dbx });
    // Les 3 plus RÉCENTS, remis en ordre chronologique.
    expect(points.map((p) => p.valeur)).toEqual([12, 13, 14]);
  });

  // ══ LA TRONCATURE SE DIT ═══════════════════════════════════════════════════════════
  //
  // ⚠️ POURQUOI C'EST CRITIQUE ICI. La fenêtre est ancrée du côté RÉCENT : quand la borne
  // mord, ce sont les relevés les plus VIEUX qui manquent. Un cumul « depuis le début »
  // bâti là-dessus sous-compte donc en silence, et rien dans le résultat ne permet de le
  // voir. Marc, 14/09 : « je veux que ça fasse tout l'historique » — un total amputé qui
  // se présente comme complet serait exactement le contraire de ce qu'il a demandé.
  it("DIT quand la borne a mordu", async () => {
    await dbTest.insert(vehicleSnapshots).values(
      [10, 11, 12, 13, 14].map((h) => ({
        recordedAt: T(h),
        source: "smartcar" as const,
        metricType: "battery_soc",
        valueNumeric: h,
      })),
    );

    const tronquee = await serieNumerique("battery_soc", { limite: 3, dbx });
    expect(tronquee.tronquee, "3 lues sur 5 : la borne a mordu").toBe(true);

    const juste = await serieNumerique("battery_soc", { limite: 5, dbx });
    expect(juste.tronquee, "5 lues sur 5 : rien ne manque").toBe(false);

    const large = await serieNumerique("battery_soc", { limite: 500, dbx });
    expect(large.tronquee).toBe(false);
    expect(large.points).toHaveLength(5);
  });

  it("la troncature se compte sur les lignes LUES, pas sur les points rendus", async () => {
    // ⚠️ Le piège exact : `filtrerPlausible` écarte des points APRÈS la lecture — sur
    // `odometer`, où un compteur qui RECULE est impossible. Compter les points rendus
    // dirait « pas de troncature » sur une lecture pourtant bornée, dès qu'une seule
    // valeur aberrante est écartée.
    //
    // ⚠️ Mon premier jet montait ce cas sur `battery_soc` avec une valeur de 150 % :
    // `filtrerPlausible` ne filtre QUE l'odomètre, donc rien n'était écarté et le test
    // mesurait un mécanisme qui n'existe pas. Vérifié dans le code plutôt que supposé.
    // ⚠️ ET LE RECUL DOIT TOMBER DANS LA FENÊTRE LUE. Mon deuxième jet le plaçait en T(11)
    // avec une borne de 3 : la fenêtre gardait T(11)-T(13), donc le recul devenait le
    // PREMIER point de la série et plus rien ne reculait par rapport à lui — zéro point
    // écarté, test vert sur un mécanisme jamais exercé. Une fixture qui n'atteint pas le
    // chemin testé ne mesure rien.
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "smartcar" as const, metricType: "odometer", valueNumeric: 990 },
      { recordedAt: T(11), source: "smartcar" as const, metricType: "odometer", valueNumeric: 1000 },
      // Un recul : impossible pour un odomètre, donc écarté après la lecture.
      { recordedAt: T(12), source: "smartcar" as const, metricType: "odometer", valueNumeric: 400 },
      { recordedAt: T(13), source: "smartcar" as const, metricType: "odometer", valueNumeric: 1010 },
    ]);

    const r = await serieNumerique("odometer", { limite: 3, dbx });
    expect(r.points.length, "un point a été écarté comme implausible").toBeLessThan(3);
    expect(r.tronquee, "quatre lignes en base pour une borne de trois : la borne a mordu").toBe(
      true,
    );
  });

  it("une série vide n'est jamais annoncée tronquée", async () => {
    const r = await serieNumerique("battery_soc", { dbx });
    expect(r.points).toEqual([]);
    expect(r.tronquee).toBe(false);
  });

  it("le refus de `location` rend la forme COMPLÈTE", async () => {
    // Sinon le champ manquerait sur ce chemin, et un consommateur lirait `undefined` —
    // qui est faux au sens de `tronquee` sans jamais avoir été décidé.
    const r = await serieNumerique("location", { dbx });
    expect(r).toEqual({ points: [], unite: null, tronquee: false });
  });

  it("la borne de l'historique complet est DÉRIVÉE, et couvre le bail", () => {
    // ⚠️ Elle n'est pas un chiffre rond choisi au jugé : à 24-48 relevés par jour
    // (Smartcar rafraîchit aux 30-60 min), elle doit couvrir plusieurs ANNÉES — sinon un
    // cumul « depuis le début » se met à mentir au milieu du bail, en silence.
    const PAR_JOUR_MAX = 48;
    const anneesCouvertes = LIMITE_HISTORIQUE_COMPLET / PAR_JOUR_MAX / 365;
    expect(anneesCouvertes, `${anneesCouvertes.toFixed(1)} an(s) couverts au pire débit`).toBeGreaterThan(2);
    // Et elle existe : une requête sans borne du tout sur une table qui grandit pour
    // toujours serait une bombe à retardement.
    expect(Number.isFinite(LIMITE_HISTORIQUE_COMPLET)).toBe(true);
  });

  // L'onglet Données trace la métrique FILTRÉE au-dessus du tableau qui la liste. Si la
  // courbe ignorait le filtre de source, l'écran porterait deux vérités : une courbe
  // « toutes sources » au-dessus de lignes d'une seule source, sans rien pour le dire.
  it("respecte le filtre de SOURCE — la courbe couvre la même sélection que le tableau", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "smartcar", metricType: "battery_soc", valueNumeric: 70, unit: "percent" },
      { recordedAt: T(11), source: "toyota_na", metricType: "battery_soc", valueNumeric: 99, unit: "percent" },
      { recordedAt: T(12), source: "smartcar", metricType: "battery_soc", valueNumeric: 74, unit: "percent" },
    ]);

    const tout = await serieNumerique("battery_soc", { dbx });
    expect(tout.points.map((p) => p.valeur)).toEqual([70, 99, 74]);

    const filtree = await serieNumerique("battery_soc", { source: "smartcar", dbx });
    expect(filtree.points.map((p) => p.valeur)).toEqual([70, 74]);

    // `null` explicite = pas de filtre, comme l'absence d'option : c'est ce que la page
    // passe quand aucune source n'est choisie.
    const sansFiltre = await serieNumerique("battery_soc", { source: null, dbx });
    expect(sansFiltre.points).toHaveLength(3);
  });

  it("une POSITION ne se trace pas, même appelée directement", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(10), source: "smartcar", metricType: "location", valueNumeric: 46.1 },
    ]);
    const { points } = await serieNumerique("location", { dbx });
    expect(points).toEqual([]);
    const inconnue = await serieNumerique("location-approximatelocation", { dbx });
    expect(inconnue.points).toEqual([]);
  });
});

describe("sousEchantillonner — jamais perdre le premier ni le DERNIER point", () => {
  const serie = (n: number): PointSerie[] =>
    Array.from({ length: n }, (_, i) => ({ t: new Date(i * 1000), valeur: i }));

  it("réduit en gardant les extrémités", () => {
    const reduit = sousEchantillonner(serie(4000), 300);
    expect(reduit.length).toBeLessThanOrEqual(600);
    expect(reduit.length).toBeGreaterThanOrEqual(300);
    expect(reduit[0]!.valeur).toBe(0);
    // Perdre le dernier point mentirait sur la FRAÎCHEUR de la série.
    expect(reduit[reduit.length - 1]!.valeur).toBe(3999);
    // Et l'ordre chronologique survit à la décimation par seaux.
    for (let i = 1; i < reduit.length; i++) {
      expect(reduit[i]!.t.getTime()).toBeGreaterThanOrEqual(reduit[i - 1]!.t.getTime());
    }
  });

  it("un PIC survit à la décimation — la légende ne peut pas mentir", () => {
    // Un stride naïf (un point sur N) effaçait un pic tombé entre deux pas, et le
    // min–max affiché était alors calculé sur la série décimée (revue du 06/08).
    const points = serie(4000);
    points[1777] = { t: points[1777]!.t, valeur: 99_999 };
    points[2333] = { t: points[2333]!.t, valeur: -99_999 };

    const reduit = sousEchantillonner(points, 300);
    const valeurs = reduit.map((p) => p.valeur);
    expect(Math.max(...valeurs)).toBe(99_999);
    expect(Math.min(...valeurs)).toBe(-99_999);
  });

  it("ne touche pas une série déjà courte", () => {
    expect(sousEchantillonner(serie(10), 300)).toHaveLength(10);
  });
});

describe("traceSvg — des coordonnées vérifiables au pixel", () => {
  it("projette min en bas, max en haut, le temps de gauche à droite", () => {
    const trace = traceSvg(
      [
        { t: new Date(0), valeur: 0 },
        { t: new Date(1000), valeur: 100 },
      ],
      { largeur: 100, hauteur: 100 },
    )!;
    const [p0, p1] = trace.polyline.split(" ");
    // Marge de 5 % sur [0,100] → fenêtre [-5,105], hauteur 110. Le min se projette à
    // 100·(105/110) = 95.5 px du haut, le max à 4.5 px. Le temps va de x=0 à x=100.
    expect(p0).toBe("0,95.5");
    expect(p1).toBe("100,4.5");
    expect(trace.min).toBe(0);
    expect(trace.max).toBe(100);
  });

  it("série plate : une ligne au centre, jamais de division par zéro", () => {
    const trace = traceSvg(
      [
        { t: new Date(0), valeur: 50 },
        { t: new Date(1000), valeur: 50 },
      ],
      { largeur: 100, hauteur: 100 },
    )!;
    expect(trace.polyline).toBe("0,50 100,50");
  });

  it("série vide : null, jamais un dessin inventé", () => {
    expect(traceSvg([])).toBeNull();
  });
});

describe("aireSvg — le dégradé sous la courbe", () => {
  it("referme la polyline sur les deux coins bas, sans toucher aux points d'origine", () => {
    const trace = traceSvg(
      [
        { t: new Date(0), valeur: 0 },
        { t: new Date(1000), valeur: 100 },
      ],
      { largeur: 100, hauteur: 100 },
    )!;
    expect(aireSvg(trace)).toBe(`${trace.polyline} 100,100 0,100`);
  });
});

describe("resumerStatutsSignaux — la ventilation qui alimente le journal", () => {
  it("sépare SUCCESS et échecs, avec leur motif", () => {
    const resultat = resumerStatutsSignaux([
      { code: "odometer-traveleddistance", body: { value: 5 }, status: { value: "SUCCESS" } },
      { code: "closure-sunroof", status: { value: "ERROR" } },
      { code: "tractionbattery-stateofcharge", body: { value: 75 } },
    ]);
    expect(resultat.succes).toEqual([
      "odometer-traveleddistance",
      "tractionbattery-stateofcharge",
    ]);
    expect(resultat.enEchec).toEqual([{ code: "closure-sunroof", statut: "ERROR" }]);
  });
});

describe("traceBail — le graphique qui décide (Doc 4 §3.4)", () => {
  const BAIL = {
    debut: "2027-07-14",
    dureeMois: 48,
    kilometrageAutorise: 90_000,
    coutParKmExcedentaire: null,
    devise: "CAD",
  };

  it("superpose le réel, l'allocation et la projection sur TOUTE la durée du bail", () => {
    const historique = [
      { km: 0, mesureLe: new Date("2027-07-14T00:00:00.000Z") },
      { km: 3400, mesureLe: new Date("2027-08-12T00:00:00.000Z") },
    ];
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: historique,
      maintenant: new Date("2027-08-12T00:00:00.000Z"),
    });
    const trace = traceBail({ etat, historique, largeur: 100, hauteur: 100 })!;

    // L'allocation part de (début, 0) et traverse tout le cadre jusqu'à l'échéance. Un
    // axe X limité à la période MESURÉE aurait écrasé les deux droites l'une sur l'autre
    // et masqué l'écart, qui est le sujet.
    expect(trace.alloue.startsWith("0,100 100,")).toBe(true);

    // ⚠️ L'INVARIANT qui porte le sens : au rythme observé (3 400 km en 29 jours, soit
    // ~117 km/jour), la projection dépasse largement l'allocation — nettement plus que
    // 90 000. Le trait de projection doit donc finir PLUS HAUT que celui du contrat,
    // c'est-à-dire à une ordonnée PLUS PETITE (l'axe Y est inversé en SVG). C'est
    // exactement l'écart que le cadrage annonçait et que ce graphique
    // existe pour rendre visible tôt.
    const yFinAlloue = Number(trace.alloue.split(" ")[1]!.split(",")[1]);
    const yFinProjete = Number(trace.projection!.split(" ")[1]!.split(",")[1]);
    expect(yFinProjete).toBeLessThan(yFinAlloue);
    // L'axe Y part de ZÉRO : la comparaison est absolue.
    expect(trace.reperes[0]!.valeur).toBe(0);
    expect(trace.maxY).toBeGreaterThanOrEqual(90_000);
    // Le réel commence en bas à gauche et ne couvre qu'un mois sur quatre ans.
    expect(trace.reel.startsWith("0,100 ")).toBe(true);
    expect(trace.projection).not.toBeNull();
  });

  it("sans rythme mesurable, PAS de projection inventée", () => {
    const historique = [{ km: 500, mesureLe: new Date("2027-07-20T00:00:00.000Z") }];
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: historique,
      maintenant: new Date("2027-07-20T00:00:00.000Z"),
    });
    const trace = traceBail({ etat, historique })!;
    // Un seul point ne donne aucun rythme : la projection reste absente plutôt que d'être
    // extrapolée d'une mesure unique.
    expect(trace.projection).toBeNull();
    expect(trace.alloue).not.toBe("");
  });

  it("le plafond englobe TOUJOURS l'allocation, même si le réel est minuscule", () => {
    const historique = [{ km: 10, mesureLe: new Date("2027-07-15T00:00:00.000Z") }];
    const etat = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: historique,
      maintenant: new Date("2027-07-15T00:00:00.000Z"),
    });
    const trace = traceBail({ etat, historique })!;
    // Sinon la droite du contrat sortirait du cadre et l'écart deviendrait invisible.
    expect(trace.maxY).toBeGreaterThanOrEqual(90_000);
  });
});

describe("rouesDuJson — une courbe par pneu, jamais une moyenne", () => {
  it("déplie la forme réelle de la bZ en positions nommées", () => {
    const roues = rouesDuJson({
      values: [
        { row: 0, column: 0, tirePressure: 282.68 },
        { row: 1, column: 1, tirePressure: 275.79 },
      ],
    });
    expect(roues).toEqual([
      { libelle: "avant gauche", pression: 282.68 },
      { libelle: "arrière droite", pression: 275.79 },
    ]);
  });

  it("tolère la forme imbriquée `{ values: { values: [...] } }` (livraison TEST)", () => {
    const roues = rouesDuJson({ values: { values: [{ row: 0, column: 1, tirePressure: 32 }] } });
    expect(roues).toEqual([{ libelle: "avant droite", pression: 32 }]);
  });

  it("un corps inattendu rend une liste VIDE, jamais une position inventée", () => {
    expect(rouesDuJson({ autre: true })).toEqual([]);
    expect(rouesDuJson(null)).toEqual([]);
    // Une pression non numérique est écartée plutôt que devenir NaN sur un graphique.
    expect(rouesDuJson({ values: [{ row: 0, column: 0, tirePressure: "?" }] })).toEqual([]);
  });
});

describe("traceSvg — la grille porte ses valeurs", () => {
  it("trois repères, du bas au haut de la fenêtre affichée", () => {
    const trace = traceSvg(
      [
        { t: new Date(0), valeur: 0 },
        { t: new Date(1000), valeur: 100 },
      ],
      { largeur: 100, hauteur: 100 },
    )!;
    expect(trace.reperes).toHaveLength(3);
    expect(trace.reperes[0]!.y).toBe(100);
    expect(trace.reperes[2]!.y).toBe(0);
    // Les valeurs encadrent la série (marge de 5 %) : une grille sans chiffres décore.
    expect(trace.reperes[0]!.valeur).toBeLessThanOrEqual(0);
    expect(trace.reperes[2]!.valeur).toBeGreaterThanOrEqual(100);
  });
});

// ══ DÉCOUVERTE DES MÉTRIQUES ═════════════════════════════════════════════════════════
//
// Ce qui s'affiche vient désormais de la BASE, plus d'une liste écrite à la main. Ces
// tests verrouillent les deux propriétés qui font tenir ce choix : la forme se déduit des
// données, et une POSITION ne peut pas entrer à l'écran par cette porte neuve.
describe("metriquesDisponibles", () => {
  beforeEach(async () => {
    await dbTest.execute(sql`DELETE FROM vehicle_snapshots`);
  });

  it("classe chaque métrique par la FORME de ses valeurs", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(1), source: "smartcar", metricType: "battery_soc", signalCode: "soc", valueNumeric: 60 },
      { recordedAt: T(2), source: "smartcar", metricType: "battery_soc", signalCode: "soc", valueNumeric: 62 },
      { recordedAt: T(1), source: "smartcar", metricType: "locked", signalCode: "lock", valueText: "true" },
      { recordedAt: T(1), source: "smartcar", metricType: "doors", signalCode: "doors", valueJson: { avant: { isOpen: false } } },
    ]);

    const inventaire = await metriquesDisponibles({ dbx });
    const parType = new Map(inventaire.map((m) => [m.metricType, m]));

    expect(parType.get("battery_soc")!.forme).toBe("numerique");
    expect(parType.get("battery_soc")!.nbTotal).toBe(2);
    expect(parType.get("locked")!.forme).toBe("etat");
    expect(parType.get("doors")!.forme).toBe("structure");
  });

  it("n'expose JAMAIS une métrique de position, même inconnue", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(1), source: "smartcar", metricType: "location", signalCode: "loc", valueJson: { lat: 46.8, lng: -71.2 } },
      { recordedAt: T(1), source: "smartcar", metricType: "location_precise", signalCode: "loc2", valueJson: { lat: 46.8 } },
      { recordedAt: T(1), source: "smartcar", metricType: "gps_position", signalCode: "loc3", valueJson: { lat: 46.8 } },
    ]);

    expect(await metriquesDisponibles({ dbx })).toEqual([]);
    // Le garde est PUR et testable seul : c'est lui qu'on relit quand un code nouveau arrive.
    expect(estMetriquePosition("location-preciselocation")).toBe(true);
    expect(estMetriquePosition("gps_position")).toBe(true);
    expect(estMetriquePosition("battery_soc")).toBe(false);
  });

  // La page passe TOUJOURS une période (le sélecteur), et `null` seulement pour « tout
  // l'historique ». Les autres tests n'exerçaient que le cas `null` : le chemin par
  // DÉFAUT de l'écran serait resté sans garde.
  it("filtre sur la période, et une métrique hors fenêtre disparaît de l'inventaire", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(1), source: "smartcar", metricType: "battery_soc", signalCode: "a", valueNumeric: 10 },
      { recordedAt: T(9), source: "smartcar", metricType: "battery_soc", signalCode: "a", valueNumeric: 20 },
      { recordedAt: T(1), source: "smartcar", metricType: "hors_fenetre", signalCode: "b", valueNumeric: 1 },
    ]);

    const tout = await metriquesDisponibles({ dbx });
    expect(tout.map((m) => m.metricType).sort()).toEqual(["battery_soc", "hors_fenetre"]);

    const recent = await metriquesDisponibles({ depuis: T(5), dbx });
    expect(recent.map((m) => m.metricType)).toEqual(["battery_soc"]);
    // Les COMPTES suivent la fenêtre : un « 2 mesures » affiché sous une période d'une
    // heure serait un chiffre qui ne correspond à rien de ce qu'on montre.
    expect(recent[0]!.nbTotal).toBe(1);
  });

  // ⚠️ Ce test encodait la règle « du numérique ⇒ une courbe », corrigée le 12/08 : elle
  // classait les BOOLÉENS comme des séries numériques (ils remplissent les deux colonnes)
  // et l'écran les traçait en créneaux 0/1. Reformulé vers la sémantique juste — c'est la
  // PROPORTION qui tranche, pas la simple présence.
  it("classe par la proportion : majorité de texte ⇒ état, texte absent ⇒ courbe", () => {
    expect(formeDeMetrique({ nbNumerique: 1, nbTexte: 40, nbJson: 0 })).toBe("etat");
    expect(formeDeMetrique({ nbNumerique: 40, nbTexte: 0, nbJson: 0 })).toBe("numerique");
    expect(formeDeMetrique({ nbNumerique: 0, nbTexte: 3, nbJson: 5 })).toBe("etat");
    expect(formeDeMetrique({ nbNumerique: 0, nbTexte: 0, nbJson: 5 })).toBe("structure");
    expect(formeDeMetrique({ nbNumerique: 0, nbTexte: 3, nbJson: 0 })).toBe("etat");
  });
});

describe("serieEtat — la frise ne garde que les CHANGEMENTS", () => {
  beforeEach(async () => {
    await dbTest.execute(sql`DELETE FROM vehicle_snapshots`);
  });

  it("replie les répétitions et date chaque bascule à son PREMIER instant", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(1), source: "smartcar", metricType: "locked", signalCode: "l", valueText: "true" },
      { recordedAt: T(2), source: "smartcar", metricType: "locked", signalCode: "l", valueText: "true" },
      { recordedAt: T(3), source: "smartcar", metricType: "locked", signalCode: "l", valueText: "false" },
      { recordedAt: T(4), source: "smartcar", metricType: "locked", signalCode: "l", valueText: "false" },
      { recordedAt: T(5), source: "smartcar", metricType: "locked", signalCode: "l", valueText: "true" },
    ]);

    const { changements, nbReleves } = await serieEtat("locked", { dbx });

    expect(nbReleves).toBe(5);
    expect(changements.map((c) => c.valeur)).toEqual(["true", "false", "true"]);
    // T(3) et non T(4) : la bascule a eu lieu au premier relevé du palier.
    expect(changements[1]!.t.toISOString()).toBe(T(3).toISOString());
  });
});

describe("aplatirJson", () => {
  it("déplie en chemins lisibles et repère les feuilles numériques", () => {
    const feuilles = aplatirJson({ avant: { gauche: { pression: 240, ouvert: false } } });
    const parChemin = new Map(feuilles.map((f) => [f.chemin, f]));

    expect(parChemin.get("avant.gauche.pression")!.nombre).toBe(240);
    expect(parChemin.get("avant.gauche.ouvert")!.valeur).toBe("false");
    expect(parChemin.get("avant.gauche.ouvert")!.nombre).toBeNull();
  });

  it("BORNE le dépliage : une structure venue d'ailleurs ne fige pas la page", () => {
    // Objet large ET profond : les deux bornes doivent mordre.
    const large = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`cle${i}`, i]),
    );
    expect(aplatirJson(large).length).toBeLessThanOrEqual(60);

    let profond: unknown = "fond";
    for (let i = 0; i < 12; i += 1) profond = { niveau: profond };
    // Rien d'exploitable au-delà de la profondeur permise — mais AUCUNE exception.
    expect(() => aplatirJson(profond)).not.toThrow();
  });

  it("une valeur absente se dit « — », jamais « null » à l'écran", () => {
    expect(aplatirJson({ a: null })).toEqual([{ chemin: "a", valeur: "—", nombre: null }]);
  });
});

describe("decimalesPour", () => {
  it("déduit la précision de l'amplitude, sans table écrite à la main", () => {
    expect(decimalesPour(0, 100)).toBe(0); // pourcentage de charge
    expect(decimalesPour(3200, 3510)).toBe(0); // odomètre
    expect(decimalesPour(21.4, 22.8)).toBe(1); // température
    expect(decimalesPour(0.12, 0.31)).toBe(2); // petite fraction
  });
});

describe("dernierEtatStructure", () => {
  beforeEach(async () => {
    await dbTest.execute(sql`DELETE FROM vehicle_snapshots`);
  });

  it("rend le DERNIER relevé, déplié", async () => {
    await dbTest.insert(vehicleSnapshots).values([
      { recordedAt: T(1), source: "smartcar", metricType: "doors", signalCode: "d", valueJson: { avant: "ouvert" } },
      { recordedAt: T(9), source: "smartcar", metricType: "doors", signalCode: "d", valueJson: { avant: "ferme" } },
    ]);

    const etat = await dernierEtatStructure("doors", { dbx });
    expect(etat!.feuilles).toEqual([{ chemin: "avant", valeur: "ferme", nombre: null }]);
    expect(etat!.mesureLe.toISOString()).toBe(T(9).toISOString());
  });

  it("rend null quand la métrique n'a aucune structure — jamais un cadre vide", async () => {
    expect(await dernierEtatStructure("doors", { dbx })).toBeNull();
  });
});

describe("formeDeMetrique — le piège des booléens", () => {
  // ⚠️ `signalVersSnapshot` écrit un booléen dans les DEUX colonnes : value_text
  // (« true »/« false ») ET value_numeric (1/0). Un test naïf « du numérique ⇒ une
  // courbe » classait donc « verrouillé » et « en charge » comme des séries numériques,
  // et l'écran traçait une courbe en créneaux entre 0 et 1 — un graphique qui n'apprend
  // rien là où une frise de bascules dit tout.
  it("un BOOLÉEN (texte ET numérique remplis) est un ÉTAT, pas une courbe", () => {
    expect(formeDeMetrique({ nbNumerique: 120, nbTexte: 120, nbJson: 0 })).toBe("etat");
  });

  it("une vraie mesure numérique n'a PAS de texte — elle reste une courbe", () => {
    expect(formeDeMetrique({ nbNumerique: 120, nbTexte: 0, nbJson: 0 })).toBe("numerique");
  });

  it("quelques lignes texte anciennes ne suffisent pas à déclasser une série numérique", () => {
    expect(formeDeMetrique({ nbNumerique: 500, nbTexte: 3, nbJson: 0 })).toBe("numerique");
  });

  it("du JSON sans texte ni nombre reste une structure", () => {
    expect(formeDeMetrique({ nbNumerique: 0, nbTexte: 0, nbJson: 40 })).toBe("structure");
  });
});

// ══ QUATRE PNEUS SUR UN SEUL AXE (Marc, 13/08 : « des graphs clairs ») ═══════════════
//
// Tracés séparément, chaque pneu avait SON axe calé sur SON min–max : deux roues à 230 et
// 205 kPa donnaient deux courbes d'allure identique. L'axe indépendant effaçait l'écart,
// c'est-à-dire la seule chose qu'on regarde sur des pneus.
describe("traceMulti — un axe COMMUN, sinon l'écart disparaît", () => {
  const T = (min: number) => new Date(Date.UTC(2026, 7, 13, 12, min, 0));

  it("place deux séries d'écart constant à des hauteurs DIFFÉRENTES", () => {
    const trace = traceMulti(
      [
        { libelle: "haute", points: [{ t: T(0), valeur: 240 }, { t: T(60), valeur: 240 }] },
        { libelle: "basse", points: [{ t: T(0), valeur: 200 }, { t: T(60), valeur: 200 }] },
      ],
      { largeur: 100, hauteur: 100 },
    );
    const haute = trace!.series.find((s) => s.libelle === "haute")!;
    const basse = trace!.series.find((s) => s.libelle === "basse")!;
    // Y croît vers le BAS en SVG : la série basse doit être plus BAS dans la viewBox.
    expect(basse.derniereY).toBeGreaterThan(haute.derniereY);
    // Preuve que l'axe est bien commun : min et max couvrent les DEUX séries.
    expect(trace!.min).toBe(200);
    expect(trace!.max).toBe(240);
  });

  it("partage aussi l'axe du TEMPS entre les séries", () => {
    const trace = traceMulti(
      [
        { libelle: "longue", points: [{ t: T(0), valeur: 10 }, { t: T(100), valeur: 20 }] },
        // Série plus COURTE : elle ne doit PAS être étirée sur toute la largeur, sinon elle
        // paraîtrait contemporaine de l'autre.
        { libelle: "courte", points: [{ t: T(0), valeur: 12 }, { t: T(50), valeur: 14 }] },
      ],
      { largeur: 100, hauteur: 100 },
    );
    const courte = trace!.series.find((s) => s.libelle === "courte")!;
    const xFinal = Number(courte.polyline.split(" ").pop()!.split(",")[0]);
    expect(xFinal).toBeCloseTo(50, 1);
    expect(trace!.premier).toEqual(T(0));
    expect(trace!.dernier).toEqual(T(100));
  });

  it("garde la dernière valeur RÉELLE de chaque série pour l'étiqueter", () => {
    const trace = traceMulti([
      { libelle: "a", points: [{ t: T(0), valeur: 1 }, { t: T(10), valeur: 7 }] },
    ]);
    expect(trace!.series[0]!.derniereValeur).toBe(7);
  });

  it("trie chaque série par le temps avant de la tracer", () => {
    const trace = traceMulti(
      [{ libelle: "desordre", points: [{ t: T(60), valeur: 20 }, { t: T(0), valeur: 10 }] }],
      { largeur: 100, hauteur: 100 },
    );
    // Le premier sommet doit être celui de T(0), donc en x = 0.
    expect(trace!.series[0]!.polyline.startsWith("0,")).toBe(true);
    expect(trace!.series[0]!.derniereValeur).toBe(20);
  });

  it("un point unique donne une ligne PLATE, pas un cadre vide", () => {
    const trace = traceMulti([{ libelle: "seul", points: [{ t: T(0), valeur: 5 }] }], {
      largeur: 100,
      hauteur: 100,
    });
    const sommets = trace!.series[0]!.polyline.split(" ");
    expect(sommets).toHaveLength(2);
    expect(sommets[0]!.split(",")[1]).toBe(sommets[1]!.split(",")[1]);
  });

  it("une série constante ne divise pas par zéro", () => {
    const trace = traceMulti(
      [{ libelle: "plate", points: [{ t: T(0), valeur: 7 }, { t: T(60), valeur: 7 }] }],
      { largeur: 100, hauteur: 100 },
    );
    expect(trace!.series[0]!.polyline).not.toContain("NaN");
    expect(trace!.min).toBe(7);
    expect(trace!.max).toBe(7);
  });

  it("rien à tracer ⇒ null, jamais un cadre vide", () => {
    expect(traceMulti([])).toBeNull();
    expect(traceMulti([{ libelle: "vide", points: [] }])).toBeNull();
  });

  it("écarte les séries vides sans écarter les autres", () => {
    const trace = traceMulti([
      { libelle: "vide", points: [] },
      { libelle: "pleine", points: [{ t: T(0), valeur: 1 }, { t: T(10), valeur: 2 }] },
    ]);
    expect(trace!.series.map((s) => s.libelle)).toEqual(["pleine"]);
  });

  it("les repères portent leur valeur, du bas vers le haut", () => {
    const trace = traceMulti(
      [{ libelle: "a", points: [{ t: T(0), valeur: 0 }, { t: T(60), valeur: 100 }] }],
      { largeur: 100, hauteur: 100 },
    );
    expect(trace!.reperes).toHaveLength(3);
    expect(trace!.reperes[0]!.valeur).toBeLessThan(trace!.reperes[2]!.valeur);
    expect(trace!.reperes[0]!.y).toBeGreaterThan(trace!.reperes[2]!.y);
  });
});

// ══ SURVOL (Marc, 13/08 : « glisser la souris sur le graph pour voir les valeurs ») ═══
//
// Viser un point de 3 px à la souris est un exercice d'adresse : on découpe la largeur en
// BANDES verticales, une par relevé. Le piège que ces tests verrouillent : des bandes de
// largeur ÉGALE décaleraient l'infobulle par rapport au point qu'elle décrit, puisque les
// relevés ne tombent pas à intervalle régulier.
describe("bandesSurvol — une colonne par relevé, calée sur le TEMPS réel", () => {
  const T = (min: number) => new Date(Date.UTC(2026, 7, 13, 12, min, 0));
  const bornes = (t0: number, t1: number, min: number, max: number) => ({
    t0,
    dureeMs: t1 - t0,
    min,
    max,
  });

  it("couvre toute la largeur, sans pixel mort", () => {
    const pts = [
      { t: T(0), valeur: 10 },
      { t: T(30), valeur: 20 },
      { t: T(60), valeur: 30 },
    ];
    const b = bandesSurvol(pts, bornes(T(0).getTime(), T(60).getTime(), 10, 30));
    expect(b[0]!.gauchePct).toBe(0);
    const derniere = b[b.length - 1]!;
    expect(derniere.gauchePct + derniere.largeurPct).toBeCloseTo(100, 1);
  });

  // ⚠️ LE test qui compte : des relevés IRRÉGULIERS donnent des bandes INÉGALES.
  it("les bandes suivent l'espacement RÉEL des relevés, pas un pas régulier", () => {
    const pts = [
      { t: T(0), valeur: 10 },
      { t: T(5), valeur: 12 }, // deux relevés serrés…
      { t: T(60), valeur: 30 }, // …puis un trou d'une heure
    ];
    const b = bandesSurvol(pts, bornes(T(0).getTime(), T(60).getTime(), 10, 30));
    // Le premier relevé a un voisin TRÈS proche : sa bande s'arrête à mi-chemin, donc elle
    // est étroite. À largeur égale elle ferait 33 % — elle en fait le huitième.
    expect(b[0]!.largeurPct).toBeLessThan(10);
    expect(b[1]!.largeurPct).toBeGreaterThan(b[0]!.largeurPct * 5);
    // Aucune bande ne vaut la largeur « régulière » (100/3) : la preuve que le découpage
    // suit le temps réel et non l'index.
    expect(b.every((x) => Math.abs(x.largeurPct - 100 / 3) > 1)).toBe(true);
    // Et chaque pastille reste sur SON abscisse réelle.
    expect(b[1]!.xPct).toBeCloseTo((5 / 60) * 100, 1);
  });

  it("la pastille est à la bonne hauteur — haut du cadre pour le maximum", () => {
    const pts = [
      { t: T(0), valeur: 0 },
      { t: T(60), valeur: 100 },
    ];
    const b = bandesSurvol(pts, bornes(T(0).getTime(), T(60).getTime(), 0, 100));
    expect(b[0]!.yPct).toBeCloseTo(100, 1); // valeur minimale ⇒ en bas
    expect(b[1]!.yPct).toBeCloseTo(0, 1); // valeur maximale ⇒ en haut
  });

  it("garde la valeur et l'instant de CHAQUE relevé, pour l'infobulle", () => {
    const pts = [
      { t: T(0), valeur: 62 },
      { t: T(60), valeur: 47 },
    ];
    const b = bandesSurvol(pts, bornes(T(0).getTime(), T(60).getTime(), 47, 62));
    expect(b.map((x) => x.valeur)).toEqual([62, 47]);
    expect(b[0]!.t).toEqual(T(0));
  });

  it("une série d'un seul point n'a rien à survoler", () => {
    const b = bandesSurvol([{ t: T(0), valeur: 5 }], bornes(T(0).getTime(), T(1).getTime(), 4, 6));
    expect(b).toEqual([]);
  });

  it("une série PLATE ne divise pas par zéro", () => {
    const pts = [
      { t: T(0), valeur: 7 },
      { t: T(60), valeur: 7 },
    ];
    const b = bandesSurvol(pts, bornes(T(0).getTime(), T(60).getTime(), 7, 7));
    expect(b.every((x) => Number.isFinite(x.yPct))).toBe(true);
  });

  it("traceSvg expose les bandes, traceMulti les expose PAR SÉRIE", () => {
    const pts = [
      { t: T(0), valeur: 1 },
      { t: T(60), valeur: 2 },
    ];
    expect(traceSvg(pts)!.bandes).toHaveLength(2);
    const multi = traceMulti([
      { libelle: "a", points: pts },
      { libelle: "b", points: pts },
    ])!;
    expect(multi.series[0]!.bandes).toHaveLength(2);
    expect(multi.series[1]!.bandes).toHaveLength(2);
  });
});

// ⚠️ Combiner deux unités sur un écran est exactement ce que le projet s'interdit de faire
// naïvement (« jamais d'agrégat entre unités incomparables »). `traceDouble` le rend
// honnête par deux propriétés, et ce sont elles qu'on vérifie ici : un axe des TEMPS
// commun, et des échelles de VALEUR indépendantes.
describe("traceDouble — deux unités, deux échelles, un seul temps", () => {
  const T = (h: number) => new Date(Date.UTC(2026, 7, 13, h));
  const soc = [
    { t: T(0), valeur: 80 },
    { t: T(6), valeur: 60 },
    { t: T(12), valeur: 40 },
  ];
  const autonomie = [
    { t: T(0), valeur: 320 },
    { t: T(12), valeur: 160 },
  ];

  it("rend null si l'une des deux séries est vide — jamais un demi-graphique", () => {
    expect(traceDouble({ gauche: { libelle: "a", unite: "%", points: [] }, droite: { libelle: "b", unite: "km", points: autonomie } })).toBeNull();
    expect(traceDouble({ gauche: { libelle: "a", unite: "%", points: soc }, droite: { libelle: "b", unite: "km", points: [] } })).toBeNull();
  });

  it("garde à CHAQUE série son échelle — 40 % et 160 km touchent tous deux le bas", () => {
    const t = traceDouble({
      gauche: { libelle: "Charge", unite: "%", points: soc },
      droite: { libelle: "Autonomie", unite: "km", points: autonomie },
      largeur: 100,
      hauteur: 100,
    })!;
    // Les min/max RÉELS de chacune, sans mélange.
    expect([t.gauche.min, t.gauche.max]).toEqual([40, 80]);
    expect([t.droite.min, t.droite.max]).toEqual([160, 320]);
    // Chaque unité reste attachée à SA série.
    expect(t.gauche.unite).toBe("%");
    expect(t.droite.unite).toBe("km");
    // Et les repères sont exprimés sur DEUX échelles différentes : sur une échelle
    // commune, ils seraient identiques — c'est ce qui prouve que le double axe existe.
    expect(t.gauche.reperes[2]).toBeGreaterThan(t.gauche.reperes[0]!);
    expect(t.droite.reperes[0]).toBeGreaterThan(t.gauche.reperes[2]!);
  });

  // ⚠️ LE piège. Projeter chaque série sur SON propre intervalle de temps les étirerait
  // différemment : deux points côte à côte à l'écran n'auraient pas le même instant, et
  // toute lecture conjointe serait fausse. Ici la série courte doit s'arrêter AVANT le
  // bord droit, puisque l'autre va plus loin dans le temps.
  it("projette les deux séries sur le MÊME axe des temps", () => {
    const courte = [
      { t: T(0), valeur: 300 },
      { t: T(6), valeur: 200 },
    ];
    const t = traceDouble({
      gauche: { libelle: "Charge", unite: "%", points: soc }, // va jusqu'à T(12)
      droite: { libelle: "Autonomie", unite: "km", points: courte }, // s'arrête à T(6)
      largeur: 120,
      hauteur: 100,
    })!;

    const derniersX = (polyline: string) =>
      Number(polyline.trim().split(" ").pop()!.split(",")[0]);

    expect(derniersX(t.gauche.polyline)).toBeCloseTo(120, 5);
    // La moitié du temps écoulé ⇒ la moitié de la largeur. Sur son propre axe, elle
    // aurait fini à 120 — c'est la mesure qui discrimine.
    expect(derniersX(t.droite.polyline)).toBeCloseTo(60, 5);

    expect(t.premier).toEqual(T(0));
    expect(t.dernier).toEqual(T(12));
  });

  it("survit à une série PLATE sans diviser par zéro", () => {
    const plate = [
      { t: T(0), valeur: 50 },
      { t: T(12), valeur: 50 },
    ];
    const t = traceDouble({
      gauche: { libelle: "a", unite: "%", points: plate },
      droite: { libelle: "b", unite: "km", points: autonomie },
    })!;
    for (const couple of t.gauche.polyline.split(" ")) {
      expect(Number(couple.split(",")[1])).toBeTypeOf("number");
      expect(Number.isFinite(Number(couple.split(",")[1]))).toBe(true);
    }
  });

  it("porte la DERNIÈRE valeur de chaque série pour la légende", () => {
    const t = traceDouble({
      gauche: { libelle: "Charge", unite: "%", points: soc },
      droite: { libelle: "Autonomie", unite: "km", points: autonomie },
    })!;
    expect(t.gauche.derniereValeur).toBe(40);
    expect(t.droite.derniereValeur).toBe(160);
  });
});
