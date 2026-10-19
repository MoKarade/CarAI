// tests/fenetre.test.ts — « la date, ou la range, ou le global » (Marc, 13/08).
//
// Le sujet de ces tests n'est pas le découpage, c'est le FUSEAU. Une date saisie
// « 2026-08-13 » veut dire le 13 août chez Marc (UTC−4 en août), pas en UTC : prise telle
// quelle, la sélection décalerait de quatre heures et manquerait sa soirée.

import { describe, expect, it } from "vitest";
import {
  analyserFenetre,
  dansLaFenetre,
  instantDansLaFenetre,
  jourLocalIso,
  minuitLocal,
  parametresFenetre,
  RACCOURCI_AUJOURDHUI,
  RACCOURCIS_ACTIVITE,
  RACCOURCIS_GLISSANTS,
} from "@/lib/vehicle/fenetre";

const MAINTENANT = new Date("2026-08-13T18:00:00.000Z");

describe("minuitLocal", () => {
  // ⚠️ En août, Toronto est à UTC−4 : minuit local = 04 h 00 UTC le même jour.
  it("rend minuit CHEZ MARC, exprimé en UTC", () => {
    expect(minuitLocal("2026-08-13")!.toISOString()).toBe("2026-08-13T04:00:00.000Z");
  });

  it("suit le changement d'heure — l'hiver, le décalage n'est plus le même", () => {
    // En janvier, Toronto est à UTC−5 : minuit local = 05 h 00 UTC.
    expect(minuitLocal("2026-01-13")!.toISOString()).toBe("2026-01-13T05:00:00.000Z");
  });

  it("refuse une date qui n'existe pas plutôt que de la décaler en silence", () => {
    expect(minuitLocal("2026-02-31")).toBeNull();
    expect(minuitLocal("2026-13-01")).toBeNull();
    expect(minuitLocal("13/08/2026")).toBeNull();
    expect(minuitLocal("")).toBeNull();
  });
});

describe("jourLocalIso", () => {
  // 02 h 00 UTC le 14 août, c'est encore le 13 au soir chez Marc (22 h). Le jour LOCAL
  // est celui qui compte : c'est ce qui empêche un trajet de 21 h de basculer au lendemain.
  it("rend le jour LOCAL, pas le jour UTC", () => {
    expect(jourLocalIso(new Date("2026-08-14T02:00:00.000Z"))).toBe("2026-08-13");
    expect(jourLocalIso(new Date("2026-08-14T12:00:00.000Z"))).toBe("2026-08-14");
  });
});

describe("analyserFenetre", () => {
  it("sans rien, retombe sur tout l'historique", () => {
    const f = analyserFenetre({}, MAINTENANT);
    expect(f.mode).toBe("tout");
    expect(f.depuis).toBeNull();
    expect(f.jusqu).toBeNull();
  });

  it("comprend un raccourci et en donne un libellé lisible", () => {
    const f = analyserFenetre({ periode: "7j" }, MAINTENANT);
    expect(f.mode).toBe("raccourci");
    expect(f.periode).toBe("7j");
    expect(f.libelle).toContain("7 derniers jours");
    expect(f.depuis!.toISOString()).toBe("2026-08-06T18:00:00.000Z");
  });

  it("un raccourci inconnu ne casse rien — il retombe sur tout", () => {
    expect(analyserFenetre({ periode: "constructor" }, MAINTENANT).mode).toBe("tout");
    expect(analyserFenetre({ periode: "42j" }, MAINTENANT).mode).toBe("tout");
  });

  // ⚠️ LE piège d'une borne de fin : sélectionner le 13 doit inclure TOUTE la journée du
  // 13. Une borne à minuit du 13 rendrait une sélection vide.
  it("un JOUR précis couvre la journée entière, pas l'instant minuit", () => {
    const f = analyserFenetre({ du: "2026-08-13", au: "2026-08-13" }, MAINTENANT);
    expect(f.mode).toBe("jour");
    expect(f.depuis!.toISOString()).toBe("2026-08-13T04:00:00.000Z");
    expect(f.jusqu!.toISOString()).toBe("2026-08-14T04:00:00.000Z");
    expect(f.libelle).toBe("Le 2026-08-13");
  });

  it("comprend une PLAGE", () => {
    const f = analyserFenetre({ du: "2026-08-01", au: "2026-08-13" }, MAINTENANT);
    expect(f.mode).toBe("plage");
    expect(f.depuis!.toISOString()).toBe("2026-08-01T04:00:00.000Z");
    expect(f.jusqu!.toISOString()).toBe("2026-08-14T04:00:00.000Z");
    expect(f.libelle).toBe("Du 2026-08-01 au 2026-08-13");
  });

  it("les dates l'emportent sur le raccourci — une plage saisie est un choix explicite", () => {
    const f = analyserFenetre({ periode: "24h", du: "2026-08-01", au: "2026-08-02" }, MAINTENANT);
    expect(f.mode).toBe("plage");
    expect(f.depuis!.toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });

  it("remet les bornes à l'endroit au lieu de rendre une sélection vide", () => {
    const f = analyserFenetre({ du: "2026-08-13", au: "2026-08-01" }, MAINTENANT);
    expect(f.depuis!.toISOString()).toBe("2026-08-01T04:00:00.000Z");
    expect(f.jusqu!.toISOString()).toBe("2026-08-14T04:00:00.000Z");
    expect(f.avertissement).toContain("l’envers");
  });

  it("une date illisible est ignorée ET signalée, jamais avalée", () => {
    const f = analyserFenetre({ du: "hier" }, MAINTENANT);
    expect(f.avertissement).not.toBeNull();
    expect(f.mode).toBe("tout");
  });

  it("accepte une borne seule, des deux côtés", () => {
    const depuis = analyserFenetre({ du: "2026-08-10" }, MAINTENANT);
    expect(depuis.depuis).not.toBeNull();
    expect(depuis.jusqu).toBeNull();
    expect(depuis.libelle).toContain("Depuis");

    const jusqu = analyserFenetre({ au: "2026-08-10" }, MAINTENANT);
    expect(jusqu.depuis).toBeNull();
    expect(jusqu.jusqu).not.toBeNull();
    expect(jusqu.libelle).toContain("Jusqu");
  });
});

describe("dansLaFenetre", () => {
  const pt = (iso: string) => ({ t: new Date(iso) });

  it("coupe à la borne HAUTE, que la lecture SQL ne connaît pas", () => {
    const f = analyserFenetre({ du: "2026-08-13", au: "2026-08-13" }, MAINTENANT);
    const gardes = dansLaFenetre(
      [
        pt("2026-08-13T03:00:00Z"), // 23 h le 12, chez Marc : DEHORS
        pt("2026-08-13T12:00:00Z"), // 8 h le 13 : dedans
        pt("2026-08-14T03:00:00Z"), // 23 h le 13 : dedans
        pt("2026-08-14T05:00:00Z"), // 1 h le 14 : DEHORS
      ],
      f,
    );
    expect(gardes).toHaveLength(2);
  });

  it("sans borne haute, ne filtre rien (le SQL a déjà fait la borne basse)", () => {
    const f = analyserFenetre({ periode: "7j" }, MAINTENANT);
    const points = [pt("2020-01-01T00:00:00Z"), pt("2026-08-13T00:00:00Z")];
    expect(dansLaFenetre(points, f)).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════
// LOT DU 14/09 — « je veux filtrer par date mois etc » (Marc).
//
// Activité n'avait qu'un menu de raccourcis glissants, avec « aujourd'hui » en défaut.
// Le sélecteur complet vivait sur Tendances. En le partageant, `analyserFenetre` a dû
// apprendre DEUX choses que chaque écran déclare : quels raccourcis il propose, et sur
// quoi retomber. Ce qui suit garde ces deux-là, plus la sérialisation qui permet aux
// liens internes de conserver la fenêtre.
// ══════════════════════════════════════════════════════════════════════════════════════

describe("le raccourci « aujourd'hui »", () => {
  // 18 h 00 UTC le 13 août = 14 h 00 chez Marc. « Aujourd'hui » commence donc à 04 h 00
  // UTC (minuit local), alors que « 24h » remonte à la veille 18 h 00 : DIX heures d'écart.
  // C'est exactement ce que le commentaire d'Activité affirmait depuis le 17/08, et rien
  // ne le vérifiait.
  it("part de MINUIT LOCAL, pas d'il y a vingt-quatre heures", () => {
    const auj = analyserFenetre({ periode: "aujourdhui" }, MAINTENANT, {
      raccourcis: RACCOURCIS_ACTIVITE,
      defaut: RACCOURCI_AUJOURDHUI,
    });
    expect(auj.depuis!.toISOString()).toBe("2026-08-13T04:00:00.000Z");

    const vingtQuatre = analyserFenetre({ periode: "24h" }, MAINTENANT, {
      raccourcis: RACCOURCIS_ACTIVITE,
      defaut: RACCOURCI_AUJOURDHUI,
    });
    expect(vingtQuatre.depuis!.toISOString()).toBe("2026-08-12T18:00:00.000Z");
    expect(auj.depuis!.getTime()).not.toBe(vingtQuatre.depuis!.getTime());
  });

  it("suit le fuseau, pas l'UTC de Vercel", () => {
    // En janvier Toronto est à UTC−5 : minuit local devient 05 h 00 UTC.
    const janvier = new Date("2026-01-13T18:00:00.000Z");
    const f = analyserFenetre({ periode: "aujourdhui" }, janvier, {
      raccourcis: RACCOURCIS_ACTIVITE,
      defaut: RACCOURCI_AUJOURDHUI,
    });
    expect(f.depuis!.toISOString()).toBe("2026-01-13T05:00:00.000Z");
  });
});

describe("le défaut appartient à l'ÉCRAN, pas à la fonction", () => {
  it("retombe sur le défaut PASSÉ, pas sur « tout » en dur", () => {
    const activite = analyserFenetre({ periode: "n’importe quoi" }, MAINTENANT, {
      raccourcis: RACCOURCIS_ACTIVITE,
      defaut: RACCOURCI_AUJOURDHUI,
    });
    expect(activite.periode).toBe("aujourdhui");

    const tendances = analyserFenetre({ periode: "n’importe quoi" }, MAINTENANT, {
      raccourcis: RACCOURCIS_GLISSANTS,
      defaut: "tout",
    });
    expect(tendances.periode).toBe("tout");
  });

  it("refuse un raccourci que l'écran ne propose PAS", () => {
    // Tendances n'offre pas « aujourd'hui » : un lien forgé à la main ne doit pas lui
    // imposer un mode que son sélecteur ne saurait pas montrer comme actif.
    const f = analyserFenetre({ periode: "aujourdhui" }, MAINTENANT, {
      raccourcis: RACCOURCIS_GLISSANTS,
      defaut: "tout",
    });
    expect(f.periode).toBe("tout");
  });

  it("un vieux lien `?periode=jour` atterrit sur le défaut de l'écran", () => {
    // Activité écrivait `?periode=jour` avant ce lot. Aucun alias n'a été posé : le repli
    // naturel fait le travail, et il le fait au BON endroit (« aujourd'hui »).
    const f = analyserFenetre({ periode: "jour" }, MAINTENANT, {
      raccourcis: RACCOURCIS_ACTIVITE,
      defaut: RACCOURCI_AUJOURDHUI,
    });
    expect(f.periode).toBe("aujourdhui");
    expect(f.mode).toBe("raccourci");
  });

  it("sans options, se comporte EXACTEMENT comme avant le partage", () => {
    // Garde de non-régression pour Tendances : le 3e paramètre est passé d'un fuseau à un
    // objet d'options, et aucun appelant ne passait de fuseau. Si ce test tombe, c'est que
    // le comportement par défaut a bougé — pas qu'une option manque.
    expect(analyserFenetre({}, MAINTENANT).periode).toBe("tout");
    expect(analyserFenetre({ periode: "7j" }, MAINTENANT).periode).toBe("7j");
    expect(analyserFenetre({ periode: "constructor" }, MAINTENANT).periode).toBe("tout");
  });
});

describe("parametresFenetre", () => {
  it("rend le raccourci quand la fenêtre en vient", () => {
    const f = analyserFenetre({ periode: "7j" }, MAINTENANT);
    expect(parametresFenetre(f)).toBe("periode=7j");
  });

  it("rend les DEUX dates quand la fenêtre est une plage", () => {
    const f = analyserFenetre({ du: "2026-08-01", au: "2026-08-13" }, MAINTENANT);
    expect(parametresFenetre(f)).toBe("du=2026-08-01&au=2026-08-13");
  });

  it("garde un jour précis tel quel — c'est la plage aux bornes confondues", () => {
    const f = analyserFenetre({ du: "2026-08-13", au: "2026-08-13" }, MAINTENANT);
    expect(f.mode).toBe("jour");
    expect(parametresFenetre(f)).toBe("du=2026-08-13&au=2026-08-13");
  });

  it("n'oublie pas une borne isolée", () => {
    expect(parametresFenetre(analyserFenetre({ du: "2026-08-10" }, MAINTENANT))).toBe(
      "du=2026-08-10",
    );
    expect(parametresFenetre(analyserFenetre({ au: "2026-08-10" }, MAINTENANT))).toBe(
      "au=2026-08-10",
    );
  });
});

describe("instantDansLaFenetre", () => {
  const plage = analyserFenetre({ du: "2026-08-10", au: "2026-08-12" }, MAINTENANT);

  it("inclut le début et EXCLUT la fin — donc toute la journée du 12", () => {
    // `analyserFenetre` pose `jusqu` à minuit du 13 : le 12 à 23 h 59 est dedans, le 13 à
    // 00 h 01 est dehors. C'est cette asymétrie qui fait qu'un jour précis contient sa
    // journée entière plutôt que de s'arrêter à son premier instant.
    expect(instantDansLaFenetre(new Date("2026-08-10T04:00:00.000Z"), plage)).toBe(true);
    expect(instantDansLaFenetre(new Date("2026-08-13T03:59:00.000Z"), plage)).toBe(true);
    expect(instantDansLaFenetre(new Date("2026-08-13T04:00:00.000Z"), plage)).toBe(false);
    expect(instantDansLaFenetre(new Date("2026-08-10T03:59:00.000Z"), plage)).toBe(false);
  });

  it("sans borne haute, ne refuse que le passé", () => {
    const sept = analyserFenetre({ periode: "7j" }, MAINTENANT);
    expect(instantDansLaFenetre(new Date("2026-08-13T17:00:00.000Z"), sept)).toBe(true);
    expect(instantDansLaFenetre(new Date("2026-12-25T00:00:00.000Z"), sept)).toBe(true);
    expect(instantDansLaFenetre(new Date("2026-08-01T00:00:00.000Z"), sept)).toBe(false);
  });

  it("accepte tout quand la fenêtre est « tout »", () => {
    const tout = analyserFenetre({ periode: "tout" }, MAINTENANT);
    expect(instantDansLaFenetre(new Date("2020-01-01T00:00:00.000Z"), tout)).toBe(true);
  });

  it("dit la MÊME chose que `dansLaFenetre`, sur les mêmes points", () => {
    // Les deux doivent rester d'accord : `dansLaFenetre` s'appuie sur ce prédicat, et le
    // jour où quelqu'un réécrirait l'un des deux, c'est ici que ça se verrait.
    const points = [
      { t: new Date("2026-08-09T12:00:00.000Z") },
      { t: new Date("2026-08-11T12:00:00.000Z") },
      { t: new Date("2026-08-14T12:00:00.000Z") },
    ];
    expect(dansLaFenetre(points, plage)).toEqual(
      points.filter((p) => instantDansLaFenetre(p.t, plage)),
    );
  });
});
