// mcp/tools/commands.tools.ts — commandes envoyées au véhicule (Doc 4 §4).
//
// ⚠️ CES TOOLS AGISSENT SUR UN OBJET PHYSIQUE. Déverrouiller une voiture garée dans la rue
// n'est pas une écriture en base : c'est une portière qui s'ouvre. La confirmation se fait
// en langage naturel AVANT l'appel (choix de Marc, Doc 4 §4) — les descriptions ci-dessous
// le rappellent explicitement à Claude, puisque c'est le seul endroit où ce rappel peut
// vivre en l'absence de paramètre `confirm`.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { lireConfigTexte, CLE_SMARTCAR_USER, CLE_SMARTCAR_VEHICLE } from "@/lib/config";
import { baseConfiguree } from "@/lib/db";
import { contexteSmartcar } from "@/lib/smartcar/client";
import {
  envoyerCommande,
  normaliserLimiteCharge,
  type TypeCommande,
} from "@/lib/smartcar/commands";
import { EntreeChargeLimit, EntreeVide } from "../schemas/commands.schema";

const NOTE_PROPAGATION =
  "Smartcar accuse réception de la commande ; l'effet peut mettre un moment à atteindre le véhicule. " +
  "Une commande acceptée n'est donc pas une preuve que l'action a eu lieu — vérifier l'état ensuite.";

function enJson(valeur: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(valeur, null, 2) }] };
}

async function executer(commande: TypeCommande, corps?: unknown) {
  if (!baseConfiguree()) {
    return {
      statut: "failed" as const,
      message: "Base de données non configurée (DATABASE_URL).",
      journalId: null,
      note: NOTE_PROPAGATION,
    };
  }

  const contexte = await contexteSmartcar(() => lireConfigTexte(CLE_SMARTCAR_USER));
  const vehicleId = await lireConfigTexte(CLE_SMARTCAR_VEHICLE);

  if (!contexte || !vehicleId) {
    return {
      statut: "failed" as const,
      message:
        "Véhicule non connecté à Smartcar. Ouvre CarAI et lance le Connect, ou vérifie SMARTCAR_CLIENT_ID / SMARTCAR_CLIENT_SECRET.",
      journalId: null,
      note: NOTE_PROPAGATION,
    };
  }

  const resultat = await envoyerCommande({
    contexte,
    vehicleId,
    commande,
    corps,
    issuedBy: "mcp",
  });

  return {
    statut: resultat.statut,
    message: resultat.message,
    journalId: resultat.journalId,
    note: NOTE_PROPAGATION,
  };
}

export function registerCommands(server: McpServer): void {
  server.tool(
    "lock_vehicle",
    "VERROUILLE le véhicule. Action physique immédiate — demander confirmation à l'utilisateur AVANT d'appeler ce tool. " +
      "Peut échouer si une portière est ouverte ; le message le dira clairement.",
    EntreeVide,
    async () => enJson(await executer("lock")),
  );

  server.tool(
    "unlock_vehicle",
    "DÉVERROUILLE le véhicule. Action physique qui laisse la voiture ouverte — demander confirmation à l'utilisateur " +
      "AVANT d'appeler ce tool, et s'assurer qu'il sait où le véhicule se trouve.",
    EntreeVide,
    async () => enJson(await executer("unlock")),
  );

  server.tool(
    "start_charging",
    "Démarre la charge. Demander confirmation avant d'appeler. Sans effet si le câble n'est pas branché.",
    EntreeVide,
    async () => enJson(await executer("start_charge")),
  );

  server.tool(
    "stop_charging",
    "Arrête la charge en cours. Demander confirmation avant d'appeler.",
    EntreeVide,
    async () => enJson(await executer("stop_charge")),
  );

  server.tool(
    "set_charge_limit",
    "Définit la limite de charge (de 50 % à 100 %, borne imposée par Smartcar). Demander confirmation avant d'appeler. " +
      "Rappel : un véhicule peut être annoncé « complètement chargé » en dessous de 100 % si sa limite est plus basse.",
    EntreeChargeLimit,
    async (args) => {
      const normalisee = normaliserLimiteCharge(args.limite);
      if ("erreur" in normalisee) {
        return enJson({
          statut: "failed",
          message: normalisee.erreur,
          journalId: null,
          note: NOTE_PROPAGATION,
        });
      }
      return enJson(await executer("set_charge_limit", { limit: normalisee.fraction }));
    },
  );
}
