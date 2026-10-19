// lib/vehicle/pollJournal.ts — lecture/écriture du journal des passages du poll.
//
// L'analyse, elle, est PURE et vit dans `lib/vehicle/cadence.ts`. Ce module ne fait que
// l'I/O : c'est ce qui permet de tester toute la logique de cadence sans base de données.

import { desc, gte } from "drizzle-orm";
import { db, baseConfiguree } from "@/lib/db";
import { pollRuns } from "@/lib/db/schema";
import type { PassagePoll } from "./cadence";

/**
 * Inscrit un passage du poll.
 *
 * ⚠️ NE LÈVE JAMAIS. Marc a demandé un poll qui rapporte ses données, pas un journal :
 * si l'écriture de la trace échoue (base saturée, réseau), le poll doit quand même aboutir
 * et ses mesures être écrites. Un échec de journal est signalé dans les logs, jamais
 * propagé — c'est la règle « tout nouvel accès d'état ajouté à une étape d'intake dégrade
 * sans throw », héritée de DriveAI.
 *
 * ⚠️ On inscrit AUSSI les passages qui n'écrivent rien : « 0 mesure écrite » et « le poll
 * n'a pas tourné » sont opposés et donnent le même écran. C'est précisément la distinction
 * qui manquait.
 */
export async function inscrirePassage(entree: {
  ok: boolean;
  raison?: string | null;
  recus: number;
  ecrits: number;
}): Promise<void> {
  if (!baseConfiguree()) return;
  try {
    await db.insert(pollRuns).values({
      ok: entree.ok,
      raison: entree.raison ?? null,
      recus: entree.recus,
      ecrits: entree.ecrits,
    });
  } catch (err) {
    console.error("[poll] trace du passage impossible", err);
  }
}

/**
 * Passages des `heures` dernières heures, du plus ancien au plus récent.
 *
 * Rend une liste VIDE sur erreur plutôt que de lever : l'écran qui l'appelle doit pouvoir
 * afficher le reste. `analyserCadence` distingue de toute façon « aucun historique » d'une
 * cadence rompue, donc une liste vide ne se déguise pas en panne.
 *
 * ⚠️ Le plafond de lignes est calculé pour la FENÊTRE, pas écrit en dur : à 30 min de
 * cadence, 24 h font 48 passages, mais un poll qui s'emballerait en produirait plus — et
 * une borne trop basse masquerait justement l'anomalie qu'on cherche à voir.
 */
export async function passagesRecents(heures = 24): Promise<PassagePoll[]> {
  if (!baseConfiguree()) return [];
  try {
    const depuis = new Date(Date.now() - heures * 3_600_000);
    const lignes = await db
      .select({ ranAt: pollRuns.ranAt, ok: pollRuns.ok })
      .from(pollRuns)
      .where(gte(pollRuns.ranAt, depuis))
      .orderBy(desc(pollRuns.ranAt))
      .limit(2000);

    return lignes
      .map((l) => ({ t: l.ranAt, ok: l.ok }))
      .sort((a, b) => a.t.getTime() - b.t.getTime());
  } catch (err) {
    console.error("[poll] lecture du journal impossible", err);
    return [];
  }
}
