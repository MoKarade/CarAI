// mcp/stdio.ts — point d'entrée stdio (développement local). `npm run mcp:dev`.
//
// ⚠️ En stdio, la SORTIE STANDARD est le canal du protocole MCP. Tout `console.log` la
// corromprait et casserait la session sans message d'erreur exploitable. Les diagnostics
// partent donc sur stderr, et uniquement là.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[carai-mcp] serveur prêt (stdio).");
}

main().catch((err) => {
  console.error("[carai-mcp] démarrage impossible", err);
  process.exit(1);
});
