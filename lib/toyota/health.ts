// lib/toyota/health.ts — isolation et santé du module Toyota (Doc 3 §6). FONCTIONS PURES.
//
// ══ LE PRINCIPE NON NÉGOCIABLE (Doc 1 §1, Doc 3 §1) ══════════════════════════════════
//
// Smartcar est le socle ; `ha-toyota-na` est un module ADDITIF et ISOLÉ. Si Toyota change
// son API, ajoute un facteur d'authentification, ou bloque à nouveau l'accès — trois choses
// déjà arrivées dans l'histoire de cet écosystème — CarAI doit continuer de fonctionner
// normalement sur Smartcar seul. AUCUNE fonctionnalité cœur ne dépend de ce module.
//
// Ce fichier est le mécanisme qui rend ce principe VRAI plutôt que déclaratif :
//   • un compteur d'échecs consécutifs, remis à zéro par le moindre succès ;
//   • une désactivation AUTOMATIQUE au-delà du seuil, pour cesser de taper dans le vide ;
//   • un chemin de RETOUR automatique — sans lui, une panne passagère de Toyota
//     condamnerait le module à vie.
//
// ⚠️ Ce dernier point vient d'une leçon coûteuse de DriveAI : « un garde-fou qui met des
// items HORS CIRCUIT exige un chemin de RETOUR auto ». Une quarantaine sans sortie
// automatique transforme un incident de quelques heures en perte permanente et silencieuse.

import type { SanteToyota } from "@/lib/config";
import type { Env } from "@/lib/env";

/** Nombre d'échecs consécutifs avant désactivation automatique (Doc 3 §6.1). */
export const SEUIL_DESACTIVATION = 5;

/**
 * Délai avant de retenter après une désactivation automatique.
 *
 * Généreux (24 h) parce que les causes typiques ne se règlent pas en dix minutes : Toyota a
 * changé son API, un abonnement a expiré, un blocage a été posé. Retenter toutes les cinq
 * minutes ne réparerait rien et ressemblerait à de l'acharnement côté Toyota — précisément
 * le comportement qui attire l'attention qu'on veut éviter.
 */
export const DELAI_REACTIVATION_HEURES = 24;

/**
 * Le module est-il ACTIF pour ce cycle ?
 *
 * Trois verrous, du plus explicite au plus automatique :
 *   1. le drapeau d'environnement (Marc décide) ;
 *   2. les identifiants (rien à tenter sans eux) ;
 *   3. la désactivation automatique, avec sa péremption.
 */
export function moduleActif(params: {
  sante: SanteToyota;
  maintenant: Date;
  env?: Env;
}): { actif: boolean; raison: string } {
  const { sante, maintenant, env = process.env } = params;

  // ⚠️ DÉSACTIVÉ PAR DÉFAUT, délibérément. Le Doc 3 §2 conditionne toute implémentation à
  // deux validations que Marc seul peut faire : l'abonnement Connected Services est-il
  // actif, et un compte `toyota.ca` fonctionne-t-il avec cette bibliothèque (inconnu réel,
  // jamais confirmé empiriquement). Le code existe et est testé ; il ne s'exécutera que
  // lorsque Marc posera TOYOTA_NA_ENABLED=true en connaissance de cause.
  if (env.TOYOTA_NA_ENABLED?.trim().toLowerCase() !== "true") {
    return {
      actif: false,
      raison:
        "Module Toyota désactivé (TOYOTA_NA_ENABLED absent). Source complémentaire non officielle — à activer seulement après validation manuelle (Doc 3 §2).",
    };
  }

  if (!env.TOYOTA_USERNAME?.trim() || !env.TOYOTA_PASSWORD?.trim()) {
    return {
      actif: false,
      raison: "Identifiants Toyota non configurés (TOYOTA_USERNAME / TOYOTA_PASSWORD).",
    };
  }

  if (sante.desactiveLe) {
    const desactiveLe = new Date(sante.desactiveLe);
    const heures = (maintenant.getTime() - desactiveLe.getTime()) / 3_600_000;
    if (Number.isNaN(heures) || heures < DELAI_REACTIVATION_HEURES) {
      return {
        actif: false,
        raison: `Module désactivé automatiquement après ${SEUIL_DESACTIVATION} échecs consécutifs. Dernière erreur : ${sante.derniereErreur ?? "non précisée"}. Nouvelle tentative dans ${Math.max(0, Math.ceil(DELAI_REACTIVATION_HEURES - (Number.isNaN(heures) ? 0 : heures)))} h.`,
      };
    }
    // Le délai est écoulé : on retente. C'est le chemin de retour automatique.
    return { actif: true, raison: "Nouvelle tentative après désactivation automatique." };
  }

  return { actif: true, raison: "Module actif." };
}

/** Santé après un cycle réussi : le compteur retombe à zéro et la désactivation est levée. */
export function apresSucces(sante: SanteToyota, maintenant: Date): SanteToyota {
  return {
    ...sante,
    echecsConsecutifs: 0,
    desactiveLe: null,
    derniereErreur: null,
    dernierSucces: maintenant.toISOString(),
  };
}

/**
 * Santé après un cycle en échec.
 *
 * ⚠️ Le compteur ne compte que les échecs CONSÉCUTIFS : un seul succès le remet à zéro.
 * Sans ça, cinq pannes réparties sur six mois finiraient par désactiver un module qui
 * marche parfaitement — un compteur cumulatif ne mesure pas une panne, il mesure l'âge.
 */
export function apresEchec(params: {
  sante: SanteToyota;
  erreur: string;
  maintenant: Date;
}): SanteToyota {
  const { sante, erreur, maintenant } = params;
  const echecs = sante.echecsConsecutifs + 1;

  return {
    ...sante,
    echecsConsecutifs: echecs,
    derniereErreur: erreur,
    desactiveLe:
      echecs >= SEUIL_DESACTIVATION ? maintenant.toISOString() : sante.desactiveLe,
  };
}

/**
 * Ces symptômes évoquent-ils un BLOCAGE côté Toyota plutôt qu'un bug de CarAI ?
 *
 * Le Doc 3 §6.2 liste les signatures observées par la communauté quand Toyota change son
 * API ou coupe l'accès : authentification qui échoue soudainement malgré des identifiants
 * corrects, erreurs de parsing sur des champs attendus, « Not Logged In » générique.
 *
 * L'intérêt n'est pas de réparer — on ne peut pas — mais d'ÉCRIRE LE DIAGNOSTIC dans le
 * message. Le jour où ça arrivera, après des mois de fonctionnement normal, la tentation
 * sera de chercher un bug dans CarAI. Ce message fera gagner les heures que cette recherche
 * aurait coûtées.
 */
export function ressembleABlocageToyota(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("not logged in") ||
    m.includes("unauthorized") ||
    m.includes("forbidden") ||
    m.includes("invalid_grant") ||
    m.includes("keyerror") ||
    m.includes("unexpected token") ||
    m.includes("cannot read properties of undefined")
  );
}

/** Message destiné à Marc quand le module vient d'être désactivé automatiquement. */
export function messageDesactivation(sante: SanteToyota): string {
  const base = `Module Toyota désactivé après ${sante.echecsConsecutifs} échecs consécutifs.`;
  const suite = sante.derniereErreur
    ? ` Dernière erreur : ${sante.derniereErreur}.`
    : "";
  const diagnostic =
    sante.derniereErreur && ressembleABlocageToyota(sante.derniereErreur)
      ? " Cette signature ressemble à un blocage ou à un changement d'API côté Toyota (déjà arrivé deux fois dans l'histoire de cette intégration), pas à un bug de CarAI — inutile de chercher longtemps de ce côté."
      : "";
  return `${base}${suite}${diagnostic} CarAI continue de fonctionner normalement sur Smartcar. Nouvelle tentative automatique dans ${DELAI_REACTIVATION_HEURES} h.`;
}
