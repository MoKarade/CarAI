// tests/summary.test.ts — CONTENU du summary publié au hub (fonction pure).
//
// Le contrat lui-même est validé par `validateSummary` ; ces tests portent sur l'HONNÊTETÉ
// du contenu : ne rien affirmer qu'on ne mesure pas, et distinguer une panne d'un silence.
// (`tests/hubSummary.test.ts` couvre le Route Handler et son authentification.)

import { describe, expect, it } from "vitest";
import {
  APP,
  COUVERTURE_KM_MAX,
  COUVERTURE_KM_MIN,
  FRAICHEUR_ATTENDUE_SEC,
  LIBELLE_KM,
  construireSummary,
  kmPubliable,
  sectionsDetail,
  type InstantaneCarAI,
} from "@/lib/hubSummary";
import { FRAICHEUR_STATUT_MINUTES } from "@/lib/vehicle/charges";
import { calculerEtatBail } from "@/lib/vehicle/lease";

const MAINTENANT = new Date("2027-08-05T12:00:00.000Z");
const SEPT_JOURS_AVANT = new Date(MAINTENANT.getTime() - 7 * 86_400_000);

const BAIL = {
  debut: "2027-07-14",
  dureeMois: 36,
  kilometrageAutorise: 36_000,
  coutParKmExcedentaire: null,
  devise: "CAD",
};

const VIDE: InstantaneCarAI = {
  batterieSoc: null,
  autonomieKm: null,
  odometreKm: null,
  statutCharge: null,
  fraicheur: null,
  bail: null,
  kmRecents: null,
  paiements: null,
  lectureBail: null,
  silenceWebhookHeures: null,
  toyotaDesactive: false,
  panne: null,
  generatedAt: MAINTENANT,
};

describe("identité publiée", () => {
  it("l'id reste `carai` — il doit matcher l'entrée de Hubperso/lib/sources.ts", () => {
    expect(APP.id).toBe("carai");
    expect(APP.url).toBe("https://carai.hubperso.com");
  });
});

describe("aucune donnée", () => {
  it("publie `building`, jamais `ok` avec des métriques vides", () => {
    const s = construireSummary(VIDE);
    expect(s.status).toBe("building");
    expect(s.metrics).toHaveLength(0);
    expect(s.alerts.length).toBeGreaterThan(0);
  });

  it("n'annonce pas de `dataAsOf` quand aucune donnée n'est arrivée", () => {
    // Un `dataAsOf` égal à `generatedAt` annoncerait une fraîcheur à la seconde alors
    // qu'il n'y a rien — exactement la confusion que le hub cherche à éviter.
    expect(construireSummary(VIDE).dataAsOf).toBeUndefined();
  });
});

describe("panne vs silence", () => {
  it("une panne donne `error` et AUCUNE métrique", () => {
    const s = construireSummary({ ...VIDE, panne: "base injoignable" });
    expect(s.status).toBe("error");
    expect(s.metrics).toHaveLength(0);
    expect(s.alerts[0]!.severity).toBe("alert");
  });

  it("la panne prime même si des valeurs sont connues", () => {
    // Afficher les dernières valeurs connues pendant une panne les ferait passer pour
    // fraîches — le widget aurait l'air en pleine forme.
    const s = construireSummary({
      ...VIDE,
      panne: "schéma absent",
      batterieSoc: { valeur: 62, unite: "percent" },
      odometreKm: 4200,
    });
    expect(s.status).toBe("error");
    expect(s.metrics).toHaveLength(0);
  });
});

describe("état de charge", () => {
  it("publie un pourcentage quand l'unité le permet", () => {
    const s = construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 62, unite: "percent" },
      fraicheur: MAINTENANT,
    });
    const charge = s.metrics.find((m) => m.label === "Charge");
    expect(charge?.value).toBe(62);
    expect(charge?.format).toBe("percent");
    expect(charge?.severity).toBe("ok");
  });

  it("convertit une fraction déclarée", () => {
    const s = construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 0.62, unite: "ratio" },
      fraicheur: MAINTENANT,
    });
    expect(s.metrics.find((m) => m.label === "Charge")?.value).toBe(62);
  });

  it("REFUSE de publier un pourcentage quand l'unité est absente", () => {
    // Sans unité, « 1 » peut être 1 % ou 100 %. Publier l'un ou l'autre serait faux d'un
    // facteur 100 sur une jauge de batterie — la pire des erreurs possibles ici.
    const s = construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 1, unite: null },
      fraicheur: MAINTENANT,
    });
    const charge = s.metrics.find((m) => m.label.startsWith("Charge"));
    expect(charge?.format).toBe("text");
    expect(charge?.label).toContain("unité inconnue");
  });

  it("passe en alerte sous 15 %", () => {
    const s = construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 9, unite: "percent" },
      fraicheur: MAINTENANT,
    });
    expect(s.metrics.find((m) => m.label === "Charge")?.severity).toBe("alert");
  });
});

describe("silence du webhook", () => {
  it("passe en `degraded` et alerte au-delà du seuil", () => {
    const s = construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 62, unite: "percent" },
      fraicheur: new Date("2027-08-05T02:00:00.000Z"),
      silenceWebhookHeures: 10,
    });
    expect(s.status).toBe("degraded");
    expect(s.alerts.some((a) => a.label.includes("Aucune donnée Smartcar"))).toBe(true);
  });

  it("reste `ok` quand les livraisons arrivent", () => {
    const s = construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 62, unite: "percent" },
      fraicheur: MAINTENANT,
      silenceWebhookHeures: 0.5,
    });
    expect(s.status).toBe("ok");
  });
});

describe("bail", () => {
  it("compare le consommé au TEMPS ÉCOULÉ, pas à 100 %", () => {
    // Consommer 2 % de son forfait après 1,5 % du bail est sain. Alerter là-dessus
    // apprendrait à ignorer l'indicateur.
    const bail = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [{ km: 2200, mesureLe: MAINTENANT }],
      maintenant: MAINTENANT,
    });
    const s = construireSummary({ ...VIDE, bail, fraicheur: MAINTENANT });
    expect(s.metrics.find((m) => m.label === "Bail consommé")?.severity).toBe("ok");
  });

  it("alerte sur un dépassement projeté", () => {
    const bail = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 0, mesureLe: new Date("2027-07-14T12:00:00.000Z") },
        { km: 2200, mesureLe: MAINTENANT },
      ],
      maintenant: MAINTENANT,
    });
    const s = construireSummary({ ...VIDE, bail, fraicheur: MAINTENANT });
    expect(s.alerts.some((a) => a.label.includes("dépassement projeté"))).toBe(true);
  });
});

describe("usage", () => {
  it("n'émet AUCUN bloc usage — CarAI n'a pas de coût mesuré", () => {
    // Un `amount: 0` affirmerait un suivi de coût inexistant ; omettre le bloc fait
    // afficher « non suivi » au hub, ce qui est vrai.
    const s = construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 62, unite: "percent" },
      fraicheur: MAINTENANT,
    });
    expect(s.usage).toBeUndefined();
  });
});

describe("bornes du contrat", () => {
  /**
   * L'instantané le PLUS FOURNI que CarAI puisse produire : chaque métrique que
   * `construireSummary` sait émettre est émissible ici.
   *
   * ⚠️ C'EST LE SEUL ENDROIT QUI PROTÈGE DU `slice(0, 6)`. Cette troncature est SILENCIEUSE :
   * une septième métrique ne casse rien, elle fait simplement disparaître la dernière — et
   * la dernière est `Versé au bail`, que rien à l'écran ne réclamerait. `validateSummary`
   * ne peut pas l'attraper non plus, puisqu'il reçoit le tableau DÉJÀ tronqué, donc valide.
   */
  const COMPLET: InstantaneCarAI = {
    ...VIDE,
    batterieSoc: { valeur: 62, unite: "percent" },
    autonomieKm: 380,
    odometreKm: 4200,
    statutCharge: {
      mode: "debranchee",
      detail: "NOT_CHARGING",
      ageMinutes: 12,
      perime: false,
      finAnnoncee: null,
    },
    fraicheur: MAINTENANT,
    bail: calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 0, mesureLe: new Date("2027-07-14T12:00:00.000Z") },
        { km: 2200, mesureLe: MAINTENANT },
      ],
      maintenant: MAINTENANT,
    }),
    kmRecents: { km: 210, du: SEPT_JOURS_AVANT, au: MAINTENANT, couvertureJours: 7 },
    paiements: {
      mensualite: 500,
      versementsFaits: 1,
      versementsTotal: 48,
      payeContrat: 500,
      totalContrat: 24_000,
      fraction: 1 / 48,
      reserves: [],
    },
    lectureBail: null,
    silenceWebhookHeures: 0.1,
    toyotaDesactive: true,
  };

  it("ne dépasse jamais 6 métriques ni 10 alertes", () => {
    const s = construireSummary(COMPLET);
    expect(s.metrics.length).toBeLessThanOrEqual(6);
    expect(s.alerts.length).toBeLessThanOrEqual(10);
  });

  it("AUCUNE métrique n'est perdue par la troncature sur l'instantané le plus fourni", () => {
    const s = construireSummary(COMPLET);
    // Les six que CarAI veut vraiment voir sur la carte. Si une septième apparaît un jour,
    // ce test échoue AVANT que la production ne l'avale en silence — et la question posée
    // est alors la bonne : laquelle des sept descend dans `details` ?
    expect(s.metrics.map((m) => m.label)).toEqual([
      "Charge",
      "Autonomie",
      "État de la charge",
      LIBELLE_KM,
      "Bail consommé",
      "Versé au bail",
    ]);
  });

  it("l'odomètre cumulé reste joignable dans la vue détaillée, pas sur la carte", () => {
    const s = construireSummary(COMPLET);
    expect(s.metrics.some((m) => m.label === "Odomètre")).toBe(false);
    const sectionBail = s.details?.find((d) => d.title === "Bail");
    expect(sectionBail?.items.some((i) => i.label === "Kilométrage")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// v1.3 du contrat — ce que CarAI dit de PLUS au hub : son rythme, son chiffre principal,
// sa vue détaillée, et un statut de charge lisible par un humain.
// ─────────────────────────────────────────────────────────────────────────────────────────

const STATUT_EN_CHARGE = {
  mode: "en-charge" as const,
  detail: "CHARGING",
  ageMinutes: 30,
  perime: false,
  finAnnoncee: { instant: MAINTENANT, minutesRestantes: 80, ageMinutes: 30 },
};

function bailReel() {
  return calculerEtatBail({
    bail: BAIL,
    historiqueOdometre: [
      { km: 0, mesureLe: new Date("2027-07-14T12:00:00.000Z") },
      { km: 2200, mesureLe: MAINTENANT },
    ],
    maintenant: MAINTENANT,
  });
}

describe("expectedMaxAgeSec — CarAI déclare son propre rythme", () => {
  it("dérive du seuil DÉJÀ en place, il n'est pas écrit une deuxième fois", () => {
    // Le garde-fou de cette PR. `FRAICHEUR_STATUT_MINUTES` existe depuis le 20/08 avec sa
    // justification (« la bZ publie aux 30-60 min ») et décide déjà, dans l'app, si un
    // statut s'énonce au présent. Un second nombre ici créerait deux vérités sur la même
    // question — et elles divergeraient au premier réglage, en silence.
    expect(FRAICHEUR_ATTENDUE_SEC).toBe(FRAICHEUR_STATUT_MINUTES * 60);
  });

  it("est publié avec dataAsOf", () => {
    const s = construireSummary({ ...VIDE, batterieSoc: { valeur: 62, unite: "percent" }, fraicheur: MAINTENANT });
    expect(s.dataAsOf).toBe(MAINTENANT.toISOString());
    expect(s.expectedMaxAgeSec).toBe(FRAICHEUR_ATTENDUE_SEC);
  });

  it("est ABSENT quand aucune mesure n'est arrivée — sinon le contrat rejetterait", () => {
    // Discriminant : publier un âge attendu sans `dataAsOf` fait lever `validateSummary`.
    // Ce test échoue donc bruyamment si les deux champs se désolidarisent.
    const s = construireSummary(VIDE);
    expect(s.dataAsOf).toBeUndefined();
    expect(s.expectedMaxAgeSec).toBeUndefined();
  });
});

describe("primary — quelle métrique porte la grande tuile", () => {
  it("la charge, et elle seule", () => {
    const s = construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 62, unite: "percent" },
      autonomieKm: 380,
      odometreKm: 4200,
      statutCharge: STATUT_EN_CHARGE,
      fraicheur: MAINTENANT,
      bail: bailReel(),
    });
    const principales = s.metrics.filter((m) => m.primary === true);
    expect(principales).toHaveLength(1);
    expect(principales[0]!.label).toBe("Charge");
  });

  it("PAS de primary sur une charge dont l'unité est inconnue", () => {
    // Une valeur qu'on ne sait pas interpréter ne mérite pas la grande tuile : entre
    // 0,3 % et 30 % sur une jauge de batterie, il n'y a pas de bonne façon de se tromper.
    const s = construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 0.62, unite: null },
      fraicheur: MAINTENANT,
    });
    expect(s.metrics[0]!.label).toBe("Charge (unité inconnue)");
    expect(s.metrics.some((m) => m.primary === true)).toBe(false);
  });
});

describe("état de la charge — un humain doit pouvoir le lire", () => {
  it("dit « En charge », jamais « true »", () => {
    // Le bug corrigé : `charge?.valueText` valait littéralement « true », et le hub
    // affichait « Charge en cours — true » sur une carte qui n'a que cinq lignes.
    const s = construireSummary({ ...VIDE, statutCharge: STATUT_EN_CHARGE, fraicheur: MAINTENANT });
    const etat = s.metrics.find((m) => m.label === "État de la charge");
    expect(etat?.value).toBe("En charge");
    expect(s.metrics.some((m) => String(m.value) === "true")).toBe(false);
    expect(etat?.severity).toBe("ok");
  });

  it("distingue « branchée en attente » de « débranchée » — chez Marc c'est normal", () => {
    // Trois minuteries de charge : « branchée mais pas en charge » est un état quotidien,
    // et le confondre avec « débranchée » lui ferait croire à un câble oublié.
    const attente = construireSummary({
      ...VIDE,
      statutCharge: { ...STATUT_EN_CHARGE, mode: "branchee-en-attente", detail: null, finAnnoncee: null },
      fraicheur: MAINTENANT,
    });
    const debranchee = construireSummary({
      ...VIDE,
      statutCharge: { ...STATUT_EN_CHARGE, mode: "debranchee", detail: null, finAnnoncee: null },
      fraicheur: MAINTENANT,
    });
    expect(attente.metrics.find((m) => m.label === "État de la charge")?.value).toBe(
      "Branchée, en attente",
    );
    expect(debranchee.metrics.find((m) => m.label === "État de la charge")?.value).toBe(
      "Débranchée",
    );
    // Ni l'un ni l'autre n'est coloré : aucun des deux n'est bon ou mauvais en soi.
    expect(attente.metrics.find((m) => m.label === "État de la charge")?.severity).toBeUndefined();
  });

  it("un relevé périmé s'énonce au passé, dans le libellé", () => {
    const s = construireSummary({
      ...VIDE,
      statutCharge: { ...STATUT_EN_CHARGE, perime: true, ageMinutes: 300 },
      fraicheur: MAINTENANT,
    });
    expect(s.metrics.some((m) => m.label === "État de la charge (dernier connu)")).toBe(true);
  });
});

describe("details — la vue détaillée", () => {
  it("explique le bail : termes, rythmes et projection", () => {
    const sections = sectionsDetail({ ...VIDE, bail: bailReel(), fraicheur: MAINTENANT });
    const bail = sections.find((x) => x.title === "Bail");
    expect(bail).toBeDefined();
    const labels = bail!.items.map((i) => i.label);
    expect(labels).toContain("Kilométrage");
    expect(labels).toContain("Jours restants");
    // La couverture du rythme est un `hint`, pas une ligne : elle qualifie le rythme, elle
    // ne se lit pas seule.
    const rythme = bail!.items.find((i) => i.label === "Rythme observé");
    expect(rythme?.hint).toMatch(/mesuré sur \d+ jours/);
  });

  it("explique la charge, et garde le mot brut de la voiture ÉTIQUETÉ comme tel", () => {
    const sections = sectionsDetail({ ...VIDE, statutCharge: STATUT_EN_CHARGE, fraicheur: MAINTENANT });
    const charge = sections.find((x) => x.title === "Charge");
    expect(charge!.items.find((i) => i.label === "État")?.value).toBe("En charge");
    const mot = charge!.items.find((i) => i.label === "Mot de la voiture");
    expect(mot?.value).toBe("CHARGING");
    expect(mot?.hint).toMatch(/brut/);
    expect(charge!.items.find((i) => i.label === "Fin annoncée")?.value).toBe(80);
  });

  it("respecte les bornes du contrat et l'unicité des libellés par section", () => {
    // Le contrat rejette une section vide, plus de 8 lignes, ou deux libellés homonymes
    // dans une section — parce que le hub retrouve une série historique par le couple
    // (section, libellé). Ce test le vérifie sur le cas le plus fourni.
    const sections = sectionsDetail({
      ...VIDE,
      bail: bailReel(),
      statutCharge: STATUT_EN_CHARGE,
      fraicheur: MAINTENANT,
    });
    expect(sections.length).toBeLessThanOrEqual(6);
    expect(new Set(sections.map((x) => x.title)).size).toBe(sections.length);
    for (const section of sections) {
      expect(section.items.length).toBeGreaterThanOrEqual(1);
      expect(section.items.length).toBeLessThanOrEqual(8);
      expect(new Set(section.items.map((i) => i.label)).size).toBe(section.items.length);
    }
  });

  it("n'est PAS publié quand il n'y a rien à détailler", () => {
    // `details: []` passerait le contrat et ferait afficher une vue détaillée vide côté
    // hub — ce qui ressemble à un chargement raté, pas à « rien à dire ».
    expect(sectionsDetail(VIDE)).toEqual([]);
    expect(construireSummary(VIDE).details).toBeUndefined();
  });

  it("le summary complet passe validateSummary avec ses détails", () => {
    // Le test qui compte : `validateSummary` applique les bornes ET l'unicité. S'il lève,
    // c'est le hub qui afficherait « réponse invalide » — sur une app qui va bien.
    const s = construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 62, unite: "percent" },
      autonomieKm: 380,
      odometreKm: 4200,
      statutCharge: STATUT_EN_CHARGE,
      fraicheur: MAINTENANT,
      bail: bailReel(),
    });
    expect(s.details?.length).toBeGreaterThan(0);
    expect(s.metrics.length).toBeLessThanOrEqual(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Ce que Marc a demandé le 15/09 : « le nombre de km 7 jours » et « le prix total depuis le
// début (avec prêt) ».
//
// Les deux exigences qui décident de la forme :
//   • une métrique du hub n'a AUCUN `hint` (le contrat n'en prévoit pas) — donc un chiffre
//     qui ne respecte pas son étiquette ne peut pas se nuancer sur la carte, il s'omet ;
//   • le libellé d'une métrique est la CLÉ de son historique côté hub — il doit donc rester
//     stable, et la nuance descend dans `details`.
// ─────────────────────────────────────────────────────────────────────────────────────────

const KM_SAIN = { km: 210, du: SEPT_JOURS_AVANT, au: MAINTENANT, couvertureJours: 7 };

describe("kmPubliable — la mesure mérite-t-elle son étiquette", () => {
  it("accepte une couverture qui correspond à la fenêtre", () => {
    expect(kmPubliable(KM_SAIN)).toBe(true);
  });

  it("refuse une mesure qui SUR-estime — départ trop vieux", () => {
    // 20 jours de route sous une étiquette « 7 jours ». C'est le mensonge dangereux :
    // il gonfle la métrique à partir de laquelle Marc déciderait de rouler moins.
    expect(kmPubliable({ ...KM_SAIN, couvertureJours: 20 })).toBe(false);
  });

  it("refuse une mesure qui SOUS-estime largement — source silencieuse", () => {
    expect(kmPubliable({ ...KM_SAIN, couvertureJours: 1 })).toBe(false);
  });

  it("refuse l'absence de mesure, jamais un zéro", () => {
    expect(kmPubliable(null)).toBe(false);
  });

  // Les bornes ne sont pas symétriques, et ce n'est pas un oubli : sur-estimer trompe, et
  // sous-estimer ressemble à « la voiture n'a pas bougé ». Si quelqu'un les égalise un
  // jour, ce test le lui dit.
  it("la borne haute est plus serrée que la borne basse", () => {
    expect(COUVERTURE_KM_MAX - 1).toBeLessThan(1 - COUVERTURE_KM_MIN);
  });
});

describe("Km (7 jours) sur la carte", () => {
  const AVEC = (kmRecents: InstantaneCarAI["kmRecents"]) =>
    construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 62, unite: "percent" },
      fraicheur: MAINTENANT,
      odometreKm: 5_310,
      kmRecents,
    });

  it("publie un nombre, pas un texte — le hub peut en tracer la courbe", () => {
    const m = AVEC(KM_SAIN).metrics.find((x) => x.label === LIBELLE_KM);
    expect(m).toEqual({ label: "Km (7 jours)", value: 210, format: "number" });
  });

  it("omet la métrique quand la couverture ne correspond pas, et DIT pourquoi", () => {
    const s = AVEC({ ...KM_SAIN, couvertureJours: 20 });
    expect(s.metrics.some((m) => m.label === LIBELLE_KM)).toBe(false);
    const route = s.details?.find((d) => d.title === "Route");
    const reserve = route?.items.find((i) => i.label === "Réserve sur les kilomètres");
    // Une absence EXPLIQUÉE : sans cette ligne, le chiffre manquant se lirait comme un bug.
    expect(String(reserve?.value)).toContain("SUR-estime");
    expect(reserve?.severity).toBe("warn");
  });

  it("explique aussi l'absence totale de mesure quand l'odomètre est connu", () => {
    const s = AVEC(null);
    const route = s.details?.find((d) => d.title === "Route");
    expect(String(route?.items[0]?.value)).toContain("ne sont pas mesurables");
  });

  it("la couverture réelle est dite dans le détail, jamais devinée depuis l'étiquette", () => {
    const s = AVEC({ ...KM_SAIN, couvertureJours: 6.4 });
    const route = s.details?.find((d) => d.title === "Route");
    expect(route?.items[0]?.hint).toBe("mesuré sur 6,4 jours de relevés");
  });
});

describe("Versé au bail", () => {
  const PAIEMENTS = {
    mensualite: 500,
    versementsFaits: 2,
    versementsTotal: 48,
    payeContrat: 1_000,
    totalContrat: 24_000,
    fraction: 2 / 48,
    reserves: [] as string[],
  };

  const AVEC = (extra: Partial<InstantaneCarAI>) =>
    construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 62, unite: "percent" },
      fraicheur: MAINTENANT,
      ...extra,
    });

  it("publie le montant versé, en devise", () => {
    const m = AVEC({ paiements: PAIEMENTS }).metrics.find((x) => x.label === "Versé au bail");
    expect(m).toEqual({ label: "Versé au bail", value: 1_000, format: "currency" });
  });

  // ⚠️ Le libellé dit « bail », pas « prix total ». Marc a demandé un prix total ; ce
  // chiffre est la part EXACTEMENT connue, et le détail nomme ce qui en est absent.
  it("dit explicitement que les recharges n'y sont pas comptées", () => {
    const section = AVEC({ paiements: PAIEMENTS }).details?.find(
      (d) => d.title === "Coût du véhicule",
    );
    const recharges = section?.items.find((i) => i.label === "Recharges");
    expect(String(recharges?.value)).toContain("Non comptées ici");
  });

  it("le total du contrat est mensualité × durée, pas le montant financé", () => {
    const section = AVEC({ paiements: PAIEMENTS }).details?.find(
      (d) => d.title === "Coût du véhicule",
    );
    const total = section?.items.find((i) => i.label === "Total du contrat");
    expect(total?.value).toBe(500 * 48);
  });

  it("aucune métrique quand FinanceAI ne donne pas les dollars — jamais 0 $", () => {
    const s = AVEC({ paiements: null, lectureBail: { statut: "injoignable", detail: "timeout" } });
    expect(s.metrics.some((m) => m.label === "Versé au bail")).toBe(false);
  });

  // Sept issues, sept gestes différents. Les fondre en « pas de montant » dirait à Marc
  // que quelque chose ne va pas sans jamais dire quoi.
  it("nomme le geste qui manque, issue par issue", () => {
    const pour = (lectureBail: InstantaneCarAI["lectureBail"]) => {
      const section = AVEC({ paiements: null, lectureBail }).details?.find(
        (d) => d.title === "Coût du véhicule",
      );
      return section?.items.find((i) => i.label === "Montants du bail");
    };

    expect(String(pour({ statut: "non-configure" })?.value)).toContain("FINANCEAI_BAIL_URL");
    expect(pour({ statut: "non-configure" })?.severity).toBe("warn");

    expect(String(pour({ statut: "refuse" })?.value)).toContain("refusé le jeton");
    expect(String(pour({ statut: "absent" })?.value)).toContain("aucune dette de véhicule");
    expect(String(pour({ statut: "ambigu", candidates: ["bZ", "Corolla"] })?.value)).toContain(
      "FINANCEAI_VEHICULE_DETTE",
    );

    // « Injoignable » n'est PAS une configuration à faire : rien à corriger, rien de perdu.
    expect(pour({ statut: "injoignable", detail: "timeout" })?.severity).toBeUndefined();
  });

  it("un écart entre CarAI et FinanceAI est remonté, jamais corrigé en silence", () => {
    const section = AVEC({
      paiements: { ...PAIEMENTS, reserves: ["FinanceAI date le début au 2027-07-01"] },
    }).details?.find((d) => d.title === "Coût du véhicule");
    const reserve = section?.items.find((i) => i.label === "Réserve sur le calcul");
    expect(String(reserve?.value)).toContain("2027-07-01");
    expect(reserve?.severity).toBe("warn");
  });
});

// ⚠️ UN `hint` TROP LONG NE FAIT PAS UN AFFICHAGE TRONQUÉ, IL FAIT UN 500. Le contrat le
// borne à 80 caractères et `construireSummary` finit par `validateSummary`, qui LÈVE : la
// route du summary répondrait 500, donc « CarAI injoignable » côté hub — un diagnostic qui
// accuse la voiture pour une phrase trop longue. Les hints sont composés à partir de
// montants et de durées venus de la production, donc leur longueur n'est pas connue à
// l'écriture. Ce cas la mesure sur des valeurs absurdes.
describe("bornes des lignes de détail", () => {
  it("aucun hint > 80 ni label > 40, même sur des valeurs absurdes", () => {
    const s = construireSummary({
      ...VIDE,
      batterieSoc: { valeur: 62, unite: "percent" },
      fraicheur: MAINTENANT,
      odometreKm: 999_999,
      kmRecents: { km: 123_456.789, du: MAINTENANT, au: MAINTENANT, couvertureJours: 123_456.789 },
      paiements: {
        mensualite: 1_234_567.89,
        versementsFaits: 999,
        versementsTotal: 9_999,
        payeContrat: 1e9,
        totalContrat: 1e10,
        fraction: 0.5,
        reserves: ["x".repeat(500)],
      },
    });
    const lignes = (s.details ?? []).flatMap((d) => d.items);
    expect(lignes.length).toBeGreaterThan(0); // anti-vacuité : il y a bien quelque chose à mesurer
    for (const i of lignes) {
      expect(i.label.length, `label « ${i.label} »`).toBeLessThanOrEqual(40);
      if (i.hint) expect(i.hint.length, `hint « ${i.hint} »`).toBeLessThanOrEqual(80);
    }
  });
});
