# CarAI

Suivi complet d'un véhicule électrique (Toyota bZ XLE AWD 2026) : état de la batterie,
charge, position, odomètre, verrouillage, historique d'entretien. Tout est conservé dans le
temps pour permettre graphiques et projections — dont le suivi du kilométrage face à
l'allocation du bail.

App de l'écosystème [hub perso](https://hubperso.com), à côté de FinanceAI, DriveAI, JobAI
et BatchChef. Privée, derrière un login Google mono-adresse.

## Ce qu'elle fait

- **Collecte** en continu depuis Smartcar (webhooks) et, en option, depuis une source
  Toyota non officielle.
- **Conserve** chaque mesure horodatée, indéfiniment, dans Postgres.
- **Publie** un résumé au hub perso (`GET /hub/summary`, contrat v1).
- **Expose** l'état et les commandes à Claude via un serveur MCP (`mcp/`).

## Stack

Next.js 15 (App Router, Server Components) · Auth.js v5 (Google, une seule adresse) ·
Neon + Drizzle · Zod · Vitest · `@modelcontextprotocol/sdk`. Déploiement Vercel sur
`carai.hubperso.com`.

## Deux sources, et une règle qui ne bouge pas

**Smartcar** est le socle : API officielle, OAuth propre, webhooks. **Toyota NA** est une
source complémentaire **non officielle** qui tape l'API mobile de Toyota — fragile par
nature, et déjà cassée deux fois dans l'histoire de cet écosystème (retrait DMCA en 2022,
puis 2FA obligatoire).

Si Toyota tombe, **CarAI continue normalement sur Smartcar seul**. Le module est désactivé
par défaut, s'auto-désactive après cinq échecs consécutifs, et retente 24 h plus tard.

## Honnêteté des données

C'est le fil conducteur du code, pas un slogan :

- Un pourcentage n'est affiché que si l'**unité déclarée** permet de l'interpréter. Sans
  elle, la valeur brute est montrée telle quelle — deviner ferait afficher « 100 % » pour
  une batterie à 1 %, exactement quand l'information compte le plus.
- Une **panne** (base injoignable) n'est jamais présentée comme une absence de données. Les
  deux donnent un écran vide, mais l'une veut dire « le véhicule n'a rien envoyé » et
  l'autre « CarAI est cassé ».
- Deux sources qui se contredisent sont affichées **toutes les deux**, avec leur source et
  leur horodatage. Aucune moyenne : 46 % entre 45 et 47 n'a jamais existé.
- Le dépassement de bail est chiffré **en kilomètres** tant que le tarif au kilomètre
  excédentaire n'est pas connu. Un montant plausible mais inventé, sur une décision
  financière, serait pire que pas de montant.
- Aucun bloc `usage` n'est publié au hub : CarAI n'a **aucun coût mesuré**, et un `0`
  affirmerait un suivi qui n'existe pas.

## Démarrer

```bash
npm install
cp .env.example .env.local   # puis remplir
npm run dev
```

Les migrations s'appliquent **au démarrage de l'app** — aucune commande à lancer, jamais.
`npm run db:generate` ne sert qu'à produire le SQL au moment du développement.

Voir **[HANDOVER.md](./HANDOVER.md)** pour la liste ordonnée de ce qu'il reste à configurer
(Neon, Vercel, Google, Smartcar, webhook, jeton hub).

## Vérifications

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

## Serveur MCP

```bash
npm run mcp:dev
```

Neuf tools : état du véhicule, historique, entretien, suivi du bail, et les commandes
(verrouillage, charge). Détail dans [`mcp/README.md`](./mcp/README.md).

## Authentification

L'app affiche des données personnelles réelles — position du véhicule comprise. Elle est
donc derrière un login Google **mono-adresse** (`AUTHORIZED_EMAIL`), avec un middleware
fail-closed : sans configuration d'auth complète, rien de protégé n'est servi.

Quatre routes échappent au garde de session parce qu'elles sont appelées par des machines
et portent leur propre authentification : `/hub/summary` (jeton), les deux webhooks
(signature HMAC et secret partagé) et le cron (secret). Elles sont énumérées une par une
dans `lib/authGuard.ts` — jamais par préfixe de dossier, pour qu'une route ajoutée demain
tombe derrière le garde par défaut.
