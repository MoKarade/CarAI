// lib/toyota/otp.ts — extraction du code de vérification Toyota (Doc 3 §4.3).
// FONCTIONS PURES : aucune I/O, testables sur de vrais corps de courriel.
//
// Toyota impose un 2FA sur tous les comptes depuis l'épisode DMCA de 2022 (Doc 3 §1) : le
// login demande un code à six chiffres envoyé par courriel. Ce module transforme un
// courriel entrant en code exploitable.
//
// ── POURQUOI C'EST PLUS SUBTIL QU'UN /\d{6}/ ─────────────────────────────────────────
// Un courriel contient bien d'autres suites de six chiffres : identifiant de message,
// numéro de dossier, montant, année suivie d'une heure, pixel de suivi dans une URL. Le
// premier `\d{6}` venu attrape n'importe lequel, et l'authentification échoue sans qu'on
// comprenne pourquoi — le code AVAIT l'air d'être là.
//
// La stratégie est donc : chercher d'abord un code ANCRÉ à une formulation de vérification
// (« verification code: 123456 »), et ne se rabattre sur un code isolé que si le texte ne
// contient qu'UN SEUL candidat plausible. Deux candidats sans ancrage ⇒ on refuse plutôt
// que de tirer à pile ou face : un code faux consommera la fenêtre de validité et fera
// croire à une panne de Toyota.

/**
 * Formulations d'ancrage observées pour ce type de courriel. Volontairement bilingues :
 * le compte de Marc est sur `toyota.ca`, et rien ne garantit la langue du message.
 */
const ANCRAGES = [
  /verification\s*code[^0-9]{0,20}(\d{6})/i,
  /security\s*code[^0-9]{0,20}(\d{6})/i,
  /one[-\s]?time\s*(?:pass)?code[^0-9]{0,20}(\d{6})/i,
  /your\s*code\s*is[^0-9]{0,20}(\d{6})/i,
  /code\s*(?:de\s*)?(?:v[ée]rification|s[ée]curit[ée])[^0-9]{0,20}(\d{6})/i,
  /votre\s*code[^0-9]{0,20}(\d{6})/i,
  /(\d{6})[^0-9]{0,20}(?:is\s*your|est\s*votre)\s*(?:verification|security)?\s*code/i,
] as const;

/** Retire le balisage HTML pour que les motifs voient le texte, pas les attributs. */
export function texteBrutDepuisHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ResultatExtraction {
  code: string | null;
  /** Comment le code a été trouvé — pour diagnostiquer sans relire le courriel. */
  methode: "ancrage" | "candidat_unique" | "aucun" | "ambigu";
}

/**
 * Extrait le code à six chiffres d'un corps de courriel.
 *
 * Renvoie `methode: "ambigu"` plutôt qu'un code au hasard quand plusieurs candidats
 * cohabitent sans ancrage. Refuser est le bon comportement : le pipeline retentera au
 * courriel suivant, alors qu'un code faux serait consommé et compterait comme un échec
 * d'authentification côté Toyota.
 */
export function extraireCodeOtp(corps: string): ResultatExtraction {
  if (!corps?.trim()) return { code: null, methode: "aucun" };

  const texte = corps.includes("<") ? texteBrutDepuisHtml(corps) : corps;

  for (const motif of ANCRAGES) {
    const trouve = texte.match(motif);
    if (trouve?.[1]) return { code: trouve[1], methode: "ancrage" };
  }

  // Pas d'ancrage : on ne retient que les suites d'EXACTEMENT six chiffres, isolées par des
  // frontières non numériques. Sans cette borne, « 1234567 » fournirait « 123456 ».
  const candidats = [...texte.matchAll(/(?<!\d)(\d{6})(?!\d)/g)].map((m) => m[1]!);
  const uniques = [...new Set(candidats)];

  if (uniques.length === 1) return { code: uniques[0]!, methode: "candidat_unique" };
  if (uniques.length > 1) return { code: null, methode: "ambigu" };
  return { code: null, methode: "aucun" };
}

/**
 * true si le courriel vient bien de Toyota.
 *
 * ⚠️ L'expéditeur exact n'a pas pu être confirmé pour le marché canadien (Doc 3 §4.3 le
 * signale : « le nom exact de l'expéditeur peut différer entre marchés US/CA »). On accepte
 * donc tout domaine contenant `toyota`, ce qui est large mais borné — et surtout, ce n'est
 * PAS ce qui protège la route : celle-ci est gardée par un secret partagé. Ce filtre évite
 * qu'un courriel sans rapport transitant par la même boîte ne pollue la file de codes.
 */
export function expediteurToyota(expediteur: string | null | undefined): boolean {
  if (!expediteur) return false;
  return /toyota/i.test(expediteur);
}

/**
 * Un code est-il encore utilisable ?
 *
 * Deux conditions : jamais consommé, et reçu dans la fenêtre de validité. Le Doc 3 §4.2
 * situe cette fenêtre entre 30 et 120 secondes selon les rapports communautaires ; on prend
 * une valeur généreuse par défaut (10 min) parce qu'un code REFUSÉ par Toyota est une
 * erreur lisible, alors qu'un code écarté trop tôt par CarAI produit un blocage muet.
 * Toyota reste juge de la validité réelle — ce filtre ne fait qu'éviter de rejouer un
 * vieux code éventé.
 */
export function codeUtilisable(params: {
  recuLe: Date;
  consommeLe: Date | null;
  maintenant: Date;
  fenetreMinutes?: number;
}): boolean {
  const { recuLe, consommeLe, maintenant, fenetreMinutes = 10 } = params;
  if (consommeLe) return false;
  const ageMinutes = (maintenant.getTime() - recuLe.getTime()) / 60_000;
  return ageMinutes >= 0 && ageMinutes <= fenetreMinutes;
}
