// tests/bandeauCharge.test.ts — ce que le bandeau « charge » de l'accueil ose affirmer.
//
// Bug d'origine (Marc, 18/08) : « je suis en charge depuis des heures, ça affiche pas ».
// `estimerFinCharge` refusait honnêtement (SOC au palier, ou montée trop courte pour
// mesurer un rythme) et le bandeau disparaissait AVEC elle. `etatBandeauCharge` sait
// désormais dire « en charge » et « à la limite » sans inventer d'heure de fin.

import { describe, expect, it } from "vitest";
import {
  ECART_MIN_ESTIMATION_MIN,
  etatBandeauCharge,
  type PointSoc,
} from "@/lib/vehicle/charges";

const MAINTENANT = new Date("2026-08-18T20:00:00.000Z");
/** Un relevé de SOC, situé par son âge en minutes — les cas se lisent en clair. */
const soc = (ageMin: number, pourcent: number): PointSoc => ({
  t: new Date(MAINTENANT.getTime() - ageMin * 60_000),
  pourcent,
});

describe("etatBandeauCharge", () => {
  it("rend l'ESTIMATION quand le rythme est mesurable", () => {
    const etat = etatBandeauCharge({
      soc: [soc(120, 40), soc(60, 55), soc(5, 70)],
      ciblePourcent: 90,
      maintenant: MAINTENANT,
    });
    if (etat?.mode !== "estimation") throw new Error(`attendu une estimation, reçu ${etat?.mode}`);
    expect(etat.estimation.socCourant).toBe(70);
    expect(etat.estimation.finEstimee.getTime()).toBeGreaterThan(MAINTENANT.getTime());
  });

  it("dit « À LA LIMITE » quand le SOC est au niveau configuré — le cas de Marc", () => {
    // Charge finie il y a des heures : SOC stable À la limite. L'estimation refuse (rien
    // ne monte, cible atteinte) — et c'est exactement ce qui n'affichait plus rien.
    const etat = etatBandeauCharge({
      soc: [soc(300, 80), soc(180, 80), soc(20, 80)],
      ciblePourcent: 80,
      maintenant: MAINTENANT,
    });
    if (etat?.mode !== "limite") throw new Error(`attendu « limite », reçu ${etat?.mode}`);
    expect(etat.socCourant).toBe(80);
    expect(etat.ciblePourcent).toBe(80);
  });

  it("dit « EN CHARGE » quand le SOC monte sans rythme mesurable", () => {
    // Écart DÉRIVÉ de la constante (jamais sa valeur du jour) : juste sous le minimum
    // d'`estimerFinCharge`, qui refuse. Le SOC monte pourtant — la voiture charge, et le
    // bandeau a le droit de le dire sans annoncer d'heure de fin.
    const etat = etatBandeauCharge({
      soc: [soc(ECART_MIN_ESTIMATION_MIN + 4, 62), soc(5, 65)],
      ciblePourcent: 90,
      maintenant: MAINTENANT,
    });
    if (etat?.mode !== "en-charge") throw new Error(`attendu « en-charge », reçu ${etat?.mode}`);
    expect(etat.socCourant).toBe(65);
    expect(etat.gainPoints).toBe(3);
  });

  it("SANS limite mesurée, un SOC stable ne devient PAS « à la limite »", () => {
    // On n'affirmerait rien de mesuré : la jauge dit déjà le pourcentage.
    expect(
      etatBandeauCharge({
        soc: [soc(180, 100), soc(10, 100)],
        ciblePourcent: null,
        maintenant: MAINTENANT,
      }),
    ).toBeNull();
  });

  it("se TAIT sur des relevés périmés — un badge de fraîcheur dit déjà que ça date", () => {
    expect(
      etatBandeauCharge({
        soc: [soc(600, 40), soc(400, 80)],
        ciblePourcent: 80,
        maintenant: MAINTENANT,
      }),
    ).toBeNull();
  });

  it("se TAIT quand le SOC baisse (la voiture roule) et quand il n'y a qu'un relevé", () => {
    expect(
      etatBandeauCharge({
        soc: [soc(60, 70), soc(5, 55)],
        ciblePourcent: 90,
        maintenant: MAINTENANT,
      }),
    ).toBeNull();
    expect(
      etatBandeauCharge({ soc: [soc(5, 55)], ciblePourcent: 90, maintenant: MAINTENANT }),
    ).toBeNull();
  });
});
