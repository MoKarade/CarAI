// tests/sautsImpossibles.test.ts — les données de TEST ne comptent pas comme des trajets.
//
// ══ L'INCIDENT (Marc, 19/08/2026) ════════════════════════════════════════════════════
// L'écran annonçait « compteur : 1751 km · trajets : 91 930 km » — 90 179 km de trop,
// avec des lignes « Maison → The Mall, 75 042 km » et « → Boul. Exemple, 10 152 km ».
// Le point commun : 51.5014, -0.1419 — Londres, la position du véhicule SIMULÉ de
// Smartcar — et l'odomètre de ce même véhicule de test (Tesla à 78 432 km). Quelques
// livraisons de test étaient entrées avant que la garde `simulee` n'existe.
//
// Rien n'est supprimé : ces lignes restent en base et restent lisibles dans Données.
// Mais un segment qui exigerait plus de 1 000 km/h ne décrit aucun déplacement réel.

import { describe, expect, it } from "vitest";
import { VITESSE_MAX_KMH, decouperSegments, decouperTrajets } from "@/lib/vehicle/trajets";

/** Coordonnées FICTIVES : le dépôt n'en contient aucune de réelle. */
const MAISON = { lat: 48.2, lng: -78.0 };
const LONDRES = { lat: 51.5014, lng: -0.1419 };
const t = (iso: string) => new Date(iso);

describe("un saut physiquement impossible n'est pas un trajet", () => {
  it("Québec → Londres en 6 minutes est écarté (le cas RÉEL du 19/08)", () => {
    const positions = [
      { t: t("2026-08-11T20:48:00.000Z"), ...MAISON, type: null },
      { t: t("2026-08-11T20:54:00.000Z"), ...LONDRES, type: null },
      { t: t("2026-08-11T21:00:00.000Z"), ...MAISON, type: null },
    ];
    const trajets = decouperTrajets(positions);
    // Aucun trajet ne peut naître de ces sauts : ils bornent du vide, pas de la conduite.
    expect(trajets).toHaveLength(0);
    // Et surtout : plus un seul kilomètre fantôme dans les totaux.
    expect(trajets.reduce((s, x) => s + x.distanceKm, 0)).toBe(0);
  });

  it("l'odomètre du véhicule de TEST (78 432 km d'un coup) est écarté aussi", () => {
    // La pollution a touché les DEUX : la géométrie ET le compteur. Un garde qui ne
    // regarderait que la distance GPS laisserait passer le 75 042 km.
    const positions = [
      { t: t("2026-08-11T17:05:00.000Z"), ...MAISON, type: null },
      { t: t("2026-08-11T20:23:00.000Z"), lat: 48.2001, lng: -78.0001, type: null },
    ];
    const odo = [
      { mesureLe: t("2026-08-11T17:05:00.000Z"), km: 1500 },
      { mesureLe: t("2026-08-11T20:23:00.000Z"), km: 78_432 },
    ];
    const segments = decouperSegments(positions, { historiqueOdometre: odo });
    expect(segments[0]!.plausible).toBe(false);
    expect(decouperTrajets(positions, { historiqueOdometre: odo })).toHaveLength(0);
  });

  it("un VRAI trajet d'autoroute reste un trajet — le garde ne mord pas sur le réel", () => {
    // Maison → Autre, ~70 km en 1 h : un trajet d'autoroute ordinaire, il doit passer.
    const positions = [
      { t: t("2026-08-19T11:00:00.000Z"), ...MAISON, type: null },
      { t: t("2026-08-19T12:00:00.000Z"), lat: 47.7, lng: -77.4, type: null },
    ];
    const trajets = decouperTrajets(positions);
    expect(trajets).toHaveLength(1);
    expect(trajets[0]!.distanceKm).toBeGreaterThan(40);
  });

  it("le seuil est DÉRIVÉ de la constante, jamais de sa valeur du jour", () => {
    // Juste sous la limite : plausible. Juste au-dessus : écarté.
    const depart = { lat: 46.8, lng: -71.3 };
    const enUneHeure = (km: number) => ({ lat: 46.8 + km / 111.32, lng: -71.3 });
    const cas = (km: number) =>
      decouperSegments([
        { t: t("2026-08-19T10:00:00.000Z"), ...depart, type: null },
        { t: t("2026-08-19T11:00:00.000Z"), ...enUneHeure(km), type: null },
      ])[0]!.plausible;
    expect(cas(VITESSE_MAX_KMH * 0.9)).toBe(true);
    expect(cas(VITESSE_MAX_KMH * 1.5)).toBe(false);
  });
});
