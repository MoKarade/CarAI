// tests/summary.test.ts — CONTENU du summary publié au hub (fonction pure).
//
// Le contrat lui-même est validé par `validateSummary` ; ces tests portent sur l'HONNÊTETÉ
// du contenu : ne rien affirmer qu'on ne mesure pas, et distinguer une panne d'un silence.
// (`tests/hubSummary.test.ts` couvre le Route Handler et son authentification.)

import { describe, expect, it } from "vitest";
import { APP, construireSummary, type InstantaneCarAI } from "@/lib/hubSummary";
import { calculerEtatBail } from "@/lib/vehicle/lease";

const MAINTENANT = new Date("2026-08-05T12:00:00.000Z");

const BAIL = {
  debut: "2026-07-14",
  dureeMois: 48,
  kilometrageAutorise: 112_000,
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
      fraicheur: new Date("2026-08-05T02:00:00.000Z"),
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
        { km: 0, mesureLe: new Date("2026-07-14T12:00:00.000Z") },
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
  it("ne dépasse jamais 6 métriques ni 10 alertes", () => {
    const bail = calculerEtatBail({
      bail: BAIL,
      historiqueOdometre: [
        { km: 0, mesureLe: new Date("2026-07-14T12:00:00.000Z") },
        { km: 2200, mesureLe: MAINTENANT },
      ],
      maintenant: MAINTENANT,
    });
    const s = construireSummary({
      batterieSoc: { valeur: 62, unite: "percent" },
      autonomieKm: 380,
      odometreKm: 4200,
      statutCharge: "NOT_CHARGING",
      fraicheur: MAINTENANT,
      bail,
      silenceWebhookHeures: 0.1,
      toyotaDesactive: true,
      panne: null,
      generatedAt: MAINTENANT,
    });
    expect(s.metrics.length).toBeLessThanOrEqual(6);
    expect(s.alerts.length).toBeLessThanOrEqual(10);
  });
});
