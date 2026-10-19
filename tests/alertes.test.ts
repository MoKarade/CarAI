// tests/alertes.test.ts — « ce qui cloche », et rien d'autre.
//
// Deux exigences opposées, et ce sont les deux qui font qu'une alerte se lit encore dans
// six mois : NE PAS crier pour rien (une alerte qui s'affiche tous les jours n'est plus
// lue), et NE PAS se taire quand ça compte. Chaque seuil est donc testé des deux côtés.

import { describe, expect, it } from "vitest";
import {
  alertesPneusDerive,
  alertesPneusEntreRoues,
  construireAlertes,
  estFaux,
  estVrai,
  mediane,
  ouvrantsOuverts,
  referencesDepuisSeries,
  BAISSE_PNEU_KPA,
  ECART_PNEU_KPA,
} from "@/lib/vehicle/alertes";
import type { MesureQualifiee } from "@/lib/vehicle/state";

const mesure = (p: Partial<MesureQualifiee>): MesureQualifiee => ({
  metricType: "x",
  source: "smartcar",
  recordedAt: new Date("2026-08-12T12:00:00Z"),
  receivedAt: new Date("2026-08-12T12:00:00Z"),
  valueNumeric: null,
  valueText: null,
  valueJson: null,
  unit: null,
  locationType: null,
  signalCode: null,
  ageMinutes: 5,
  interpretationFiable: true,
  raisonInterpretation: null,
  ...p,
});

const roue = (libelle: string, pression: number) => ({ libelle, pression });

describe("estVrai / estFaux", () => {
  // ⚠️ Les booléens arrivent en TEXTE. Comparer à `true` sans convertir rendrait TOUTES
  // les alertes muettes — et une alerte muette ne se distingue pas d'une absence de
  // problème, ce qui est le pire des deux mondes.
  it("lit les booléens tels que la source les écrit", () => {
    expect(estVrai("true")).toBe(true);
    expect(estVrai("TRUE")).toBe(true);
    expect(estVrai(" true ")).toBe(true);
    expect(estVrai("false")).toBe(false);
    expect(estVrai(null)).toBe(false);
    expect(estFaux("false")).toBe(true);
    // Ni vrai ni faux : une absence n'est pas un « déverrouillé ».
    expect(estFaux(null)).toBe(false);
    expect(estFaux("true")).toBe(false);
  });
});

describe("mediane", () => {
  it("résiste à une valeur extrême, contrairement à la moyenne", () => {
    // C'est précisément pourquoi la comparaison entre roues l'utilise : avec quatre
    // valeurs, une roue très basse tire la moyenne vers le bas et masque son écart.
    expect(mediane([250, 250, 180])).toBe(250);
    expect(mediane([250, 240])).toBe(245);
  });
});

describe("alertesPneusEntreRoues", () => {
  it("signale la roue nettement sous les autres, avec ses chiffres", () => {
    const alertes = alertesPneusEntreRoues([
      roue("avant gauche", 250),
      roue("avant droite", 248),
      roue("arrière gauche", 205),
      roue("arrière droite", 252),
    ]);
    expect(alertes).toHaveLength(1);
    expect(alertes[0]!.titre).toContain("arrière gauche");
    // Une alerte sans son chiffre ne se vérifie pas.
    expect(alertes[0]!.detail).toContain("205");
    expect(alertes[0]!.detail).toContain("250");
  });

  it("SE TAIT sur la dispersion normale entre quatre pneus", () => {
    // Température, ensoleillement d'un côté, tolérance du capteur : sous le seuil, c'est
    // du bruit. Crier ici, c'est garantir que plus personne ne lira l'écran.
    const alertes = alertesPneusEntreRoues([
      roue("avant gauche", 250),
      roue("avant droite", 242),
      roue("arrière gauche", 238),
      roue("arrière droite", 245),
    ]);
    expect(alertes).toEqual([]);
  });

  // Le seuil se teste DES DEUX CÔTÉS et se DÉRIVE de la constante, jamais de sa valeur
  // du jour (leçon DriveAI : un test codé « 16 ≥ 10 » ment au premier rajustement).
  it("mord juste au-dessus du seuil, se tait juste en dessous", () => {
    const base = [roue("a", 250), roue("b", 250), roue("c", 250)];
    const juste = alertesPneusEntreRoues([...base, roue("d", 250 - ECART_PNEU_KPA + 1)]);
    expect(juste).toEqual([]);
    const franchi = alertesPneusEntreRoues([...base, roue("d", 250 - ECART_PNEU_KPA)]);
    expect(franchi).toHaveLength(1);
  });

  it("ne compare pas moins de trois roues — deux valeurs ne font pas une référence", () => {
    expect(alertesPneusEntreRoues([roue("a", 250), roue("b", 180)])).toEqual([]);
    expect(alertesPneusEntreRoues([])).toEqual([]);
  });
});

describe("alertesPneusDerive", () => {
  // ⚠️ Ce que la comparaison ENTRE roues ne peut pas voir : les quatre descendent
  // ensemble (froid), ou une crevaison lente encore trop faible pour créer un écart.
  it("attrape une baisse que la comparaison entre roues ne verrait PAS", () => {
    const actuelles = [roue("a", 220), roue("b", 222), roue("c", 219), roue("d", 221)];
    // Aucun écart entre elles :
    expect(alertesPneusEntreRoues(actuelles)).toEqual([]);
    // Mais toutes ont perdu ~30 kPa sur leur propre référence.
    const references = new Map([["a", 250], ["b", 250], ["c", 250], ["d", 250]]);
    expect(alertesPneusDerive(actuelles, references)).toHaveLength(4);
  });

  it("ignore une roue sans référence connue plutôt que d'en inventer une", () => {
    expect(alertesPneusDerive([roue("a", 200)], new Map())).toEqual([]);
  });

  it("mord juste au-dessus du seuil, se tait juste en dessous", () => {
    const references = new Map([["a", 250]]);
    expect(alertesPneusDerive([roue("a", 250 - BAISSE_PNEU_KPA + 1)], references)).toEqual([]);
    expect(alertesPneusDerive([roue("a", 250 - BAISSE_PNEU_KPA)], references)).toHaveLength(1);
  });
});

describe("ouvrantsOuverts", () => {
  it("nomme l'ouvrant par son PARENT, pas par le champ d'état", () => {
    // Rendre « isOpen » n'apprendrait rien : c'est « avant gauche » qu'on veut lire.
    const ouverts = ouvrantsOuverts({
      avantGauche: { isOpen: true },
      avantDroite: { isOpen: false },
      arriereGauche: { isOpen: false },
    });
    expect(ouverts).toEqual(["avantGauche"]);
  });

  it("rend une liste vide quand tout est fermé — le cas normal ne parle pas", () => {
    expect(ouvrantsOuverts({ a: { isOpen: false }, b: { isOpen: false } })).toEqual([]);
    expect(ouvrantsOuverts(null)).toEqual([]);
    expect(ouvrantsOuverts({ autre: "chose" })).toEqual([]);
  });

  it("descend dans les tableaux, comme la source les publie parfois", () => {
    expect(ouvrantsOuverts({ values: [{ nom: "x", isOpen: true }] })).toEqual(["values.0"]);
  });
});

describe("construireAlertes", () => {
  it("SE TAIT quand tout va bien — zéro alerte est la réponse normale", () => {
    const alertes = construireAlertes({
      mesures: [
        mesure({ metricType: "lock_status", valueText: "true" }),
        mesure({ metricType: "battery_soc", valueNumeric: 69 }),
        mesure({ metricType: "door_status", valueJson: { avant: { isOpen: false } } }),
      ],
    });
    expect(alertes).toEqual([]);
  });

  it("signale une voiture déverrouillée depuis assez longtemps", () => {
    const alertes = construireAlertes({
      mesures: [mesure({ metricType: "lock_status", valueText: "false", ageMinutes: 45 })],
    });
    expect(alertes.map((a) => a.cle)).toEqual(["deverrouillee"]);
  });

  it("NE crie PAS sur un déverrouillage tout frais — Marc est peut-être à côté", () => {
    const alertes = construireAlertes({
      mesures: [mesure({ metricType: "lock_status", valueText: "false", ageMinutes: 3 })],
    });
    expect(alertes).toEqual([]);
  });

  it("signale une charge basse SEULEMENT si la voiture n'est ni branchée ni en charge", () => {
    const basse = mesure({ metricType: "battery_soc", valueNumeric: 12 });

    expect(construireAlertes({ mesures: [basse] }).map((a) => a.cle)).toEqual(["charge-basse"]);

    // Branchée : il n'y a rien à faire, la voiture s'en occupe.
    expect(
      construireAlertes({
        mesures: [basse, mesure({ metricType: "charge_plugged_in", valueText: "true" })],
      }),
    ).toEqual([]);

    // En charge : idem.
    expect(
      construireAlertes({
        mesures: [basse, mesure({ metricType: "charging_status", valueText: "true" })],
      }),
    ).toEqual([]);
  });

  it("ne fabrique PAS d'alerte de charge sur une valeur non interprétable", () => {
    // Une unité non déclarée rend « 12 » ambigu (12 % ou 0,12 ?). Alerter dessus serait
    // affirmer un niveau qu'on ne sait pas lire.
    const alertes = construireAlertes({
      mesures: [
        mesure({ metricType: "battery_soc", valueNumeric: 12, interpretationFiable: false }),
      ],
    });
    expect(alertes).toEqual([]);
  });

  it("garde la mesure la plus FRAÎCHE quand deux sources portent la même métrique", () => {
    const alertes = construireAlertes({
      mesures: [
        mesure({
          metricType: "lock_status",
          source: "toyota_na",
          valueText: "false",
          ageMinutes: 200,
          recordedAt: new Date("2026-08-12T08:00:00Z"),
        }),
        mesure({
          metricType: "lock_status",
          source: "smartcar",
          valueText: "true",
          ageMinutes: 5,
          recordedAt: new Date("2026-08-12T12:00:00Z"),
        }),
      ],
    });
    // La plus récente dit « verrouillée » : pas d'alerte, malgré l'ancienne.
    expect(alertes).toEqual([]);
  });

  it("chaque alerte porte une clé UNIQUE — deux roues basses font deux lignes", () => {
    const alertes = construireAlertes({
      mesures: [
        mesure({
          metricType: "tire_pressure",
          valueJson: {
            values: [
              { row: 0, column: 0, tirePressure: 190 },
              { row: 0, column: 1, tirePressure: 250 },
              { row: 1, column: 0, tirePressure: 252 },
              { row: 1, column: 1, tirePressure: 251 },
            ],
          },
        }),
      ],
    });
    const cles = alertes.map((a) => a.cle);
    expect(new Set(cles).size).toBe(cles.length);
    expect(cles).toContain("pneu-ecart-avant gauche");
  });
});

describe("referencesDepuisSeries", () => {
  const J = (jour: number) => new Date(Date.UTC(2026, 7, jour, 12, 0, 0));
  const avant = J(12); // on exclut tout ce qui est postérieur au 12 août midi

  // ⚠️ LE point du module : sans exclusion des mesures récentes, un pneu qui se dégonfle
  // depuis ce matin abaisse SA PROPRE référence, l'écart devient nul, et l'alerte ne se
  // déclenche jamais. Le défaut se masquerait lui-même — en silence.
  it("EXCLUT les mesures récentes, sinon la dérive masque la dérive", () => {
    const series = [
      {
        libelle: "avant gauche",
        points: [
          { t: J(5), valeur: 250 },
          { t: J(7), valeur: 251 },
          { t: J(9), valeur: 249 },
          // Aujourd'hui, le pneu est à 200 : ces points ne doivent PAS entrer dans sa
          // propre référence.
          { t: J(12), valeur: 200 },
          { t: J(13), valeur: 198 },
        ],
      },
    ];
    const refs = referencesDepuisSeries(series, avant);
    expect(refs.get("avant gauche")).toBe(250);

    // Et l'alerte tombe bien, avec cette référence.
    const alertes = alertesPneusDerive([roue("avant gauche", 198)], refs);
    expect(alertes).toHaveLength(1);
  });

  it("refuse de bâtir une référence sur trop peu de points", () => {
    const series = [
      { libelle: "a", points: [{ t: J(5), valeur: 250 }, { t: J(6), valeur: 249 }] },
    ];
    // Deux points : une référence bancale produirait une alerte fausse, qui coûte plus
    // cher que l'absence d'alerte.
    expect(referencesDepuisSeries(series, avant).size).toBe(0);
  });

  it("prend la MÉDIANE — une lecture aberrante ne déplace pas la référence", () => {
    const series = [
      {
        libelle: "a",
        points: [
          { t: J(5), valeur: 250 },
          { t: J(6), valeur: 251 },
          { t: J(7), valeur: 9 }, // capteur qui bafouille
          { t: J(8), valeur: 249 },
        ],
      },
    ];
    // La moyenne aurait donné ~190 et rendu toute alerte impossible.
    expect(referencesDepuisSeries(series, avant).get("a")).toBe(249.5);
  });
});
