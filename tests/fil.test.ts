// tests/fil.test.ts — le fil mêlé d'Activité (étape 2 de la refonte, 17/08).
//
// Ce que ces tests protègent : l'ORDRE du fil (un trajet se trie sur son ARRIVÉE, une
// recharge sur son DÉBUT — sinon « rentrer puis brancher » s'affiche à l'envers), la
// frontière de JOUR dans le fuseau de Marc (un événement de 21 h locale appartient à SA
// journée, pas au lendemain UTC), et l'honnêteté de l'énergie déduite (jamais un zéro,
// jamais un négatif présenté comme une consommation).

import { describe, expect, it } from "vitest";
import {
  cleJourLocale,
  construireFil,
  consoTrajet,
  energieTrajetKwh,
  trajetsDuMemeJour,
} from "@/lib/vehicle/fil";
import type { Trajet } from "@/lib/vehicle/trajets";
import type { SessionCharge } from "@/lib/vehicle/charges";
import { cleGeo, libelleCourt } from "@/lib/geocodage";

function trajet(patch: Partial<Trajet>): Trajet {
  const debut = patch.debut ?? new Date("2026-08-17T14:00:00Z");
  const fin = patch.fin ?? new Date("2026-08-17T14:30:00Z");
  return {
    debut,
    fin,
    departAuPlusTard: debut,
    departIncertitudeMinutes: 0,
    arriveeAuPlusTot: fin,
    arriveeIncertitudeMinutes: 0,
    depart: { lat: 45.43, lng: -73.29 },
    arrivee: { lat: 45.5, lng: -73.55 },
    points: [],
    dureeMinutes: 30,
    dureeEstFenetre: false,
    distanceKm: 25,
    distanceEstimee: false,
    cheminInconnu: true,
    odoDebut: null,
    odoFin: null,
    vitesseMoyenne: 50,
    ...patch,
  };
}

function session(patch: Partial<SessionCharge>): SessionCharge {
  return {
    debut: new Date("2026-08-17T15:00:00Z"),
    fin: new Date("2026-08-17T17:00:00Z"),
    dureeMinutes: 120,
    socDebut: 40,
    socFin: 80,
    deltaSocPoints: 40,
    energieKwh: 25,
    energieEstimee: true,
    coût: null,
    source: "soc",
    bornesEstimees: true,
    ...patch,
  } as SessionCharge;
}

describe("construireFil — l'ordre vécu de la journée", () => {
  it("trie un trajet sur son ARRIVÉE et une recharge sur son DÉBUT", () => {
    // On arrive à 14 h 30, on branche à 15 h : la recharge est l'événement le plus
    // récent, elle sort EN PREMIER (fil du plus récent au plus ancien).
    const jours = construireFil({
      trajets: [trajet({})],
      sessions: [session({})],
    });
    expect(jours).toHaveLength(1);
    expect(jours[0]!.evenements.map((e) => e.genre)).toEqual(["recharge", "trajet"]);
  });

  it("compte les totaux du jour : km des trajets, nb trajets, nb recharges", () => {
    const jours = construireFil({
      trajets: [trajet({ distanceKm: 25 }), trajet({
        debut: new Date("2026-08-17T18:00:00Z"),
        fin: new Date("2026-08-17T18:20:00Z"),
        distanceKm: 5,
      })],
      sessions: [session({})],
    });
    expect(jours[0]).toMatchObject({ nbTrajets: 2, nbRecharges: 1, kmTrajets: 30 });
  });

  it("la frontière de jour est LOCALE : 21 h à Québec reste aujourd'hui, pas demain UTC", () => {
    // 2026-08-17 21:30 heure de Québec = 2026-08-18 01:30 UTC. En UTC ce serait demain ;
    // dans le fuseau de Marc c'est encore sa soirée du 17.
    const soir = new Date("2026-08-18T01:30:00Z");
    expect(cleJourLocale(soir, "America/Toronto")).toBe("2026-08-17");

    const jours = construireFil({
      trajets: [trajet({ debut: new Date("2026-08-18T01:00:00Z"), fin: soir })],
      sessions: [],
    });
    expect(jours[0]!.cle).toBe("2026-08-17");
  });

  it("groupe par jour, du plus récent au plus ancien", () => {
    const jours = construireFil({
      trajets: [
        trajet({ debut: new Date("2026-08-15T14:00:00Z"), fin: new Date("2026-08-15T14:30:00Z") }),
        trajet({}),
      ],
      sessions: [],
    });
    expect(jours.map((j) => j.cle)).toEqual(["2026-08-17", "2026-08-15"]);
  });
});

describe("energieTrajetKwh — jamais un chiffre inventé", () => {
  it("déduit du delta de SOC et de la capacité", () => {
    expect(energieTrajetKwh({ socDebut: 80, socFin: 70, capaciteKwh: 71 })).toBeCloseTo(7.1);
  });

  it("refuse sans SOC, sans capacité, ou sur un delta NÉGATIF", () => {
    expect(energieTrajetKwh({ socDebut: null, socFin: 70, capaciteKwh: 71 })).toBeNull();
    expect(energieTrajetKwh({ socDebut: 80, socFin: null, capaciteKwh: 71 })).toBeNull();
    expect(energieTrajetKwh({ socDebut: 80, socFin: 70, capaciteKwh: null })).toBeNull();
    // La voiture a chargé en route, ou la mesure est bruitée : « −2 kWh consommés »
    // n'aurait aucun sens — null, pas un nombre négatif à l'écran.
    expect(energieTrajetKwh({ socDebut: 70, socFin: 80, capaciteKwh: 71 })).toBeNull();
  });

  it("consoTrajet exige énergie ET distance", () => {
    expect(consoTrajet({ energieKwh: 5, distanceKm: 25 })).toBeCloseTo(20);
    expect(consoTrajet({ energieKwh: null, distanceKm: 25 })).toBeNull();
    expect(consoTrajet({ energieKwh: 5, distanceKm: 0 })).toBeNull();
  });
});

describe("géocodage — la clé de cache et le libellé court", () => {
  it("cleGeo arrondit à 4 décimales (~11 m) — deux stationnements voisins partagent la clé", () => {
    expect(cleGeo(48.12341, -77.45674)).toBe("48.1234,-77.4567");
    expect(cleGeo(48.12339, -77.45668)).toBe("48.1234,-77.4567");
  });

  it("libelleCourt prend la voie et la ville, JAMAIS le numéro civique", () => {
    const libelle = libelleCourt({
      results: [
        {
          address_components: [
            { types: ["street_number"], short_name: "1234" },
            { types: ["route"], short_name: "Boul. Exemple O" },
            { types: ["locality", "political"], short_name: "Ville-Exemple" },
          ],
        },
      ],
    });
    expect(libelle).toBe("Boul. Exemple O, Ville-Exemple");
    expect(libelle).not.toContain("1234");
  });

  it("libelleCourt rend null sur une réponse sans voie — jamais un libellé inventé", () => {
    expect(libelleCourt({ results: [] })).toBeNull();
    expect(libelleCourt(null)).toBeNull();
    expect(
      libelleCourt({ results: [{ address_components: [{ types: ["locality"], short_name: "Ville-Exemple" }] }] }),
    ).toBeNull();
  });
});

describe("trajetsDuMemeJour — ce que la CARTE couvre", () => {
  const T = (debutIso: string, finIso: string) => ({
    debut: new Date(debutIso),
    fin: new Date(finIso),
  });

  it("rend les trajets du même jour, du plus ancien au plus récent", () => {
    // Le 18/09 réel de Marc : Maison → Travail, découpé en trois par l'ancien seuil.
    const a = T("2026-09-18T10:21:30Z", "2026-09-18T11:10:52Z");
    const b = T("2026-09-18T11:11:30Z", "2026-09-18T12:00:52Z");
    const c = T("2026-09-18T12:01:31Z", "2026-09-18T12:14:19Z");
    const veille = T("2026-09-17T20:28:21Z", "2026-09-17T21:06:14Z");

    expect(trajetsDuMemeJour([c, veille, a, b], c, "America/Toronto")).toEqual([a, b, c]);
  });

  it("range un trajet sur son ARRIVÉE, comme le fil — jamais sur son départ", () => {
    // Départ le 18 à 23 h 50 heure de Marc, arrivée le 19 à 00 h 20. Une seconde règle
    // écrite ici ferait que la carte et la liste dateraient le même trajet autrement.
    const nuit = T("2026-09-19T03:50:00Z", "2026-09-19T04:20:00Z"); // 23h50 → 00h20 local
    const le19 = T("2026-09-19T14:00:00Z", "2026-09-19T14:30:00Z");
    const le18 = T("2026-09-18T14:00:00Z", "2026-09-18T14:30:00Z");

    const duJour = trajetsDuMemeJour([le18, nuit, le19], nuit, "America/Toronto");
    expect(duJour).toEqual([nuit, le19]);
    expect(duJour).not.toContain(le18);
  });

  it("un jour à un seul trajet rend ce trajet seul", () => {
    const seul = T("2026-09-15T14:00:00Z", "2026-09-15T14:30:00Z");
    const autre = T("2026-09-16T14:00:00Z", "2026-09-16T14:30:00Z");
    expect(trajetsDuMemeJour([seul, autre], seul, "America/Toronto")).toEqual([seul]);
  });
});
