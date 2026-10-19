// tests/bilan.test.ts — les chiffres des trois moments où Marc ouvre l'app.
//
// Le passage de minuit est LE piège : Vercel tourne en UTC, Marc vit à UTC−4. « Aujourd'hui »
// calculé en UTC bascule à 20 h locale — donc le bilan du soir, celui qu'il regarde
// justement à cette heure-là, serait toujours faux.

import { describe, expect, it } from "vitest";
import {
  FENETRE_KM_JOURS,
  calculerBilan,
  debutDuJourLocal,
  debutDuMoisLocal,
  kmDepuis,
  kmSurFenetre,
} from "@/lib/vehicle/bilan";

const odo = (km: number, iso: string) => ({ km, mesureLe: new Date(iso) });

describe("debutDuJourLocal", () => {
  it("rend MINUIT à Toronto, pas minuit UTC", () => {
    // 12 août 18 h UTC = 14 h à Toronto ⇒ minuit local = 12 août 04:00 UTC.
    const minuit = debutDuJourLocal(new Date("2027-08-12T18:00:00Z"));
    expect(minuit.toISOString()).toBe("2027-08-12T04:00:00.000Z");
  });

  // ⚠️ LE cas qui casse tout si on calcule en UTC : après 20 h locale, la date UTC a déjà
  // basculé au lendemain. Un trajet de 21 h compterait pour demain.
  it("à 21 h locale, « aujourd'hui » commence toujours ce matin-LÀ", () => {
    // 13 août 01:00 UTC = 12 août 21:00 à Toronto.
    const minuit = debutDuJourLocal(new Date("2027-08-13T01:00:00Z"));
    expect(minuit.toISOString()).toBe("2027-08-12T04:00:00.000Z");
  });

  it("juste après minuit local, la journée vient de commencer", () => {
    // 13 août 04:30 UTC = 13 août 00:30 à Toronto.
    const minuit = debutDuJourLocal(new Date("2027-08-13T04:30:00Z"));
    expect(minuit.toISOString()).toBe("2027-08-13T04:00:00.000Z");
  });
});

describe("debutDuMoisLocal", () => {
  it("rend le 1er du mois à minuit LOCAL", () => {
    const debut = debutDuMoisLocal(new Date("2027-08-12T18:00:00Z"));
    expect(debut.toISOString()).toBe("2027-08-01T04:00:00.000Z");
  });

  it("le 1er du mois à 21 h locale, le mois a commencé le matin même", () => {
    // 2 septembre 01:00 UTC = 1er septembre 21:00 à Toronto.
    const debut = debutDuMoisLocal(new Date("2027-09-02T01:00:00Z"));
    expect(debut.toISOString()).toBe("2027-09-01T04:00:00.000Z");
  });
});

describe("kmDepuis", () => {
  const historique = [
    odo(3000, "2027-08-11T20:00:00Z"), // hier soir
    odo(3050, "2027-08-12T12:00:00Z"),
    odo(3087, "2027-08-12T17:00:00Z"),
  ];

  it("mesure l'écart depuis le dernier relevé AVANT la fenêtre", () => {
    // Depuis minuit local (12 août 04:00 UTC) : 3087 − 3000.
    expect(kmDepuis(historique, new Date("2027-08-12T04:00:00Z"))).toBe(87);
  });

  it("prend le MAXIMUM de la fenêtre, pas le dernier arrivé", () => {
    // L'ordre d'arrivée n'est pas garanti et un compteur ne recule pas : les extrêmes
    // sont plus robustes qu'un « dernier − premier ».
    const desordre = [
      odo(3000, "2027-08-11T20:00:00Z"),
      odo(3087, "2027-08-12T17:00:00Z"),
      odo(3050, "2027-08-12T12:00:00Z"),
    ];
    expect(kmDepuis(desordre, new Date("2027-08-12T04:00:00Z"))).toBe(87);
  });

  it("rend 0 quand rien n'a bougé depuis le dernier relevé connu", () => {
    // Aucun relevé aujourd'hui, mais on SAIT d'où on part : la voiture n'a pas roulé.
    expect(kmDepuis([odo(3000, "2027-08-11T20:00:00Z")], new Date("2027-08-12T04:00:00Z"))).toBe(0);
  });

  // ⚠️ La distinction qui compte : « il n'a pas roulé » et « on ne sait pas depuis quand »
  // se ressemblent à l'écran, et un 0 affirmerait le premier.
  it("rend NULL sans point de départ connu — jamais un 0 qui affirmerait", () => {
    // Le premier relevé est APRÈS le début de la fenêtre : on ignore ce qui a été
    // parcouru avant lui.
    expect(kmDepuis([odo(3087, "2027-08-12T17:00:00Z")], new Date("2027-08-12T04:00:00Z"))).toBeNull();
    expect(kmDepuis([], new Date("2027-08-12T04:00:00Z"))).toBeNull();
  });

  it("ne rend jamais un kilométrage négatif", () => {
    const douteux = [odo(3100, "2027-08-11T20:00:00Z"), odo(3000, "2027-08-12T12:00:00Z")];
    expect(kmDepuis(douteux, new Date("2027-08-12T04:00:00Z"))).toBe(0);
  });
});

describe("calculerBilan", () => {
  const historique = [
    odo(3000, "2027-08-01T02:00:00Z"), // avant le début du mois local
    odo(3400, "2027-08-11T20:00:00Z"),
    odo(3487, "2027-08-12T17:00:00Z"),
  ];

  it("donne les km du jour, du mois, et la part du budget mensuel", () => {
    const bilan = calculerBilan({
      historiqueOdometre: historique,
      allocationKm: 36_000,
      dureeMois: 36,
      maintenant: new Date("2027-08-12T18:00:00Z"),
    });

    expect(bilan.kmAujourdhui).toBe(87);
    expect(bilan.kmCeMois).toBe(487);
    // 36 000 / 36 mois = 1 000 km par mois.
    expect(bilan.budgetMensuelKm).toBeCloseTo(1000, 0);
    expect(bilan.partDuMoisPourcent!).toBeCloseTo((487 / (36_000 / 36)) * 100, 1);
  });

  it("n'invente rien quand l'odomètre manque", () => {
    const bilan = calculerBilan({
      historiqueOdometre: [],
      allocationKm: 36_000,
      dureeMois: 36,
      maintenant: new Date("2027-08-12T18:00:00Z"),
    });
    expect(bilan.kmAujourdhui).toBeNull();
    expect(bilan.kmCeMois).toBeNull();
    expect(bilan.partDuMoisPourcent).toBeNull();
    // Le budget, lui, ne dépend que du contrat : il reste connu.
    expect(bilan.budgetMensuelKm).toBeGreaterThan(0);
  });

  it("sans bail en base : les km restent mesurés, aucun budget n'est inventé", () => {
    const bilan = calculerBilan({
      historiqueOdometre: historique,
      allocationKm: null,
      dureeMois: null,
      maintenant: new Date("2027-08-12T18:00:00Z"),
    });
    expect(bilan.kmAujourdhui).toBe(87);
    expect(bilan.kmCeMois).toBe(487);
    expect(bilan.budgetMensuelKm).toBeNull();
    expect(bilan.partDuMoisPourcent).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// `kmSurFenetre` — la mesure sur fenêtre glissante, AVEC sa couverture réelle.
//
// Demande de Marc, 15/09 : « le nombre de km 7 jours ». Ce qui suit protège la seule chose
// qui rend ce chiffre honnête : la distinction entre la fenêtre DEMANDÉE et la durée
// RÉELLEMENT couverte par les relevés.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("kmSurFenetre", () => {
  const MAINTENANT = new Date("2027-09-15T12:00:00.000Z");
  const ilYA = (heures: number) => new Date(MAINTENANT.getTime() - heures * 3_600_000);

  it("mesure les kilomètres entre le relevé de départ et le plus récent", () => {
    const m = kmSurFenetre(
      [
        { km: 5_000, mesureLe: ilYA(24 * 7 + 1) },
        { km: 5_120, mesureLe: ilYA(72) },
        { km: 5_310, mesureLe: ilYA(2) },
      ],
      7,
      MAINTENANT,
    );
    expect(m?.km).toBe(310);
    expect(m?.couvertureJours).toBeCloseTo(7 + 1 / 24 - 2 / 24, 3);
  });

  // ⚠️ LE CŒUR DU TYPE. Sans la couverture, ce cas rendrait « 4 200 km » sous une étiquette
  // « 7 jours » — vingt jours de route comptés pour une semaine, et rien à l'écran ne
  // cloche. C'est `couvertureJours` qui permet à l'appelant de le refuser.
  it("dit quand le relevé de départ précède largement la fenêtre", () => {
    const m = kmSurFenetre(
      [
        { km: 1_000, mesureLe: ilYA(24 * 20) },
        { km: 5_200, mesureLe: ilYA(1) },
      ],
      7,
      MAINTENANT,
    );
    expect(m?.km).toBe(4_200);
    // La mesure couvre ~19,96 jours, PAS 7 : la sur-estimation est mesurable.
    expect(m!.couvertureJours).toBeGreaterThan(19);
  });

  // « Aucun relevé dans la fenêtre » ≠ « la voiture n'a pas roulé ». C'est la différence
  // délibérée avec `kmDepuis`, qui rend 0 dans ce cas — défendable pour « aujourd'hui »,
  // faux pour sept jours, où sept jours de silence ne veulent pas dire sept jours immobile.
  it("refuse de rendre 0 quand aucun relevé n'est arrivé pendant la fenêtre", () => {
    const points = [{ km: 5_000, mesureLe: ilYA(24 * 10) }];
    expect(kmSurFenetre(points, 7, MAINTENANT)).toBeNull();
    expect(kmDepuis(points, new Date(MAINTENANT.getTime() - 7 * 86_400_000))).toBe(0);
  });

  it("refuse sans relevé AVANT la fenêtre — le point de départ est inconnu", () => {
    expect(
      kmSurFenetre([{ km: 5_200, mesureLe: ilYA(3) }], 7, MAINTENANT),
    ).toBeNull();
  });

  it("ignore les relevés non finis et ne recule jamais", () => {
    const m = kmSurFenetre(
      [
        { km: 5_000, mesureLe: ilYA(24 * 8) },
        { km: Number.NaN, mesureLe: ilYA(48) },
        { km: 4_900, mesureLe: ilYA(24) },
        { km: 5_050, mesureLe: ilYA(3) },
      ],
      7,
      MAINTENANT,
    );
    // `max − départ`, jamais `dernier − premier` : le relevé à 4 900 est du bruit d'ordre.
    expect(m?.km).toBe(50);
  });

  it("rend null sur un historique vide ou une fenêtre nulle", () => {
    expect(kmSurFenetre([], 7, MAINTENANT)).toBeNull();
    expect(
      kmSurFenetre([{ km: 1, mesureLe: ilYA(100) }], 0, MAINTENANT),
    ).toBeNull();
  });

  // La constante BORNE le calcul et COMPOSE le libellé : deux nombres écrits séparément
  // divergeraient, et l'écran annoncerait une fenêtre qu'il ne mesure pas.
  it("la fenêtre publiée au hub est celle que Marc a demandée", () => {
    expect(FENETRE_KM_JOURS).toBe(7);
  });
});
