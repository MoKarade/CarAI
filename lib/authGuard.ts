// lib/authGuard.ts
//
// Logique de garde du middleware, isolée en fonctions PURES : testable sans mocker tout
// NextAuth, et surtout LISIBLE — c'est ici que se décide ce qui est public.
//
// ⚠️⚠️ LE PIÈGE N°1 DU TEMPLATE, vécu en production par JobAI (« le défaut n°1 du
// squelette du 27/07 ») : **`/hub/summary` DOIT rester public ici.** Il porte sa PROPRE
// authentification (le jeton `x-hub-token`, vérifié en temps constant dans le Route
// Handler). S'il tombe sous le garde de session utilisateur, le hub reçoit une
// REDIRECTION HTML vers la page de connexion au lieu du JSON attendu — et le widget
// affiche « injoignable » en permanence, sans que rien ne semble cassé côté app.
//
// Le symptôme est trompeur : l'app marche parfaitement dans un navigateur (tu es
// connecté), seul le hub voit le problème.
//
// ══ CarAI AJOUTE TROIS ROUTES DANS CE MÊME CAS, ET C'EST DÉLIBÉRÉ ════════════════════
//
// CarAI reçoit des appels de MACHINES qui n'auront jamais de session Google : Smartcar
// pousse ses webhooks, le service courriel pousse les codes OTP Toyota, le planificateur
// Vercel réveille le poll. Chacune de ces routes porte sa PROPRE authentification, plus
// forte qu'un cookie de session dans ce contexte (HMAC sur le corps, secret partagé).
//
// Pour Smartcar, l'enjeu dépasse le confort : une route de webhook qui répond 302 ou 503
// compte comme un ÉCHEC DE LIVRAISON, et Smartcar DÉSACTIVE le webhook après six échecs
// consécutifs (Doc 2 §6.4). Mettre ces routes derrière le garde de session couperait le
// flux de données en silence — l'app marcherait, le tableau de bord se figerait, et rien
// nulle part ne serait rouge.
//
// ⚠️ La liste est EXPLICITE, chemin par chemin — jamais un préfixe du genre
// `/api/webhooks/*`. Une exclusion par dossier s'applique pour toujours, y compris à la
// route qu'on ajoutera dans six mois sans y penser (leçon JobAI : « un garde qui s'exclut
// d'un dossier entier s'en exclut pour toujours »). Ici, une nouvelle route tombe DERRIÈRE
// le garde par défaut — le mauvais côté de l'oubli est le côté sûr.

export type GuardDecision =
  | { type: "next" }
  | { type: "unauthorized" }
  | { type: "redirect"; location: string };

/**
 * Routes qui portent leur PROPRE authentification et doivent donc échapper au garde de
 * session. Chaque entrée est justifiée ; ajouter une ligne ici est une décision, pas un
 * dépannage.
 *
 * ⚠️ Doit rester alignée avec le matcher du middleware. `tests/auth.test.ts` vérifie cet
 * alignement — deux listes qui disent la même chose à deux endroits divergent toujours,
 * sauf si un test les compare.
 */
export const ROUTES_A_AUTH_PROPRE = [
  /** Hub perso — jeton `x-hub-token`, comparé en temps constant. */
  "/hub/summary",
  /** Smartcar — signature HMAC-SHA256 du corps brut (Doc 2 §6.4). */
  "/api/webhooks/smartcar",
  /** Service courriel entrant — secret partagé, code OTP Toyota (Doc 3 §4.3). */
  "/api/webhooks/toyota-otp",
  /** Planificateur Vercel — en-tête `Authorization: Bearer CRON_SECRET` (Doc 3 §5.3). */
  "/api/cron/toyota-poll",
] as const;

/**
 * Routes accessibles SANS session utilisateur. Doit rester aligné avec le matcher du
 * middleware — les deux listes disent la même chose, à deux endroits différents.
 */
export function isPublicPath(pathname: string): boolean {
  // Routes à authentification propre. Voir l'avertissement en tête de fichier avant
  // d'ajouter quoi que ce soit à cette liste.
  if ((ROUTES_A_AUTH_PROPRE as readonly string[]).includes(pathname)) return true;

  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/_next/image") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest"
  ) {
    return true;
  }
  // Fichier avec extension (svg, png, css…) → asset public.
  const lastSegment = pathname.split("/").pop() ?? "";
  return lastSegment.includes(".");
}

/**
 * Décide du sort d'une requête. Une route publique OU authentifiée passe ; sinon 401
 * pour une route API (un client machine attend du JSON, pas une page de login) et
 * redirection vers /login pour une page.
 */
export function decideGuard(params: {
  isAuthenticated: boolean;
  pathname: string;
  search?: string;
}): GuardDecision {
  const { isAuthenticated, pathname, search = "" } = params;

  if (isPublicPath(pathname) || isAuthenticated) return { type: "next" };
  if (pathname.startsWith("/api/")) return { type: "unauthorized" };

  const callbackUrl = encodeURIComponent(pathname + search);
  return { type: "redirect", location: `/login?callbackUrl=${callbackUrl}` };
}
