// lib/toyota/poll.ts — stratégie de poll à deux vitesses (Doc 3 §5). FONCTIONS PURES.
//
// ══ CE QUI EST EN JEU : LA BATTERIE 12 V DU VÉHICULE ═════════════════════════════════
//
// Contrairement à Smartcar (webhooks), il n'existe aucun mécanisme de push côté Toyota :
// CarAI doit demander. Et le Doc 3 §5.1 documente un comportement vérifié empiriquement sur
// l'infrastructure équivalente : le statut portes/serrures est servi depuis un CACHE côté
// Toyota, qui ne se rafraîchit que lorsque le véhicule roule — ou lorsqu'on envoie une
// requête de RÉVEIL explicite. Envoyer ce réveil trop souvent DRAINE la batterie 12 V, cas
// documenté dans l'écosystème des intégrations communautaires.
//
// D'où deux chemins que ce module garde SÉPARÉS, et qui ne doivent jamais fusionner :
//
//   • POLL LÉGER — lit ce que Toyota a déjà en cache. N'éveille rien, ne coûte rien au
//     véhicule. Toutes les 2 h par défaut.
//   • RÉVEIL FORCÉ — demande au véhicule de se réveiller pour rafraîchir son cache. Rare,
//     conditionnel, journalisé. C'est celui qui peut vider une batterie.
//
// Le Doc 3 §5.3 demande explicitement que ces deux logiques restent distinctes « pour
// éviter qu'un refactor futur ne réintroduise un réveil trop fréquent par accident ». La
// séparation est donc dans les TYPES, pas seulement dans un commentaire : `DecisionPoll`
// porte deux champs distincts, et rien ne permet de dériver l'un de l'autre.

/** Intervalle par défaut du poll léger (Doc 3 §5.2). Ajustable après observation réelle. */
export const INTERVALLE_POLL_LEGER_MINUTES = 120;

/**
 * Intervalle plancher entre deux réveils forcés. Filet de dernier recours : même si toutes
 * les conditions de réveil sont réunies en boucle (odomètre qui bouge à chaque cycle
 * pendant un long trajet), on ne réveille pas plus souvent que ça.
 */
export const PLANCHER_REVEIL_MINUTES = 60;

/**
 * Écart d'odomètre à partir duquel on considère que le véhicule a ROULÉ depuis le dernier
 * cycle. Un seuil strictement positif plutôt que `!==` : un odomètre peut varier d'une
 * unité par arrondi de conversion sans que la voiture ait bougé.
 */
export const SEUIL_DEPLACEMENT_KM = 0.5;

export type RaisonReveil =
  | "vehicule_vient_de_s_arreter"
  | "demande_explicite"
  | "aucune";

export interface DecisionPoll {
  /** Lire le cache Toyota. Sans effet sur le véhicule. */
  pollLeger: boolean;
  /** Demander au véhicule de se réveiller. ⚠️ Consomme la batterie 12 V. */
  reveilForce: boolean;
  raisonReveil: RaisonReveil;
  /** Explication lisible, destinée au journal exigé par le Doc 3 §5.3. */
  explication: string;
}

export interface EtatPoll {
  dernierPollLe: Date | null;
  dernierReveilLe: Date | null;
  dernierOdometre: number | null;
}

export interface ContextePoll {
  etat: EtatPoll;
  maintenant: Date;
  /** Odomètre lu au cycle courant, s'il est disponible. */
  odometreCourant: number | null;
  /** Marc a cliqué « rafraîchir maintenant », ou une commande exige un état à jour. */
  demandeExplicite?: boolean;
  intervalleLegerMinutes?: number;
}

function minutesEcoulees(depuis: Date | null, maintenant: Date): number | null {
  if (!depuis) return null;
  return (maintenant.getTime() - depuis.getTime()) / 60_000;
}

/**
 * Décide ce que le cycle courant a le droit de faire.
 *
 * ⚠️ Le réveil PÉRIODIQUE (véhicule inactif depuis des jours) n'existe pas ici, et c'est
 * volontaire : le Doc 3 §5.2 demande qu'il reste désactivé par défaut et ne soit ajouté que
 * si un besoin réel apparaît à l'usage. Ne pas l'écrire du tout est plus sûr que l'écrire
 * derrière un drapeau qu'on finirait par activer « pour voir ».
 */
export function deciderPoll(contexte: ContextePoll): DecisionPoll {
  const {
    etat,
    maintenant,
    odometreCourant,
    demandeExplicite = false,
    intervalleLegerMinutes = INTERVALLE_POLL_LEGER_MINUTES,
  } = contexte;

  const depuisPoll = minutesEcoulees(etat.dernierPollLe, maintenant);
  const pollLeger = depuisPoll === null || depuisPoll >= intervalleLegerMinutes;

  const depuisReveil = minutesEcoulees(etat.dernierReveilLe, maintenant);
  const reveilAutorise = depuisReveil === null || depuisReveil >= PLANCHER_REVEIL_MINUTES;

  // Demande explicite de Marc : prioritaire, mais TOUJOURS soumise au plancher. C'est la
  // seule protection contre un bouton cliqué vingt fois d'affilée.
  if (demandeExplicite) {
    if (reveilAutorise) {
      return {
        pollLeger: true,
        reveilForce: true,
        raisonReveil: "demande_explicite",
        explication: "Rafraîchissement demandé explicitement.",
      };
    }
    return {
      pollLeger: true,
      reveilForce: false,
      raisonReveil: "aucune",
      explication: `Rafraîchissement demandé mais le dernier réveil date de ${Math.round(depuisReveil!)} min (plancher : ${PLANCHER_REVEIL_MINUTES} min). Lecture du cache seulement.`,
    };
  }

  // Le véhicule vient de s'arrêter : détecté par un écart d'odomètre entre deux cycles
  // (Doc 3 §5.2). C'est le moment utile — on capte les fermetures juste après que Marc
  // soit sorti, ce qu'un poll de cache seul ne verrait jamais.
  const aRoule =
    odometreCourant !== null &&
    etat.dernierOdometre !== null &&
    odometreCourant - etat.dernierOdometre >= SEUIL_DEPLACEMENT_KM;

  if (aRoule && reveilAutorise) {
    return {
      pollLeger: true,
      reveilForce: true,
      raisonReveil: "vehicule_vient_de_s_arreter",
      explication: `Odomètre passé de ${etat.dernierOdometre} à ${odometreCourant} : le véhicule a roulé, on rafraîchit le statut des ouvrants.`,
    };
  }

  return {
    pollLeger,
    reveilForce: false,
    raisonReveil: "aucune",
    explication: pollLeger
      ? "Poll léger périodique (lecture du cache Toyota, aucun réveil du véhicule)."
      : `Rien à faire : dernier poll il y a ${Math.round(depuisPoll!)} min (intervalle : ${intervalleLegerMinutes} min).`,
  };
}

/**
 * Nouvel état de santé après un cycle. PUR : l'appelant persiste ce qui est renvoyé.
 *
 * ⚠️ `dernierReveilLe` n'avance QUE si un réveil a réellement eu lieu. Le faire avancer à
 * chaque cycle réinitialiserait le plancher en permanence et laisserait passer un réveil
 * bien plus souvent que prévu — le genre de bug qui ne se voit que sur une batterie à plat.
 */
export function etatApresCycle(params: {
  etat: EtatPoll;
  decision: DecisionPoll;
  odometreCourant: number | null;
  maintenant: Date;
}): EtatPoll {
  const { etat, decision, odometreCourant, maintenant } = params;
  return {
    dernierPollLe: decision.pollLeger ? maintenant : etat.dernierPollLe,
    dernierReveilLe: decision.reveilForce ? maintenant : etat.dernierReveilLe,
    dernierOdometre: odometreCourant ?? etat.dernierOdometre,
  };
}
