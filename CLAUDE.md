# CLAUDE.md — CarAI

<!-- Court exprès (60 lignes, 10 Ko, verrou `.github/ci/verifier-longueur.mjs`). Le texte complet de l'ancien fichier est dans docs/claude/ ; « CLAUDE.md §N » dans le code = docs/claude/NN-*.md. -->

## Contexte
- Suivi complet du véhicule électrique de Marc (Toyota bZ XLE AWD 2026) : collecte dans le temps, graphiques, publication au hub, exposition à Claude par un serveur MCP.
- Sources : **Smartcar** (`lib/smartcar/`, officielle, socle stable) et **Toyota NA** (`lib/toyota/`, non officielle, fragile, jamais le socle).
- Stack : Next.js 16 · Neon + Drizzle · Auth.js v5 (`providers: []`, la session vient du hub) · Zod · Vitest · SDK MCP.
- Déploiement : `carai.hubperso.com` (Vercel), dépôt privé, branche par défaut `main`. Marc valide, il ne code pas.
- État : `HANDOVER.md` (à lire en premier) ; plan : `BACKLOG.md` ; décisions : `docs/adr/`.

## Commandes standard
- `npm run dev` : serveur local. `npm run build` : compilation de production.
- `npm run typecheck` : types. `npm run lint` : règles de style. `npm run test` : tests (vitest).
- `npm run portes` : portes qualité du dépôt (`qualite/portes.mjs`, cliquet : rien ne recule). Rien n'est fini tant qu'une porte est rouge.

## Règles propres à CarAI (détail : `docs/claude/01-principes.md`)
- **No fake data, à la lettre** : unité non déclarée = on n'affiche pas ; une mesure porte TOUJOURS sa source et son `recordedAt`.
- **Aucune donnée perso dans un fichier versionné** (décision du 15/10/2026) : coordonnées, adresses, montants, relevés réels = données FICTIVES. Verrou : `tests/donneesPerso.test.ts`.
- **Panne ≠ absence de données** ; deux sources qui se contredisent sont montrées toutes les deux, jamais de moyenne.
- **App privée, échec fermé** : middleware fail-closed, `requireSession()` revérifié côté serveur ; connexion ET autorisation viennent du hub.
- **Aucune commande à taper** : migrations appliquées au démarrage (`lib/migrations.ts`).
- **Le quota de déploiement Vercel est PARTAGÉ** entre les six apps (`docs/claude/06-bis-quota-deploiement.md`) ; le build est sauté par `scripts/build-necessaire.sh` (`ignoreCommand`).
- **Ne jamais remettre un bloc `crons` dans `vercel.json`** (plan Hobby) ; le poll Toyota ne passe pas par Vercel (`docs/LESSONS.md`).
- Après un merge : vérifier le **déploiement**, pas seulement la CI (`docs/claude/06-deploiement.md`). Secrets : jamais dans le code ni un `.env` versionné.

## Git et CI
- Branches `claude/<slug>` (automatisé) ou `feature/<slug>` ; `git fetch origin main` AVANT de committer ; jamais `--force` sur `main`, jamais `--no-verify`.
- PR en brouillon pour itérer ; Mergify (configuration ajoutée le 15/10/2026) fusionne en squash une PR sortie du brouillon quand tous les contrôles sont verts. Une PR qui touche `.github/`, `scripts/hooks/`, `qualite/`, `vercel.json`, `drizzle/` ou `.env*` est fusionnée aussi quand le contrôle « Garde-fou » est vert (oui de Marc, 15/10/2026) ; rouge (test retiré ou sauté, seuil baissé, secret, migration destructive, `.mergify.yml` ou garde-fou modifié), elle attend Marc (issue `qui:marc`). `--base main` explicite.
- Un check requis n'a JAMAIS de `paths:` ; la CI a une voie rapide pour les PR de docs seules (`.github/ci/`), qui ne saute jamais les tests lisant des docs.
- Commits en français, préfixés (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`). Code et commentaires en français.

## Pour aller plus loin (à lire seulement si nécessaire)
- Index généré : `docs/INDEX.md` ; anciens titres -> chemins : `docs/correspondance.md`.
- Sections de l'ancien fichier : `docs/claude/` (`01-principes`, `02-conventions`, `03-workflow-git`, `04-commandes`, `05-verifications`, `06-deploiement`,
  `06-bis-quota-deploiement`, `07-hub`, `08-documentation`, `10-style-compte-rendu`, `11-ce-qui-na-pas-pu-etre-verifie`). Leçons apprises : `docs/LESSONS.md`.
- Architecture (choix techniques réels et pourquoi) : `docs/ARCHITECTURE.md`. Photographie de l'état courant : `docs/ETAT.md`.
- Coûts (minutes Actions, quota, appels IA) : `docs/couts.md`. Rattachement : `docs/rattachement.md`.
- Graphe de code (hooks et MCP `graphify` posés, 0 jeton ; `scripts/graphe.sh query|affected|path|explain` avant de grepper ; wiki : `graphify-out/wiki/index.md`) : `docs/claude/12-graphe-code.md`.

## CI (dépôt privé)
Les jobs déclenchés par une PR choisissent leur machine selon la visibilité du dépôt : privé, robot de tests du PC de Marc (`[self-hosted, pc-marc]`) ; public, machines GitHub (gratuites). Un robot du PC ne doit jamais servir une PR d'un dépôt public. `smartcar-poll.yml` (planifié) reste sur le PC.

## Compte-rendu
Règles de forme : instructions du projet « Apps ». Copie lisible à la demande dans `docs/COMPTE-RENDU.md` (non chargée à chaque session ; sa synchro reste vérifiée par la CI).
