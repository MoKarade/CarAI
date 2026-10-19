// lib/connexionHub.ts — où envoyer quelqu'un qui n'a pas de session.
//
// ── CE QUI A CHANGÉ, ET POURQUOI ────────────────────────────────────────────────────
//
// CarAI ne parle plus à Google (ADR 0001 de Hubperso). Elle ne fabrique plus de session :
// elle LIT celle que le hub a posée sur `.hubperso.com`. Quand il n'y en a pas, elle
// n'affiche donc plus de bouton « Se connecter avec Google » — elle renvoie au hub, qui
// est devenu la porte d'entrée unique de l'écosystème.
//
// Le gain n'est pas cosmétique : le `client_secret` Google n'existe plus dans cet
// environnement. Une copie de moins à faire tourner le jour d'un incident, et une app de
// moins qui peut casser sa propre authentification.

/** Le hub. Surchargeable pour un déploiement de test, jamais écrit en dur ailleurs. */
export const URL_HUB = process.env.NEXT_PUBLIC_HUB_URL?.trim() || "https://hubperso.com";

/**
 * Le chemin interne demandé, ou `/` si on ne peut pas lui faire confiance.
 *
 * ⚠️ On n'accepte QUE des chemins internes. Une URL absolue venue de l'extérieur ferait
 * de CarAI un tremplin : `?retour=https://evil.com` renverrait la personne sur un site
 * tiers APRÈS une connexion réussie, donc en confiance. Et `//evil.com` ressemble à un
 * chemin sans en être un — le navigateur y voit une autre origine.
 */
export function cheminInterne(retour: string | null | undefined): string {
  const valeur = retour?.trim();
  if (!valeur) return "/";
  if (!valeur.startsWith("/") || valeur.startsWith("//")) return "/";
  return valeur;
}

/**
 * L'URL de connexion du hub, avec de quoi revenir ici ensuite.
 *
 * `origine` est l'origine de CETTE app, telle que la requête l'a vue — pas une constante :
 * CarAI répond aussi bien sur son domaine que sur une préversion Vercel, et coder l'un
 * empêcherait l'autre de fonctionner.
 *
 * Le hub valide cette destination de son côté (`lib/retour.ts`) : il n'accepte que les
 * sous-domaines de `hubperso.com`. La confiance ne va donc pas dans les deux sens — ce
 * qu'on envoie ici est une demande, pas un ordre.
 */
export function urlConnexionHub(origine: string, retour: string | null | undefined): string {
  const url = new URL("/login", URL_HUB);
  url.searchParams.set("callbackUrl", new URL(cheminInterne(retour), origine).toString());
  return url.toString();
}
