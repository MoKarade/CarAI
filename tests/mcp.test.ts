// tests/mcp.test.ts — le connecteur MCP (demande de Marc, 19/08/2026).
//
// Ce qui est verrouillé ici, dans l'ordre d'importance :
//   1. LECTURE SEULE. Donner à Claude les infos de la voiture ne doit pas, au passage,
//      lui donner les clés. Aucun outil ne pilote le véhicule, et le module d'outils
//      n'importe aucune fonction de commande.
//   2. LA POSITION EXACTE NE SORT PAS. Ni dans l'état, ni dans les trajets.
//   3. Le protocole : une NOTIFICATION ne reçoit jamais de réponse, un outil qui échoue
//      revient en `isError` plutôt qu'en erreur de transport.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OUTILS, nommerEndroit, nommerEndroitSiConnu, outilParNom } from "@/lib/mcp/outils";
import { CODE_METHODE_INCONNUE, traiterMessage } from "@/lib/mcp/protocole";
import { ROUTES_A_AUTH_PROPRE } from "@/lib/authGuard";
import { sansCommentairesJsx } from "./aides/controles";

describe("LECTURE SEULE — le connecteur ne pilote pas la voiture", () => {
  const VERBES_INTERDITS = [
    "lock", "unlock", "verrouil", "deverrouil", "start", "stop", "charge_limit",
    "commande", "command", "envoyer", "set_",
  ];

  it("aucun outil ne porte un nom de commande", () => {
    for (const outil of OUTILS) {
      for (const verbe of VERBES_INTERDITS) {
        expect(
          outil.name.toLowerCase().includes(verbe),
          `l'outil « ${outil.name} » ressemble à une commande — le pilotage à distance est une décision à part`,
        ).toBe(false);
      }
    }
  });

  it("le module d'outils n'importe AUCUNE fonction de commande", () => {
    // Le vrai garde : même en ajoutant un outil bien nommé, on ne pourrait pas piloter
    // sans importer ces modules. Le test échoue AVANT que la surface n'existe.
    const source = readFileSync("lib/mcp/outils.ts", "utf8");
    expect(source).not.toMatch(/from "@\/lib\/smartcar\/commands"/);
    expect(source).not.toMatch(/from "@\/app\/actions\/commandes"/);
    // Les APPELS, pas les mentions : l'en-tête du module a le droit d'expliquer que le
    // pilotage vit ailleurs, derrière ses propres gardes (piège déjà payé sur `.eyebrow`).
    expect(source).not.toMatch(/\benvoyerCommande\(/);
    expect(source).not.toMatch(/\bautoriserCommande\(/);
    expect(source).not.toMatch(/\bcommanderInline\(/);
  });

  it("le catalogue n'est pas vide et chaque outil est décrit", () => {
    expect(OUTILS.length).toBeGreaterThanOrEqual(5);
    for (const o of OUTILS) {
      expect(o.description.length, `${o.name} sans description`).toBeGreaterThan(30);
      expect(o.inputSchema.type).toBe("object");
    }
  });
});

describe("VIE PRIVÉE — la position exacte ne part pas vers un service tiers", () => {
  const LIEUX = [
    { nom: "Maison", lat: 48.2, lng: -78.0, rayonM: 150, mode: "kwh" as const, tarif: 0.1 },
  ];

  it("nomme un lieu connu plutôt que de donner ses coordonnées", () => {
    expect(nommerEndroit({ lat: 48.2001, lng: -78.0001 }, LIEUX)).toBe("Maison");
  });

  it("arrondit un lieu INCONNU à ~1 km — assez pour raisonner, pas pour trouver une porte", () => {
    const rendu = nommerEndroit({ lat: 48.34567, lng: -77.76543 }, LIEUX);
    // Deux décimales : la précision exacte ne doit PAS réapparaître.
    expect(rendu).toBe("~48.35, -77.77");
    expect(rendu).not.toContain("48.3456");
    expect(rendu).not.toContain("-77.765");
  });

  it("l'état du véhicule ne communique jamais la position structurée", () => {
    const source = readFileSync("lib/mcp/outils.ts", "utf8");
    expect(source).toMatch(/position \(non communiquée\)/);
  });
});

describe("le protocole JSON-RPC", () => {
  it("initialize annonce la version et les capacités", async () => {
    const r = await traiterMessage({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect(r).not.toBeNull();
    const result = r!.result as Record<string, unknown>;
    expect(result.protocolVersion).toBeTypeOf("string");
    expect(result.capabilities).toHaveProperty("tools");
  });

  it("tools/list rend le catalogue avec ses schémas", async () => {
    const r = await traiterMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = (r!.result as { tools: unknown[] }).tools;
    expect(tools).toHaveLength(OUTILS.length);
  });

  it("une NOTIFICATION ne reçoit AUCUNE réponse", async () => {
    // Répondre à un message sans `id` casse les clients qui attendent le silence.
    expect(await traiterMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  it("une méthode inconnue AVEC id rend une erreur, sans id rend le silence", async () => {
    const avec = await traiterMessage({ jsonrpc: "2.0", id: 3, method: "n/existe/pas" });
    expect(avec!.error?.code).toBe(CODE_METHODE_INCONNUE);
    expect(await traiterMessage({ jsonrpc: "2.0", method: "n/existe/pas" })).toBeNull();
  });

  it("un outil inconnu est refusé par son nom", async () => {
    const r = await traiterMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "verrouiller_la_voiture" },
    });
    expect(r!.error).toBeDefined();
    expect(outilParNom("verrouiller_la_voiture")).toBeNull();
  });
});

describe("la route est déclarée comme portant sa PROPRE auth", () => {
  it("/api/mcp est dans ROUTES_A_AUTH_PROPRE et dans le matcher du middleware", () => {
    // Un client MCP n'a pas de session Google : sans ça, il recevrait une redirection
    // HTML vers /login au lieu du JSON — le piège n°1 du squelette.
    expect(ROUTES_A_AUTH_PROPRE as readonly string[]).toContain("/api/mcp");
    expect(readFileSync("middleware.ts", "utf8")).toContain("api/mcp");
  });

  it("le jeton ne passe JAMAIS par l'URL", () => {
    // On avait accepté `?jeton=` en croyant que claude.ai ne pouvait rien envoyer d'autre
    // qu'une URL. Faux : son écran de connecteur personnalisé n'offre QUE OAuth, et il
    // découvre les endpoints tout seul. Le paramètre d'URL n'apportait donc rien — il
    // exposait juste un secret dans les journaux de requêtes de l'hébergeur.
    //
    // Ce test empêche la ré-introduction : c'est une régression qu'on ne verrait pas,
    // puisqu'elle FONCTIONNERAIT.
    const source = readFileSync("app/api/mcp/route.ts", "utf8");
    expect(source).not.toMatch(/searchParams\.get\(["']jeton["']\)/);
    expect(source).toContain('headers.get("authorization")');
  });

  it("la route refuse en TEMPS CONSTANT, et distingue « désactivé » de « refusé »", () => {
    const source = readFileSync("app/api/mcp/route.ts", "utf8");
    expect(source).toMatch(/timingSafeEqual/);
    expect(source, "MCP_TOKEN absent doit donner 503, pas 401").toMatch(/status: 503/);
    expect(source).toMatch(/status: 401/);
  });

  it("le GET publie un BOOLÉEN sur MCP_TOKEN, jamais sa valeur", async () => {
    // `MCP_TOKEN` ne prend effet qu'au déploiement SUIVANT celui où on la pose : sans un
    // signal lisible en GET, « c'est déployé » se dirait sur la foi d'un statut de build.
    // L'app s'interdit ce raccourci partout ailleurs (« CI verte » ≠ « en ligne »).
    const { GET } = await import("@/app/api/mcp/route");

    const avant = process.env.MCP_TOKEN;
    try {
      const requete = new Request("https://carai.hubperso.com/api/mcp");
      process.env.MCP_TOKEN = "";
      const vide = await GET(requete);
      expect(vide.status).toBe(405);
      expect(await vide.json()).toMatchObject({ configure: false });

      process.env.MCP_TOKEN = "un-jeton-secret-qui-ne-doit-pas-fuiter";
      const pose = await GET(requete);
      const corps = await pose.json();
      expect(corps).toMatchObject({ configure: true });
      // LE point du test : la valeur ne doit apparaître NULLE PART dans la réponse —
      // ni dans le corps, ni dans un en-tête. Un booléen ne rapproche personne de la
      // deviner ; la chaîne elle-même la donnerait.
      const tout = JSON.stringify(corps) + JSON.stringify([...pose.headers]);
      expect(tout).not.toContain("un-jeton-secret-qui-ne-doit-pas-fuiter");
    } finally {
      if (avant === undefined) delete process.env.MCP_TOKEN;
      else process.env.MCP_TOKEN = avant;
    }
  });
});

describe("une position ABSENTE n'est pas un endroit", () => {
  const LIEUX = [
    { nom: "Maison", lat: 46.8, lng: -71.2, rayonM: 100, mode: "kwh" as const, tarif: 0.06 },
  ];

  it("rend null quand aucune position n'encadre la session", () => {
    expect(nommerEndroitSiConnu(null, LIEUX)).toBeNull();
  });

  it("rend bien le nom quand la position est connue", () => {
    expect(nommerEndroitSiConnu({ lat: 46.8, lng: -71.2 }, LIEUX)).toBe("Maison");
  });

  // ⚠️ Le site d'appel compte autant que le helper : le défaut n'était pas dans
  // `nommerEndroit`, il était dans le `?? { lat: 0, lng: 0 }` qui le précédait. Deux
  // sessions sur quinze annonçaient « ~0.00, 0.00 » le 17/09 — et cette coordonnée
  // fabriquée ENTRE dans la recherche de lieu, donc un lieu enregistré près du point nul
  // se verrait attribuer des recharges qui n'y ont jamais eu lieu.
  it("le module ne fabrique plus aucune position de repli", () => {
    const source = sansCommentairesJsx(
      readFileSync(new URL("../lib/mcp/outils.ts", import.meta.url), "utf8"),
    );
    // Anti-vacuité : sans elle, « aucun repli trouvé » se prouverait à partir d'un
    // décommentage qui aurait tout effacé.
    expect(source).toContain("nommerEndroitSiConnu");
    expect(source.length).toBeGreaterThan(2000);

    expect(source).not.toMatch(/lat:\s*0\s*,\s*lng:\s*0/);
  });
});
