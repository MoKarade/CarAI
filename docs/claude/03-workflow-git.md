<!-- Extrait de l'ancien CLAUDE.md (§ 3. Workflow git), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Workflow git

## 3. Workflow git

- Branches `claude/<slug>` pour le travail automatisé, `feature/<slug>` pour Marc.
- Commits en français, préfixés (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- **PR en draft** pour itérer.
- ❌ Jamais `--force` sur `main`. ❌ Jamais `--no-verify`.
- ⚠️ **`git fetch origin main` AVANT de committer.** Plusieurs sessions travaillent en
  parallèle sur l'écosystème ; le 20/08/2026, deux d'entre elles ont produit la même
  correction, mot pour mot, dans la même heure.
