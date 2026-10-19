// tests/entretiens.test.ts — `[SC-04]` : le déclencheur de la synchro d'entretien.
//
// Ce que ces tests protègent :
//   1. `extraireEntretiens` accepte les enveloppes RÉELLEMENT possibles et REFUSE d'en
//      deviner une inconnue — « aucun entretien » et « je n'ai pas su lire » sont deux
//      informations différentes, et les confondre écrirait zéro entretien en silence.
//   2. Le créneau de 24 h est ATOMIQUE : deux polls concurrents ne font pas deux appels
//      Smartcar. Prouvé contre un vrai Postgres, comme la réservation du bouton.

import { describe, expect, it } from "vitest";
import { appConfig } from "@/lib/db/schema";
import {
  CLE_SYNCHRO_ENTRETIENS,
  PLANCHER_ENTRETIENS_MS,
  extraireEntretiens,
} from "@/lib/smartcar/entretiens";
import { reserverCreneau } from "@/lib/vehicle/creneau";
import { deciderRafraichissement } from "@/lib/vehicle/rafraichissement";
import { baseDeTest } from "./aides/basePGlite";

type Dbx = NonNullable<Parameters<typeof reserverCreneau>[0]["dbx"]>;
const dbx = baseDeTest([appConfig]).base as unknown as Dbx;

const T = (ms: number) => new Date(Date.UTC(2026, 8, 18, 12, 0, 0) + ms);

describe("extraireEntretiens — lire sans deviner", () => {
  const entree = { serviceDate: "2026-03-01", odometer: 1200 };

  it("accepte un tableau nu", () => {
    expect(extraireEntretiens([entree])).toEqual([entree]);
  });

  it("accepte les enveloppes du projet", () => {
    for (const cle of ["items", "serviceHistory", "records", "data"]) {
      expect(extraireEntretiens({ [cle]: [entree] })).toEqual([entree]);
    }
  });

  it("⚠️ REFUSE une enveloppe inconnue plutôt que de rendre une liste vide", () => {
    // Le cas qui compte : rendre `[]` ferait écrire « zéro entretien » alors que la
    // réponse en contenait peut-être dix. `null` force l'appelant à le DIRE.
    expect(extraireEntretiens({ resultats: [entree] })).toBeNull();
    expect(extraireEntretiens({ ok: true })).toBeNull();
    expect(extraireEntretiens(null)).toBeNull();
    expect(extraireEntretiens("des entretiens")).toBeNull();
  });

  it("écarte ce qui n'est pas un objet dans une liste par ailleurs valide", () => {
    expect(extraireEntretiens([entree, null, 42, "x"])).toEqual([entree]);
  });

  it("une liste VIDE reste une liste — c'est « aucun entretien », pas un échec", () => {
    expect(extraireEntretiens({ items: [] })).toEqual([]);
  });
});

describe("le créneau de 24 h — un appel Smartcar par jour, pas un par poll", () => {
  const reserve = (maintenant: Date) =>
    reserverCreneau({
      cle: CLE_SYNCHRO_ENTRETIENS,
      plancherMs: PLANCHER_ENTRETIENS_MS,
      dbx,
      maintenant,
    });

  it("le premier poll de la journée passe, les suivants sont différés", async () => {
    expect(await reserve(T(0))).toBe(true);
    // Le poll suivant, quinze minutes plus tard.
    expect(await reserve(T(15 * 60_000))).toBe(false);
    // Et celui d'un quart d'heure avant la fin de la fenêtre.
    expect(await reserve(T(PLANCHER_ENTRETIENS_MS - 60_000))).toBe(false);
  });

  it("⚠️ DEUX polls simultanés : un seul appelle Smartcar", async () => {
    const [a, b] = await Promise.all([reserve(T(0)), reserve(T(0))]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("rouvre le lendemain", async () => {
    expect(await reserve(T(0))).toBe(true);
    expect(await reserve(T(PLANCHER_ENTRETIENS_MS))).toBe(true);
  });

  it("n'entre pas en collision avec le créneau du bouton", async () => {
    // Deux clés distinctes : le bouton « Rafraîchir » et la synchro d'entretien ne doivent
    // pas se bloquer l'un l'autre. Une clé partagée ferait qu'un clic repousse la synchro
    // d'une journée entière, sans que rien ne le dise.
    expect(await reserve(T(0))).toBe(true);
    expect(
      await reserverCreneau({
        cle: "poll.rafraichirManuel",
        plancherMs: 60_000,
        dbx,
        maintenant: T(0),
      }),
    ).toBe(true);
  });
});

describe("⚠️ la fonction PURE et la RÉSERVATION doivent être d'accord", () => {
  it("à l'instant EXACT du plancher, les deux autorisent", async () => {
    // Le défaut trouvé en écrivant ces tests : `lt` côté base contre `>=` côté pure. Les
    // deux divergeaient d'une milliseconde — l'écran aurait annoncé « tu peux y aller »
    // pendant que la base refusait, et le bouton aurait semblé cassé une fois sur mille.
    const plancherMs = 60_000;
    const pose = T(0);
    const pile = T(plancherMs);

    expect(
      await reserverCreneau({ cle: "test.accord", plancherMs, dbx, maintenant: pose }),
    ).toBe(true);

    const cotePure = deciderRafraichissement({ dernier: pose, maintenant: pile, plancherMs });
    const coteBase = await reserverCreneau({
      cle: "test.accord",
      plancherMs,
      dbx,
      maintenant: pile,
    });

    expect(cotePure.autorise).toBe(true);
    expect(coteBase).toBe(true);
  });

  it("une milliseconde avant, les deux refusent", async () => {
    const plancherMs = 60_000;
    const pose = T(0);
    const avant = T(plancherMs - 1);

    await reserverCreneau({ cle: "test.accord2", plancherMs, dbx, maintenant: pose });

    expect(
      deciderRafraichissement({ dernier: pose, maintenant: avant, plancherMs }).autorise,
    ).toBe(false);
    expect(
      await reserverCreneau({ cle: "test.accord2", plancherMs, dbx, maintenant: avant }),
    ).toBe(false);
  });
});
