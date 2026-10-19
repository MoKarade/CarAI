// lib/vehicle/commandes.ts — le CATALOGUE des commandes offertes à l'écran. PUR, testé.
//
// Marc, 13/08/2026 : « la prochaine étape c'est de mettre en place des commandes depuis
// l'app ». L'envoi existait déjà (`lib/smartcar/commands.ts`, utilisé par le MCP) ; ce qui
// manquait, c'est une surface web — et surtout les GARDES qui vont avec.
//
// ══ POURQUOI CE FICHIER EST SÉPARÉ DE L'ENVOI ════════════════════════════════════════
//
// `lib/smartcar/commands.ts` sait PARLER à Smartcar. Il ne sait pas, et n'a pas à savoir,
// laquelle de ces commandes ouvre une portière dans la rue. Ce jugement-là est une décision
// de produit : il vit ici, en fonctions pures, donc il se teste sans réseau et sans base.
//
// ══ CE QUI REND UNE COMMANDE DANGEREUSE ══════════════════════════════════════════════
//
// ⚠️ Déverrouiller une voiture n'est pas une écriture en base : c'est une portière qui
// s'ouvre, potentiellement dans un stationnement public, et RIEN dans l'app ne peut la
// refermer si Marc n'est pas à côté. Le MCP obtient sa confirmation en langage naturel
// AVANT l'appel (Doc 4 §4) ; une page web n'a pas cette conversation, donc elle exige un
// geste explicite — et le VÉRIFIE côté serveur, jamais seulement dans le navigateur.
//
// Les commandes de charge, elles, sont réversibles d'un clic et n'exposent rien : les
// exiger sous confirmation entraînerait à cocher sans lire, ce qui détruirait la valeur de
// la confirmation là où elle compte vraiment.

import type { TypeCommande } from "@/lib/smartcar/commands";

export interface CommandeOfferte {
  type: TypeCommande;
  libelle: string;
  /** Ce que ça fait, en une phrase — jamais un paragraphe. */
  effet: string;
  /**
   * `true` quand l'action a un effet PHYSIQUE qu'on ne peut pas défaire à distance.
   *
   * Ce n'est pas une échelle de gravité : c'est un booléen qui commande une garde.
   */
  confirmationRequise: boolean;
  /** Une valeur numérique accompagne la commande (la limite de charge). */
  champNumerique?: {
    nom: string;
    libelle: string;
    min: number;
    max: number;
    pas: number;
    suffixe: string;
  };
}

/**
 * Les commandes proposées à l'écran, dans l'ordre d'affichage.
 *
 * ⚠️ `unlock` est la SEULE à exiger une confirmation, et c'est délibéré. Verrouiller ne
 * peut rien exposer ; arrêter une charge se rattrape en la relançant. Cocher une case pour
 * chacune apprendrait à cocher sans lire.
 */
export const COMMANDES_OFFERTES: readonly CommandeOfferte[] = [
  {
    type: "lock",
    libelle: "Verrouiller",
    effet: "Verrouille les portières.",
    confirmationRequise: false,
  },
  {
    type: "unlock",
    libelle: "Déverrouiller",
    effet: "Ouvre les portières, là où la voiture est garée.",
    confirmationRequise: true,
  },
  {
    type: "start_charge",
    libelle: "Démarrer la charge",
    effet: "Sans effet si le câble n’est pas branché.",
    confirmationRequise: false,
  },
  {
    type: "stop_charge",
    libelle: "Arrêter la charge",
    effet: "La charge peut redémarrer seule selon la programmation de la voiture.",
    confirmationRequise: false,
  },
  {
    type: "set_charge_limit",
    libelle: "Limite de charge",
    effet: "Plafond auquel la voiture arrête de charger.",
    confirmationRequise: false,
    champNumerique: {
      nom: "limite",
      libelle: "Limite",
      // Bornes de Smartcar (Doc 2 §5.2), exprimées en pourcentage à l'écran.
      min: 50,
      max: 100,
      pas: 5,
      suffixe: "%",
    },
  },
];

/** Retrouve une commande du catalogue. `null` sur tout ce qui n'y est pas. PURE. */
export function commandeOfferte(type: string | null | undefined): CommandeOfferte | null {
  if (!type) return null;
  return COMMANDES_OFFERTES.find((c) => c.type === type) ?? null;
}

/**
 * Les motifs de refus, en CODES.
 *
 * ⚠️ Un code plutôt qu'une phrase parce que ce refus voyage dans une URL (l'écran redirige
 * après la soumission). Du texte libre en query string serait RÉAFFICHÉ tel quel : on
 * pourrait fabriquer un faux message système en trafiquant le lien. Un code se valide
 * contre cette liste, et la phrase est écrite ici, côté serveur.
 */
export type CodeRefus = "inconnue" | "confirmation";

export const MESSAGES_REFUS: Readonly<Record<CodeRefus, string>> = {
  inconnue: "Commande inconnue — rien n’a été envoyé au véhicule.",
  confirmation:
    "Cette commande a un effet physique : coche la confirmation avant d’envoyer.",
};

/**
 * La table COMPLÈTE des messages que l'interface peut afficher après une soumission —
 * les refus du catalogue plus les échecs d'infrastructure (session, base, connexion).
 *
 * Une seule table pour l'écran Commandes ET les actions du schéma de l'accueil (refonte
 * du 17/08) : deux copies divergeraient, et c'est la copie la plus pauvre qui gagnerait
 * (leçon JobAI). Toujours indexée par CODE, jamais par texte d'URL.
 */
export const MOTIFS_UI: Readonly<Record<string, string>> = {
  ...MESSAGES_REFUS,
  session: "Session expirée — reconnecte-toi.",
  base: "DATABASE_URL absent : impossible de journaliser, donc rien n’a été envoyé.",
  deconnecte:
    "Véhicule non connecté à Smartcar — rien n’a été envoyé. Lance le Connect depuis l’accueil.",
  limite: "Limite de charge hors bornes : Smartcar accepte de 50 % à 100 %.",
};

export type RefusCommande =
  | { ok: true; commande: CommandeOfferte }
  | { ok: false; code: CodeRefus; motif: string };

/**
 * Décide si une soumission de formulaire a le droit de partir vers le véhicule. PURE.
 *
 * ══ LE POINT IMPORTANT ═══════════════════════════════════════════════════════════════
 *
 * ⚠️ La confirmation est re-vérifiée ICI, côté serveur. Un attribut `required` sur une case
 * à cocher est une commodité de saisie, pas un contrôle : il vit dans le navigateur, et
 * une requête POST fabriquée à la main ne le rencontre jamais. Le garde qui compte est
 * celui que le serveur applique — c'est la même règle que « échec fermé » ailleurs dans
 * l'écosystème.
 *
 * ⚠️ Une commande INCONNUE est refusée, jamais transmise telle quelle : la table des
 * chemins Smartcar ne doit pas être atteignable par une valeur d'URL arbitraire.
 */
export function autoriserCommande(params: {
  type: string | null | undefined;
  confirme: boolean;
}): RefusCommande {
  const commande = commandeOfferte(params.type);
  if (!commande) {
    return { ok: false, code: "inconnue", motif: MESSAGES_REFUS.inconnue };
  }
  if (commande.confirmationRequise && !params.confirme) {
    return { ok: false, code: "confirmation", motif: MESSAGES_REFUS.confirmation };
  }
  return { ok: true, commande };
}

/**
 * Ce qu'on affiche après une commande, par statut.
 *
 * ⚠️ Aucun de ces textes ne dit « c'est fait ». Smartcar documente qu'une commande peut
 * être acceptée par l'API sans que l'effet atteigne le véhicule (Doc 4 §4.5) : annoncer un
 * succès serait exactement la fausse donnée que le projet s'interdit. Le seul moyen de
 * savoir, c'est l'état publié ENSUITE par la voiture.
 */
export const TON_PAR_STATUT: Readonly<Record<string, "ok" | "attention" | "danger">> = {
  success: "ok",
  pending: "attention",
  unknown: "attention",
  failed: "danger",
};

export function libelleStatut(statut: string): string {
  switch (statut) {
    case "success":
      return "Acceptée par Smartcar";
    case "pending":
      return "En cours";
    case "failed":
      return "Refusée";
    case "unknown":
      // ⚠️ « Inconnu » n'est pas un échec : c'est l'aveu qu'on ne sait pas si le véhicule a
      // reçu l'ordre. Le ranger dans « refusée » ferait croire qu'il ne s'est rien passé.
      return "Sort inconnu";
    default:
      return statut;
  }
}
