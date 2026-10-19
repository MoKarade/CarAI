<!-- Extrait de l'ancien CLAUDE.md (§ 2. Conventions de code), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Conventions de code

## 2. Conventions de code

- **TypeScript strict**, pas de `any` silencieux.
- **Erreurs honnêtes** : chaque mode d'échec se distingue. Une source injoignable, une
  mesure absente et une mesure à zéro ne se ressemblent pas — et surtout ne s'affichent pas
  pareil.
- **Fonctions pures d'un côté, I/O de l'autre.** `lib/authGuard.ts` décide sans rien lire ;
  c'est ce qui le rend testable exhaustivement.
- **Jamais d'arbitrage silencieux entre deux sources.** 46 % entre 45 et 47 est un chiffre
  que le véhicule n'a jamais affiché.
- ⚠️ **CarAI est SOMBRE, de jour comme de nuit — et ce fichier disait l'inverse.** Il
  portait « ne pas imposer le dark mode : `prefers-color-scheme` décide » alors que
  `app/globals.css` force `color-scheme: dark` et n'a plus une seule règle de thème clair
  **depuis le 17/08/2026**. Un mois de contradiction entre la règle et le code, dans le
  fichier chargé à CHAQUE session : c'est la doc qui perdait, et une session qui aurait
  « corrigé » le CSS pour lui obéir aurait cassé un choix de Marc. Corrigé dans le sens de
  l'usage le 18/09, sur son arbitrage explicite (« 17a » de la refonte d'interface).
  La raison tient en une phrase, et elle vient de JobAI : **un thème jamais montré à la
  validation n'est pas une option, c'est une version non validée de l'app servie au hasard
  du réglage système.** Le thème clair est donc SUPPRIMÉ, pas caché.
  ⚠️ La règle par défaut des huit dépôts reste « suivre le système » : CarAI est
  l'exception, et c'est le cas que la règle elle-même prévoit.
- **Socle visuel commun (CarAI#217, 16/10/2026).** Les couleurs vivent dans `app/globals.css`, en variables
  HEXADÉCIMALES nommées comme celles d'app-template (`--fond`, `--surface`, `--texte`, `--accent`,
  `--succes-texte` …), et nulle part ailleurs : ni `oklch(…)`, ni `#hex`, ni classe de palette dans une règle
  ou un fichier TypeScript. Une teinte translucide s'écrit `color-mix(in srgb, var(--jeton) 40%, transparent)`.
  `tests/theme.test.ts` le tient (exceptions TypeScript nommées une à une, une raison chacune). La surface
  s'appelle `.carte` ; `.alerte`, `.erreur`, `.pastille` et `.etiquette` gardent leur sens d'avant (listés dans
  `PRIS_AILLEURS`). `--texte-faible` tient 4,5:1 sur `--fond`, `--surface` et `--surface-douce` (`COUPLES`, CarAI#284).
- **DEUX points de rupture, et seulement deux** : `max-width: 700px` (téléphone) et
  `min-width: 900px` (grand écran). Il y en avait six le 18/09/2026, dont quatre dans des
  blocs MORTS. Tenu par `tests/pointsDeRupture.test.ts`, jamais par la vigilance.
- **La 3D ne descend qu'au CLIC.** `three` et le modèle pèsent plus que tout le reste de
  l'app réuni. Un seul `import` statique de `app/ui/Voiture3D.tsx` — ou de `three` — les
  ferait partir à chaque ouverture de l'accueil, **sans rien casser** : même écran, mêmes
  tests verts, juste une page plus lente sur celui qu'on ouvre en marchant vers sa voiture.
  Le canvas n'est donc atteignable que par `VueVoiture3D` (`next/dynamic`, `ssr: false`), et
  `tests/chargementDiffere3d.test.ts` refuse tout le reste. ⚠️ Ce qui DÉCIDE quoi que ce soit
  vit dans `lib/vehicle/vue3d.ts`, PUR : jsdom n'a pas de WebGL, donc ce qui reste dans le
  composant n'est couvert par rien.
