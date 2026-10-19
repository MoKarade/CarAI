"use server";

// app/actions/rafraichir.ts — `[UI-02]` : « Rafraîchir maintenant ».
//
// ══ POURQUOI UNE ACTION ET PAS UN LIEN VERS LA ROUTE DE CRON ═════════════════════════
//
// La route `/api/cron/smartcar-poll` exige `CRON_SECRET`. Un bouton qui la viserait
// obligerait à mettre ce secret dans le navigateur — donc à le donner à quiconque ouvre
// l'app. Une Server Action appelle `pollerSignaux()` directement, côté serveur, derrière
// `requireSession()` : le secret reste où il est, et l'appelant est vérifié.
//
// ⚠️ **La contre-pression est OBLIGATOIRE, et elle vient AVANT le travail.**
// `reserverRafraichissement` est atomique et vit en base (`lib/vehicle/rafraichissement.ts`).
// Sans elle, un bouton exposé à l'écran permettrait de marteler Smartcar en cliquant —
// c'est la leçon JobAI, « supprimer un geste manuel déplace son coût : il faut le borner
// AVANT ». Le refus est DIT, avec le nombre de secondes à attendre : un bouton qui ne fait
// rien sans expliquer pourquoi se lit comme une panne.
//
// ⚠️ **`revalidatePath` est justifié ICI, contrairement aux commandes véhicule.** Une
// commande acceptée n'est pas une mesure — rien à rafraîchir. Un poll, lui, VIENT d'écrire
// des mesures : ne pas revalider afficherait l'ancien état juste après avoir demandé le
// nouveau, ce qui est exactement le contraire du but du bouton.

import { revalidatePath } from "next/cache";
import { baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { pollerSignaux } from "@/lib/smartcar/poll";
import { inscrirePassage } from "@/lib/vehicle/pollJournal";
import {
  dernierRafraichissement,
  deciderRafraichissement,
  reserverRafraichissement,
} from "@/lib/vehicle/rafraichissement";
import { requireSession } from "@/lib/session";

export interface RetourRafraichir {
  /** `true` quand le poll a réellement eu lieu (qu'il ait écrit ou non). */
  lance: boolean;
  /** Phrase d'affichage, construite ICI — la feuille la rend telle quelle. */
  message: string;
  ton: "ok" | "attention" | "danger";
}

export async function rafraichirMaintenant(): Promise<RetourRafraichir> {
  try {
    await requireSession();
  } catch {
    return { lance: false, message: "Session expirée. Recharge la page.", ton: "danger" };
  }

  if (!baseConfiguree()) {
    return { lance: false, message: "Base non configurée.", ton: "danger" };
  }

  await assurerMigrations();

  // La réservation TRANCHE — on ne relit pas ensuite pour « vérifier ». Le second appel
  // n'existe que pour composer le message du refus, et il ne décide de rien.
  if (!(await reserverRafraichissement())) {
    const decision = deciderRafraichissement({
      dernier: await dernierRafraichissement(),
      maintenant: new Date(),
    });
    const reste = decision.autorise ? 0 : decision.resteSecondes;
    return {
      lance: false,
      message:
        reste > 0
          ? `Déjà rafraîchi il y a moins d’une minute — encore ${reste} s.`
          : "Un rafraîchissement vient d’avoir lieu.",
      ton: "attention",
    };
  }

  const resultat = await pollerSignaux();

  // Journaliser CE passage comme les autres : la page Données mesure la cadence à partir
  // de ce journal, et un passage manuel qui n'y figurerait pas creuserait un faux trou.
  await inscrirePassage({
    ok: resultat.ok,
    raison: resultat.ok ? "demandé à la main" : `échec — ${resultat.raison}`,
    recus: resultat.recus,
    ecrits: resultat.ecrits,
  });

  if (!resultat.ok) {
    return { lance: true, message: `Échec : ${resultat.raison}`, ton: "danger" };
  }

  revalidatePath("/");

  // ⚠️ « 0 écrite » n'est PAS un échec : la voiture n'a peut-être rien de neuf à dire. Le
  // confondre avec une panne apprendrait à se méfier d'un bouton qui marche.
  return {
    lance: true,
    message:
      resultat.ecrits > 0
        ? `${resultat.ecrits} mesure(s) à jour.`
        : "Rien de neuf — la voiture n’a pas republié depuis.",
    ton: "ok",
  };
}
