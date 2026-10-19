// lib/toyota/cycle.ts — orchestration d'un cycle de poll Toyota (Doc 3 §5-6).
//
// Assemble les pièces pures (`health`, `poll`, `signals`) et les écritures. La règle qui
// gouverne tout ce fichier tient en une phrase : CE MODULE NE DOIT JAMAIS FAIRE ÉCHOUER
// QUOI QUE CE SOIT D'AUTRE. Aucune exception ne remonte à l'appelant — elles sont
// attrapées, comptées, journalisées, et transformées en résultat.

import { db } from "@/lib/db";
import { vehicleSnapshots } from "@/lib/db/schema";
import { lireSanteToyota, ecrireSanteToyota } from "@/lib/config";
import { signauxVersSnapshots } from "@/lib/smartcar/signals";
import { credentialsToyota, creerClientToyota } from "./client";
import {
  apresEchec,
  apresSucces,
  messageDesactivation,
  moduleActif,
  SEUIL_DESACTIVATION,
} from "./health";
import { deciderPoll, etatApresCycle, type DecisionPoll } from "./poll";

export interface ResultatCycle {
  execute: boolean;
  raison: string;
  decision: DecisionPoll | null;
  snapshotsEcrits: number;
  erreur: string | null;
  moduleDesactive: boolean;
}

/**
 * Exécute un cycle complet. NE LÈVE JAMAIS.
 *
 * Renvoyer un résultat plutôt que lever n'est pas de la complaisance : c'est ce qui garantit
 * qu'un planificateur qui appelle cette fonction ne verra jamais une panne Toyota comme une
 * panne de CarAI. Le détail de l'échec est dans `erreur`, pas avalé.
 */
export async function executerCycleToyota(params: {
  maintenant?: Date;
  demandeExplicite?: boolean;
} = {}): Promise<ResultatCycle> {
  const { maintenant = new Date(), demandeExplicite = false } = params;

  const vide: ResultatCycle = {
    execute: false,
    raison: "",
    decision: null,
    snapshotsEcrits: 0,
    erreur: null,
    moduleDesactive: false,
  };

  let sante;
  try {
    sante = await lireSanteToyota();
  } catch (err) {
    // Même la lecture de l'état ne doit pas propager : sans elle, on ne fait rien, et c'est
    // une réponse acceptable.
    return {
      ...vide,
      raison: "État de santé du module illisible.",
      erreur: err instanceof Error ? err.message : String(err),
    };
  }

  const { actif, raison } = moduleActif({ sante, maintenant });
  if (!actif) return { ...vide, raison };

  const credentials = credentialsToyota();
  if (!credentials) {
    return { ...vide, raison: "Identifiants Toyota absents." };
  }

  const client = creerClientToyota(credentials);
  if (!client) {
    // Adaptateur non implémenté (voir lib/toyota/client.ts). Ce n'est PAS un échec à
    // compter : compter un manque d'implémentation comme une panne finirait par
    // « désactiver automatiquement » un module qui n'a jamais été branché, et ce faux
    // diagnostic resterait ensuite dans l'état de santé pour induire en erreur.
    return {
      ...vide,
      raison:
        "Adaptateur réseau Toyota non implémenté — voir l'en-tête de lib/toyota/client.ts.",
    };
  }

  const decision = deciderPoll({
    etat: {
      dernierPollLe: sante.dernierSucces ? new Date(sante.dernierSucces) : null,
      dernierReveilLe: sante.dernierReveilForce ? new Date(sante.dernierReveilForce) : null,
      dernierOdometre: sante.dernierOdometre,
    },
    maintenant,
    odometreCourant: sante.dernierOdometre,
    demandeExplicite,
  });

  if (!decision.pollLeger && !decision.reveilForce) {
    return { ...vide, raison: decision.explication, decision };
  }

  // Journalisation explicite de tout réveil forcé (Doc 3 §5.3) : c'est ce qui permettra
  // d'auditer la fréquence réelle le jour où un doute apparaîtra sur la batterie 12 V.
  if (decision.reveilForce) {
    console.warn(
      `[toyota] RÉVEIL FORCÉ à ${maintenant.toISOString()} — raison : ${decision.raisonReveil}. ${decision.explication}`,
    );
  }

  try {
    await client.authentifier();
    const signaux = await client.lireStatut({ reveilForce: decision.reveilForce });

    const lignes = signauxVersSnapshots(signaux, {
      source: "toyota_na",
      recuLe: maintenant,
      // Un réveil forcé rapporte l'état COURANT ; sinon c'est la dernière position connue.
      // La distinction est propre à cette source (Doc 3 §3) et Smartcar ne l'offre pas.
      locationType: decision.reveilForce ? "real_time" : "last_parked",
    });

    let ecrits = 0;
    if (lignes.length > 0) {
      const inserees = await db
        .insert(vehicleSnapshots)
        .values(lignes)
        .onConflictDoNothing()
        .returning({ id: vehicleSnapshots.id });
      ecrits = inserees.length;
    }

    const odometre = lignes.find((l) => l.metricType === "odometer")?.valueNumeric ?? null;

    const santeApres = apresSucces(sante, maintenant);
    const etat = etatApresCycle({
      etat: {
        dernierPollLe: maintenant,
        dernierReveilLe: decision.reveilForce ? maintenant : null,
        dernierOdometre: odometre,
      },
      decision,
      odometreCourant: odometre,
      maintenant,
    });

    await ecrireSanteToyota({
      ...santeApres,
      dernierOdometre: etat.dernierOdometre,
      dernierReveilForce: decision.reveilForce
        ? maintenant.toISOString()
        : sante.dernierReveilForce,
    });

    return {
      execute: true,
      raison: decision.explication,
      decision,
      snapshotsEcrits: ecrits,
      erreur: null,
      moduleDesactive: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const santeApres = apresEchec({ sante, erreur: message, maintenant });

    try {
      await ecrireSanteToyota(santeApres);
    } catch (err2) {
      console.error("[toyota] écriture de l'état de santé impossible", err2);
    }

    const desactive = santeApres.echecsConsecutifs >= SEUIL_DESACTIVATION;
    if (desactive) console.error(`[toyota] ${messageDesactivation(santeApres)}`);
    else console.error(`[toyota] échec de cycle (${santeApres.echecsConsecutifs}/${SEUIL_DESACTIVATION}) : ${message}`);

    return {
      execute: false,
      raison: decision.explication,
      decision,
      snapshotsEcrits: 0,
      erreur: message,
      moduleDesactive: desactive,
    };
  }
}
