// app/api/mcp/authorize/route.ts — la page qui demande la clé d'accès.
//
// C'est le seul écran du flux que Marc voit : claude.ai l'ouvre tout seul après avoir
// découvert les endpoints. GET affiche le formulaire (paramètres OAuth validés PUIS rejoués
// en champs cachés, échappés) ; POST vérifie la clé en temps constant et redirige vers
// claude.ai avec le code signé.
//
// ⚠️ Le limiteur d'échecs ci-dessous est un FILET FAIBLE en serverless, et le dire fait
// partie du garde-fou : l'hébergeur lance une instance par requête, donc un pilonnage
// PARALLÈLE voit N compteurs à zéro. Il sert à (a) freiner un pilonnage sériel sur une
// instance tiède, (b) TRACER chaque échec dans les journaux. La VRAIE barrière est
// l'ENTROPIE de `MCP_ACCESS_KEY` — d'où le générateur aléatoire de l'écran Réglages, et le
// refus d'accepter une clé de moins de 16 caractères.

import { contexteMcp, reponse503, reponseErreurOAuth, lireCorps, NO_STORE } from "@/lib/mcp/contexte";
import { OAuthError, makeAttemptLimiter } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

const limiteur = makeAttemptLimiter();

const CHAMPS_REJOUES = [
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
  "response_type",
] as const;

function echapperHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Page autonome : elle vit hors du layout de l'app (c'est une route d'API, pas une page
 * Next) et n'a donc pas accès à `globals.css`. Les deux thèmes suivent
 * `prefers-color-scheme` — CarAI n'impose pas le sombre, ici comme ailleurs.
 */
function pageFormulaire(q: Record<string, string>, erreur?: string): string {
  const caches = CHAMPS_REJOUES.map(
    (k) => `<input type="hidden" name="${k}" value="${echapperHtml(q[k] ?? "")}">`,
  ).join("\n");

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">
<title>CarAI — autoriser Claude</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--fond:#f6f6f7;--carte:#fff;--texte:#1b1b1f;--doux:#5f6168;--bord:#d8d9de;--accent:#1a56c4;--sur-accent:#fff;--err:#b3261e}
@media (prefers-color-scheme:dark){:root{--fond:#111114;--carte:#1c1c20;--texte:#ecedf0;--doux:#a2a4ac;--bord:#3a3b42;--accent:#9cc0ff;--sur-accent:#10131a;--err:#f2b8b5}}
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:var(--fond);color:var(--texte);display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem}
form{background:var(--carte);border:1px solid var(--bord);padding:1.8rem;border-radius:14px;max-width:23rem;width:100%}
h1{font-size:1.05rem;margin:0 0 .6rem}
p{color:var(--doux);font-size:.85rem;line-height:1.45;margin:.4rem 0}
label{display:block;font-size:.85rem;font-weight:600;margin-top:1rem}
input[type=password]{width:100%;padding:.6rem;margin-top:.35rem;border-radius:8px;border:1px solid var(--bord);background:var(--fond);color:var(--texte);font:inherit}
button{width:100%;margin-top:1.1rem;padding:.65rem;border:none;border-radius:8px;background:var(--accent);color:var(--sur-accent);font:inherit;font-weight:600;cursor:pointer}
.err{color:var(--err);font-weight:600}
</style></head><body>
<form method="POST" action="/api/mcp/authorize">
<h1>Autoriser Claude à lire CarAI</h1>
<p>Claude pourra consulter l’état du véhicule, les trajets, les recharges et le bail.
Il ne peut rien commander : les outils sont en lecture seule.</p>
${erreur ? `<p class="err">${echapperHtml(erreur)}</p>` : ""}
${caches}
<label for="access_key">Clé d’accès</label>
<input id="access_key" type="password" name="access_key" autofocus autocomplete="current-password"
 placeholder="MCP_ACCESS_KEY">
<button type="submit">Autoriser</button>
</form></body></html>`;
}

function reponseHtml(code: number, html: string, entetes: Record<string, string> = {}): Response {
  return new Response(html, {
    status: code,
    headers: { "Content-Type": "text/html; charset=utf-8", ...NO_STORE, ...entetes },
  });
}

export async function GET(request: Request): Promise<Response> {
  const ctx = contexteMcp(request);
  if (!ctx) return reponse503();

  const q = Object.fromEntries(new URL(request.url).searchParams);
  try {
    // Valider AVANT d'afficher : un formulaire rempli puis refusé pour un paramètre absent
    // ferait ressaisir la clé pour rien, et l'erreur n'aurait aucun rapport avec elle.
    ctx.auth.validateAuthorizeRequest(q);
  } catch (err) {
    return reponseErreurOAuth(err);
  }
  return reponseHtml(200, pageFormulaire(q));
}

export async function POST(request: Request): Promise<Response> {
  const ctx = contexteMcp(request);
  if (!ctx) return reponse503();

  const form = await lireCorps(request);
  try {
    ctx.auth.validateAuthorizeRequest(form);
  } catch (err) {
    return reponseErreurOAuth(err);
  }

  // Plafond AVANT toute comparaison : la clé d'accès est la seule porte devinable du système.
  if (limiteur.isBlocked()) {
    const attente = limiteur.retryAfterSeconds();
    console.error(
      `[CarAI MCP] /api/mcp/authorize BLOQUÉ : quota d'échecs épuisé, réessai dans ${attente} s. ` +
        "Si ce n'est pas toi, fais tourner MCP_SIGNING_KEY (elle invalide tous les jetons émis).",
    );
    return reponseHtml(
      429,
      pageFormulaire(form, `Trop de tentatives. Réessaie dans ${Math.ceil(attente / 60)} minute(s).`),
      { "Retry-After": String(attente) },
    );
  }

  let code: string;
  try {
    code = ctx.auth.authorize({
      clientId: form.client_id ?? "",
      redirectUri: form.redirect_uri ?? "",
      codeChallenge: form.code_challenge ?? "",
      accessKey: form.access_key ?? "",
    });
  } catch (err) {
    if (err instanceof OAuthError && err.code === "access_denied") {
      limiteur.recordFailure();
      // Tracé à CHAQUE échec, pas seulement au blocage : un pilonnage se lit à la répétition.
      console.error("[CarAI MCP] /api/mcp/authorize : clé d'accès REFUSÉE.");
      return reponseHtml(403, pageFormulaire(form, "Clé d’accès invalide — réessaie."));
    }
    return reponseErreurOAuth(err);
  }

  // Succès : l'historique d'échecs est effacé. L'usage légitime ne consomme aucun quota —
  // sinon Marc finirait bloqué par ses propres reconnexions.
  limiteur.reset();

  const cible = new URL(form.redirect_uri ?? "");
  cible.searchParams.set("code", code);
  if (form.state) cible.searchParams.set("state", form.state);
  return new Response(null, {
    status: 302,
    headers: { Location: cible.toString(), ...NO_STORE },
  });
}
