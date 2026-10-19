// lib/authorized.ts
//
// Filtre d'accès de l'app : UNE SEULE adresse est admise. La valeur autorisée vient de
// AUTHORIZED_EMAIL (jamais en dur). Fonction PURE, sans lecture d'environnement, pour
// être testable directement — c'est le patron des 3 apps privées de l'écosystème
// (Hubperso, BatchChef, JobAI).

/**
 * true seulement si `email` correspond à `authorized` (trim + lower-case).
 * Toute valeur absente/vide, côté candidat OU côté allowlist → refus : on ne laisse
 * JAMAIS passer quand l'allowlist n'est pas configurée (fail-closed).
 */
export function isAuthorizedEmail(
  email: string | null | undefined,
  authorized: string | null | undefined,
): boolean {
  const normalize = (value: string | null | undefined): string =>
    (value ?? "").trim().toLowerCase();

  const candidate = normalize(email);
  const allowed = normalize(authorized);

  if (!candidate || !allowed) return false;
  return candidate === allowed;
}
