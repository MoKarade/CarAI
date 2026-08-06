// tests/webhook.test.ts — authenticité et lecture des livraisons Smartcar (Doc 2 §6).

import { describe, expect, it } from "vitest";
import {
  challengeBienForme,
  hmacHex,
  lireEvenement,
  livraisonAuthentique,
  reponseChallenge,
  signaturesEgales,
  silenceWebhook,
} from "@/lib/smartcar/webhook";

const TOKEN = "jeton-de-management-de-test";

describe("signature", () => {
  it("accepte une signature calculée sur le corps BRUT", () => {
    const corps = JSON.stringify({ eventName: "VEHICLE_STATE", signals: [] });
    expect(
      livraisonAuthentique({
        corpsBrut: corps,
        signature: hmacHex(TOKEN, corps),
        managementToken: TOKEN,
      }),
    ).toBe(true);
  });

  it("refuse une signature calculée sur un corps RE-SÉRIALISÉ", () => {
    // Le piège central : `JSON.stringify(JSON.parse(x))` réordonne les clés et change les
    // espaces. Les octets diffèrent, donc le HMAC aussi — d'où la lecture unique du texte
    // brut dans le handler.
    const corps = '{"b":2,\n  "a":1}';
    const reserialise = JSON.stringify(JSON.parse(corps));
    expect(
      livraisonAuthentique({
        corpsBrut: reserialise,
        signature: hmacHex(TOKEN, corps),
        managementToken: TOKEN,
      }),
    ).toBe(false);
  });

  it("refuse une signature absente, vide ou fausse", () => {
    const corps = "{}";
    expect(livraisonAuthentique({ corpsBrut: corps, signature: null, managementToken: TOKEN })).toBe(false);
    expect(livraisonAuthentique({ corpsBrut: corps, signature: "   ", managementToken: TOKEN })).toBe(false);
    expect(livraisonAuthentique({ corpsBrut: corps, signature: "deadbeef", managementToken: TOKEN })).toBe(false);
  });

  it("échec fermé : sans token de management, rien n'est accepté", () => {
    const corps = "{}";
    expect(
      livraisonAuthentique({
        corpsBrut: corps,
        signature: hmacHex(TOKEN, corps),
        managementToken: undefined,
      }),
    ).toBe(false);
  });

  it("compare des longueurs différentes sans lever", () => {
    // `timingSafeEqual` lève sur des buffers de tailles différentes : la garde de longueur
    // doit venir avant, sinon une signature tronquée ferait planter la route au lieu de la
    // refuser proprement.
    expect(() => signaturesEgales("a".repeat(64), "court")).not.toThrow();
    expect(signaturesEgales("a".repeat(64), "court")).toBe(false);
  });
});

describe("lireEvenement", () => {
  it("reconnaît un VERIFY par son challenge, même sans nom d'événement attendu", () => {
    const ev = lireEvenement({ eventName: "peu-importe", payload: { challenge: "abc" } });
    expect(ev.type).toBe("VERIFY");
    expect(ev.challenge).toBe("abc");
  });

  it("reconnaît un VEHICLE_STATE et en extrait signaux et identifiant", () => {
    const ev = lireEvenement({
      eventName: "VEHICLE_STATE",
      eventId: "evt_1",
      payload: {
        signals: [{ code: "odometer-traveleddistance", value: 42 }],
        triggers: [{ code: "odometer-traveleddistance" }],
        vehicle: { id: "veh_9" },
      },
    });
    expect(ev.type).toBe("VEHICLE_STATE");
    expect(ev.eventId).toBe("evt_1");
    expect(ev.vehicleId).toBe("veh_9");
    expect(Array.isArray(ev.signaux)).toBe(true);
  });

  it("lit aussi des signaux posés à la racine", () => {
    const ev = lireEvenement({ eventType: "VEHICLE_STATE", signals: [{ code: "motion-speed" }] });
    expect(ev.signaux).toHaveLength(1);
  });

  it("classe un VEHICLE_ERROR à part", () => {
    expect(lireEvenement({ eventName: "VEHICLE_ERROR" }).type).toBe("VEHICLE_ERROR");
  });

  it("ne lève pas sur une charge vide ou absurde", () => {
    expect(lireEvenement(null).type).toBe("INCONNU");
    expect(lireEvenement("texte").type).toBe("INCONNU");
  });
});

describe("reponseChallenge", () => {
  it("renvoie le challenge haché avec le token de management", () => {
    expect(reponseChallenge("defi", TOKEN)).toEqual({ challenge: hmacHex(TOKEN, "defi") });
  });
});

describe("silenceWebhook — la panne qui ne fait pas de bruit", () => {
  const maintenant = new Date("2026-08-05T12:00:00.000Z");

  it("ne crie pas quand les livraisons sont récentes", () => {
    const r = silenceWebhook({
      derniereLivraison: new Date("2026-08-05T11:00:00.000Z"),
      maintenant,
    });
    expect(r.silencieux).toBe(false);
    expect(r.heures).toBeCloseTo(1, 5);
  });

  it("signale un silence au-delà du seuil", () => {
    const r = silenceWebhook({
      derniereLivraison: new Date("2026-08-05T02:00:00.000Z"),
      maintenant,
    });
    expect(r.silencieux).toBe(true);
  });

  it("ne signale rien quand aucune livraison n'est JAMAIS arrivée", () => {
    // « Jamais reçu » n'est pas « plus rien depuis six heures » : le premier veut dire que
    // le véhicule n'est pas encore connecté, le second qu'un flux existant s'est tu.
    const r = silenceWebhook({ derniereLivraison: null, maintenant });
    expect(r.silencieux).toBe(false);
    expect(r.heures).toBeNull();
  });
});

// ── Les deux couches d'identifiants Smartcar (incident du 05/08/2026) ───────────────
// Le Connect a refusé l'identifiant des API Credentials avec
// « 400: Invalid parameter client_id: client_01KZ9… ». Les deux couches du Doc 2 §3.1
// n'attendent pas la même valeur ; ces tests verrouillent la séparation ET le repli.
describe("identifiant du Connect", () => {
  it("préfère SMARTCAR_CONNECT_CLIENT_ID quand il est posé", async () => {
    const { clientIdConnect } = await import("@/lib/smartcar/auth");
    expect(
      clientIdConnect({
        SMARTCAR_CLIENT_ID: "client_01KZ9HBPCDY29DC7S9NRNJJ72H",
        SMARTCAR_CONNECT_CLIENT_ID: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      }),
    ).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });

  it("retombe sur SMARTCAR_CLIENT_ID — une config à une seule valeur marche encore", async () => {
    const { clientIdConnect } = await import("@/lib/smartcar/auth");
    expect(clientIdConnect({ SMARTCAR_CLIENT_ID: "abc" })).toBe("abc");
  });

  it("ignore une valeur blanche plutôt que d'envoyer des espaces à Smartcar", async () => {
    const { clientIdConnect } = await import("@/lib/smartcar/auth");
    expect(clientIdConnect({ SMARTCAR_CONNECT_CLIENT_ID: "   ", SMARTCAR_CLIENT_ID: "abc" })).toBe("abc");
    expect(clientIdConnect({})).toBeNull();
  });

  it("reconnaît la FORME d'un UUID — pour diagnostiquer, jamais pour refuser", async () => {
    const { ressembleAUuid } = await import("@/lib/smartcar/auth");
    expect(ressembleAUuid("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
    expect(ressembleAUuid("client_01KZ9HBPCDY29DC7S9NRNJJ72H")).toBe(false);
  });
});

// ── La vérification du webhook (incident du 05/08/2026) ────────────────────────────
// Smartcar a répondu « verification request responded with a non-2xx status: 401 » :
// l'événement de vérification n'est PAS signé, et notre route exigeait une signature
// avant de répondre au challenge. Tant que cette vérification échoue, AUCUNE donnée
// n'est livrée — ces tests verrouillent la forme exacte du payload de référence.
describe("événement de vérification", () => {
  it("lit le challenge sous `data` — la forme réelle de Smartcar", () => {
    // Payload issu du handler de référence : payload.get('data', {}).get('challenge').
    const ev = lireEvenement({
      eventType: "VERIFY",
      data: { challenge: "challenge_063f9ab0f106cc06b7d06e7945b4eced" },
    });
    expect(ev.type).toBe("VERIFY");
    expect(ev.challenge).toBe("challenge_063f9ab0f106cc06b7d06e7945b4eced");
  });

  it("produit la réponse attendue : { challenge: <hmac hex> }", () => {
    const r = reponseChallenge("challenge_063f9ab0f106cc06b7d06e7945b4eced", TOKEN);
    expect(Object.keys(r)).toEqual(["challenge"]);
    expect(r.challenge).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("challengeBienForme — ferme l'oracle de signature", () => {
  it("accepte la forme réelle des challenges", () => {
    expect(challengeBienForme("challenge_063f9ab0f106cc06b7d06e7945b4eced")).toBe(true);
    expect(challengeBienForme("challenge_s4mpleR4nd0mStr1ng")).toBe(true);
  });

  it("REFUSE tout ce qui pourrait être un corps de livraison", () => {
    // Le cœur du garde : répondre au challenge revient à SIGNER la chaîne fournie. Sans
    // contrainte de forme, un tiers ferait signer le corps d'une fausse livraison puis
    // le renverrait avec cette signature — l'endpoint serait la clé de sa propre serrure.
    expect(challengeBienForme('{"eventType":"VEHICLE_STATE","data":{}}')).toBe(false);
    expect(challengeBienForme("challenge_{}")).toBe(false);
    expect(challengeBienForme('challenge_"a"')).toBe(false);
    expect(challengeBienForme("")).toBe(false);
    expect(challengeBienForme("challenge_")).toBe(false);
    expect(challengeBienForme("autre_chose")).toBe(false);
    expect(challengeBienForme(`challenge_${"a".repeat(129)}`)).toBe(false);
  });
});

// ── Permissions du Connect ─────────────────────────────────────────────────────────
// Deux signaux de la bZ échouent en PERMISSION. Les débloquer suppose de connaître le nom
// exact de leur scope, invérifiable depuis ces sessions — et un scope invalide casse le
// Connect ENTIER. D'où une liste par défaut figée (celle qui marche) et un ajout par
// l'environnement, réversible en vidant la variable.
describe("permissions demandées au Connect", () => {
  it("sans variable, la liste reste EXACTEMENT celle qui fonctionne", async () => {
    const { permissionsDemandees, PERMISSIONS } = await import("@/lib/smartcar/connect");
    expect(permissionsDemandees({})).toEqual([...PERMISSIONS]);
  });

  it("ajoute les scopes fournis, en acceptant virgules ou espaces", async () => {
    const { permissionsDemandees } = await import("@/lib/smartcar/connect");
    const p = permissionsDemandees({ SMARTCAR_SCOPES_EXTRA: "read_vin, read_speed" });
    expect(p).toContain("read_vin");
    expect(p).toContain("read_speed");
  });

  it("ne duplique jamais un scope déjà demandé", async () => {
    const { permissionsDemandees } = await import("@/lib/smartcar/connect");
    const p = permissionsDemandees({ SMARTCAR_SCOPES_EXTRA: "read_battery read_vin" });
    expect(p.filter((s) => s === "read_battery")).toHaveLength(1);
  });

  it("ignore une valeur vide ou en espaces plutôt que d'envoyer un scope vide", async () => {
    const { permissionsDemandees, PERMISSIONS } = await import("@/lib/smartcar/connect");
    expect(permissionsDemandees({ SMARTCAR_SCOPES_EXTRA: "  ,  " })).toEqual([...PERMISSIONS]);
  });
});
