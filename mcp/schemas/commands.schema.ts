// mcp/schemas/commands.schema.ts — schémas des tools de commande (Doc 4 §4).
//
// ── PAS DE PARAMÈTRE `confirm` ───────────────────────────────────────────────────────
// Décision de Marc citée au Doc 4 §4 : confirmation en langage naturel par Claude AVANT
// l'appel, pas de système preview/confirm à deux appels comme `set_cash` chez FinanceAI.
// Le tool exécute donc directement dès qu'il est appelé. Les descriptions ci-dessous le
// rappellent à Claude — c'est là que la confirmation se joue, pas dans le schéma.

import { z } from "zod";

export const EntreeVide = {};

export const EntreeChargeLimit = {
  limite: z
    .number()
    .describe(
      "Limite de charge cible. Accepte 50 à 100 (pourcentage) ou 0.5 à 1.0 (fraction). Smartcar n'autorise pas en dehors de ces bornes.",
    ),
};

export const SortieCommande = z.object({
  statut: z.enum(["pending", "success", "failed", "unknown"]),
  message: z.string(),
  /** Référence dans `vehicle_commands_log`, pour la traçabilité exigée au Doc 4 §5. */
  journalId: z.number().nullable(),
  /**
   * Rappel systématique : Smartcar documente qu'une commande acceptée n'a pas forcément
   * encore pris effet sur le véhicule. Annoncer « c'est verrouillé » serait une affirmation
   * que l'API ne permet pas de faire.
   */
  note: z.string(),
});
