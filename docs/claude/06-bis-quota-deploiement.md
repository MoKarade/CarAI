<!-- Extrait de l'ancien CLAUDE.md (§ 6 bis. ⚠️ Le quota de déploiement est PARTAGÉ, et il s'épuise), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# bis. ⚠️ Le quota de déploiement est PARTAGÉ, et il s'épuise

## 6 bis. ⚠️ Le quota de déploiement est PARTAGÉ, et il s'épuise

Vercel plafonne le plan gratuit à **100 déploiements par jour**, **pour tout le compte** —
donc partagés entre CarAI, hubperso, BatchChef, DriveAI, JobAI et FinanceAI.

⚠️ **Sur CarAI, une PR `claude/**` ne consomme qu'UN déploiement, celui du merge** :
`vercel.json` porte `deploymentEnabled: { "claude/*": false }` depuis le 21/08. Le 16/10
(CarAI#216) la liste s'est allongée à `mergify/**` (les brouillons de la file de fusion, qui
créaient chacun une préversion pour rien), `dependabot/**` et `feature/**` : **seule `main`
déploie**. ⚠️ C'est une liste FERMÉE de préfixes, pas « tout sauf main » : une branche d'un
préfixe nouveau déploierait encore, et c'est à ajouter ici. C'est une économie voulue, mais elle a une conséquence qui ne se devine pas et qui a coûté un
aller-retour avec Marc le 14/09 — **il n'existe AUCUNE URL de prévisualisation pour une PR
ouverte par une session Claude**. Lui demander de « regarder le rendu avant qu'on fusionne »
est donc un cul-de-sac : le seul endroit où il peut voir le résultat est la production. Une
PR d'interface se fusionne pour être vue, ou bien on autorise explicitement sa branche.

Vécu le 20/08 : dix PR dans la journée sur ce seul dépôt ont épuisé le quota du compte.
Le merge suivant a été mergé, gate vert, et **aucun déploiement n'a été créé** — ni erreur
rouge sur le dépôt, ni changement en ligne. `main` avançait, le site servait l'ancien build.

Ce qui en découle :

- **Grouper.** Un correctif qui n'est pas vérifiable tout de suite attend le suivant. On ne
  pousse pas par réflexe après chaque changement.
- **Ne pas construire pour rien.** Une PR qui ne touche que `docs/`, `HANDOVER.md` ou des
  tests ne change RIEN de ce que le site sert. CarAI saute ces builds via un `ignoreCommand`
  (`scripts/build-necessaire.sh`) dans `vercel.json`, **posé le 21/08** — cette ligne disait
  « CarAI ne l'a pas encore » et elle est restée fausse trois semaines. ⚠️ Sa convention est
  contre-intuitive — **exit 0 IGNORE le build, exit 1 le LANCE** — et l'inverser ne
  produirait pas « un déploiement de trop » : ça les supprimerait TOUS, en silence, CI verte.
  ⚠️⚠️ **Un build sauté apparaît `CANCELED` dans Vercel**, exactement comme une annulation.
  Les deux se départagent en REJOUANT le script sur le commit
  (`bash scripts/build-necessaire.sh <sha>~1 <sha>`), jamais en lisant l'état. Mesuré le
  14/09 sur `dd6ca65` : « build ignoré : documentation et tests uniquement » — donc un saut
  voulu, et non la panne de déploiement que j'ai cru y lire pendant une demi-journée.
- **Quand le quota est épuisé, « Redeploy » est un piège.** Il rejoue le commit du
  déploiement existant, PAS le dernier — on redéploie l'ancien code en croyant l'inverse.
  Le seul geste fiable est un nouveau push, puis comparer le SHA servi au SHA attendu.

### Changer une variable d'environnement : « Redeploy » est annulé, un commit construit

Constaté le 19/10/2026. Un changement de variable dans Vercel ne change AUCUN fichier. Le
« Redeploy » du tableau de bord rejoue le même commit, dont la plage depuis le dernier build
réussi ne contient que des tests ou de la doc : le script répond « build ignoré » et Vercel
annule (`CANCELED`, code de sortie 0). Quatre déploiements de production d'affilée ont été
annulés ainsi après le changement de `CRON_SECRET` ; la route du poll Smartcar répondait 401
avec le nouveau secret. Le script avait appliqué sa règle correctement : c'est la règle qui
ignorait ce cas.

- **Pour appliquer une variable : une PR qui modifie `vercel-rebuild.txt`** (date et raison, jamais
  une valeur). Le script le traite comme un fichier servi et construit. Une PR de tests ou de
  doc, elle, reste sautée.
- Redéployer le dernier déploiement déjà construit (plage vide) construit aussi : « aucun fichier
  lisible dans le diff » lance le build. Redéployer un déploiement annulé ne construit pas.
- Preuve que le build a eu lieu : l'état `READY` ET la réponse de la route concernée avec la
  nouvelle valeur, pas seulement le déploiement.
- Le test qui garde tout cela : `tests/buildNecessaire.test.ts` (rejoue le script sur un dépôt
  jetable : doc, tests, outillage, fichier servi, commit enjambé, plage vide, mode Vercel).
