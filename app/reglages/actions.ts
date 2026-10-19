"use server";

// app/reglages/actions.ts — les Server Actions de l'écran Réglages.
//
// ⚠️ `purgerMesures` SUPPRIME définitivement. Trois gardes, dans cet ordre :
//   1. la session est revérifiée ICI (une Server Action est une route publique — la
//      protection de la page ne s'étend pas à elle) ;
//   2. l'action ne prend que des IDENTIFIANTS, jamais un critère : elle ne peut donc pas
//      supprimer plus large que ce que l'écran a montré ;
//   3. les identifiants sont RECOUPÉS avec l'inventaire côté serveur — un appel forgé qui
//      demanderait la suppression d'une mesure légitime n'obtient rien.
//
// La garde n°3 est celle qui compte : sans elle, la n°2 ne protège que l'utilisateur
// honnête, puisque n'importe qui pourrait poster la liste d'IDs de son choix.

import { requireSession } from "@/lib/session";
import { assurerMigrations } from "@/lib/migrations";
import {
  inventaireSimulees,
  purgerParIds,
  type InventairePurge,
} from "@/lib/vehicle/purgeSimulee";

/**
 * Établit la liste des mesures impossibles, À LA DEMANDE (CarAI#202). Ne supprime rien.
 *
 * ⚠️ Elle existe parce que Réglages la lisait à CHAQUE ouverture : `inventaireSimulees`
 * parcourt toutes les positions, tous les odomètres et toutes les pressions, soit une
 * lecture lourde de la base pour une section que Marc ouvre presque jamais — alors que la
 * limite mensuelle de transfert Neon a été dépassée. Une Server Action est une route
 * publique : la session est revérifiée ici comme dans `purgerMesures`.
 */
export async function chargerInventairePurge(): Promise<InventairePurge> {
  await requireSession();
  await assurerMigrations();
  return inventaireSimulees();
}

export async function purgerMesures(ids: number[]): Promise<number> {
  await requireSession();
  await assurerMigrations();

  const { candidates } = await inventaireSimulees();
  const autorises = new Set(candidates.map((c) => c.id));
  const aSupprimer = ids.filter((id) => autorises.has(id));

  if (aSupprimer.length !== ids.length) {
    // On ne supprime pas « ce qui reste » en silence : l'écart signale soit un écran
    // périmé, soit un appel forgé, et les deux méritent une trace.
    console.warn(
      `[purge] ${ids.length - aSupprimer.length} identifiant(s) hors inventaire, ignoré(s).`,
    );
  }

  const n = await purgerParIds(aSupprimer);
  console.warn(`[purge] ${n} mesure(s) du véhicule de test supprimée(s) définitivement.`);
  return n;
}
