# Coûts — CarAI

Dépôt privé, GitHub Free : 2 000 minutes d'Actions par mois (épuisées le 23/09/2026). Chiffres MESURÉS seulement ; un chiffre non mesuré s'écrit « à mesurer ». Modèle : `modeles/couts/couts.md` de l'Atelier.

## Minutes GitHub Actions
Mesure : `node modeles/couts/compter-runs.mjs MoKarade/CarAI 2026-09` (runs par workflow, lecture seule). Relevé du 26/09/2026 (avant cette PR ; la liste est limitée à 1 000 runs récents : le mois peut être incomplet, et la durée de calendrier compte l'attente d'un runner, ce n'est pas la facturation) :

| Workflow | Déclencheurs | Runs en 09/2026 (mesuré) | Minutes (calendrier) | Rôle |
|---|---|---|---|---|
| Auto-merge | workflow_run 224, schedule 160, status 37, pull_request_target 17 | 438 (36 échoués) | ~132 | Fusion automatique. Les 160 `schedule` viennent de l'ancien cron `*/30`, remplacé par un passage quotidien le 23/09. |
| Poll Smartcar | schedule 166 | 166 (4 échoués) | ~27 | Collecte du véhicule. NON touché (décision de Marc en attente). |
| CI | pull_request 77, push 13, schedule 3 | 93 (15 échoués, 2 annulés) | ~206 | Gate, audit, qualité, sécurité. |
| Dependabot Updates | dynamique 19 | 19 | ~31 | Mises à jour. |

Attendu de cette PR : le push ne tourne plus que sur `main` ; les PR de docs seules ne lancent plus install, tests ni build (voie rapide) ; les runs périmés d'une PR sont annulés (concurrency). Le chiffre réel : à mesurer après fusion.
Règle : ajouter ou accélérer un cron = mettre ce tableau à jour dans la même PR, avec le coût.

## Crons autorisés
- `auto-merge.yml` : une fois par jour (`23 9 * * *`), sortie immédiate s'il n'y a aucune PR ouverte. La spec autorise au plus un passage toutes les 6 h ; on ne monte pas (chaque passage coûte au moins une minute).
- `ci.yml` : audit hebdomadaire (`17 12 * * 1`).
- `smartcar-poll.yml` : `*/15 * * * *` (collecte fonctionnelle). NON modifié par cette PR : décision de Marc en attente.
- `toyota-poll.yml` : lancement manuel seulement (cron en commentaire).

## Quota Claude
- Taille du CLAUDE.md : 36 lignes, 3,5 Ko (plafond 60 lignes, 10 Ko), contre 489 lignes et 34 Ko avant (le détail est dans `docs/claude/`). Chaque session le charge : économie directe de quota.

## Appels IA
- Aucun appel d'API payante identifié par cette PR : à mesurer.

## Autres
- Vercel : `ignoreCommand` DÉJÀ présent (`scripts/build-necessaire.sh`, protégé par `tests/docVercel.test.ts`) : conservé, le modèle `ignore-command.mjs` n'est pas ajouté. Quota de déploiement partagé : `docs/claude/06-bis-quota-deploiement.md`.

## Exceptions au gabarit
| Quoi | Raison | Condition de retour |
|---|---|---|
| Auto-merge : kit `modeles/auto-merge` en profil `prive` (dépôt PRIVÉ, vérifié par `gh repo view`), SANS `armement-auto-merge.yml` | Pas d'auto-fusion native en dépôt privé Free : `fusionner.mjs` fusionne (SHA verrouillé, chemins, appId) ; `COPIES.md` atteste la fidélité des copies | Dépôt public ou protection de branche : profil `complet` |
| Pas de neutralisation du quota Vercel : un échec de quota Vercel BLOQUE la fusion | Décision de Marc du 26/09/2026 ; l'ancien `scripts/autoMerge.mjs` neutralisait ce cas, le kit non ; le Gate (qui contient le build) reste le juge du code | Décision de Marc (lot dédié, conditions strictes de pole-securite) |
| `pull_request_target` (ready_for_review) retiré de l'auto-merge | Condition de pole-securite pour les PR d'adoption ; une PR sortie du brouillon est vue au prochain `status`/`check_run` ou au rattrapage quotidien | Si des PR restent ouvertes après « prête à relire » |
| `securite_login` absent de `.github/auto-merge.json` | Le compte d'attestation (GitHub App) n'est pas encore dans le kit : sans lui aucun chemin sensible ne peut être attesté (donc jamais auto-fusionné : sûr) | PR de configuration après la fusion du lot « App de sécurité » |
| Cron auto-merge quotidien et non toutes les 6 h | Déjà au-dessous du plafond de la spec | Si un événement manqué devient fréquent |
| `ci.yml` garde ses jobs `gate`, `audit`, `qualite`, `securite` (pas le workflow réutilisable `ci / portes`) | Renommer le check requis casserait la fusion automatique | Une PR dédiée qui migre les noms de checks et `auto-merge` ensemble |
| `securite` (gitleaks, Semgrep) jamais sauté par la voie rapide | Un secret peut se cacher dans un document | aucune |
| `ignoreCommand` existant (`build-necessaire.sh`) au lieu du modèle Vercel | Déjà en place et testé (`docVercel.test.ts`) | Si le modèle gagne une couverture équivalente |
