# CLAUDE.md — app-template

Squelette d'app de l'écosystème hub perso. Deux responsabilités génériques, déjà branchées :
exposer `GET /hub/summary` conforme à
[`@mokarade/hub-contract`](https://github.com/MoKarade/hub-contract), et rester **privée**
(login Google, une seule adresse). Tout le reste — l'interface, le moteur métier — se
construit après le fork.

> **Ce fichier condense ce que les cinq apps de l'écosystème ont appris en production**
> (Hubperso, FinanceAI, DriveAI, BatchChef, JobAI). Chaque avertissement marqué ⚠️ vient
> d'un vrai bug, pas d'une précaution théorique. Ce que ce fichier oublie, chaque fork
> l'oubliera.

## Principes non négociables

- **Contrat d'abord.** Toute réponse de `/hub/summary` passe par le schéma du contrat
  (`buildingSummary` le garantit ; au fork, `validateSummary(...)` sur un vrai summary).
  Le hub REJETTE ce qui dévie — il affichera « invalide », pas tes données.
- **No fake data.** Par défaut `status: "building"`, aucune métrique inventée. On ne publie
  de vrais chiffres que quand le moteur les produit réellement. Un `0` affirme ; une absence
  admet. Pas de bloc `usage` tant qu'il n'y a pas de coût réel.
- **Échec fermé, partout.** `x-hub-token` obligatoire (401 sinon) ; `HUB_TOKEN` absent
  → 503 (intégration désactivée, pas une panne) ; auth utilisateur non configurée → 503 et
  rien n'est servi. Comparaisons de jetons en **temps constant**. Jamais de secret en dur.
- **`no-store` systématique** sur `/hub/summary` : un summary est un instantané.
- **App privée par défaut.** Elle affiche des données personnelles → login Google
  mono-adresse (`AUTHORIZED_EMAIL`) + middleware fail-closed. Toute NOUVELLE route qui
  affiche des données reste DERRIÈRE le middleware.

## Les deux pièges qui ont coûté cher

**1. `/hub/summary` doit rester HORS du middleware d'auth utilisateur.**
Il porte sa propre auth (le jeton). S'il tombe sous le garde de session, le hub reçoit une
redirection HTML vers `/login` au lieu du JSON → widget « injoignable » en permanence.
Le symptôme est trompeur : l'app marche parfaitement dans ton navigateur (tu es connecté),
seul le hub voit le problème. Vécu par JobAI, qui l'a appelé « le défaut n°1 du squelette ».
Verrouillé par `tests/auth.test.ts` — ne pas supprimer ce test.

**2. Le hub polle toutes les ~15 s, et il ne peut pas deviner ce que ça te coûte.**
Si produire ton summary consomme une ressource BORNÉE (exécution Apps Script, appel d'API
tierce, requête lourde), mets un **cache court dans ton handler**. DriveAI a découvert que
19 polls sur 20 renvoyaient des octets identiques, chacun facturé sur un quota dur de
90 min/jour partagé avec son moteur. Règle : si la donnée ne bouge qu'aux N minutes, un
cache de ~N/5 ne perd aucune fraîcheur. ⚠️ Ne JAMAIS mettre une **panne** en cache — un
échec doit rester observable et le prochain appel doit réessayer.

## Publier au hub — ce qui compte

- **`dataAsOf` ≠ `generatedAt`.** `generatedAt` = quand tu as fabriqué la réponse (toujours
  « maintenant »). `dataAsOf` = quand la DONNÉE a été rafraîchie. Sans lui, le hub ne peut
  pas distinguer « à jour » de « figé depuis trois jours ».
- **Période des coûts** (`usage.cost.period`) : le hub ne fusionne **jamais** deux périodes
  différentes — il l'a fait, ça produisait un montant qui n'existait pas. Choisir `total`
  sauf raison explicite : c'est ce que publient BatchChef et FinanceAI, donc les coûts
  s'agrègent entre eux. `mois` apparaîtra dans un total séparé.
- **Un champ additif optionnel ne casse rien.** Les schémas strippent les clés inconnues :
  un producteur peut publier `usage` avant que tous les consommateurs ne soient re-pinnés.
- **Le hub ne connaît aucune app en particulier.** Il rend ce que le summary contient. Si tu
  veux quelque chose de spécifique à l'écran, ça passe par le contrat, pas par du code hub.

## Au fork — checklist

1. Personnaliser `APP` (id/name/url/color) dans `app/hub/summary/route.ts`. L'`id` doit
   correspondre EXACTEMENT à l'entrée de `lib/sources.ts` côté Hubperso.
2. Configurer l'environnement (cf. `.env.example`) : `HUB_TOKEN`, `AUTH_SECRET`,
   `AUTHORIZED_EMAIL`, `GOOGLE_CLIENT_ID/SECRET`.
3. Déclarer l'app dans `lib/sources.ts` du hub + la variable `HUB_TOKEN_<ID>`.
   ⚠️ C'est du **code** côté hub → ça exige un redéploiement du hub, pas juste une variable.
4. Remplacer `buildingSummary(...)` par un vrai summary quand le moteur produit des données.
5. **Si l'app a une base** : ajouter `"vercel-build": "npm run db:migrate && next build"`
   (Vercel l'utilise à la place de `build` quand il existe) OU appliquer les migrations au
   démarrage. Exigence de Marc : **ne jamais avoir à lancer une commande sur son PC**.
6. Tenir `HANDOVER.md` (état courant, à lire en premier) et `BACKLOG.md` dès la 1ʳᵉ session.

## Vérifications avant commit

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

*(`lint` = ESLint CLI : `next lint` est déprécié et retiré dans Next 16. Le bloc `ignores`
de `eslint.config.mjs` est indispensable — l'ESLint CLI n'ignore pas `node_modules`/`.next`
implicitement, contrairement à `next lint` : 4 122 faux positifs mesurés chez JobAI.)*

La **CI** (`.github/workflows/ci.yml`) rejoue ce gate et part avec le fork — c'est voulu :
les apps nées de ce template ont démarré sans aucune vérification automatisée, et l'une a
laissé vivre une injection SQL en production faute de quoi que ce soit qui se déclenche.
Un job `audit` **séparé** (`npm audit --omit=dev`, aussi en hebdomadaire) complète le gate :
un avis de sécurité paraît sans qu'une ligne n'ait changé, et mêlé au gate il peindrait un
dépôt sain en rouge sans rapport avec le code — c'est ainsi qu'une CI cesse d'être lue.

## Documentation

- `CLAUDE.md` (ce fichier) se charge à **chaque session** → il reste **court**. ⚠️ Leçon
  FinanceAI : le sien avait atteint 1 777 lignes (~36 500 tokens par session) tout en
  affirmant être « dense et court ». Les leçons détaillées vont dans `docs/`, jamais ici.
- `HANDOVER.md` — état courant, à lire en premier à chaque reprise.
- `BACKLOG.md` — tâches. ⚠️ Un item peut être **périmé** (réglé ailleurs) : vérifier l'état
  réel avant de coder.
- ⚠️ **Doc périmée = pire que pas de doc.** Le README de JobAI a annoncé « rien n'est
  déployé » pendant des semaines alors que l'app tournait avec des données réelles — et
  promettait en même temps une fonctionnalité IA qui n'existait pas. Mettre à jour la doc
  touchée dans la MÊME PR que le code.

## Style (hérité du CLAUDE.md global de Marc)

- Réponses, commits et docs **en français** (`feat:`, `fix:`, `docs:`, …). Pas d'emojis
  dans le chat sauf demande explicite.
- TypeScript strict, pas de `any` silencieux. Erreurs honnêtes, jamais avalées.
- Ne pas imposer le dark mode : `prefers-color-scheme` décide.
- **Planchers de version, jamais redescendus** : documenter dans `package.json` (clé `//`)
  toute version minimale imposée par une faille — ex. `drizzle-orm ≥ 0.45.2`
  (GHSA-gpj5-g38j-94v9, injection SQL, HIGH) chez BatchChef.
