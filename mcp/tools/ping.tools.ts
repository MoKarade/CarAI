// mcp/tools/ping.tools.ts — santé du serveur (cohérence avec le pattern financeai-mcp).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { baseConfiguree } from "@/lib/db";

export function registerPing(server: McpServer): void {
  server.tool(
    "ping",
    "Vérifie que le serveur MCP CarAI répond. Indique aussi si la base de données est configurée — " +
      "un serveur qui répond sans base ne peut renvoyer aucune donnée de véhicule.",
    {},
    async () => ({
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              pong: true,
              horodatage: new Date().toISOString(),
              baseConfiguree: baseConfiguree(),
            },
            null,
            2,
          ),
        },
      ],
    }),
  );
}
