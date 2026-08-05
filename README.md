# app-template

Squelette d'app pour l'écosystème hub perso. Toute nouvelle app `<nom>.hubperso.com`
part d'ici : elle expose déjà `GET /hub/summary` conforme au contrat
[`@mokarade/hub-contract`](https://github.com/MoKarade/hub-contract), avec l'auth
`x-hub-token`, et démarre honnêtement « en construction » (`buildingSummary`) tant que
son moteur n'est pas actif.

## Ce qui est déjà branché

- **`app/hub/summary/route.ts`** — Route Handler Next.js : vérifie le header
  `x-hub-token` (temps constant, 401 sinon), répond toujours en `Cache-Control: no-store`,
  et renvoie un `buildingSummary` conforme au contrat. Le hub peut donc afficher un widget
  « en construction » dès le premier déploiement.
- **`lib/hubToken.ts`** — comparaison de jeton en temps constant.
- Pin `@mokarade/hub-contract#v1.0.0`, TypeScript strict, tests Vitest.

## Forker une nouvelle app

1. **Cloner ce template** sous un nouveau repo `<nom>` (ou « Use this template » sur GitHub).
2. **Personnaliser l'identité** dans `app/hub/summary/route.ts` (bloc `APP`) :
   ```ts
   const APP = {
     id: "mon-app",              // kebab-case, stable
     name: "Mon App",            // 1 à 30 caractères
     url: "https://mon-app.hubperso.com",
     color: "#e11d48",           // hex 6 digits
   };
   ```
   et le `<title>` dans `app/layout.tsx`, le contenu de `app/page.tsx`.
3. **Générer un jeton** et le configurer (voir ci-dessous).
4. **Construire l'app.** Quand ton moteur produit de vraies données, remplace dans
   `route.ts` le `buildingSummary(APP, …)` par un vrai `HubSummary` (metrics/alerts/actions),
   validé par `HubSummarySchema.parse(...)` avant d'être renvoyé.
5. **Déclarer l'app au hub** : ajouter une entrée dans `lib/sources.ts` du repo Hubperso
   + la variable de jeton `HUB_TOKEN_<ID>`.

## Auth

- Le hub envoie le header **`x-hub-token`**. Sans jeton valide → **401** (échec fermé).
- Sans `HUB_TOKEN` côté serveur → **500** (jamais de summary sans auth configurée).
- Le jeton vit dans une variable d'environnement (`.env.local` en dev, variables de l'hôte
  en prod), jamais dans le code.

```bash
# générer un jeton
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

## CORS : rien à faire

Le hub fetch `/hub/summary` **server-side via son proxy** — aucun header CORS à configurer.

## Développement

```bash
npm install
npm run dev        # http://localhost:3000  (endpoint : /hub/summary)
npm run test       # vitest (auth + contrat)
npm run typecheck  # tsc --noEmit
npm run build

# tester le endpoint en local
HUB_TOKEN=dev npm run dev
curl -s -H "x-hub-token: dev" http://localhost:3000/hub/summary
```

## Déploiement

Sur Vercel (ou tout hôte Next.js). Définir la variable `HUB_TOKEN` (le même jeton que le
hub enverra). Le domaine cible est `<nom>.hubperso.com`.
