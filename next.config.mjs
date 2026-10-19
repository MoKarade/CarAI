/**
 * En-têtes de sécurité — `[SEC-01]`, posé le 17/09/2026.
 *
 * ⚠️ CarAI n'en avait AUCUN jusqu'ici, alors qu'elle sert sur Internet la position du
 * véhicule, son kilométrage et les habitudes de charge de Marc. Hubperso, BatchChef et
 * DriveAI les portaient depuis le 31/07 ; ce dépôt était le dernier sans.
 *
 * ── CE QUI EST ENFORCÉ, ET POURQUOI C'EST SANS RISQUE ───────────────────────────────
 * Les cinq premiers ne dépendent d'aucune ressource : ils restreignent ce qu'un TIERS
 * peut faire de l'app, pas ce que l'app charge. `X-Frame-Options: DENY` interdit qu'on
 * embarque CarAI dans une iframe ; il n'a rien à voir avec l'iframe Google Maps que
 * l'app, elle, affiche — celle-là relève de `frame-src`, plus bas.
 * ⚠️ `geolocation=()` est sûr ici, et ça a été vérifié plutôt que supposé : l'app ne
 * demande JAMAIS la position du navigateur (aucun `navigator.geolocation` dans le dépôt),
 * elle lit celle de la voiture. Le jour où ça changerait, la fonctionnalité serait coupée
 * en silence — c'est le genre de ligne qu'on relit avant d'ajouter une carte « autour de
 * moi ».
 *
 * ── POURQUOI LA CSP EST EN REPORT-ONLY ──────────────────────────────────────────────
 * Parce qu'une CSP trop serrée ne casse pas bruyamment : elle coupe l'app de ses propres
 * ressources SANS que le build ni les tests ne le voient (leçon DriveAI, qui a laissé la
 * sienne en observation pour exactement cette raison). Deux dépendances externes ici, et
 * les deux sont VISIBLES :
 *   • `img-src … tile.openstreetmap.org` — les tuiles de carte sont des `<img>`
 *     (`app/ui/CarteInteractive.tsx`, `app/ui/Carte.tsx`). Sans elle, la carte devient
 *     blanche, et rien ne le dit.
 *   • `frame-src https://www.google.com` — `app/ui/CarteGoogle.tsx` embarque
 *     `maps/embed`. Sans elle, l'itinéraire disparaît.
 * `'unsafe-inline'` sur les styles et les scripts est la rançon de Next sans nonce : le
 * flux de données de l'App Router arrive dans des balises inline. L'enlever demande une
 * `middleware` qui pose un nonce à chaque requête — un lot en soi, pas une ligne.
 *
 * ➜ POUR L'ENFORCER un jour : ouvrir l'app, parcourir accueil / trajets / activité /
 * réglages / la carte, vérifier qu'aucune violation n'apparaît en console, PUIS renommer
 * la clé `Content-Security-Policy-Report-Only` en `Content-Security-Policy`. Tant que ce
 * n'est pas fait, cette ligne OBSERVE — elle ne protège pas, et le dire vaut mieux que de
 * laisser croire l'inverse.
 */
const CSP_OBSERVEE = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org",
  "frame-src https://www.google.com",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self' https://*.ingest.us.sentry.io",
  "font-src 'self'",
].join("; ");

export const EN_TETES_SECURITE = [
  // Un an, sous-domaines compris : le hub et les apps vivent tous sous hubperso.com.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_OBSERVEE },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Sans cela Next empaquette le SDK Sentry côté serveur et son chargeur de crochets échoue avec
  // « Cannot find package '@sentry/server-runtime-injection' » (constaté sur app-template).
  serverExternalPackages: ["@sentry/server-runtime-injection"],

  // Un seul réglage pour Sentry : `SENTRY_DSN` (serveur) est aussi donné au navigateur, car un DSN
  // n'est pas un secret. Vide = Sentry éteint (voir lib/sentryConfig.ts).
  env: {
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN ?? "",
  },

  async headers() {
    return [{ source: "/:chemin*", headers: EN_TETES_SECURITE }];
  },

  // Découverte OAuth du connecteur MCP : les clients (claude.ai) interrogent des chemins
  // NORMALISÉS à la racine du domaine. On les fait pointer vers un seul handler plutôt que
  // de créer un dossier `.well-known` — un dossier commençant par un point est ignoré par
  // plusieurs outils de la chaîne, et l'échec serait silencieux.
  //
  // ⚠️ La destination porte le type dans le CHEMIN (`/api/mcp/meta/as`), jamais en query :
  // une réécriture vers `?type=as` atteint le handler mais `request.url` y garde le chemin
  // d'origine, donc la query de la destination est PERDUE — 404 sur une config correcte.
  //
  // Les variantes `/:suffixe*` existent parce que la RFC 9728 autorise le client à ajouter
  // le chemin de la ressource après le préfixe (`/.well-known/oauth-protected-resource/api/mcp`).
  // Ne servir que la forme nue suffirait à faire échouer la découverte chez un client
  // rigoureux, avec pour seul symptôme « impossible d'ajouter le connecteur ».
  async rewrites() {
    return [
      { source: "/.well-known/oauth-authorization-server", destination: "/api/mcp/meta/as" },
      { source: "/.well-known/oauth-authorization-server/:suffixe*", destination: "/api/mcp/meta/as" },
      { source: "/.well-known/oauth-protected-resource", destination: "/api/mcp/meta/pr" },
      { source: "/.well-known/oauth-protected-resource/:suffixe*", destination: "/api/mcp/meta/pr" },
    ];
  },
};

export default nextConfig;
