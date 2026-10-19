// tests/commandesSmartcar.test.ts — conformité du TRANSPORT Smartcar (fonctions pures).
//
// ⚠️ Ne pas confondre avec `tests/commandes.test.ts`, qui teste le CATALOGUE d'interface
// (`lib/vehicle/commandes.ts`) : quelles commandes l'app propose, lesquelles exigent une
// confirmation, ce qu'on affiche du résultat. Ici c'est la couche réseau
// (`lib/smartcar/commands.ts`) : les chemins, la forme du corps, la lecture du statut.
// Les deux fichiers portaient le même nom sur deux branches — d'où le renommage.
//
// ══ POURQUOI CE FICHIER EXISTE ═══════════════════════════════════════════════════════
// Trois bugs ont vécu dans `lib/smartcar/commands.ts` depuis le cadrage, sous une suite
// verte, parce qu'AUCUN test ne confrontait le code à la forme réelle de l'API :
//
//   1. le chemin de `set_charge_limit` (`/charge/limit` au lieu de `/charge/set-limit`) ;
//   2. le corps de cette même commande (fraction 0,8 au lieu de `{data:{attributes:
//      {percent:80}}}`) ;
//   3. le plus grave — un `status.value: "FAILURE"` dans le corps d'un 200/202 était
//      annoncé « success », donc « Verrouillé » alors que la voiture avait refusé.
//
// Les trois venaient de suppositions écrites de mémoire, la doc Smartcar étant bloquée
// depuis les sessions. Ils ont été corrigés le 2026-08-14 contre la spec OpenAPI réelle,
// archivée dans `docs/SMARTCAR_API.md`.
//
// Ces tests DISCRIMINENT : chacun échoue sur le code d'avant. C'est la seule preuve qui
// vaille — un test qui passe des deux côtés ne verrouille rien.

import { describe, expect, it } from "vitest";
import {
  CHEMINS_COMMANDES,
  LIMITE_CHARGE_MAX,
  LIMITE_CHARGE_MIN,
  corpsCommande,
  lireStatutExecution,
  normaliserLimiteCharge,
} from "@/lib/smartcar/commands";

describe("chemins des commandes", () => {
  // Dérivés de la spec OpenAPI, section `paths`. Le test échoue sur l'ancien
  // `/commands/charge/limit`, qui renvoyait un 404 depuis toujours.
  it("correspondent EXACTEMENT aux chemins de la spec", () => {
    expect(CHEMINS_COMMANDES).toEqual({
      lock: "/commands/security/lock",
      unlock: "/commands/security/unlock",
      start_charge: "/commands/charge/start",
      stop_charge: "/commands/charge/stop",
      set_charge_limit: "/commands/charge/set-limit",
    });
  });

  it("portent tous le segment /commands/ — les horaires de charge, eux, n'en ont PAS", () => {
    for (const chemin of Object.values(CHEMINS_COMMANDES)) {
      expect(chemin.startsWith("/commands/")).toBe(true);
    }
  });
});

describe("normaliserLimiteCharge", () => {
  // `ChargeLimitAttributes` : percent, integer, minimum 50, maximum 100.
  it("rend un POURCENTAGE ENTIER, jamais une fraction", () => {
    const r = normaliserLimiteCharge(80);
    expect(r).toEqual({ percent: 80 });
    // Le bug d'avant rendait 0.8 — la garde qui l'attrape.
    expect(Number.isInteger((r as { percent: number }).percent)).toBe(true);
  });

  it("convertit une fraction saisie en pourcentage", () => {
    expect(normaliserLimiteCharge(0.8)).toEqual({ percent: 80 });
  });

  it("arrondit : la spec exige un entier, 80.5 ferait un 400 inexpliqué", () => {
    expect(normaliserLimiteCharge(80.4)).toEqual({ percent: 80 });
    expect(normaliserLimiteCharge(80.6)).toEqual({ percent: 81 });
  });

  it("accepte les deux bornes exactes de la spec", () => {
    expect(normaliserLimiteCharge(LIMITE_CHARGE_MIN)).toEqual({ percent: 50 });
    expect(normaliserLimiteCharge(LIMITE_CHARGE_MAX)).toEqual({ percent: 100 });
  });

  it("refuse hors bornes et ce qui n'est pas un nombre fini", () => {
    expect(normaliserLimiteCharge(49)).toHaveProperty("erreur");
    expect(normaliserLimiteCharge(101)).toHaveProperty("erreur");
    expect(normaliserLimiteCharge(Number.NaN)).toHaveProperty("erreur");
    expect(normaliserLimiteCharge(Number.POSITIVE_INFINITY)).toHaveProperty("erreur");
  });

  // Les bornes sont DÉRIVÉES de la constante, pas recopiées : le jour où Smartcar
  // change son minimum, le test suit au lieu de mentir.
  it("annonce ses bornes dans le message d'erreur", () => {
    const r = normaliserLimiteCharge(10) as { erreur: string };
    expect(r.erreur).toContain(String(LIMITE_CHARGE_MIN));
    expect(r.erreur).toContain(String(LIMITE_CHARGE_MAX));
  });
});

describe("corpsCommande", () => {
  it("produit l'enveloppe { data: { attributes } } de la spec", () => {
    expect(corpsCommande({ percent: 80 })).toEqual({ data: { attributes: { percent: 80 } } });
  });
});

describe("lireStatutExecution — le statut est dans le CORPS, pas dans le code HTTP", () => {
  const enveloppe = (status: unknown) => ({
    data: { id: "exec_1", type: "command-execution", attributes: { status } },
  });

  it("lit un SUCCESS", () => {
    expect(lireStatutExecution(enveloppe({ value: "SUCCESS" }), 200).statut).toBe("success");
  });

  // ══ LE TEST QUI COMPTE ══════════════════════════════════════════════════════════════
  // Exemple officiel de la spec : un `security-lock` en ÉCHEC, servi sous un 202.
  // L'ancien code répondait "success" ⇒ CarAI disait « Verrouillé » sur une voiture
  // restée ouverte. Ce test échoue sur le code d'avant, dans les deux variantes HTTP.
  it.each([200, 202])(
    "traite un FAILURE comme un ÉCHEC même sous un HTTP %i",
    (httpStatus) => {
      const lu = lireStatutExecution(
        enveloppe({
          value: "FAILURE",
          error: {
            status: "500",
            type: "VEHICLE",
            code: "LOCK_FAILED",
            title: "Lock Failed",
            detail: "The vehicle was unable to lock its doors.",
          },
        }),
        httpStatus,
      );
      expect(lu.statut).toBe("failed");
      expect(lu.statut).not.toBe("success");
      expect(lu.message).toContain("unable to lock");
      expect(lu.message).toContain("LOCK_FAILED");
    },
  );

  it("préfère suggestedUserMessage, que la spec destine à l'affichage", () => {
    const lu = lireStatutExecution(
      enveloppe({
        value: "FAILURE",
        error: {
          code: "ASLEEP",
          detail: "The vehicle is in a sleep state.",
          suggestedUserMessage: "Ta voiture dort. Réessaie dans un moment.",
        },
      }),
      200,
    );
    expect(lu.message).toContain("Ta voiture dort");
    expect(lu.message).not.toContain("sleep state");
  });

  it("rend PENDING quand le véhicule n'a pas encore tranché", () => {
    expect(lireStatutExecution(enveloppe({ value: "PENDING" }), 202).statut).toBe("pending");
  });

  // Un statut absent ne doit JAMAIS devenir un succès : c'est exactement l'inférence qui
  // a produit le bug. `unknown` est la colonne qui existe pour dire « on ne sait pas ».
  it("ne DEVINE pas un succès quand le statut est absent ou illisible", () => {
    expect(lireStatutExecution(null, 200).statut).toBe("unknown");
    expect(lireStatutExecution({}, 200).statut).toBe("unknown");
    expect(lireStatutExecution({ data: {} }, 200).statut).toBe("unknown");
    expect(lireStatutExecution(enveloppe({ value: "PAS_UN_STATUT" }), 200).statut).toBe(
      "unknown",
    );
  });

  it("garde « en cours » pour un 202 sans corps exploitable", () => {
    expect(lireStatutExecution(null, 202).statut).toBe("pending");
  });
});
