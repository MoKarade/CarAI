// lib/sessionDecision.ts — décision pure de `requireSession` (lib/session.ts).
//
// Extrait dans un fichier SANS dépendance à next-auth : `lib/session.ts` importe `@/auth`,
// qui importe `next/server`, dont la résolution casse sous Vitest dans cet environnement
// (`Cannot find module '.../next/server'`, next-auth/lib/env.js). Un test qui importerait
// `decideSessionEmail` depuis lib/session.ts échouerait donc au CHARGEMENT, pas sur
// l'assertion — silencieusement invisible si ce fichier n'existait pas séparément. Même
// patron que `decideGuard` (lib/authGuard.ts), déjà isolé de `middleware.ts` pour la même
// raison.

import { isAuthorizedEmail } from "@/lib/authorized";

/**
 * Choisit l'email de session entre les deux sources possibles, nouveau cookie signé en
 * premier (phase 1 du plan `auth-asym-hubperso`), repli sur l'ancienne session Auth.js.
 */
export function decideSessionEmail(
  emailNouveauCookie: string | null,
  emailAncienneSession: string | null,
  authorizedEmail: string | undefined,
): string | null {
  if (emailNouveauCookie && isAuthorizedEmail(emailNouveauCookie, authorizedEmail)) {
    return emailNouveauCookie;
  }
  if (emailAncienneSession && isAuthorizedEmail(emailAncienneSession, authorizedEmail)) {
    return emailAncienneSession;
  }
  return null;
}
