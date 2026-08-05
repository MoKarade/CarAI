// tests/webhook.test.ts — authenticité et lecture des livraisons Smartcar (Doc 2 §6).

import { describe, expect, it } from "vitest";
import {
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
