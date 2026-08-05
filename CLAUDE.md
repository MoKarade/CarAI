# CLAUDE.md — CarAI

Suivi complet du véhicule électrique de Marc (Toyota bZ XLE AWD 2026, bail signé le
14 juillet 2026). Collecte les données du véhicule dans le temps, les rend en graphiques,
les publie au hub perso et les expose à Claude via un serveur MCP.

> Ce fichier se charge à **chaque session** — il reste court. Le détail vit dans
> `HANDOVER.md` (état courant, à lire en premier) et `BACKLOG.md`.

## Deux sources, une hiérarchie non négociable

- **Smartcar** (`lib/smartcar/`) — API officielle, socle stable. Tout ce qui compte en dépend.
- **Toyota NA** (`lib/toyota/`) — source complémentaire **non officielle**, fragile par
  nature (Toyota a déjà cassé ce type d'accès deux fois : DMCA en 2022, puis 2FA obligatoire).

⚠️ **Si Toyota tombe, CarAI continue normalement sur Smartcar seul.** Aucune fonctionnalité
cœur ne dépend du module non officiel. Il est **désactivé par défaut** (`TOYOTA_NA_ENABLED`),
s'auto-désactive après 5 échecs consécutifs, et se réactive tout seul 24 h plus tard —
une quarantaine sans chemin de retour transforme une panne passagère en perte définitive.

## Principes non négociables

- **No fake data, appliqué à la lettre.** Une unité non déclarée ⇒ on affiche la valeur
  brute, jamais un pourcentage deviné (un état de charge de 1 % affiché « 100 % » serait
  faux au moment où l'information compte le plus). Un coût d'entretien absent reste absent.
  Un dépassement de bail est chiffré en kilomètres tant que le tarif au km est inconnu.
- **Panne ≠ absence de données.** Les deux donnent un écran vide, mais l'une veut dire
  « le véhicule n'a rien envoyé » et l'autre « CarAI est cassé ». Le summary publie `error`
  dans le second cas, jamais `building`.
- **Une mesure porte TOUJOURS sa source et son `recordedAt`** (instant de la mesure côté
  véhicule, pas de la réception). La fraîcheur réelle est de 30-60 min : sans horodatage,
  l'affichage laisserait croire au temps réel.
- **Deux sources qui se contredisent sont montrées toutes les deux.** Jamais de moyenne,
  jamais d'arbitrage silencieux — 46 % entre 45 et 47 est un chiffre que le véhicule n'a
  jamais affiché.
- **App privée, échec fermé.** Login Google mono-adresse, middleware fail-closed,
  `requireSession()` revérifié côté serveur. Jamais de secret en base ni côté client.
- **Aucune commande à taper.** Migrations appliquées au démarrage (`lib/migrations.ts`).

## Les routes hors middleware, et pourquoi

`ROUTES_A_AUTH_PROPRE` (`lib/authGuard.ts`) énumère **une par une** les routes appelées par
des machines : `/hub/summary`, les deux webhooks, le cron. Chacune porte sa propre auth.

⚠️ **Jamais un préfixe de dossier.** Une nouvelle route non déclarée tombe derrière le garde
par défaut — le mauvais côté de l'oubli doit être le côté sûr. Verrouillé par
`tests/auth.test.ts`, qui compare aussi la liste au matcher du middleware.

⚠️ Pour Smartcar l'enjeu est concret : une route qui répond 302 ou 503 compte comme un
**échec de livraison**, et six échecs suffisent à ce que Smartcar **désactive le webhook**.
Le flux s'arrête alors en silence. C'est pour ça que `webhook_deliveries` existe et que le
summary alerte au-delà de 6 h sans livraison.

## La déduplication est structurelle, pas un détail

Smartcar livre **tous** les signaux souscrits à chaque événement, alors que le véhicule ne
se rafraîchit qu'aux 30-60 min. L'index unique `(source, metric_type, recorded_at)` fait
qu'une mesure est identifiée par l'instant où le *véhicule* l'a produite : une re-livraison
ne crée rien. C'est aussi ce qui rend l'ingestion idempotente sans faire confiance à un
identifiant d'événement. Corollaire assumé : quand une source ne date pas ses mesures,
`recorded_at` retombe sur la réception et la dédup ne joue plus — mieux vaut des doublons
visibles qu'une fraîcheur inventée.

## Ce qui n'a pas pu être vérifié (à faire quand le réseau le permet)

Deux blocages de la session de création, tous deux **documentés dans le code concerné** :

1. **`smartcar.com` est filtré par la politique d'egress** → les noms exacts des signaux V3
   n'ont pas pu être confirmés (seuls `tractionbattery-stateofcharge` et
   `odometer-traveleddistance` le sont). D'où le mapping à trois niveaux de
   `lib/smartcar/signals.ts` — code exact, puis groupe, puis code brut — qui ne jette
   **aucune** donnée même quand un nom est mal deviné. Corriger la table quand la doc est
   lisible ne fait perdre aucun historique (`signal_code` garde toujours le code d'origine).
2. **`toyota-na` est une bibliothèque Python inaccessible** → l'adaptateur réseau Toyota
   (`lib/toyota/client.ts`) est **déclaré, pas deviné**. Des URLs plausibles auraient produit
   du code qui compile et échoue au premier appel, en faisant croire à un changement d'API
   côté Toyota. La marche à suivre pour le brancher est dans l'en-tête du fichier.

## Vérifications avant commit

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

*(`lint` = ESLint CLI : `next lint` est déprécié et retiré dans Next 16. Le bloc `ignores`
de `eslint.config.mjs` est indispensable.)* La CI rejoue ce gate, plus un job `audit`
séparé — un avis de sécurité paraît sans qu'une ligne n'ait changé, et mêlé au gate il
peindrait un dépôt sain en rouge jusqu'à ce qu'on prenne l'habitude du rouge.

## Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

**CI verte ne veut pas dire « en ligne ».** Vécu le 31/07/2026 dans l'écosystème : quatre
projets Vercel ont cessé de créer des déploiements pendant ~3 h ; le commit d'en-têtes de
sécurité de Hubperso et BatchChef est resté **cinq jours** en attente sans que personne ne
le voie. Après un merge qui change ce qui est servi, vérifier qu'un déploiement de
production existe et qu'il est `READY`, puis contrôler l'effet sur la **réponse HTTP réelle**.

## Style (hérité du CLAUDE.md global de Marc)

- Réponses, commits et docs **en français** (`feat:`, `fix:`, `docs:`…). Pas d'emojis.
- TypeScript strict, pas de `any` silencieux. Erreurs honnêtes, jamais avalées.
- Logique métier en **fonctions pures**, hors des I/O — c'est ce qui rend le reste testable.
- Ne pas imposer le dark mode : `prefers-color-scheme` décide.
- **Planchers de version, jamais redescendus** : `drizzle-orm ≥ 0.45.2`
  (GHSA-gpj5-g38j-94v9, injection SQL, HIGH), documenté dans `package.json`.
