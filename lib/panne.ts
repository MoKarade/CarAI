// lib/panne.ts — classer une erreur de base de données. FONCTIONS PURES.
//
// ── POURQUOI CE FICHIER EXISTE ───────────────────────────────────────────────────────
// Leçon reprise de JobAI, apprise en production : « un message d'erreur FAUX coûte plus
// cher qu'un message générique ». Là-bas, une page avait annoncé « la base n'a pas
// répondu » alors que la base répondait parfaitement — il manquait une table. Marc est
// parti vérifier une connexion là où il manquait une migration.
//
// Postgres distingue clairement les deux cas, encore faut-il lire le code :
//   • 42P01 « undefined_table » → la base répond très bien, le SCHÉMA n'est pas là.
//   • tout le reste → la base est injoignable, saturée, ou refuse les identifiants.
//
// Ces deux situations appellent deux gestes opposés (attendre les migrations vs vérifier
// DATABASE_URL), donc elles doivent porter deux messages différents.
//
// ⚠️ Cette classification vit ICI et nulle part ailleurs. Chez JobAI, la même logique
// écrite deux fois dans deux pages avait divergé : l'accueil classait correctement, la
// page suivante avait été écrite sans reprendre la classification.

export type TypePanne = "schema_absent" | "base_injoignable" | "inconnue";

/** Code d'erreur Postgres pour « la relation n'existe pas ». */
export const CODE_TABLE_ABSENTE = "42P01";

function chercherCode(erreur: unknown, profondeur = 0): string | null {
  if (!erreur || typeof erreur !== "object" || profondeur > 5) return null;

  const o = erreur as Record<string, unknown>;
  if (typeof o.code === "string" && o.code) return o.code;

  // Drizzle enveloppe l'erreur du pilote : le code réel vit dans `cause`. Sans cette
  // descente, toute erreur de schéma serait classée « injoignable » — exactement le
  // message faux qu'on veut éviter.
  return chercherCode(o.cause, profondeur + 1);
}

export function classerPanne(erreur: unknown): TypePanne {
  const code = chercherCode(erreur);
  if (code === CODE_TABLE_ABSENTE) return "schema_absent";
  if (code) return "base_injoignable";

  // Pas de code exploitable : on regarde le texte, sans prétendre à mieux qu'une
  // supposition — d'où le repli sur « inconnue » plutôt qu'une affirmation.
  const message = erreur instanceof Error ? erreur.message : String(erreur ?? "");
  if (/does not exist|relation .* does not exist/i.test(message)) return "schema_absent";
  return "inconnue";
}

/** Message destiné à Marc : ce qui se passe, et ce qu'il peut faire. */
export function messagePanne(type: TypePanne, detail?: string): string {
  switch (type) {
    case "schema_absent":
      return "Le schéma de la base n'est pas encore créé. Les tables s'appliquent au démarrage de l'app : recharge la page dans quelques secondes. Si ça persiste, c'est que les migrations échouent — regarde les journaux.";
    case "base_injoignable":
      return `La base de données ne répond pas. Vérifie DATABASE_URL dans les variables d'environnement.${detail ? ` (${detail})` : ""}`;
    default:
      return `CarAI n'a pas pu lire ses données.${detail ? ` (${detail})` : ""}`;
  }
}

/** Étiquette courte, pour un label d'alerte du hub (borné à 80 caractères par le contrat). */
export function resumePanne(type: TypePanne): string {
  switch (type) {
    case "schema_absent":
      return "schéma de base pas encore créé";
    case "base_injoignable":
      return "base de données injoignable";
    default:
      return "lecture des données impossible";
  }
}
