// lib/authConfigured.ts
//
// FAIL-CLOSED. Constat vécu en préproduction sur le hub : quand `AUTH_SECRET` manque,
// Auth.js loggue `MissingSecret` mais LAISSE PASSER la requête — l'app servait ses
// données sans aucun login. Une app privée ne doit jamais « échouer ouvert » : sans
// configuration d'auth complète, on ne sert RIEN de protégé.
//
// Fonction pure et injectable, pour être testée sans toucher au vrai environnement.

type Env = Record<string, string | undefined>;

/** true seulement si la config d'auth minimale est présente (secret + allowlist). */
export function isAuthConfigured(env: Env = process.env): boolean {
  return Boolean(env.AUTH_SECRET?.trim() && env.AUTHORIZED_EMAIL?.trim());
}
