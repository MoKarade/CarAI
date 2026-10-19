// lib/mcp/contexte.ts — ce que tout endpoint MCP partage : la config, ou un refus net.
//
// Un seul endroit décide « le connecteur est-il configuré ? ». Deux endpoints qui
// répondraient différemment à cette question (l'un 503, l'autre 500, l'autre en marchant à
// moitié) donneraient un serveur d'autorisation partiellement ouvert — la pire des formes,
// parce qu'elle a l'air de fonctionner.

import { makeOAuthProvider, lireEnvMcp, OAuthError } from "@/lib/mcp/oauth";

/** Jamais de cache : `no-store` sur TOUT ce que le MCP renvoie (jetons, métadonnées, refus). */
export const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * L'origine PUBLIQUE du serveur, lue dans la requête et jamais codée en dur.
 *
 * C'est l'`issuer` OAuth : il doit correspondre EXACTEMENT à l'hôte par lequel claude.ai est
 * arrivé, sinon la découverte échoue (l'issuer annoncé ne correspondrait pas au domaine
 * interrogé). Une préversion Vercel doit donc s'annoncer sous SON nom, pas sous celui de la
 * production — même raison qu'app/login/page.tsx.
 */
export function origineDe(request: Request): string {
  const url = new URL(request.url);
  const hote = request.headers.get("x-forwarded-host") ?? url.host;
  const protocole = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${protocole}://${hote}`;
}

export interface ContexteMcp {
  auth: ReturnType<typeof makeOAuthProvider>;
  issuer: string;
}

/**
 * Les providers sont MÉMOÏSÉS, et ce n'est pas une optimisation — c'est ce qui fait exister
 * la protection anti-rejeu.
 *
 * ⚠️ BUG TROUVÉ AU PREMIER TEST HTTP RÉEL (19/08) : le provider porte en mémoire la liste des
 * codes déjà consommés (`consumedJti`), qui rend un code d'autorisation à USAGE UNIQUE. En le
 * reconstruisant à chaque requête, cette liste repartait vide à tous les coups — donc rejouer
 * le même code émettait de NOUVEAUX jetons, indéfiniment. Mesuré : l'étape « rejouer le code »
 * a rendu 200 et un access_token. Aucun test unitaire ne pouvait le voir : ils tiennent tous
 * UN provider et exercent la garde dessus, ce qui prouve la logique et pas son câblage.
 *
 * La clé du cache inclut les secrets ET l'issuer : une rotation de `MCP_SIGNING_KEY` produit
 * donc un provider neuf (et invalide au passage tout ce qui a été émis), et deux hôtes servis
 * par la même instance ne se partagent pas un état.
 *
 * Ce que ça ne répare PAS, et il faut le savoir : en serverless chaque instance a sa propre
 * mémoire. Une instance froide repart de zéro, donc l'anti-rejeu reste « best-effort » —
 * il attrape un rejeu sur instance tiède, pas un rejeu distribué. Ce qui borne vraiment la
 * fenêtre est la durée de vie courte du code (10 min) et son lien cryptographique au couple
 * client/redirect/PKCE. Le kill-switch d'incident reste la rotation de `MCP_SIGNING_KEY`.
 */
const providers = new Map<string, ReturnType<typeof makeOAuthProvider>>();

/** `null` quand la configuration est incomplète — l'appelant répond alors 503, fermé. */
export function contexteMcp(request: Request): ContexteMcp | null {
  const env = lireEnvMcp();
  if (!env) return null;
  const issuer = origineDe(request);
  const cle = `${env.signingKey}|${env.accessKey}|${issuer}`;

  const connu = providers.get(cle);
  if (connu) return { auth: connu, issuer };

  try {
    const auth = makeOAuthProvider({
      signingKey: env.signingKey,
      accessKey: env.accessKey,
      issuer,
    });
    // Borne de sûreté : `issuer` vient d'un en-tête, donc d'une valeur qu'un client peut
    // faire varier. Sans plafond, un attaquant ferait grossir cette table indéfiniment en
    // changeant `x-forwarded-host` à chaque requête.
    if (providers.size >= 32) providers.clear();
    providers.set(cle, auth);
    return { auth, issuer };
  } catch {
    // `makeOAuthProvider` jette si une clé est trop courte. `lireEnvMcp` l'a déjà vérifié, mais
    // on ne laisse pas une exception nue sortir d'ici : le refus doit rester un 503 lisible.
    return null;
  }
}

export function reponse503(): Response {
  return Response.json(
    {
      error: "mcp_desactive",
      message:
        "Connecteur MCP désactivé : MCP_SIGNING_KEY et MCP_ACCESS_KEY ne sont pas configurées.",
    },
    { status: 503, headers: NO_STORE },
  );
}

/** Traduit une OAuthError en réponse conforme (RFC 6749 §5.2 : `error` + `error_description`). */
export function reponseErreurOAuth(err: unknown): Response {
  if (err instanceof OAuthError) {
    return Response.json(
      { error: err.code, error_description: err.message },
      { status: err.status, headers: NO_STORE },
    );
  }
  // Une erreur inattendue reste une erreur : on ne la maquille pas en refus OAuth propre,
  // qui enverrait le client réessayer indéfiniment une chose qui n'a rien à voir.
  console.error("[mcp] erreur inattendue", err);
  return Response.json(
    { error: "server_error", error_description: "Erreur interne." },
    { status: 500, headers: NO_STORE },
  );
}

/**
 * Lit un corps `application/x-www-form-urlencoded` OU `application/json`.
 * claude.ai poste du form-urlencoded (OAuth standard), mais d'autres clients envoient du JSON —
 * refuser l'un des deux produirait un « invalid_request » incompréhensible côté client.
 */
export async function lireCorps(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  const texte = await request.text();
  if (type.includes("application/json")) {
    try {
      const objet = JSON.parse(texte) as Record<string, unknown>;
      const sortie: Record<string, string> = {};
      for (const [k, v] of Object.entries(objet)) if (typeof v === "string") sortie[k] = v;
      return sortie;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(texte));
}
