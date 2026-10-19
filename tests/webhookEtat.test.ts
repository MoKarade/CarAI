// tests/webhookEtat.test.ts — diagnostic de l'état des webhooks Smartcar.
//
// Ce que ces tests protègent : un panneau de diagnostic qui se trompe est PIRE que pas de
// panneau. Annoncer « tout va bien » sur un webhook désactivé, ou crier à la panne parce
// que la voiture est stationnée, apprend à ignorer l'écran — et c'est irréversible.
//
// Chaque cas de verdict est instancié, et la DISCRIMINATION des cas voisins est vérifiée :
// il ne suffit pas que « désactivé » sorte `desactive`, il faut que le même jeu de données
// avec `actif: true` sorte AUTRE CHOSE.

import { beforeEach, describe, expect, it } from "vitest";
import {
  CHEMIN_CALLBACK,
  SEUIL_MUET_MINUTES,
  SEUIL_MUET_EVENEMENTIEL_MINUTES,
  callbackAttendu,
  comparerCallback,
  deduireType,
  diagnostiquerWebhooks,
  type EntreeDiagnostic,
  type SouscriptionSmartcar,
  type WebhookSmartcar,
} from "@/lib/smartcar/webhookEtat";
import {
  detailErreur,
  lireSouscriptions,
  lireWebhooks,
  managementConfigure,
  souscrireVehicule,
} from "@/lib/smartcar/management";
import { oublierToken } from "@/lib/smartcar/auth";

const CALLBACK = "https://carai.hubperso.com/api/webhooks/smartcar";
const VEHICULE = "veh-123";
const MAINTENANT = new Date("2026-08-17T18:00:00Z");

/** Identifiants M2M valides pour les tests qui doivent atteindre l'appel réseau. */
const CREDENTIALS = { SMARTCAR_CLIENT_ID: "id_x", SMARTCAR_CLIENT_SECRET: "secret_x" };

/**
 * Enveloppe un mock `fetch` pour répondre AUSSI à l'obtention de jeton OAuth
 * (`iam.smartcar.com`), avant de déléguer à `management` pour l'appel réel — c'est
 * le vrai parcours à deux requêtes depuis le correctif du 17/08 (voir `management.ts`).
 */
function avecToken(management: typeof fetch): typeof fetch {
  return (async (url, init) => {
    if (String(url).startsWith("https://iam.smartcar.com/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok_x", expires_in: 3600 }), {
        status: 200,
      });
    }
    return management(url, init);
  }) as typeof fetch;
}

// Cache de jeton MODULE-LEVEL dans `auth.ts`, partagé par construction (voir son
// commentaire) : un test qui laisse un jeton en cache ferait passer le suivant sans
// jamais retoucher le réseau, ce qui invaliderait ses propres assertions sur l'appel.
beforeEach(() => oublierToken());

function webhook(patch: Partial<WebhookSmartcar> = {}): WebhookSmartcar {
  return {
    id: "wh-1",
    nom: "CarAI",
    callbackUri: CALLBACK,
    actif: true,
    autoAbonnement: false,
    declencheurs: [],
    donnees: ["tractionbattery-stateofcharge"],
    ...patch,
  };
}

function souscription(patch: Partial<SouscriptionSmartcar> = {}): SouscriptionSmartcar {
  return { id: "sub-1", webhookId: "wh-1", vehicleId: VEHICULE, creeLe: null, ...patch };
}

function entree(patch: Partial<EntreeDiagnostic> = {}): EntreeDiagnostic {
  return {
    webhooks: [webhook()],
    souscriptions: [souscription()],
    vehicleId: VEHICULE,
    callbackAttendu: CALLBACK,
    derniereLivraison: new Date(MAINTENANT.getTime() - 10 * 60_000),
    maintenant: MAINTENANT,
    ...patch,
  };
}

describe("callbackAttendu", () => {
  it("préfère l'origine canonique de SMARTCAR_REDIRECT_URI à celle de la requête", () => {
    const url = callbackAttendu(
      { SMARTCAR_REDIRECT_URI: "https://carai.hubperso.com/api/connect/callback" },
      "https://carai-git-preview-marc.vercel.app",
    );
    expect(url).toBe(CALLBACK);
  });

  it("retombe sur l'origine de la requête quand rien n'est déclaré", () => {
    expect(callbackAttendu({}, "https://exemple.test")).toBe(
      `https://exemple.test${CHEMIN_CALLBACK}`,
    );
  });

  it("ne lève JAMAIS sur une URL déclarée illisible — un diagnostic ne casse pas sa page", () => {
    expect(callbackAttendu({ SMARTCAR_REDIRECT_URI: "pas une url" }, "https://exemple.test")).toBe(
      `https://exemple.test${CHEMIN_CALLBACK}`,
    );
  });

  it("tolère une barre finale sur l'origine de la requête", () => {
    expect(callbackAttendu({}, "https://exemple.test/")).toBe(
      `https://exemple.test${CHEMIN_CALLBACK}`,
    );
  });
});

describe("comparerCallback", () => {
  it("reconnaît l'identité malgré la casse de l'hôte et une barre finale", () => {
    expect(comparerCallback("https://CarAI.Hubperso.com/api/webhooks/smartcar/", CALLBACK)).toBe(
      "exact",
    );
  });

  it("distingue « même chemin, autre hôte » de « rien à voir »", () => {
    expect(comparerCallback("https://vieille-preview.vercel.app/api/webhooks/smartcar", CALLBACK)).toBe(
      "autre_hote",
    );
    expect(comparerCallback("https://carai.hubperso.com/autre/chose", CALLBACK)).toBe("different");
  });

  it("ne confond pas un chemin PRÉFIXE avec le chemin exact", () => {
    // `/api/webhooks/smartcar-test` commence par le bon chemin : une comparaison par
    // `startsWith` le prendrait pour le bon webhook et validerait une adresse fausse.
    expect(comparerCallback("https://carai.hubperso.com/api/webhooks/smartcar-test", CALLBACK)).toBe(
      "different",
    );
  });

  it("traite une URL illisible comme différente, sans lever", () => {
    expect(comparerCallback("://cassé", CALLBACK)).toBe("different");
  });
});

describe("deduireType", () => {
  it("sans déclencheur ⇒ programmé ; avec déclencheurs ⇒ événementiel", () => {
    expect(deduireType(webhook({ declencheurs: [] }))).toBe("programme");
    expect(deduireType(webhook({ declencheurs: ["charge-ischarging"] }))).toBe("evenementiel");
    expect(deduireType(null)).toBe("inconnu");
  });
});

describe("diagnostiquerWebhooks — les obstacles, dans l'ordre où ils bloquent", () => {
  it("sans identifiants M2M : le dit, et ne prétend rien sur l'état réel", () => {
    const v = diagnostiquerWebhooks(entree({ webhooks: null }));
    expect(v.code).toBe("sans_jeton");
    expect(v.gravite).toBe("attention");
    expect(v.action).toContain("SMARTCAR_CLIENT_ID");
    expect(v.action).toContain("SMARTCAR_CLIENT_SECRET");
  });

  it("lecture refusée : porte le motif de Smartcar, jamais un « tout va bien » par défaut", () => {
    const v = diagnostiquerWebhooks(
      entree({ webhooks: null, erreurLecture: "401 — token invalide" }),
    );
    expect(v.code).toBe("illisible");
    expect(v.explication).toContain("401");
    // Le point qui compte : ne PAS laisser croire que l'absence de problème détecté
    // équivaut à une absence de problème.
    expect(v.explication).toContain("ne dit donc RIEN");
  });

  it("aucun webhook : panne, avec le rappel que l'API ne peut pas en créer", () => {
    const v = diagnostiquerWebhooks(entree({ webhooks: [] }));
    expect(v.code).toBe("aucun_webhook");
    expect(v.gravite).toBe("panne");
    expect(v.action).toContain("POST /webhooks");
    expect(v.action).toContain(CALLBACK);
  });

  it("webhook braqué sur un autre hôte : cas distinct, pas « aucun webhook »", () => {
    const v = diagnostiquerWebhooks(
      entree({
        webhooks: [webhook({ callbackUri: "https://vieille-preview.vercel.app/api/webhooks/smartcar" })],
      }),
    );
    expect(v.code).toBe("autre_hote");
    expect(v.gravite).toBe("panne");
    expect(v.explication).toContain("vieille-preview.vercel.app");
  });

  it("des webhooks existent mais aucun pour CarAI : les callbacks trouvés sont NOMMÉS", () => {
    const v = diagnostiquerWebhooks(
      entree({ webhooks: [webhook({ callbackUri: "https://autre.test/hook" })] }),
    );
    expect(v.code).toBe("aucun_pour_carai");
    // Un diagnostic qui ne dit pas ce qu'il a VU oblige à rouvrir le tableau de bord.
    expect(v.explication).toContain("https://autre.test/hook");
  });

  it("webhook désactivé : panne, et l'explication nomme la désactivation automatique", () => {
    const v = diagnostiquerWebhooks(entree({ webhooks: [webhook({ actif: false })] }));
    expect(v.code).toBe("desactive");
    expect(v.gravite).toBe("panne");
    expect(v.explication).toContain("six livraisons en échec");
    expect(v.corrigibleIci).toBe(false);
  });

  it("DISCRIMINATION : le même jeu avec actif=true ne sort PAS « désactivé »", () => {
    expect(diagnostiquerWebhooks(entree({ webhooks: [webhook({ actif: true })] })).code).not.toBe(
      "desactive",
    );
  });

  it("préfère un webhook ACTIF quand deux pointent vers la même adresse", () => {
    const v = diagnostiquerWebhooks(
      entree({
        webhooks: [webhook({ id: "wh-mort", actif: false }), webhook({ id: "wh-1", actif: true })],
      }),
    );
    // Un webhook mort laissé en place à côté du bon ne doit pas faire crier à la panne.
    expect(v.webhook?.id).toBe("wh-1");
    expect(v.code).toBe("ok");
  });

  it("véhicule non abonné : panne, et CarAI peut la corriger lui-même", () => {
    const v = diagnostiquerWebhooks(entree({ souscriptions: [] }));
    expect(v.code).toBe("non_souscrit");
    expect(v.gravite).toBe("panne");
    expect(v.corrigibleIci).toBe(true);
  });

  it("un abonnement pour un AUTRE véhicule ne compte pas comme un abonnement", () => {
    const v = diagnostiquerWebhooks({
      ...entree(),
      souscriptions: [souscription({ vehicleId: "veh-autre" })],
    });
    expect(v.code).toBe("non_souscrit");
  });

  it("un abonnement vers un AUTRE webhook ne compte pas non plus", () => {
    const v = diagnostiquerWebhooks({
      ...entree(),
      souscriptions: [souscription({ webhookId: "wh-autre" })],
    });
    expect(v.code).toBe("non_souscrit");
  });

  it("aucun véhicule connecté : attention (rien à abonner), pas panne", () => {
    const v = diagnostiquerWebhooks(entree({ vehicleId: null, souscriptions: [] }));
    expect(v.code).toBe("non_souscrit");
    expect(v.gravite).toBe("attention");
    expect(v.corrigibleIci).toBe(false);
    expect(v.action).toContain("Connect");
  });

  it("autoSubscribe activé n'excuse PAS un véhicule non abonné, et l'explication le dit", () => {
    const v = diagnostiquerWebhooks(
      entree({ webhooks: [webhook({ autoAbonnement: true })], souscriptions: [] }),
    );
    expect(v.code).toBe("non_souscrit");
    expect(v.explication).toContain("abonnement automatique");
  });
});

describe("diagnostiquerWebhooks — le silence, selon le TYPE de webhook", () => {
  const silence = (minutes: number, declencheurs: string[]) =>
    diagnostiquerWebhooks(
      entree({
        webhooks: [webhook({ declencheurs })],
        derniereLivraison: new Date(MAINTENANT.getTime() - minutes * 60_000),
      }),
    );

  it("webhook PROGRAMMÉ muet au-delà du seuil : panne", () => {
    const v = silence(SEUIL_MUET_MINUTES + 60, []);
    expect(v.code).toBe("muet");
    expect(v.gravite).toBe("panne");
    expect(v.type).toBe("programme");
  });

  it("webhook ÉVÉNEMENTIEL au MÊME silence : rien, parce que la voiture peut être garée", () => {
    // Le cœur du sujet. Un webhook événementiel silencieux pendant huit heures est le
    // comportement NORMAL d'une voiture stationnée (constat du 11/08). Le confondre avec
    // une panne remplirait l'écran d'alarmes fausses — et une alarme fausse s'ignore.
    const v = silence(SEUIL_MUET_MINUTES + 60, ["charge-ischarging"]);
    expect(v.code).toBe("ok");
  });

  it("webhook ÉVÉNEMENTIEL vraiment très longtemps muet : attention, jamais panne", () => {
    const v = silence(SEUIL_MUET_EVENEMENTIEL_MINUTES + 60, ["charge-ischarging"]);
    expect(v.code).toBe("muet");
    expect(v.gravite).toBe("attention");
    expect(v.explication).toContain("n’est donc pas une preuve de panne");
  });

  it("juste EN DEÇÀ du seuil programmé : pas d'alerte (le seuil est une frontière, pas une zone)", () => {
    expect(silence(SEUIL_MUET_MINUTES - 1, []).code).toBe("ok");
  });

  it("aucune livraison JAMAIS reçue : traité comme un silence infini, pas comme « récent »", () => {
    const v = diagnostiquerWebhooks(entree({ derniereLivraison: null }));
    expect(v.code).toBe("muet");
    expect(v.titre).toContain("JAMAIS");
  });

  it("tout en place et livraisons fraîches : ok, sans action", () => {
    const v = diagnostiquerWebhooks(entree());
    expect(v.code).toBe("ok");
    expect(v.gravite).toBe("ok");
    expect(v.action).toBeNull();
  });

  it("le seuil événementiel est franchement plus large que le programmé", () => {
    // Verrouille l'INTENTION, pas les valeurs : si un jour quelqu'un aligne les deux, la
    // nuance « stationné ≠ cassé » disparaît en silence.
    expect(SEUIL_MUET_EVENEMENTIEL_MINUTES).toBeGreaterThan(SEUIL_MUET_MINUTES * 4);
  });
});

describe("lecture des réponses de la Management API", () => {
  it("lireWebhooks lit les attributs du schéma WebhookAttributes", () => {
    const w = lireWebhooks({
      data: [
        {
          id: "wh-1",
          type: "webhook",
          attributes: {
            name: "CarAI",
            callbackUri: CALLBACK,
            isEnabled: true,
            autoSubscribe: false,
            triggers: [{ group: "Charge", name: "IsCharging", code: "charge-ischarging" }],
            data: [{ group: "TractionBattery", name: "Soc", code: "tractionbattery-stateofcharge" }],
          },
        },
      ],
    });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({
      id: "wh-1",
      nom: "CarAI",
      actif: true,
      autoAbonnement: false,
      declencheurs: ["charge-ischarging"],
      donnees: ["tractionbattery-stateofcharge"],
    });
  });

  it("lireWebhooks accepte triggers=null (le schéma le déclare nullable) sans lever", () => {
    const w = lireWebhooks({
      data: [{ id: "wh-1", attributes: { name: "P", callbackUri: CALLBACK, isEnabled: true, triggers: null, data: null } }],
    });
    expect(w[0]?.declencheurs).toEqual([]);
    expect(w[0]?.donnees).toEqual([]);
  });

  it("lireWebhooks ÉCARTE une entrée sans id — un webhook non identifiable n'apparie rien", () => {
    const w = lireWebhooks({ data: [{ attributes: { name: "orphelin" } }, { id: "wh-1" }] });
    expect(w.map((x) => x.id)).toEqual(["wh-1"]);
  });

  it("lireWebhooks ne prend pas isEnabled absent pour vrai", () => {
    // Défaut prudent : un webhook dont on ne sait pas s'il est actif est traité comme
    // inactif, ce qui produit une alerte visible plutôt qu'un faux « tout va bien ».
    expect(lireWebhooks({ data: [{ id: "wh-1", attributes: {} }] })[0]?.actif).toBe(false);
  });

  it("lireWebhooks rend [] sur une charge utile inattendue, sans lever", () => {
    expect(lireWebhooks(null)).toEqual([]);
    expect(lireWebhooks({ data: "pas un tableau" })).toEqual([]);
  });

  it("lireSouscriptions prend les identifiants dans relationships, pas dans attributes", () => {
    const s = lireSouscriptions({
      data: [
        {
          id: "sub-1",
          type: "subscription",
          attributes: { vehicle: { make: "TOYOTA", model: "bZ", year: 2026, mode: "live" } },
          meta: { createdAt: "2026-08-01T00:00:00Z" },
          relationships: {
            webhook: { data: { type: "webhook", id: "wh-1" } },
            vehicle: { data: { type: "vehicle", id: VEHICULE } },
          },
        },
      ],
    });
    expect(s[0]).toMatchObject({ id: "sub-1", webhookId: "wh-1", vehicleId: VEHICULE });
    expect(s[0]?.creeLe?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("lireSouscriptions tolère des relations absentes sans inventer d'identifiant", () => {
    const s = lireSouscriptions({ data: [{ id: "sub-1" }] });
    expect(s[0]).toMatchObject({ webhookId: null, vehicleId: null, creeLe: null });
  });

  it("detailErreur remonte le detail JSON:API, et null quand il n'y en a pas", () => {
    expect(detailErreur({ errors: [{ status: "401", detail: "token invalide" }] })).toBe(
      "token invalide",
    );
    expect(detailErreur({ errors: [{ code: "UNAUTHORIZED" }] })).toBe("UNAUTHORIZED");
    expect(detailErreur({})).toBeNull();
  });

  it("managementConfigure exige les DEUX identifiants M2M, pas SMARTCAR_MANAGEMENT_TOKEN", () => {
    // Régression du 17/08 : la première version lisait SMARTCAR_MANAGEMENT_TOKEN, qui ne
    // sert qu'à vérifier les livraisons entrantes — un jeton totalement indépendant.
    expect(managementConfigure({ SMARTCAR_MANAGEMENT_TOKEN: "amt_x" })).toBe(false);
    expect(managementConfigure({ SMARTCAR_CLIENT_ID: "  ", SMARTCAR_CLIENT_SECRET: "s" })).toBe(false);
    expect(managementConfigure({ SMARTCAR_CLIENT_ID: "id_x", SMARTCAR_CLIENT_SECRET: "secret_x" })).toBe(
      true,
    );
  });
});

describe("souscrireVehicule — la forme du corps et la nature du 202", () => {
  it("envoie exactement l'enveloppe SubscriptionRequest du schéma", async () => {
    let vuUrl = "";
    let vuCorps: unknown = null;
    let vuMethode = "";
    const faux = avecToken(async (url, init) => {
      vuUrl = String(url);
      vuMethode = init?.method ?? "GET";
      vuCorps = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ meta: { message: "subscription creation in progress" } }), {
        status: 202,
      });
    });

    const r = await souscrireVehicule(
      { webhookId: "wh-1", userId: "u-1", vehicleId: VEHICULE },
      { fetchImpl: faux, env: CREDENTIALS },
    );

    expect(vuMethode).toBe("POST");
    expect(vuUrl).toBe("https://management.api.smartcar.com/v3/subscriptions");
    // La forme exacte compte : `{webhookId, userId, vehicleId}` DANS `data.attributes`.
    // Une clé à plat produirait un 400 permanent, et c'est précisément l'erreur commise
    // le matin même sur la limite de charge.
    expect(vuCorps).toEqual({
      data: { attributes: { webhookId: "wh-1", userId: "u-1", vehicleId: VEHICULE } },
    });
    expect(r).toEqual({ ok: true, valeur: { accepte: true, message: "subscription creation in progress" } });
  });

  it("un 4xx est rendu comme un échec PORTANT le motif, jamais comme un succès", async () => {
    const faux = avecToken(
      async () =>
        new Response(JSON.stringify({ errors: [{ status: "409", detail: "already subscribed" }] }), {
          status: 409,
        }),
    );
    const r = await souscrireVehicule(
      { webhookId: "wh-1", userId: "u-1", vehicleId: VEHICULE },
      { fetchImpl: faux, env: CREDENTIALS },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain("already subscribed");
  });

  it("sans identifiants M2M, l'appel n'est même pas tenté", async () => {
    let appele = false;
    const faux: typeof fetch = async () => {
      appele = true;
      return new Response("{}", { status: 200 });
    };
    const r = await souscrireVehicule(
      { webhookId: "wh-1", userId: "u-1", vehicleId: VEHICULE },
      { fetchImpl: faux, env: {} },
    );
    expect(appele).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("une panne réseau est un échec nommé, pas une exception qui remonte à la page", async () => {
    const faux: typeof fetch = async () => {
      throw new Error("ECONNRESET");
    };
    const r = await souscrireVehicule(
      { webhookId: "wh-1", userId: "u-1", vehicleId: VEHICULE },
      { fetchImpl: faux, env: CREDENTIALS },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain("ECONNRESET");
  });

  it("un token OAuth refusé (mauvais identifiants) est un échec nommé", async () => {
    const faux: typeof fetch = async (url) => {
      if (String(url).startsWith("https://iam.smartcar.com/oauth2/token")) {
        return new Response(
          JSON.stringify({ error: "invalid_client", error_description: "bad credentials" }),
          { status: 401 },
        );
      }
      throw new Error("ne devrait jamais atteindre la Management API");
    };
    const r = await souscrireVehicule(
      { webhookId: "wh-1", userId: "u-1", vehicleId: VEHICULE },
      { fetchImpl: faux, env: CREDENTIALS },
    );
    expect(r.ok).toBe(false);
  });
});
