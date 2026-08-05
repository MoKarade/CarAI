# HANDOVER — état courant de CarAI

> À lire en premier à chaque reprise de session.

**Dernière mise à jour** : 2026-08-05 (soir) · branche `main`

## Où en est le projet

**L'app est DÉPLOYÉE et fonctionne** sur `carai.hubperso.com` : login Google, base Neon
branchée, tableau de bord honnête. Le véhicule est **autorisé chez Smartcar** (Connect
réussi) et **abonné au webhook**.

Il reste **UNE** chose avant que les données arrivent : la **vérification du webhook**.

## L'étape exacte où reprendre

1. Vérifier qu'un déploiement de **production** existe pour le dernier commit de `main`
   (⚠️ le merge du 05/08 au soir n'en avait pas créé — voir « CI verte ≠ en ligne » dans
   `CLAUDE.md`). Un « Redeploy » rejoue le commit du déploiement EXISTANT, donc l'ancien
   code : pour forcer, pousser un nouveau commit.
2. Contrôler que l'endpoint est prêt :
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -X POST \
     https://carai.hubperso.com/api/webhooks/smartcar \
     -H 'Content-Type: application/json' -H 'sc-signature: peu-importe' \
     --data-binary '{"eventType":"VEHICLE_STATE"}'
   ```
   `401` = prêt (le token de management est là, la signature bidon est refusée).
   `503` = `SMARTCAR_MANAGEMENT_TOKEN` absent ou pas encore déployé.
3. Dashboard Smartcar → le webhook `carai` → **Verify**. Doit passer maintenant.
4. Les livraisons commencent. Première donnée visible sous ~30-60 min (fraîcheur Toyota).

## Ce qui a été appris en branchant pour de vrai (05/08)

Quatre pièges, tous corrigés, tous documentés dans le code concerné :

- **Le cron Vercel** : le plan Hobby n'accepte qu'un cron QUOTIDIEN. Le poll Toyota passe
  par `.github/workflows/toyota-poll.yml` (manuel tant que Toyota est désactivé).
- **La course migrations/lecture** : la page rendait un 500 au tout premier chargement.
  Tout passe par `collecter()`, qui séquence et ne lève jamais.
- **Deux identifiants Smartcar** : le Connect n'utilise pas celui des API Credentials.
  D'où `SMARTCAR_CONNECT_CLIENT_ID`, séparé avec repli.
- **L'événement de vérification n'est PAS signé** : exiger une signature avant de répondre
  au challenge renvoyait 401 et empêchait toute livraison. Le challenge vit sous `data`.
  Un garde de forme (`challengeBienForme`) empêche l'endpoint de devenir un oracle de
  signature.

⚠️ Leçon transversale : **trois de ces quatre bugs venaient de chemins d'API devinés**,
la doc Smartcar étant filtrée par la politique réseau des sessions Claude. Quand une
valeur ne peut pas être vérifiée, la rendre CONFIGURABLE ou l'APPRENDRE de ce qui arrive
vaut mieux que de deviner — c'est ce qui a réglé le `vehicleId` (appris des livraisons)
et le `client_id` (variable dédiée).

## Ce qui reste ouvert

- Le mapping des signaux Smartcar est encore **hypothétique** (`lib/smartcar/signals.ts`).
  La première livraison réelle révélera les vrais codes. Aucun historique ne sera perdu :
  `signal_code` conserve le code d'origine, une requête SQL suffit à reclasser. → `[SC-01]`
- Tarif au km excédentaire du bail à renseigner pour chiffrer le dépassement. → `[BAIL-01]`
- Graphiques, en-têtes de sécurité, serveur MCP sur Cloud Run. → `BACKLOG.md`
- Module Toyota : désactivé, et conditionné aux deux vérifications du Doc 3 §2.

## Environnement (rappel)

Posé : `DATABASE_URL`, `AUTH_SECRET`, `AUTHORIZED_EMAIL`, `GOOGLE_CLIENT_ID/SECRET`,
`SMARTCAR_CLIENT_ID/SECRET`, `SMARTCAR_CONNECT_CLIENT_ID`, `SMARTCAR_MANAGEMENT_TOKEN`.

À poser : `HUB_TOKEN` (côté CarAI) **et** `HUB_TOKEN_CARAI` (côté Hubperso, déjà déployé
avec le code) — pour que la tuile CarAI apparaisse sur `hubperso.com`.
