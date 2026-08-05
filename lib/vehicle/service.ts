// lib/vehicle/service.ts — lecture de l'historique d'entretien (Doc 1 §5.2, Doc 4 §3.3).

import { and, asc, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { serviceHistory, type ServiceRecord } from "@/lib/db/schema";

export async function lireEntretiens(params: {
  debut?: Date;
  fin?: Date;
} = {}): Promise<ServiceRecord[]> {
  const conditions = [];
  if (params.debut) conditions.push(gte(serviceHistory.serviceDate, params.debut));
  if (params.fin) conditions.push(lte(serviceHistory.serviceDate, params.fin));

  return db
    .select()
    .from(serviceHistory)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(serviceHistory.serviceDate));
}

/**
 * Signale ce que la source n'a pas fourni.
 *
 * Smartcar documente que la richesse de l'historique dépend de la marque (Doc 2 §5.4) : des
 * coûts peuvent manquer. Le dire explicitement évite qu'un total d'entretien partiel passe
 * pour un total complet — l'erreur serait invisible et se propagerait dans tout raisonnement
 * bâti dessus.
 */
export function noteCompletude(entretiens: ServiceRecord[]): string | undefined {
  if (entretiens.length === 0) return undefined;
  const sansCout = entretiens.filter((e) => e.totalCost === null).length;
  if (sansCout === 0) return undefined;
  return `${sansCout} entretien(s) sur ${entretiens.length} sans coût fourni par la source. Tout total calculé sur ces données serait partiel.`;
}
