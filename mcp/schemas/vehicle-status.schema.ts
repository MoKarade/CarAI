// mcp/schemas/vehicle-status.schema.ts — schémas Zod des tools de lecture d'état (Doc 4 §5).
//
// Entrées et sorties sont séparées, comme chez FinanceAI. La sortie n'est pas décorative :
// elle documente le CONTRAT que Claude peut attendre, et surtout elle impose les trois
// champs sans lesquels une réponse serait trompeuse — `source`, `recordedAt`, et l'aveu
// qu'une source était indisponible.

import { z } from "zod";

export const EntreeVehicleStatus = {
  metriques: z
    .array(z.string())
    .optional()
    .describe(
      "Filtre optionnel sur les types de métriques (battery_soc, odometer, location…). Vide = tout.",
    ),
};

/**
 * Une mesure, TOUJOURS qualifiée par sa source et sa fraîcheur.
 *
 * `recordedAt` est l'instant de la MESURE côté véhicule, pas celui de la réception (Doc 1
 * §5.1). C'est la distinction qui permet de dire « 45 % il y a dix minutes » plutôt que
 * « 45 % » tout court — la seconde formulation laisse croire au temps réel alors que la
 * fraîcheur Toyota est de 30 à 60 minutes.
 */
export const MesureSchema = z.object({
  metrique: z.string(),
  libelle: z.string(),
  valeur: z.union([z.number(), z.string(), z.null()]),
  unite: z.string().nullable(),
  source: z.string(),
  sourceLibelle: z.string(),
  recordedAt: z.string(),
  ageMinutes: z.number(),
  /** `false` ⇒ la valeur est brute et son unité ne permet pas de l'interpréter sûrement. */
  interpretationFiable: z.boolean(),
  locationType: z.string().nullable().optional(),
});

export const SortieVehicleStatus = z.object({
  mesures: z.array(MesureSchema),
  /**
   * Métriques pour lesquelles PLUSIEURS sources donnent des valeurs différentes. Elles
   * restent toutes présentes dans `mesures` — ce champ ne fait que signaler le désaccord,
   * il ne tranche pas (Doc 4 §3.1).
   */
  desaccords: z.array(z.string()),
  sourcesPresentes: z.array(z.string()),
  /** Sources attendues mais absentes au moment de la requête, avec la raison. */
  sourcesIndisponibles: z.array(z.object({ source: z.string(), raison: z.string() })),
  fraicheurMax: z.string().nullable(),
  /** Panne réelle, à distinguer d'une absence de données. */
  panne: z.string().nullable(),
});

export type SortieVehicleStatus = z.infer<typeof SortieVehicleStatus>;
