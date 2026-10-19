# Rattachement de CarAI à l'Atelier

> Caduc depuis le 15/10/2026 : l'Atelier est arrêté. Le travail passe par une PR par tâche, les tests sur le robot du PC de Marc et la fusion par Mergify. Gardé comme historique.

- Chef de projet : `atelier-chef` (CarAI n'a pas de session propre dans l'agence ; `atelier-git` y travaille depuis l'Atelier, dans un worktree).
- Dernière PR : structure commune (CI + voie rapide, auto-merge = kit profil privé, CLAUDE.md court, couts.md), brouillon, relecture pole-securite.
- Prochaine étape : mesurer les minutes Actions après fusion (`node modeles/couts/compter-runs.mjs`) et remplir `docs/couts.md`.
- Branche par défaut : `main` ; auto-merge : kit `modeles/auto-merge` (profil `prive`), voir `docs/couts.md` (exceptions au gabarit).
- Décision en attente de Marc : le Poll Smartcar (`smartcar-poll.yml`, toutes les 15 minutes) n'est pas touché par cette PR.
