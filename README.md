# app-template

Squelette d'app pour l'écosystème hub perso. Toute nouvelle app `<nom>.hubperso.com` part
d'ici. Deux choses sont déjà branchées et testées :

1. **`GET /hub/summary`** conforme au contrat
   [`@mokarade/hub-contract`](https://github.com/MoKarade/hub-contract), avec auth
   `x-hub-token` en temps constant — l'app apparaît dans le hub dès le premier déploiement,
   honnêtement « en construction » (`buildingSummary`).
2. **Un login Google mono-adresse** (Auth.js v5) + middleware **fail-closed** — parce que
   ces apps affichent des données personnelles réelles, et que les quatre apps existantes
   ont toutes fini par avoir besoin exactement de ça.

> Ce template condense ce que **Hubperso, FinanceAI, DriveAI, BatchChef et JobAI** ont
> appris en production. Les avertissements ⚠️ viennent de vrais bugs.

## Ce qui est déjà branché

| Fichier | Rôle |
|---|---|
| `app/hub/summary/route.ts` | Endpoint du hub : 503 sans `HUB_TOKEN`, 401 sans jeton valide, `no-store`, summary `building` |
| `lib/hubToken.ts` | Comparaison de jeton en temps constant (SHA-256 + `timingSafeEqual`) |
| `auth.ts` | Auth.js v5, Google, **une seule** adresse admise (`AUTHORIZED_EMAIL`) |
| `middleware.ts` | Garde global fail-closed ; exclut `/hub/summary` (auth par jeton) |
| `lib/authGuard.ts` | Décision de garde en fonctions **pures**, testables |
| `lib/authConfigured.ts` | Refuse tout si `AUTH_SECRET`/`AUTHORIZED_EMAIL` manquent |
| `app/login/page.tsx` | Page publique, messages d'erreur honnêtes et distincts |
| `tests/` | 17 tests : contrat + garde d'accès |
| `.github/workflows/ci.yml` | Gate (typecheck · lint · test · build) + job `audit` séparé |

## ⚠️ Les deux pièges à ne pas rejouer

**`/hub/summary` doit rester hors du middleware d'auth utilisateur.** Il porte sa propre
auth. S'il tombe derrière la session, le hub reçoit une redirection HTML au lieu du JSON →
widget « injoignable » en permanence, alors que l'app marche parfaitement dans ton
navigateur. JobAI l'a appelé « le défaut n°1 du squelette ». Verrouillé par `tests/auth.test.ts`.

**Le hub polle toutes les ~15 s.** S'il coûte quelque chose de borné de produire ton summary
(Apps Script, API tierce, requête lourde), mets un cache court **dans ton handler** — le hub
ne peut pas deviner ce que ça te coûte. DriveAI a découvert que 19 polls sur 20 renvoyaient
des octets identiques, chacun facturé sur un quota dur. Ne jamais mettre une **panne** en cache.

## Forker une nouvelle app

1. **Cloner** ce template sous un nouveau repo (ou « Use this template » sur GitHub).
2. **Personnaliser l'identité** dans `app/hub/summary/route.ts` :
   ```ts
   const APP = {
     id: "mon-app",              // kebab-case, stable — doit matcher lib/sources.ts du hub
     name: "Mon App",            // 1 à 30 caractères
     url: "https://mon-app.hubperso.com",
     color: "#e11d48",           // hex 6 digits
   };
   ```
   puis le `<title>` dans `app/layout.tsx` et le contenu de `app/page.tsx`.
3. **Configurer l'environnement** — voir [`.env.example`](./.env.example).
4. **Déclarer l'app au hub** : entrée dans `lib/sources.ts` du repo Hubperso + variable
   `HUB_TOKEN_<ID>`. ⚠️ C'est du **code** côté hub → redéploiement du hub nécessaire, pas
   seulement une variable d'environnement.
5. **Construire l'app.** Quand le moteur produit de vraies données, remplacer
   `buildingSummary(APP, …)` par un vrai `HubSummary`, validé par `validateSummary(...)`.
6. **Si l'app a une base** : voir « Migrations » plus bas.
7. **Créer `HANDOVER.md` et `BACKLOG.md`** dès la première session.

## Auth

Deux authentifications indépendantes, qui ne se recouvrent pas :

| | Qui | Mécanisme | Échec |
|---|---|---|---|
| **Hub → app** | le hub, server-side | header `x-hub-token` | 503 si `HUB_TOKEN` absent, 401 si invalide |
| **Toi → app** | navigateur | Google OAuth, 1 adresse | 503 si non configurée, redirection `/login` sinon |

```bash
# jeton du hub
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
# secret Auth.js
npx auth secret
```

⚠️ **Fail-closed voulu** : sans `AUTH_SECRET`/`AUTHORIZED_EMAIL`, le middleware répond 503 et
ne sert RIEN. Auth.js seul se contente de logguer `MissingSecret` et **laisse passer** —
constaté en préproduction sur le hub, qui servait ses données sans login.

## Migrations : rien à lancer sur ton PC

Exigence de Marc, non négociable. Deux patrons éprouvés, au choix :

- **Au déploiement** (BatchChef) : ajouter `"vercel-build": "npm run db:migrate && next build"`.
  Vercel utilise ce script à la place de `build` quand il existe → les migrations s'appliquent
  à chaque déploiement, prod et previews. Idempotent (table de suivi Drizzle).
- **Au démarrage de l'app** (JobAI, `lib/migrations.ts`) : mémorisé par processus, n'échoue
  jamais vers l'appelant. À préférer si l'app doit aussi se réparer hors déploiement.

## CORS : rien à faire

Le hub fetch `/hub/summary` **server-side**. Aucun header CORS à configurer — si le besoin
apparaît, c'est le signe qu'un fetch est parti côté client, ce qui exposerait le jeton.

## Développement

```bash
npm install
npm run dev        # http://localhost:3000  (endpoint : /hub/summary)
npm run test       # vitest (contrat + garde d'accès)
npm run typecheck  # tsc --noEmit
npm run lint
npm run build

# tester le endpoint en local
HUB_TOKEN=dev npm run dev
curl -s -H "x-hub-token: dev" http://localhost:3000/hub/summary
```

Avant chaque commit : `npm run typecheck && npm run lint && npm run test && npm run build`.

## Déploiement

Vercel (ou tout hôte Next.js). Définir `HUB_TOKEN`, `AUTH_SECRET`, `AUTHORIZED_EMAIL`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Domaine cible : `<nom>.hubperso.com`.

Redirect URIs à déclarer côté Google Cloud :
`http://localhost:3000/api/auth/callback/google` et
`https://<nom>.hubperso.com/api/auth/callback/google`.

## Version du contrat

`@mokarade/hub-contract` est épinglé sur un **SHA**, pas un tag : le tag `v1.1.0` n'a jamais
pu être poussé (proxy git, 403 sur les refs de tag). Les cinq dépôts de l'écosystème épinglent
le **même** SHA `2d37a61…` = contenu v1.1.0 (bloc `usage` additif). Ne pas redescendre à
`#v1.0.0`, qui ignore ce bloc.
