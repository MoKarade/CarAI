// mcp/schemas/history.schema.ts — schémas des tools d'historique et de bail (Doc 4 §3.2-3.4).

import { z } from "zod";
import { GRANULARITES } from "@/lib/vehicle/history";

export const EntreeHistory = {
  metrique: z
    .string()
    .describe("Type de métrique (battery_soc, odometer, battery_range, speed…)."),
  depuis: z
    .string()
    .optional()
    .describe("Date de début, ISO-8601. Absent = depuis le premier relevé."),
  jusqua: z.string().optional().describe("Date de fin, ISO-8601. Absent = maintenant."),
  granularite: z
    .enum(GRANULARITES)
    .optional()
    .describe(
      "brut | heure | jour | semaine. La rétention étant illimitée, agréger évite de rapatrier des années de points.",
    ),
  source: z
    .string()
    .optional()
    .describe("Filtre sur une source (smartcar, toyota_na). Absent = toutes."),
};

export const SortieHistory = z.object({
  metrique: z.string(),
  unite: z.string().nullable(),
  granularite: z.string(),
  points: z.array(
    z.object({
      instant: z.string(),
      valeur: z.number().nullable(),
      source: z.string(),
      echantillons: z.number(),
    }),
  ),
  /** Vrai si la fenêtre ne contient rien — DIT, plutôt que rendu par une série vide muette. */
  vide: z.boolean(),
  /**
   * Sur `odometer`, l'agrégation prend le MAXIMUM de la période et non la moyenne : un
   * odomètre ne fait que croître, sa moyenne horaire ne correspond à aucun kilométrage réel.
   */
  noteAgregation: z.string().optional(),
});

export const EntreeServiceHistory = {
  depuis: z.string().optional().describe("Date de début, ISO-8601."),
  jusqua: z.string().optional().describe("Date de fin, ISO-8601."),
};

export const SortieServiceHistory = z.object({
  entretiens: z.array(
    z.object({
      date: z.string(),
      odometre: z.number().nullable(),
      odometreUnite: z.string().nullable(),
      taches: z.unknown().nullable(),
      type: z.string().nullable(),
      cout: z.number().nullable(),
      devise: z.string().nullable(),
      source: z.string(),
    }),
  ),
  total: z.number(),
  /** Champs manquants côté source. Un coût absent RESTE absent — jamais remplacé par 0. */
  note: z.string().optional(),
});

export const EntreeLease = {};

export const SortieLease = z.object({
  kilometrageActuel: z.number().nullable(),
  mesureLe: z.string().nullable(),
  allocationTotale: z.number(),
  consommePourcent: z.number().nullable(),
  ecoulePourcent: z.number(),
  debutBail: z.string(),
  finBail: z.string(),
  joursRestants: z.number(),
  rythmeKmParJour: z.number().nullable(),
  rythmeAutoriseKmParJour: z.number(),
  projectionFinBail: z.number().nullable(),
  depassementProjete: z.number().nullable(),
  coutDepassementProjete: z.number().nullable(),
  devise: z.string(),
  resume: z.string(),
  /**
   * Ce qui manque pour que le calcul soit complet (tarif au km excédentaire inconnu, pas
   * assez de relevés…). Vide = résultat pleinement exploitable. Ces limites sont NOMMÉES
   * plutôt que comblées par des valeurs plausibles : Marc prend une décision financière
   * là-dessus.
   */
  limites: z.array(z.string()),
});
