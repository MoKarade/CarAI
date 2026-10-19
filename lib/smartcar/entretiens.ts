// lib/smartcar/entretiens.ts — `[SC-04]` : le DÉCLENCHEUR de la synchro d'entretien.
//
// ══ CE QUI MANQUAIT, ET CE QUI EXISTAIT DÉJÀ ═════════════════════════════════════════
//
// La lecture existait (`lireHistoriqueEntretien`, `lib/smartcar/client.ts`) et l'écriture
// aussi (`insererEntretiens`, dédoublonnée par `dedupeKey`). Entre les deux : personne.
// L'historique d'entretien de la bZ n'est donc jamais entré en base, et le MCP le lisait
// sur une table vide.
//
// ══ POURQUOI DANS LE POLL, ET PAS DANS UN CRON À PART ════════════════════════════════
//
// Un second déclencheur serait un second endroit qui peut cesser de tirer sans que rien
// ne le dise — et on vient justement de mesurer ce que vaut un `schedule` GitHub Actions
// (6 passages par jour sur 48 demandés). Le poll, lui, passe aux 15 minutes et c'est
// vérifié. L'étape s'y greffe, **gardée par un créneau de 24 h** : au plus un appel par
// jour, quel que soit le nombre de polls.
//
// ⚠️ **Elle ne peut JAMAIS faire échouer le poll.** C'est la leçon DriveAI : une étape
// secondaire qui lève gèle tout le pipeline, et l'intake saute à chaque tick. Cette
// fonction ne lève pas — elle rapporte. L'appelant l'enveloppe quand même.
//
// ⚠️ **Le créneau est réservé AVANT l'appel, pas après.** Réserver après signifierait
// qu'un échec réseau rouvre immédiatement la porte, donc un appel par poll tant que
// Smartcar boude — exactement ce que le plancher existe pour empêcher. Conséquence
// assumée : un échec fait attendre 24 h. C'est le bon sens de l'erreur pour une donnée
// qui, par nature, ne bouge que quelques fois par an.

import { contexteSmartcar, lireHistoriqueEntretien } from "@/lib/smartcar/client";
import { insererEntretiens } from "@/lib/smartcar/ingest";
import { CLE_SMARTCAR_USER, CLE_SMARTCAR_VEHICLE, lireConfigTexte } from "@/lib/config";
import { reserverCreneau } from "@/lib/vehicle/creneau";

/** La clé du créneau, en base. */
export const CLE_SYNCHRO_ENTRETIENS = "smartcar.entretiens";

/** Au plus un appel par jour : un historique d'entretien bouge quelques fois par AN. */
export const PLANCHER_ENTRETIENS_MS = 24 * 60 * 60 * 1000;

export type ResultatEntretiens =
  /** Le créneau n'est pas ouvert : quelqu'un a déjà regardé il y a moins de 24 h. */
  | { statut: "differe" }
  /** L'intégration n'est pas prête (pas de véhicule, pas d'identifiants). */
  | { statut: "non-configure"; raison: string }
  | { statut: "echec"; raison: string }
  | { statut: "ok"; nouvelles: number; lues: number };

/**
 * Extrait la liste d'entretiens d'une réponse Smartcar, quelle que soit son enveloppe.
 * PURE, testée.
 *
 * ⚠️ Deux formes sont acceptées parce que les deux existent dans ce projet selon les
 * endpoints (`{ items: [...] }` et `{ serviceHistory: [...] }`), et qu'un tableau nu reste
 * possible. Ce qui n'est PAS accepté : deviner. Une enveloppe inconnue rend `null`, et
 * l'appelant le DIT au lieu d'écrire zéro entretien en silence — « aucun entretien » et
 * « je n'ai pas su lire » ne sont pas la même information.
 */
export function extraireEntretiens(reponse: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(reponse)) return reponse.filter(estObjet);
  if (reponse === null || typeof reponse !== "object") return null;

  const corps = reponse as Record<string, unknown>;
  for (const cle of ["items", "serviceHistory", "records", "data"]) {
    const valeur = corps[cle];
    if (Array.isArray(valeur)) return valeur.filter(estObjet);
  }
  return null;
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Synchronise l'historique d'entretien, au plus une fois par `PLANCHER_ENTRETIENS_MS`.
 *
 * NE LÈVE JAMAIS : chaque mode d'échec a son statut, et l'appelant (le poll) ne doit pas
 * pouvoir tomber à cause de cette étape.
 */
export async function synchroniserEntretiens(options?: {
  plancherMs?: number;
}): Promise<ResultatEntretiens> {
  try {
    const vehicleId = await lireConfigTexte(CLE_SMARTCAR_VEHICLE);
    if (!vehicleId) {
      return { statut: "non-configure", raison: "aucun véhicule connu — refaire le Connect." };
    }

    const contexte = await contexteSmartcar(() => lireConfigTexte(CLE_SMARTCAR_USER));
    if (!contexte) {
      return { statut: "non-configure", raison: "intégration Smartcar non configurée." };
    }

    // Le créneau se prend APRÈS les gardes de configuration : une app non branchée ne doit
    // pas consommer la fenêtre de 24 h, sinon brancher l'intégration ne changerait rien
    // avant le lendemain.
    if (
      !(await reserverCreneau({
        cle: CLE_SYNCHRO_ENTRETIENS,
        plancherMs: options?.plancherMs ?? PLANCHER_ENTRETIENS_MS,
      }))
    ) {
      return { statut: "differe" };
    }

    const reponse = await lireHistoriqueEntretien(contexte, vehicleId);
    const entrees = extraireEntretiens(reponse.data);
    if (entrees === null) {
      return { statut: "echec", raison: "enveloppe inattendue — aucun entretien lisible." };
    }

    const nouvelles = await insererEntretiens(entrees);
    return { statut: "ok", nouvelles, lues: entrees.length };
  } catch (err) {
    return {
      statut: "echec",
      raison: err instanceof Error ? err.message : String(err),
    };
  }
}
