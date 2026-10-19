// tests/pointsAccueil.test.ts — CE QUE dit chaque point posé sur la voiture.
//
// L'enjeu central est l'HONNÊTETÉ : sur une carrosserie, une pastille verte se lit « tout
// va bien » et un « 0 » se lit comme une mesure. Chaque absence est donc vérifiée une par
// une — c'est le genre de régression qu'aucun typage n'attrape.

import { describe, expect, it } from "vitest";
import type { EtatSchema } from "@/lib/vehicle/etatSchema";
import type { PneuDiagnostique } from "@/lib/vehicle/schemaVehicule";
import { construirePointsVoiture, SYNCHRO_VIEILLE_MS } from "@/lib/vehicle/pointsAccueil";
import { ANCRES, type IdPoint } from "@/lib/vehicle/pointsVoiture";

const T0 = new Date("2026-08-20T18:00:00Z");

const SCHEMA_VIDE: EtatSchema = {
  pneus: [],
  unitePression: null,
  portieresOuvertes: [],
  vitresOuvertes: [],
  ouvrantsSansPosition: 0,
  verrouillee: null,
  mesureLe: null,
};

const RIEN = {
  schema: SCHEMA_VIDE,
  soc: null,
  autonomieKm: null,
  odometreKm: null,
  derniereSynchro: null,
  maintenant: T0,
};

const pneu = (
  position: PneuDiagnostique["position"],
  pressionKpa: number,
  etat: PneuDiagnostique["etat"],
  raison = "",
): PneuDiagnostique => ({
  position,
  libelle: position ?? "roue",
  pressionKpa,
  psi: Math.round(pressionKpa * 0.145038),
  etat,
  ecartKpa: null,
  baisseKpa: null,
  raison,
});

const point = (points: ReturnType<typeof construirePointsVoiture>, id: IdPoint) => {
  const p = points.find((x) => x.id === id);
  if (!p) throw new Error(`point ${id} absent`);
  return p;
};

describe("la couverture des points", () => {
  it("chaque ancre a son point, et chaque point son ancre — exactement une fois", () => {
    const points = construirePointsVoiture(RIEN);
    const ids = points.map((p) => p.id).sort();
    expect(ids).toEqual((Object.keys(ANCRES) as IdPoint[]).sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("seuls la charge et le verrou COMMANDENT", () => {
    // Tout le reste est en lecture. Un point qui agirait sans le dire serait un piège.
    const qui = construirePointsVoiture(RIEN)
      .filter((p) => p.commande)
      .map((p) => p.id)
      .sort();
    expect(qui).toEqual(["charge", "verrou"]);
  });
});

describe("une mesure absente ne devient JAMAIS rassurante", () => {
  const points = construirePointsVoiture(RIEN);

  it.each<IdPoint>([
    "charge",
    "autonomie",
    "odometre",
    "synchro",
    "verrou",
    "pneu-avant-gauche",
    "pneu-avant-droite",
    "pneu-arriere-gauche",
    "pneu-arriere-droite",
  ])("%s : « — » et ton inconnu, jamais 0 ni vert", (id) => {
    const p = point(points, id);
    expect(p.valeur).toBe("—");
    expect(p.ton).toBe("inconnu");
    expect(p.unite).toBeUndefined();
  });

  it("les ouvrants font exception, et c'est mesuré : « rien d'ouvert » EST une information", () => {
    // La voiture publie l'état de chaque ouvrant ; aucun ouvert est un fait, pas une
    // absence de mesure. C'est le seul point où le vert est mérité sans chiffre.
    const p = point(points, "ouvrants");
    expect(p.valeur).toBe("Fermé");
    expect(p.ton).toBe("ok");
  });
});

describe("les pastilles de pneu restent ÉTROITES", () => {
  it("aucune n'affiche son unité — la marge de bord en dépend", () => {
    // ⚠️ Couplage explicite avec `MARGE_X` (pointsVoiture.ts), calibrée sur la pastille
    // étroite. Ajouter « kPa » ici ferait déborder les quatre pressions hors du cadre, et
    // rien d'autre ne le signalerait qu'un coup d'œil à l'écran.
    const points = construirePointsVoiture({
      ...RIEN,
      schema: {
        ...SCHEMA_VIDE,
        pneus: [
          pneu("avant-gauche", 269, "ok"),
          pneu("avant-droite", 269, "ok"),
          pneu("arriere-gauche", 241, "surveiller", "plus basse que les autres"),
          pneu("arriere-droite", 269, "ok"),
        ],
      },
    });
    for (const p of points.filter((x) => x.id.startsWith("pneu-"))) {
      expect(p.unite, `${p.id} ne doit pas porter d'unité sur sa pastille`).toBeUndefined();
    }
    // L'unité vit dans le détail, où elle a la place.
    expect(point(points, "pneu-avant-gauche").detail.join(" ")).toContain("kPa");
    // Et la roue qui s'écarte porte son ton ET sa raison.
    expect(point(points, "pneu-arriere-gauche").ton).toBe("surveiller");
    expect(point(points, "pneu-arriere-gauche").detail.join(" ")).toContain("plus basse");
  });

  it("chaque pression atterrit sur SA roue", () => {
    const points = construirePointsVoiture({
      ...RIEN,
      schema: {
        ...SCHEMA_VIDE,
        pneus: [pneu("arriere-droite", 200, "ok")],
      },
    });
    expect(point(points, "pneu-arriere-droite").valeur).toBe("200");
    // Les trois autres n'ont pas de mesure — et surtout, elles n'héritent pas de celle-là.
    expect(point(points, "pneu-avant-gauche").valeur).toBe("—");
    expect(point(points, "pneu-avant-droite").valeur).toBe("—");
    expect(point(points, "pneu-arriere-gauche").valeur).toBe("—");
  });
});

describe("les seuils", () => {
  it.each([
    [95, "ok"],
    [41, "ok"],
    [39, "attention"],
    [21, "attention"],
    [19, "danger"],
    [2, "danger"],
  ])("charge à %i %% → ton %s", (soc, attendu) => {
    expect(point(construirePointsVoiture({ ...RIEN, soc }), "charge").ton).toBe(attendu);
  });

  it("la synchro passe en « attention » quand elle dépasse le seuil, pas avant", () => {
    // ⚠️ Les deux cas sont DÉRIVÉS de la constante, jamais de sa valeur du jour : codés en
    // dur, ils mentiraient au premier rajustement du seuil.
    const juste = new Date(T0.getTime() - (SYNCHRO_VIEILLE_MS - 60_000));
    const trop = new Date(T0.getTime() - (SYNCHRO_VIEILLE_MS + 60_000));
    expect(point(construirePointsVoiture({ ...RIEN, derniereSynchro: juste }), "synchro").ton).toBe("ok");
    expect(point(construirePointsVoiture({ ...RIEN, derniereSynchro: trop }), "synchro").ton).toBe("attention");
  });

  it("l'âge se compte depuis `maintenant` PASSÉ, pas depuis l'horloge", () => {
    // C'est ce qui rend la fonction testable — et ce qui évite qu'un rendu serveur affiche
    // un âge calculé sur une autre seconde que celle du reste de la page.
    const releve = new Date(T0.getTime() - 90 * 60_000);
    expect(point(construirePointsVoiture({ ...RIEN, derniereSynchro: releve }), "synchro").valeur).toBe("2 h");
    const plusTard = new Date(T0.getTime() + 24 * 3_600_000);
    expect(
      point(construirePointsVoiture({ ...RIEN, derniereSynchro: releve, maintenant: plusTard }), "synchro").valeur,
    ).toBe("26 h");
  });
});

describe("le verrou et les ouvrants disent l'exception", () => {
  it("déverrouillée est un DANGER, verrouillée est normal", () => {
    const ouverte = construirePointsVoiture({
      ...RIEN,
      schema: { ...SCHEMA_VIDE, verrouillee: false },
    });
    expect(point(ouverte, "verrou").ton).toBe("danger");
    expect(point(ouverte, "verrou").valeur).toBe("OUVERTE");

    const fermee = construirePointsVoiture({
      ...RIEN,
      schema: { ...SCHEMA_VIDE, verrouillee: true },
    });
    expect(point(fermee, "verrou").ton).toBe("ok");
  });

  it("un ouvrant que la voiture ne SITUE pas est compté, et dit comme tel", () => {
    const points = construirePointsVoiture({
      ...RIEN,
      schema: { ...SCHEMA_VIDE, ouvrantsSansPosition: 2 },
    });
    const p = point(points, "ouvrants");
    expect(p.valeur).toBe("2");
    expect(p.ton).toBe("danger");
    expect(p.detail.join(" ")).toContain("ne situe pas");
  });
});

describe("la fin de charge est SUR la voiture, pas seulement dans le bandeau", () => {
  // Marc, 20/08 : « Fin prévue 15 h 35 (2 h 30 annoncées par la voiture au relevé) — je
  // veux que ce soit sur le véhicule aussi ».
  const enCharge = {
    ...RIEN,
    soc: 84,
    finCharge: { heure: "15 h 35", duree: "2 h 30" },
  };

  it("l'heure de fin s'affiche SUR la pastille de charge", () => {
    const p = point(construirePointsVoiture(enCharge), "charge");
    expect(p.valeur).toBe("84");
    expect(p.unite).toBe("% · 15 h 35");
  });

  it("le détail dit d'où vient l'heure — et depuis QUAND elle est comptée", () => {
    // ⚠️ « au relevé » n'est pas un ornement : le relevé peut avoir une heure de retard, et
    // une fin comptée depuis « maintenant » serait fausse d'autant.
    const detail = point(construirePointsVoiture(enCharge), "charge").detail.join(" ");
    expect(detail).toContain("15 h 35");
    expect(detail).toContain("2 h 30");
    expect(detail).toContain("AU RELEVÉ");
  });

  it("HORS charge, aucune heure n'apparaît — même si la voiture en rediffuse une", () => {
    // C'est tout le sujet du 19/08 : la bZ garde `charge_time_remaining` de la session
    // précédente. `finCharge` absent DOIT laisser la pastille muette là-dessus.
    const p = point(construirePointsVoiture({ ...RIEN, soc: 100 }), "charge");
    expect(p.unite).toBe("%");
    expect(p.detail.join(" ")).not.toContain("Fin prévue");
  });
});
