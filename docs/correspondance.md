# Correspondance des anciens titres

L'ancien `CLAUDE.md` (489 lignes) a été découpé, texte inchangé, dans `docs/claude/` : le `CLAUDE.md` d'entrée fait maintenant moins de 60 lignes. Les commentaires du code qui citent « CLAUDE.md §N » se lisent dans le fichier ci-dessous.
`node .github/ci/generer-index.mjs --verifier` échoue si un chemin n'existe plus.

| ancien titre | nouveau chemin |
|---|---|
| CLAUDE.md, introduction (contexte, stack, destination) | docs/claude/00-introduction.md |
| CLAUDE.md § 1. Principes non négociables | docs/claude/01-principes.md |
| CLAUDE.md § 2. Conventions de code | docs/claude/02-conventions.md |
| CLAUDE.md § 3. Workflow git | docs/claude/03-workflow-git.md |
| CLAUDE.md § 4. Commandes utiles | docs/claude/04-commandes.md |
| CLAUDE.md § 5. Vérifications avant commit | docs/claude/05-verifications.md |
| CLAUDE.md § 6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI | docs/claude/06-deploiement.md |
| CLAUDE.md § 6 bis. Le quota de déploiement est PARTAGÉ, et il s'épuise | docs/claude/06-bis-quota-deploiement.md |
| CLAUDE.md § 7. Intégration hub | docs/claude/07-hub.md |
| CLAUDE.md § 8. Documentation (où vit quoi) | docs/claude/08-documentation.md |
| CLAUDE.md § 9. Leçons apprises | docs/LESSONS.md |
| CLAUDE.md § 10. Style et compte-rendu | docs/claude/10-style-compte-rendu.md |
| CLAUDE.md § 11. Ce qui n'a pas pu être vérifié (et où ça en est) | docs/claude/11-ce-qui-na-pas-pu-etre-verifie.md |
