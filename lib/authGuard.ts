// lib/authGuard.ts
//
// Logique de garde du middleware, isolée en fonctions PURES : testable sans mocker tout
// NextAuth, et surtout LISIBLE — c'est ici que se décide ce qui est public.
//
// ⚠️⚠️ LE PIÈGE N°1 DE CE TEMPLATE, vécu en production par JobAI (« le défaut n°1 du
// squelette du 27/07 ») : **`/hub/summary` DOIT rester public ici.** Il porte sa PROPRE
// authentification (le jeton `x-hub-token`, vérifié en temps constant dans le Route
// Handler). S'il tombe sous le garde de session utilisateur, le hub reçoit une
// REDIRECTION HTML vers la page de connexion au lieu du JSON attendu — et le widget
// affiche « injoignable » en permanence, sans que rien ne semble cassé côté app.
//
// Le symptôme est trompeur : l'app marche parfaitement dans un navigateur (tu es
// connecté), seul le hub voit le problème. Ne jamais retirer `/hub/summary` de
// `isPublicPath`, et ne jamais l'ajouter au matcher du middleware.

export type GuardDecision =
  | { type: "next" }
  | { type: "unauthorized" }
  | { type: "redirect"; location: string };

/**
 * Routes accessibles SANS session utilisateur. Doit rester aligné avec le matcher du
 * middleware — les deux listes disent la même chose, à deux endroits différents.
 */
export function isPublicPath(pathname: string): boolean {
  // Endpoint du hub : gardé par x-hub-token, PAS par la session. Voir l'avertissement
  // en tête de fichier avant de toucher à cette ligne.
  if (pathname === "/hub/summary") return true;

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
