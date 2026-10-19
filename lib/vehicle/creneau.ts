// lib/vehicle/creneau.ts — « ai-je le droit de faire ce travail maintenant ? », ATOMIQUE.
//
// ══ POURQUOI CE MODULE EST SÉPARÉ, ET POURQUOI IL EST ATOMIQUE ═══════════════════════
//
// Deux besoins l'emploient déjà et n'ont rien d'autre en commun : le bouton « Rafraîchir
// maintenant » (plancher d'une minute, protège Smartcar du martèlement) et la synchro de
// l'historique d'entretien (une fois par jour, dans un poll qui passe aux 15 min). Écrire
// la même réservation deux fois, c'est se donner deux occasions de l'écrire mal.
//
// ⚠️ **En serverless, un compteur de processus n'est pas une contre-pression.** Il est vide
// au démarrage à froid et n'est pas partagé entre instances : deux requêtes servies par
// deux instances passeraient toutes les deux.
//
// ⚠️ **Et la garantie d'unicité vit dans l'ÉCRITURE, jamais dans une lecture qui la
// précède.** « Lire la dernière fois, comparer, puis écrire » laisse une fenêtre où deux
// appelants lisent la même valeur et gagnent ensemble. Un seul
// `INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING` règle la question : c'est Postgres
// qui arbitre, et le perdant ne reçoit aucune ligne. Vérifié par un test de COURSE
// (`Promise.all`) contre un vrai Postgres — l'implémentation naïve y passe deux fois.

import { and, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { appConfig } from "@/lib/db/schema";

/**
 * Réserve le créneau `cle`, ou refuse. ATOMIQUE.
 *
 * Rend `true` quand l'appelant a gagné le droit de travailler, `false` quand quelqu'un l'a
 * pris il y a moins de `plancherMs`.
 *
 * ⚠️ `updatedAt` de la ligne EST l'horodatage de la dernière réservation : il n'y a pas de
 * second champ à tenir à jour, donc pas de risque qu'ils divergent.
 */
export async function reserverCreneau(params: {
  cle: string;
  plancherMs: number;
  /** La base à employer. Sert aux tests, qui exercent le VRAI schéma sous PGlite — une
   *  réservation atomique ne se prouve que contre un vrai Postgres. */
  dbx?: typeof db;
  maintenant?: Date;
}): Promise<boolean> {
  const { cle, plancherMs } = params;
  const base = params.dbx ?? db;
  const maintenant = params.maintenant ?? new Date();
  const seuil = new Date(maintenant.getTime() - plancherMs);

  const lignes = await base
    .insert(appConfig)
    .values({ key: cle, value: { reserve: true }, updatedAt: maintenant })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: { reserve: true }, updatedAt: maintenant },
      // Le `WHERE` du ON CONFLICT : la mise à jour n'a lieu QUE si la précédente est plus
      // vieille que le plancher. Sinon Postgres ne touche rien et ne rend aucune ligne.
      //
      // ⚠️ `lte`, pas `lt`, et ce n'est pas un détail : `deciderRafraichissement` — la
      // fonction PURE qui compose le message du refus — autorise à `ecoule >= plancherMs`.
      // Avec `lt` ici, les deux divergeaient d'une milliseconde : l'écran aurait annoncé
      // « tu peux y aller » pendant que la base refusait. Un test verrouille leur accord.
      setWhere: and(eq(appConfig.key, cle), lte(appConfig.updatedAt, seuil)),
    })
    .returning({ cle: appConfig.key });

  return lignes.length > 0;
}

/** Quand le créneau a été réservé pour la dernière fois. `null` s'il ne l'a jamais été. */
export async function derniereReservation(
  cle: string,
  dbx?: typeof db,
): Promise<Date | null> {
  const lignes = await (dbx ?? db)
    .select({ quand: appConfig.updatedAt })
    .from(appConfig)
    .where(eq(appConfig.key, cle))
    .limit(1);
  const quand = lignes[0]?.quand ?? null;
  if (quand === null) return null;
  return quand instanceof Date ? quand : new Date(quand as unknown as string);
}
