# HANDOVER — état courant de CarAI

> À lire en premier à chaque reprise de session.

**Dernière mise à jour** : 2026-08-05 · branche `claude/carai-electric-car-app-wdya72`

## Où en est le projet

Le squelette complet est en place et le gate passe (typecheck, lint, 115 tests, build).
**Rien n'est encore déployé, et aucune donnée réelle n'est jamais arrivée** — c'est normal :
tout attend les actions manuelles listées plus bas.

### Livré et vérifié

| Domaine | État |
|---|---|
| Base de données (Doc 1) | Schéma Drizzle 6 tables, migrations au démarrage, déduplication structurelle |
| Smartcar V3 (Doc 2) | Auth M2M, client HTTP sans SDK, signaux, webhooks signés, commandes, taxonomie d'erreurs |
| Toyota NA (Doc 3) | OTP, poll deux vitesses, santé/isolation, routes — **sauf l'adaptateur réseau** |
| Serveur MCP (Doc 4) | 9 tools, schémas Zod, stdio |
| Webapp | Tableau de bord, flow Connect, `/hub/summary` |
| Tests | 115, tous verts |

### Deux trous CONNUS, et pourquoi ils sont là

**1. L'adaptateur réseau Toyota n'est pas implémenté** (`lib/toyota/client.ts`).
`ha-toyota-na` est une bibliothèque **Python** sans équivalent npm, et son flux
d'authentification n'a pas pu être lu (dépôts tiers inaccessibles dans la session de
création). Écrire des URLs plausibles de mémoire aurait produit du code qui compile, qui
passe une revue, et qui échoue au premier appel réel en faisant croire à un changement
d'API côté Toyota. L'interface est réduite à deux méthodes ; la marche à suivre est dans
l'en-tête du fichier. **Tout le reste du module est complet et testé.**

**2. Les noms de signaux Smartcar sont des hypothèses** (`lib/smartcar/signals.ts`).
`smartcar.com` est filtré par la politique d'egress (403 confirmé côté proxy) alors que le
Doc 2 §4.2 demandait de vérifier chaque groupe. Seuls `tractionbattery-stateofcharge` et
`odometer-traveleddistance` sont confirmés par des sources tierces. Le mapping à trois
niveaux fait que se tromper de nom **ne perd aucune donnée** — au pire le classement est
moins fin, et `signal_code` garde toujours le code d'origine pour corriger après coup.

## Ce qui bloque le démarrage — actions de Marc

Dans cet ordre. Rien de tout ça ne peut être fait depuis une session Claude.

1. **Base Neon** — créer la base, poser `DATABASE_URL` dans Vercel. Les tables se créent
   toutes seules au premier démarrage.
2. **Projet Vercel + domaine** — brancher le dépôt, pointer `carai.hubperso.com`
   (Cloudflare DNS-only, grey cloud, comme le reste de l'écosystème).
3. **Auth Google** — client OAuth « Web application », redirect URI
   `https://carai.hubperso.com/api/auth/callback/google`. Poser `AUTH_SECRET`,
   `AUTHORIZED_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
4. **Compte Smartcar** — créer l'app, récupérer `SMARTCAR_CLIENT_ID` /
   `SMARTCAR_CLIENT_SECRET` (onglet API Credentials) et le token de management.
   Déclarer l'URL de redirection `https://carai.hubperso.com/api/connect/callback`.
5. **Webhook Smartcar** — le créer dans le tableau de bord vers
   `https://carai.hubperso.com/api/webhooks/smartcar`, sélectionner les signaux, puis
   abonner le véhicule. ⚠️ L'endpoint doit répondre au challenge AVANT que Smartcar ne
   livre quoi que ce soit — donc `SMARTCAR_MANAGEMENT_TOKEN` doit être posé d'abord.
6. **Connect** — ouvrir CarAI, cliquer « Lancer le Connect », autoriser le véhicule.
7. **Jeton hub** — générer `HUB_TOKEN`, le poser côté CarAI **et** en `HUB_TOKEN_CARAI`
   côté Hubperso. ⚠️ Hubperso doit être **redéployé** : l'ajout de l'app est du code.
8. **`CRON_SECRET`** — pour le poll planifié (seulement si le module Toyota est activé).

### Avant d'activer Toyota (facultatif, et à faire en connaissance de cause)

Le Doc 3 §2 conditionne l'activation à deux vérifications :

- l'abonnement **Toyota Connected Services est ACTIF** sur ton compte — l'onglet
  abonnements de l'app Toyota doit le montrer, « l'app est installée » ne suffit pas ;
- un compte **`toyota.ca` fonctionne réellement** avec cette bibliothèque. Personne ne l'a
  confirmé publiquement : c'est un vrai inconnu technique.

Si la seconde échoue spécifiquement pour le marché canadien, **abandonner ce module** et
rester sur Smartcar n'est pas un échec du projet (Doc 3 §7).

## Suite proposée

1. Faire les étapes 1 à 7 ci-dessus et voir arriver les premières données réelles.
2. **Confronter le mapping des signaux au réel** : la première livraison de webhook dira
   quels codes existent vraiment. Corriger `CORRESPONDANCE_EXACTE` en conséquence.
3. Renseigner le **tarif au kilomètre excédentaire** du bail (config `bail`) pour que le
   dépassement soit chiffré en dollars et pas seulement en kilomètres.
4. Graphiques dans la webapp (les séries sont déjà exposées par `lib/vehicle/history.ts`).
5. Déployer le serveur MCP sur Cloud Run.
