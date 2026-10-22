// mcp/tools/commands.tools.ts — commandes envoyées au véhicule (Doc 4 §4).
//
// N3 lecture seule pour le moment (décision de Marc du 22/10/2026).
// L'assistant refuse proprement toute commande : aucun tool de commande n'est enregistré.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerCommands(_server: McpServer): void {
  // Lecture seule : aucun tool de commande exposé à l'assistant.
}
