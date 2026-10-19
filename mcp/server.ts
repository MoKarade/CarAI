// mcp/server.ts — registry des tools MCP exposés par CarAI (Doc 4).
//
// Aucune dépendance à Next ni à React : importable depuis stdio (Node local) comme depuis
// un serveur HTTP (Cloud Run), sur le pattern déjà validé par `financeai-mcp`.
//
// Le serveur lit et écrit dans la MÊME base que la webapp (Doc 4 §2) : pas de duplication
// de données, pas de synchronisation à maintenir entre deux copies.
//
// Deux familles de tools :
//   • LECTURE — get_vehicle_status, get_vehicle_history, get_service_history,
//     get_lease_mileage_status. Chaque réponse porte sa source et sa fraîcheur.
//   • COMMANDE — lock/unlock, charge, limite de charge. Elles agissent sur un objet
//     PHYSIQUE et sont toutes journalisées dans `vehicle_commands_log`.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerCommands,
  registerHistory,
  registerPing,
  registerVehicleStatus,
} from "./tools";

export const MCP_SERVER_VERSION = "0.1.0";

export interface OptionsServeur {
  /**
   * Expose les tools de COMMANDE. Par défaut `true` (décision de Marc, Doc 4 §3 :
   * « lecture et commande, les deux exposées au MCP »), mais le drapeau existe pour
   * pouvoir monter un serveur en lecture seule — par exemple si le MCP devait un jour
   * être joignable depuis un contexte moins contrôlé que le poste de Marc.
   */
  commandes?: boolean;
}

export function createServer(options: OptionsServeur = {}): McpServer {
  const { commandes = true } = options;

  const server = new McpServer({
    name: "carai-mcp",
    version: MCP_SERVER_VERSION,
  });

  registerPing(server);
  registerVehicleStatus(server);
  registerHistory(server);
  if (commandes) registerCommands(server);

  return server;
}
