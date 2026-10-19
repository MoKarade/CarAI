// app/api/mcp/route.ts — le connecteur MCP de CarAI (demande de Marc, 19/08/2026).
//
// ⚠️ Route HORS du middleware d'authentification utilisateur (`ROUTES_A_AUTH_PROPRE`) :
// un client MCP n'a pas de session Google. Elle porte donc SA PROPRE auth.
//
// DEUX FAÇONS DE S'AUTHENTIFIER, et l'histoire de pourquoi il y en a deux :
//
//   1. OAuth 2.1 (`lib/mcp/oauth.ts`) — le chemin de claude.ai, et le seul qu'il sache
//      prendre. Le jeton porte le préfixe `ca1.` et voyage en en-tête `Authorization`.
//   2. Jeton statique `MCP_TOKEN` en EN-TÊTE — pour un client qui pilote lui-même ses
//      en-têtes (Claude Code, curl, un script). Optionnel : si la variable est absente,
//      ce chemin n'existe simplement pas.
//
// ⚠️ CORRECTION D'UNE ERREUR (même journée) : on avait d'abord accepté le jeton dans
// l'URL (`?jeton=`), en croyant que l'écran « connecteur personnalisé » de claude.ai ne
// pouvait rien envoyer d'autre qu'une URL. C'était FAUX — cet écran n'offre QUE OAuth, et
// claude.ai découvre les endpoints tout seul à partir du `WWW-Authenticate` du 401
// ci-dessous. Le jeton d'URL ne servait donc à rien tout en exposant un secret dans les
// journaux de requêtes de l'hébergeur : il est RETIRÉ. La leçon générale : avant de
// contourner la limite d'un outil, vérifier qu'elle existe — DriveAI faisait déjà l'inverse
// dans le même écosystème.
//
// L'ordre des refus est délibéré, et chacun dit une chose différente :
//   • aucune auth configurée → 503 « connecteur désactivé » (une configuration, pas une panne)
//   • jeton absent ou faux   → 401 + `WWW-Authenticate` (c'est lui qui amorce la découverte)
//   • méthode ≠ POST         → 405
//
// ⚠️ LECTURE SEULE, et c'est structurel : les outils vivent dans `lib/mcp/outils.ts`, qui
// n'importe aucune fonction de commande. Un test refuse tout outil dont le nom ressemble
// à un pilotage. Donner à Claude les infos de la voiture ne doit pas, au passage, lui
// donner les clés.
//
// ⚠️ `no-store` systématique : un état de véhicule est un instantané, jamais une page à
// mettre en cache.

import { createHash, timingSafeEqual } from "node:crypto";
import { baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { traiterMessage, type MessageJsonRpc } from "@/lib/mcp/protocole";
import { contexteMcp } from "@/lib/mcp/contexte";
import { OAuthError } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Comparaison en temps constant, via digests de longueur fixe (patron de `hubToken`). */
function jetonValide(fourni: string | null, attendu: string): boolean {
  if (!fourni) return false;
  const a = createHash("sha256").update(fourni).digest();
  const b = createHash("sha256").update(attendu).digest();
  return timingSafeEqual(a, b);
}

/**
 * Le jeton statique présenté en EN-TÊTE. Jamais l'URL — voir l'en-tête du fichier.
 *
 * Deux formes parce que les clients diffèrent : `Authorization: Bearer` est le standard,
 * `x-mcp-token` existe pour un client qui réserve `Authorization` à autre chose.
 */
function jetonStatique(request: Request): string | null {
  const autorisation = request.headers.get("authorization");
  if (autorisation?.toLowerCase().startsWith("bearer ")) return autorisation.slice(7).trim();
  return request.headers.get("x-mcp-token");
}

/**
 * Le 401 qui AMORCE le flux OAuth.
 *
 * `WWW-Authenticate` avec `resource_metadata` (RFC 9728) est ce que claude.ai lit pour
 * savoir où trouver la page d'autorisation. Sans cet en-tête, il ne peut pas deviner, et
 * l'ajout du connecteur échoue sans rien indiquer de ce qu'il faudrait configurer — le
 * refus doit ENSEIGNER, pas seulement fermer la porte.
 */
function refus401(urlMetadonnees: string | null): Response {
  const entetes: Record<string, string> = { ...NO_STORE };
  if (urlMetadonnees) {
    entetes["WWW-Authenticate"] =
      `Bearer realm="CarAI", resource_metadata="${urlMetadonnees}"`;
  }
  return Response.json({ error: "non_autorise" }, { status: 401, headers: entetes });
}

export async function POST(request: Request): Promise<Response> {
  const ctx = contexteMcp(request);
  const statique = process.env.MCP_TOKEN?.trim();

  // Aucun des deux chemins n'est configuré : le connecteur n'existe pas. 503, pas 401 —
  // « pas installé » et « tu n'as pas le droit » appellent deux gestes différents.
  if (!ctx && !statique) {
    return Response.json(
      {
        error: "mcp_desactive",
        message:
          "Connecteur MCP désactivé : ni MCP_SIGNING_KEY/MCP_ACCESS_KEY ni MCP_TOKEN ne sont configurés.",
      },
      { status: 503, headers: NO_STORE },
    );
  }

  const urlMetadonnees = ctx?.auth.resourceMetadataUrl() ?? null;
  const presente = jetonStatique(request);

  // OAuth d'abord, reconnu au préfixe du jeton. Sans ce préfixe on ne saurait pas quelle
  // vérification appliquer, et « essayer les deux » ferait fuir par le message d'erreur
  // laquelle a échoué.
  let autorise = false;
  if (ctx && presente?.startsWith("ca1.")) {
    try {
      ctx.auth.verifyAccessToken(`Bearer ${presente}`);
      autorise = true;
    } catch (err) {
      if (!(err instanceof OAuthError)) throw err;
      return refus401(urlMetadonnees);
    }
  } else if (statique && jetonValide(presente, statique)) {
    autorise = true;
  }

  if (!autorise) return refus401(urlMetadonnees);

  if (!baseConfiguree()) {
    return Response.json(
      { error: "base_absente", message: "DATABASE_URL n'est pas configuré." },
      { status: 503, headers: NO_STORE },
    );
  }

  let charge: unknown;
  try {
    charge = await request.json();
  } catch {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON illisible." } },
      { status: 400, headers: NO_STORE },
    );
  }

  await assurerMigrations();

  // Un client peut envoyer un LOT (tableau JSON-RPC). Les notifications n'y produisent
  // aucune réponse — un lot entièrement fait de notifications se répond par 202 sans
  // corps, comme la spec le demande.
  if (Array.isArray(charge)) {
    const reponses = (
      await Promise.all((charge as MessageJsonRpc[]).map((m) => traiterMessage(m)))
    ).filter((r) => r !== null);
    if (reponses.length === 0) return new Response(null, { status: 202, headers: NO_STORE });
    return Response.json(reponses, { headers: NO_STORE });
  }

  const reponse = await traiterMessage((charge ?? {}) as MessageJsonRpc);
  if (reponse === null) return new Response(null, { status: 202, headers: NO_STORE });
  return Response.json(reponse, { headers: NO_STORE });
}

/**
 * Un GET ne sert à rien ici, et le dire vaut mieux qu'un 404 qui ressemble à une faute
 * d'URL. Il porte aussi `configure` — le seul moyen de VÉRIFIER un déploiement.
 *
 * POURQUOI CE CHAMP EXISTE
 * `MCP_TOKEN` ne prend effet qu'au déploiement SUIVANT celui où on la pose. Sans ce
 * champ, la seule façon de savoir si le build servi la voit est d'envoyer un POST et de
 * lire 503 contre 401 — ce qui suppose un client capable de POSTer vers le domaine. On
 * se retrouvait à AFFIRMER « c'est déployé » sur la foi d'un statut de build, exactement
 * ce que l'app s'interdit ailleurs (« vert » ne veut pas dire « en ligne »). Un GET, lui,
 * se fait depuis un navigateur, une barre d'adresse, n'importe quoi.
 *
 * CE QUE ÇA DIVULGUE : rien de neuf. Un POST sans jeton distingue DÉJÀ 503 de 401 pour
 * qui que ce soit ; ce booléen dit la même chose par un autre verbe. La VALEUR, elle,
 * ne sort jamais — et un `true` ne rapproche personne de la deviner.
 */
export async function GET(request: Request): Promise<Response> {
  return Response.json(
    {
      error: "methode_non_autorisee",
      message: "Le connecteur MCP de CarAI parle JSON-RPC en POST.",
      /** Une authentification est-elle configurée dans le code SERVI ? Un booléen, jamais
       *  une valeur — et il couvre les DEUX chemins, sinon il mentirait dès qu'on n'utilise
       *  que l'un des deux. */
      configure: Boolean(contexteMcp(request)) || Boolean(process.env.MCP_TOKEN?.trim()),
      /** Le flux OAuth (celui de claude.ai) est-il utilisable ? C'est la question que Marc
       *  se pose vraiment quand le connecteur refuse de s'ajouter. */
      oauth: Boolean(contexteMcp(request)),
    },
    { status: 405, headers: { ...NO_STORE, Allow: "POST" } },
  );
}
