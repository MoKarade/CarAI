# 14 — Navigation entre apps : la liste du parc

À quoi sert `lib/appsDuParc.ts` : donner à chaque app l'adresse des autres sans repasser par le hub. Il expose `APPS_DU_PARC` (7 destinations figées : hub, FinanceAI, DriveAI, BatchChef, CarAI, JobAI, MemoryAI) et `autresApps(courant)`, qui rend toutes les destinations SAUF l'app courante, dans l'ordre de la liste. Rien n'est affiché par ce fichier : le composant d'onglet « Apps » (tâche suivante, app-template#213 (référence), CarAI#252) et les six apps s'en servent.

## Règles

- **La vérité est `Hubperso/lib/sources.ts`** (`APPS`, champ `accueil`). `lib/appsDuParc.ts` s'en copie tel quel dans chaque app ; il ne lit jamais Hubperso à l'exécution (aucun `fetch`, aucun secret, aucune dépendance).
- **Ajouter, renommer ou retirer une app du parc = mettre à jour ce fichier dans chaque dépôt**, dans la même vague que `Hubperso/lib/sources.ts`. Le test `tests/appsDuParc.test.ts` fige la liste exacte : il rougit tant que la copie et la liste attendue ne sont pas changées ensemble.
- **Le hub est à `https://www.hubperso.com`** : `https://hubperso.com` répond 308 vers `www` (relevé du 29/10/2026). On met l'adresse finale, pas celle qui redirige.
- **Un id inconnu lève une erreur** (`autresApps("faute")`) : une liste vide en silence cacherait une faute de frappe dans l'id d'un fork.
- Chaque adresse est une origine https sans chemin, requête, fragment ni identifiant, sur `hubperso.com` ou un sous-domaine (verrou du test).

## À un fork

Copier `lib/appsDuParc.ts` et `tests/appsDuParc.test.ts` tels quels. L'id de l'app courante (`APP_COURANTE`) se change en une ligne ; il doit être l'un des `AppId`.

# L'onglet « Apps » (app-template#213 (référence), CarAI#252)

`components/NavApps.tsx` : une pastille « Apps » repliée en haut à droite ; dépliée, un bouton par AUTRE app du parc (liste de `autresApps`) et un pour le hub. Un clic ouvre l'app dans le même onglet. Composant serveur : un `<details>`/`<summary>` natif, zéro JavaScript, aucun état « en ligne » inventé, aucun `fetch`. Style : classes `.nav-apps*` de `app/globals.css`, jetons existants seulement (clair et sombre), cibles ≥ 44 px, texte 16 px.

## Qui le voit

`navAppsAutorisee()` (`lib/navAppsMonter.ts`) : vrai seulement si la session est celle de `AUTHORIZED_EMAIL` (propriétaire, comparaison sans réseau, échec fermé). Un invité admis par le hub, une session absente ou la page de connexion : le composant n'est pas monté du tout. `app/layout.tsx` (asynchrone dans CarAI) le monte avec `<NavApps courant={APP_COURANTE} />`.

## Copier dans une app

1. Copier `components/NavApps.tsx`, `lib/navAppsMonter.ts`, `tests/navApps.test.tsx` et le bloc `.nav-apps*` de `app/globals.css` (avec `lib/appsDuParc.ts` déjà copié).
2. **Adapter l'id courant** : `APP_COURANTE` dans `lib/navAppsMonter.ts`, l'un des `AppId` (CarAI : `carai`).
3. **Adapter le montage** : dans le layout racine, `navAppsAutorisee()` à côté de la porte de session de l'app, puis `{navApps && <NavApps courant={APP_COURANTE} />}`.
4. **Adapter la porte** : `requireSession()` de l'app et sa variable `AUTHORIZED_EMAIL`. Le test `tests/navApps.test.tsx` doit rester vert, y compris la prise en charge des `.tsx` dans `vitest.config.ts`.

## Dans CarAI

Le thème est sombre seul (jetons de `app/globals.css`). La pastille est posée sous l'encoche (`env(safe-area-inset-*)`, `viewportFit: cover`). Les tests `.tsx` sont pris en charge par `vitest.config.ts`.
