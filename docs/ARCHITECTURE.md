# ARCHITECTURE — CarAI

> Choix techniques réels et pourquoi, pas un plan idéal. Sources : `CLAUDE.md` (en-tête),
> `docs/claude/01-principes.md`, `docs/adr/0004-bail-en-dollars-lu-chez-financeai.md` et
> `package.json`. Rédigé le 29/09/2026 ; quand une alternative écartée n'est pas
> documentée ailleurs, ce fichier le dit plutôt que de la supposer.

## Vue d'ensemble

Suivi dans le temps du véhicule électrique de Marc (Toyota bZ XLE AWD 2026, bail),
publication de graphiques et d'un résumé au hub perso, exposition en lecture seule à
Claude par un serveur MCP. Next.js (App Router) sur Vercel · Neon (Postgres serverless) +
Drizzle ORM · Auth.js v5 (`providers: []`, la session vient du hub perso) · Zod · Vitest ·
`@modelcontextprotocol/sdk`.

## Stack et pourquoi

- **Next.js + Vercel, sans commande à taper.** Un déploiement se fait au push ; les
  migrations s'appliquent au DÉMARRAGE de l'app (`lib/migrations.ts`), jamais via un
  script `vercel-build` séparé — l'app a des tâches de fond (webhooks Smartcar, poll
  Toyota) qui doivent pouvoir réparer le schéma sans redéploiement.
- **Neon + Drizzle.** Une base unique. Trois colonnes de valeur par mesure (`value_json`
  compris) plutôt qu'une colonne par type de signal — un signal nouveau n'exige pas de
  migration de schéma. `drizzle-orm >= 0.45.2` est un plancher de sécurité jamais
  redescendu (GHSA-gpj5-g38j-94v9, injection SQL par identifiants mal échappés).
- **Auth.js v5 SANS fournisseur (`providers: []`).** CarAI ne parle plus à Google : elle
  lit le cookie de session que Hubperso pose sur `.hubperso.com` (connexion unique entre
  les apps du hub). Deux étages d'autorisation : `AUTHORIZED_EMAIL` (le propriétaire,
  vérifié SANS réseau, pour qu'une panne du hub ne l'enferme pas dehors de sa propre app)
  puis `aAccesHub` (le hub tranche pour toute autre adresse, table `acces`, gérée depuis
  `hubperso.com/administration`). `requireSession()` revérifie côté serveur, en défense en
  profondeur du middleware.
  - **Migration en cours (29/09/2026, plan `auth-asym-hubperso`)** : passage d'un cookie
    JWE chiffré à un cookie JWS signé ES256, pour qu'une satellite compromise ne puisse
    plus FORGER de session (elle n'a plus le secret qui sert à en fabriquer une). Phase 1
    (lecture des deux cookies, additive) faite côté CarAI ; Hubperso n'émet pas encore le
    nouveau cookie. Détail : `lib/sessionAsymetrique.ts`, `lib/sessionDecision.ts`.
- **Deux sources de données, jamais confondues.** Smartcar (`lib/smartcar/`) est le socle
  officiel et stable. Toyota NA (`lib/toyota/`) est non officielle, fragile, désactivée par
  défaut (`TOYOTA_NA_ENABLED`), coupée après 5 échecs consécutifs et réactivée 24 h après —
  aucune fonction cœur n'en dépend. Deux signaux ne partagent jamais un `metric_type`, et
  des sources contradictoires s'affichent TOUTES LES DEUX plutôt qu'en moyenne.
- **`@modelcontextprotocol/sdk`, en LECTURE SEULE.** Le serveur MCP (`lib/mcp/`, `mcp/`)
  n'expose aucun outil de pilotage, ne fait aucun calcul neuf, et n'expose jamais la
  position exacte du véhicule.
- **`@mokarade/hub-contract`, épinglé sur un tag.** Contrat partagé (types + schémas Zod)
  entre CarAI et le hub perso pour `GET /hub/summary`. Épinglage documenté dans
  `package.json` (`//hub-contract`) : redescendre sous une version qui manque un champ
  ferait disparaître ce champ EN SILENCE côté hub (les clés inconnues sont strippées sans
  erreur).
- **Zod.** Sert la règle « no fake data » : une unité non déclarée ne s'affiche pas, un
  coût absent reste absent plutôt que d'être deviné.

## Cadence et coût

Le poll Smartcar a DEUX déclencheurs distincts, volontairement découplés le 28/09/2026
pour préserver le quota GitHub Actions (dépôt privé, 2 000 min/mois) :
principal = service de cron externe (cron-job.org, hors dépôt, 15 min) ; filet =
`.github/workflows/smartcar-poll.yml` (GitHub Actions, 60 min, `CADENCE_FILET_GITHUB_MINUTES`
dans `lib/vehicle/cadence.ts`). Les deux vivent dans des fichiers qui ne se parlent pas :
verrouillés séparément par `tests/cadence.test.ts`. Le déploiement Vercel (quota 100/jour)
est PARTAGÉ entre six apps de l'écosystème — voir `docs/claude/06-bis-quota-deploiement.md`.

## Ce qui n'est PAS documenté ailleurs et mériterait de l'être

- Le détail des tables et de la rétention (raw vs mesures conservées à vie) vit dans
  `docs/claude/01-principes.md` et les migrations elles-mêmes (`drizzle/`), pas ici.
- Aucune alternative écartée au choix Neon/Drizzle n'est documentée : ce choix hérite du
  gabarit commun de l'écosystème (JobAI, MemoryAI, BatchChef), pas d'un arbitrage propre à
  CarAI retrouvé dans les sources consultées.
