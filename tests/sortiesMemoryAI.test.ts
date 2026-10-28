import { describe, expect, it, vi } from "vitest";
import {
  creerEvenementEtat,
  creerEvenementRecharge,
  creerEvenementTrajet,
  posterLotSorties,
  transmettreSorties,
  type EvenementSortie,
} from "@/lib/sortiesMemoryAI";

const DATE = new Date("2026-10-25T10:00:00-04:00");
const MESURE = { id: 42, source: "smartcar", recordedAt: DATE };

describe("événements de sortie MemoryAI", () => {
  it("crée un trajet sans position, avec la date et la source de la mesure", () => {
    const evenement = creerEvenementTrajet(
      {
        debut: new Date(DATE.getTime() - 30 * 60_000),
        fin: DATE,
        dureeMinutes: 30,
        dureeEstFenetre: false,
        distanceKm: 12.4,
        distanceEstimee: false,
      },
      MESURE,
    );

    expect(evenement).toMatchObject({
      type: "trajet",
      date: DATE.toISOString(),
      titre: "Trajet terminé · 12.4 km",
      resume: "30 min · odomètre · Smartcar.",
      ref: "carai-snapshot-42-trajet",
      niveau: 2,
    });
    expect(JSON.stringify(evenement)).not.toMatch(/latitude|longitude|coordonn|adresse/i);
  });

  it("ne dit jamais « 0 min » : une durée nulle avec une distance devient « durée inconnue »", () => {
    const evenement = creerEvenementTrajet(
      {
        debut: DATE,
        fin: DATE,
        dureeMinutes: 0,
        dureeEstFenetre: false,
        distanceKm: 80,
        distanceEstimee: true,
      },
      MESURE,
    );

    expect(evenement).toMatchObject({
      titre: "Trajet terminé · 80 km",
      resume: "durée inconnue · distance estimée · Smartcar.",
    });
    expect(evenement?.resume).not.toMatch(/(^|\s)0 min/);
  });

  it("crée une recharge terminée avec durée et pourcentage", () => {
    const evenement = creerEvenementRecharge(
      {
        debut: new Date(DATE.getTime() - 60 * 60_000),
        fin: DATE,
        socDebut: 20,
        socFin: 80,
      },
      { ...MESURE, id: 43, source: "toyota_na" },
    );

    expect(evenement).toMatchObject({
      type: "recharge",
      date: DATE.toISOString(),
      titre: "Recharge terminée · 20 à 80 %",
      resume: "60 min · Toyota NA.",
      ref: "carai-snapshot-43-recharge",
      niveau: 2,
    });
  });

  it("crée un changement d’état sans reprendre la valeur brute", () => {
    const evenement = creerEvenementEtat({
      ...MESURE,
      metricType: "door_status",
    });

    expect(evenement).toMatchObject({
      type: "etat_vehicule",
      date: DATE.toISOString(),
      titre: "État du véhicule modifié",
      resume: "État modifié. Smartcar.",
      niveau: 2,
    });
  });

  it("n'envoie rien sans jeton", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await transmettreSorties([creerEvenementEtat({ ...MESURE, metricType: "lock_status" })], {
      token: "",
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("compte une réponse 500 sans journaliser de texte de réponse", async () => {
    const journal: string[] = [];
    const evenement: EvenementSortie = creerEvenementEtat({
      ...MESURE,
      metricType: "lock_status",
    });
    await posterLotSorties([evenement], new URL("https://memoryai.example/api/sorties"), {
      fetchImpl: async () => new Response("texte fictif confidentiel", { status: 500 }),
      journal: (message) => journal.push(message),
    });

    expect(journal).toEqual(["[memoryai-sorties] échec HTTP 500 (1 événement)"]);
    expect(journal.join(" ")).not.toContain("texte fictif confidentiel");
  });

  it("absorbe un délai dépassé sans journaliser l'erreur brute", async () => {
    const journal: string[] = [];
    const evenement = creerEvenementEtat({ ...MESURE, metricType: "lock_status" });
    await posterLotSorties([evenement], new URL("https://memoryai.example/api/sorties"), {
      delaiMs: 1,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("texte fictif confidentiel", "TimeoutError")),
            { once: true },
          );
        }),
      journal: (message) => journal.push(message),
    });

    expect(journal).toEqual(["[memoryai-sorties] échec réseau (1 événement)"]);
    expect(journal.join(" ")).not.toContain("texte fictif confidentiel");
  });

  it("envoie un corps de contrat sans identifiant d'application", async () => {
    let corps: unknown;
    await posterLotSorties(
      [creerEvenementEtat({ ...MESURE, metricType: "lock_status" })],
      new URL("https://memoryai.example/api/sorties"),
      {
        fetchImpl: async (_input, init) => {
          corps = JSON.parse(String(init?.body));
          return new Response(null, { status: 200 });
        },
      },
    );

    expect(corps).toMatchObject({
      source: "sorties",
      evenements: [{ type: "etat_vehicule", date: DATE.toISOString(), niveau: 2 }],
    });
    expect(corps).not.toHaveProperty("app");
  });
});
