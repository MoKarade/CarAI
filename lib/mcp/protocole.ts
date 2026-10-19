// lib/mcp/protocole.ts — le sous-ensemble de MCP dont un serveur d'OUTILS a besoin. PUR.
//
// ══ POURQUOI PAS LE SDK ══════════════════════════════════════════════════════════════
// MCP sur HTTP est du JSON-RPC 2.0, et un serveur en lecture seule n'a besoin que de
// trois méthodes : `initialize`, `tools/list`, `tools/call`. Les écrire ici coûte moins
// qu'une dépendance runtime de plus, et surtout ça reste TESTABLE sans réseau ni
// transport — c'est la règle du dépôt : la logique vit hors des I/O.
//
// ⚠️ Une NOTIFICATION (message sans `id`, comme `notifications/initialized`) ne reçoit
// JAMAIS de réponse — c'est dans la spec JSON-RPC. Y répondre casse des clients qui
// attendent le silence. D'où `null` comme retour légitime de `traiterMessage`.

import { OUTILS, outilParNom } from "./outils";

/** Version du protocole annoncée au client. */
export const VERSION_PROTOCOLE = "2024-11-05";

export const SERVEUR = {
  name: "carai",
  version: "1.0.0",
} as const;

/** Codes d'erreur JSON-RPC utilisés ici. */
export const CODE_METHODE_INCONNUE = -32601;
export const CODE_PARAMS_INVALIDES = -32602;
export const CODE_ERREUR_INTERNE = -32603;

export interface MessageJsonRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface ReponseJsonRpc {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const ok = (id: string | number | null, result: unknown): ReponseJsonRpc => ({
  jsonrpc: "2.0",
  id,
  result,
});

const erreur = (
  id: string | number | null,
  code: number,
  message: string,
): ReponseJsonRpc => ({ jsonrpc: "2.0", id, error: { code, message } });

/**
 * Traite UN message. Rend `null` pour une notification (aucune réponse attendue).
 *
 * ⚠️ Une erreur d'OUTIL n'est pas une erreur de PROTOCOLE : elle revient dans le
 * `result` avec `isError: true`, pour que le modèle la lise et s'adapte au lieu de voir
 * la connexion échouer. C'est la distinction que la spec MCP fait, et elle compte : une
 * base momentanément indisponible ne doit pas ressembler à un serveur cassé.
 */
export async function traiterMessage(msg: MessageJsonRpc): Promise<ReponseJsonRpc | null> {
  const id = msg.id ?? null;
  const estNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: VERSION_PROTOCOLE,
        capabilities: { tools: {} },
        serverInfo: SERVEUR,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return estNotification ? null : ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: OUTILS.map((o) => ({
          name: o.name,
          description: o.description,
          inputSchema: o.inputSchema,
        })),
      });

    case "tools/call": {
      const nom = typeof msg.params?.name === "string" ? msg.params.name : null;
      if (!nom) return erreur(id, CODE_PARAMS_INVALIDES, "Paramètre `name` manquant.");
      const outil = outilParNom(nom);
      if (!outil) return erreur(id, CODE_PARAMS_INVALIDES, `Outil inconnu : ${nom}`);

      const args =
        msg.params?.arguments && typeof msg.params.arguments === "object"
          ? (msg.params.arguments as Record<string, unknown>)
          : {};

      try {
        const donnees = await outil.executer(args);
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(donnees, null, 2) }],
        });
      } catch (err) {
        // Erreur d'OUTIL : le modèle doit la LIRE, pas voir le transport tomber.
        const message = err instanceof Error ? err.message : "Erreur inconnue.";
        console.error(`[mcp] ${nom} a échoué`, err);
        return ok(id, {
          content: [{ type: "text", text: `Impossible de répondre : ${message}` }],
          isError: true,
        });
      }
    }

    default:
      if (estNotification) return null;
      return erreur(id, CODE_METHODE_INCONNUE, `Méthode inconnue : ${msg.method ?? "(absente)"}`);
  }
}
