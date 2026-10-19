// lib/smartcar/poll.ts — lecture PÉRIODIQUE des signaux, en complément du webhook.
//
// ══ POURQUOI CE MODULE EXISTE (constat du 11/08/2026) ════════════════════════════════
// Le webhook se déclenche sur `SIGNAL_UPDATED` : un CHANGEMENT de la donnée côté véhicule,
// pas une lecture. Le tableau de bord Smartcar l'a montré noir sur blanc — « Smartcar
// retrieved at 20:52 » (Smartcar interroge bien la bZ) mais « Vehicle updated at 17:05 »
// (la donnée, elle, n'a pas bougé). Voiture stationnée ⇒ aucun changement ⇒ AUCUNE
// livraison pendant des heures. Rien n'est cassé, mais CarAI n'apprend rien non plus.
//
// Ce poll va donc CHERCHER l'état courant à intervalle régulier. Les deux chemins se
// complètent et ne se marchent pas dessus : la déduplication structurelle (index unique
// sur source + métrique + instant de mesure) fait qu'un état déjà reçu par webhook est
// simplement ignoré à l'écriture. Poller ne duplique rien ; ça comble les silences.
//
// ⚠️ Chaque poll consomme du quota Smartcar (certains signaux sont facturables). La
// cadence vit donc dans le planificateur, pas ici, et le résultat rapporte toujours
// combien de signaux ont été demandés — pour qu'un coût qui dérape se VOIE.

import { CLE_SMARTCAR_USER, CLE_SMARTCAR_VEHICLE, lireConfigTexte } from "@/lib/config";
import { appelSmartcar, contexteSmartcar } from "@/lib/smartcar/client";
import {
  filtrerRepetitions,
  insererSnapshots,
  statutsConnusSmartcar,
} from "@/lib/smartcar/ingest";
import { resumerStatutsSignaux, signauxVersSnapshots } from "@/lib/smartcar/signals";

export interface ResultatPoll {
  ok: boolean;
  /** Motif LISIBLE quand le poll n'a pas pu tourner — jamais un échec muet. */
  raison?: string;
  /** Signaux renvoyés par l'API. */
  recus: number;
  /** Total annoncé par l'API : s'il dépasse `recus`, la réponse était paginée. */
  totalAnnonce: number | null;
  /** Mesures réellement écrites (0 = tout était déjà connu, c'est NORMAL). */
  ecrits: number;
  /** Refus déjà connus, non ré-inscrits (voir `filtrerRepetitions`). */
  repetitionsEcartees: number;
  succes: number;
  enEchec: number;
  /**
   * Les CODES, groupés par statut — pas seulement les comptes.
   *
   * ⚠️ Ajouté le 12/08/2026 juste après un re-Connect : le poll est passé de 16 SUCCESS à
   * 9, et les comptes seuls ne permettaient PAS de dire lesquels avaient disparu ni
   * pourquoi. Un outil de diagnostic qui ne rend qu'un nombre ne diagnostique rien —
   * « 9 sur 74 » et « 16 sur 74 » se ressemblent alors qu'ils racontent deux histoires
   * opposées (véhicule endormi, ou permissions perdues).
   *
   * Ces noms ne portent AUCUNE valeur — ni position, ni kilométrage : ils peuvent circuler
   * dans une réponse de cron et un journal de CI public sans rien exposer.
   */
  codes: {
    succes: string[];
    /** `{ "ERROR (PERMISSION)": [...], … }` — la ventilation qui commande l'action. */
    parStatut: Record<string, string[]>;
  };
}

/**
 * Extrait le tableau de signaux d'une réponse `GET /vehicles/{id}/signals`.
 *
 * Forme OBSERVÉE le 11/08/2026 : `{ data: [ { id, attributes: {…}, meta: {…} } ], meta:
 * { totalCount, pageSize, pageNumber } }`. On tolère aussi `signals` à la racine — la
 * même prudence que `normaliserSignal`, pour la même raison : un changement d'enveloppe
 * ne doit pas se traduire par un silence.
 */
export function extraireSignaux(reponse: unknown): {
  signaux: unknown[];
  totalAnnonce: number | null;
} {
  const racine = (reponse ?? {}) as Record<string, unknown>;
  const brut =
    (Array.isArray(racine.data) && racine.data) ||
    (Array.isArray(racine.signals) && racine.signals) ||
    [];
  const meta = (racine.meta ?? {}) as Record<string, unknown>;
  const total = Number(meta.totalCount);
  return {
    signaux: brut as unknown[],
    totalAnnonce: Number.isFinite(total) ? total : null,
  };
}

/**
 * Va chercher l'état courant de tous les signaux souscrits et l'enregistre.
 *
 * Ne lève JAMAIS : un poll planifié qui plante finirait par ressembler à une panne de
 * CarAI alors que la cause est en amont. L'échec est rapporté dans le résultat, avec son
 * motif, et le prochain passage réessaiera.
 */
export async function pollerSignaux(): Promise<ResultatPoll> {
  const vide = {
    recus: 0,
    totalAnnonce: null,
    ecrits: 0,
    repetitionsEcartees: 0,
    succes: 0,
    enEchec: 0,
    codes: { succes: [], parStatut: {} },
  };

  const vehicleId = await lireConfigTexte(CLE_SMARTCAR_VEHICLE);
  if (!vehicleId) {
    return { ok: false, raison: "aucun véhicule connu — refaire le Connect.", ...vide };
  }

  const contexte = await contexteSmartcar(() => lireConfigTexte(CLE_SMARTCAR_USER));
  if (!contexte) {
    return {
      ok: false,
      raison: "intégration Smartcar non configurée (identifiants ou userId absents).",
      ...vide,
    };
  }

  let reponse: unknown;
  try {
    // GET, sur le chemin OBSERVÉ dans le catalogue réel (`links.self`). Le POST par liste
    // de codes existe aussi (`lireSignaux`) mais sa forme n'a jamais pu être vérifiée —
    // et trois des quatre bugs de production de ce projet venaient de chemins DEVINÉS.
    //
    // `appelSmartcar` LÈVE sur une réponse non-ok : le catch ci-dessous en fait un motif
    // lisible plutôt qu'une trace de pile dans un cron.
    const r = await appelSmartcar(contexte, `/vehicles/${encodeURIComponent(vehicleId)}/signals`);
    reponse = r.data;
  } catch (err) {
    return {
      ok: false,
      raison: `appel Smartcar impossible : ${err instanceof Error ? err.message : String(err)}`,
      ...vide,
    };
  }

  const { signaux, totalAnnonce } = extraireSignaux(reponse);
  const statuts = resumerStatutsSignaux(signaux);

  if (signaux.length === 0) {
    return {
      ok: false,
      raison: "réponse sans signal exploitable — enveloppe inattendue.",
      ...vide,
      totalAnnonce,
    };
  }

  const lignes = signauxVersSnapshots(signaux, { source: "smartcar", recuLe: new Date() });

  // Ne pas ré-inscrire un refus déjà connu : sans ce filtre, chaque poll ajoutait une
  // ligne vide par signal refusé (voir `filtrerRepetitions`).
  const aEcrire = filtrerRepetitions(lignes, await statutsConnusSmartcar());
  const ecrits = await insererSnapshots(aEcrire);

  return {
    ok: true,
    recus: signaux.length,
    totalAnnonce,
    ecrits,
    repetitionsEcartees: lignes.length - aEcrire.length,
    succes: statuts.succes.length,
    enEchec: statuts.enEchec.length,
    codes: {
      succes: statuts.succes,
      parStatut: grouperParStatut(statuts.enEchec),
    },
  };
}

/**
 * Groupe les refus par statut. PURE, testée.
 *
 * La ventilation, pas la liste à plat : `COMPATIBILITY` (perdu à jamais) et `PERMISSION`
 * (récupérable par un re-Connect) appellent des gestes opposés, et les mélanger dans un
 * seul tableau oblige à relire chaque ligne pour trancher.
 */
export function grouperParStatut(
  enEchec: Array<{ code: string; statut: string }>,
): Record<string, string[]> {
  const parStatut: Record<string, string[]> = {};
  for (const { code, statut } of enEchec) {
    (parStatut[statut] ??= []).push(code);
  }
  for (const codes of Object.values(parStatut)) codes.sort();
  return parStatut;
}
