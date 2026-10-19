<!-- Extrait de l'ancien CLAUDE.md (§ 6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

## 6. Après un merge : vérifier le DÉPLOIEMENT, pas seulement la CI

**CI verte ne veut pas dire « en ligne ».** Vécu le 31/07/2026 dans l'écosystème : quatre
projets Vercel ont cessé de créer des déploiements pendant ~3 h ; le commit d'en-têtes de
sécurité de Hubperso et BatchChef est resté **cinq jours** en attente sans que personne ne
le voie. Après un merge qui change ce qui est servi, vérifier qu'un déploiement de
production existe et qu'il est `READY`, puis contrôler l'effet sur la **réponse HTTP réelle**.

⚠️ **`READY` ne dit pas QUEL COMMIT.** Vécu le 13/08 : `carai.hubperso.com` était `READY`
en production, sans rien de rouge — et servait un commit vieux de deux PR. Un clic sur
*Redeploy* dans le tableau de bord Vercel REJOUE LE COMMIT D'ORIGINE du déploiement choisi,
jamais le HEAD actuel de `main` (`meta.action: "redeploy"` + `originalDeploymentId` dans
l'API le confirment). Toujours comparer `meta.githubCommitSha` du déploiement au HEAD réel
de `main` — jamais l'état `READY` seul. Pour faire avancer la production au bon commit sans
dashboard : un nouveau PUSH sur `main`, jamais un *Redeploy*.

⚠️ **Le quota Vercel gratuit (100 déploiements/jour) est PARTAGÉ entre les six projets de
l'écosystème, et pousser à chaque correctif le brûle.** Épuisé le 12/08 après neuf commits
en une soirée (deux déploiements chacun : preview + production) — voir `HANDOVER.md`.
Grouper les correctifs plutôt que commit-push-vérifie par bug trouvé ; la CI locale
(`npm run typecheck && lint && test && build`) donne déjà la confiance voulue avant de
pousser, sans consommer le quota. Sur un échec `api-deployments-free-per-day` : ne PAS
retenter (ça échoue à l'identique) — mais la fenêtre réelle peut être bien plus courte que
les 24 h annoncées (rouverte en 20 min le 12/08) : un signal RÉUSSI ailleurs sur le compte
(un autre projet, un *Redeploy* de quelqu'un) vaut la peine d'être vérifié avant d'attendre
pour rien.

⚠️ **« Merged » ne veut pas dire « sur `main` » — le piège des PR EMPILÉES.** Vécu le
13/08/2026. Trois PR empilées (#40 → #41 → #42, chacune ayant la précédente pour base),
mergées à **onze secondes d'intervalle**. GitHub ne re-cible une PR enfant sur `main`
qu'une fois la branche parente **supprimée** ; trop rapide, rien n'a été supprimé à temps,
et #41 comme #42 sont parties dans leur base d'origine — deux branches devenues des
culs-de-sac. Résultat : trois PR affichant « Merged », CI verte, Vercel `READY`, et la
production servant **uniquement #40**. Rien de rouge nulle part, et deux fonctionnalités
entières hors ligne.

C'est la même famille que « `READY` ne dit pas QUEL COMMIT », d'un cran plus tôt dans la
chaîne : **le statut d'une opération ne dit pas ce qui a atterri.** Vérifier une PR mergée,
c'est donc prouver que son CONTENU est sur `main` — et la commande dépend du MODE de merge.

⚠️ **`merge-base --is-ancestor` rend un FAUX NÉGATIF sur un squash-merge**, qui est le mode
que l'auto-merge de ce dépôt emploie. Un squash crée un commit **neuf** (`f0b70d1`, parent
unique) ; le SHA de la branche (`9179ecd`) n'entre JAMAIS dans l'histoire de `main`. Vécu le
14/09/2026 : « ABSENT » sur un merge parfaitement réussi, à deux doigts de faire rouvrir une
PR déjà en ligne. La commande reste juste pour un MERGE COMMIT — le cas des PR empilées
qu'elle a été écrite pour attraper, et qu'elle attrape toujours.

```bash
git ls-remote origin refs/heads/main          # le HEAD distant, pas le clone local

# Squash-merge (le défaut ici) : c'est le CONTENU qui fait foi, jamais le SHA de branche.
git show origin/main:<fichier touché> | grep -q '<un jeton que la PR vient de poser>' \
  && echo "CONTENU SUR MAIN" || echo "ABSENT"

# Merge commit (pile de PR, merge manuel « Create a merge commit ») : l'ancêtre fait foi.
git merge-base --is-ancestor <sha-de-la-PR> origin/main && echo SUR MAIN || echo ABSENT
```

Le mode se lit sur le commit lui-même : `git log --format='%h %p %s' -1 origin/main` — **un
seul parent et un titre en `… (#N)`** = squash ; **deux parents et « Merge pull request #N »**
= merge commit.

Et pour une pile : **merger une PR à la fois, en attendant que la suivante ait bien
re-ciblé `main`** (cocher « supprimer la branche » à chaque merge le déclenche). Le
rattrapage, si le mal est fait : la branche de tête contient toute la pile en ligne droite
— une fusion de cette branche vers `main` ramène tout d'un coup.

Corollaire : un merge qui ne change QUE de la doc n'a pas de déploiement à vérifier. Le dire
plutôt que de laisser croire qu'on a vérifié.
