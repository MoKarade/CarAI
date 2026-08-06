# BACKLOG — CarAI

Convention : chaque tâche porte une case. Un item fini et validé (mergé, gate vert) part
dans la section « Livré » avec sa date. Une note sans travail à faire n'est pas une tâche.

## Bloqué par une action de Marc

Voir `HANDOVER.md` pour la marche à suivre détaillée.

- [ ] `[INFRA-07]` `HUB_TOKEN` côté CarAI **et** `HUB_TOKEN_CARAI` côté Hubperso
      (⚠️ exige un redéploiement de Hubperso — l'ajout de l'app est du code)
- [ ] `[INFRA-08]` `CRON_SECRET` (seulement si le module Toyota est activé), puis
      décommenter le `schedule` de `.github/workflows/toyota-poll.yml` et poser les
      secrets de dépôt `CARAI_URL` / `CRON_SECRET`.
      ⚠️ Le poll ne passe PAS par un cron Vercel : le plan Hobby n'autorise que des
      crons **quotidiens**, et `0 */2 * * *` fait échouer le déploiement. Voir
      « Le poll Toyota ne passe pas par Vercel » dans `CLAUDE.md`.

## À faire dès que des données réelles arrivent

- [ ] `[SC-05]` **Confirmer la couverture 15/15 sur quelques heures de livraisons.**
      La livraison de 13:33 portait 11 signaux : soit Smartcar livre par lots, soit le
      ménage de Marc a retiré un signal fonctionnel. Trancher avec les journaux Vercel
      (les codes y sont maintenant listés) et la page `/donnees` (les manquants y sont
      nommés). Si un des 15 ne se présente jamais : vérifier la souscription du webhook.
- [ ] `[SC-03]` Confirmer que les commandes de sécurité répondent bien en V3
      (`lib/smartcar/commands.ts` → `CHEMINS_COMMANDES`). Le cadrage signalait que la doc
      mentionnait encore V2.0 pour cet endpoint. Si 404/501, corriger la table — c'est une
      ligne, et la commande est de toute façon journalisée avec sa réponse brute.
- [ ] `[SC-04]` Brancher la synchronisation de l'historique d'entretien (hebdomadaire) :
      le pipeline d'écriture existe (`insererEntretiens`), il manque le déclencheur.
- [ ] `[BAIL-01]` Renseigner le **tarif au kilomètre excédentaire** dans la config `bail`
      pour que le dépassement soit chiffré en dollars. Sans lui, il reste en kilomètres —
      volontairement.

## Fonctionnalités

- [ ] `[UI-01]` Graphiques dans la webapp (les séries sont déjà exposées par
      `lib/vehicle/history.ts` ; les agrégats de `lib/vehicle/inventaire.ts` disent
      quelles séries sont assez fournies pour être tracées)
- [ ] `[UI-02]` Bouton « rafraîchir maintenant » (le chemin `demandeExplicite` existe déjà
      dans `deciderPoll`, avec son plancher anti-abus)
- [ ] `[UI-03]` Compléter l'écran de diagnostic : santé Toyota et état de la connexion
      Smartcar (la partie « livraisons + couverture + mesures ligne à ligne, en live »
      est livrée dans l'onglet Base de données le 06/08)
- [ ] `[DATA-01]` **Stratégie de sauvegarde externe de la base.** Neon gratuit n'offre
      qu'une restauration courte, et le dépôt est PUBLIC — un dump n'ira jamais sur
      GitHub. Piste : export périodique chiffré (age) vers le Drive de Marc, déclenché
      par GitHub Actions. À cadrer avant que l'historique ait de la valeur (des mois de
      données).
- [ ] `[MCP-01]` Déployer le serveur MCP sur Cloud Run (patron `financeai-mcp`)
- [ ] `[SEC-01]` En-têtes de sécurité (`next.config.mjs`) : HSTS, X-Content-Type-Options,
      X-Frame-Options, Referrer-Policy, Permissions-Policy, puis CSP en `Report-Only`
      avant de l'enforcer

## Module Toyota (non officiel) — seulement après validation

- [ ] `[TOY-01]` Vérifier l'abonnement Connected Services (app Toyota, onglet abonnements)
- [ ] `[TOY-02]` Test d'authentification MINIMAL et isolé avec un compte `toyota.ca`, code
      OTP saisi à la main. Si l'échec est spécifique au marché canadien : **abandonner ce
      module**, ce n'est pas un échec du projet (Doc 3 §7).
- [ ] `[TOY-03]` Implémenter `ClientToyotaHttp` (`lib/toyota/client.ts`) — exige de lire le
      flux d'auth de `toyota-na`, donc une session avec accès au dépôt tiers
- [ ] `[TOY-04]` Choisir et configurer le service de courriel entrant pour les codes OTP
      (Resend Inbound recommandé au cadrage — vérifier que l'offre gratuite tient toujours)
- [ ] `[TOY-05]` Sous-domaine dédié pour la réception des courriels OTP

## Dette assumée / à surveiller

- [ ] `[DETTE-01]` Le cache du token Smartcar est un cache de **processus** : vide au
      démarrage à froid, non partagé entre instances serverless. Bénéfice partiel, sans
      risque. À revoir seulement si le volume d'appels le justifie.
- [ ] `[DETTE-02]` Le webhook écrit AVANT de répondre 200 (le détachement tuerait le
      travail avec l'instance en serverless). Tenable à quelques livraisons par heure sur
      un véhicule. Si ça grossit, la réponse est une file — pas un détachement silencieux.

## Livré

- [x] `[INFRA-01..06]` Base Neon, Vercel + domaine, OAuth Google, identifiants Smartcar,
      webhook vérifié, Connect réussi — 2026-08-05/06 (données réelles en base)
- [x] `[SC-01]` Mapping confronté au réel : structure de livraison alignée (PR #9),
      collision de métriques corrigée + 15 codes confirmés mappés un à un (PR #10) — 2026-08-06
- [x] `[SC-02]` Unité des pourcentages confirmée sur livraison réelle (`percent`, 0-100) ;
      l'ambiguïté fraction/pourcent reste tranchée par l'unité, jamais par la valeur — 2026-08-06
- [x] `[SC-06]` Permissions du Connect extensibles sans code (`SMARTCAR_SCOPES_EXTRA`,
      PR #11) — 2026-08-06
- [x] `[DATA-02]` Inventaire des données (`/donnees` : couverture des 15 signaux,
      comptes/bornes par métrique, journal des livraisons) + codes des signaux dans les
      journaux + rétention du raw des webhooks (90 j, mesures conservées à vie) — 2026-08-06
- [x] `[FOND-01]` Fork d'app-template, schéma de données, migrations au démarrage — 2026-08-05
- [x] `[FOND-02]` Intégration Smartcar V3 (auth, signaux, webhooks, commandes) — 2026-08-05
- [x] `[FOND-03]` Module Toyota isolé (OTP, poll, santé) hors adaptateur réseau — 2026-08-05
- [x] `[FOND-04]` Serveur MCP (9 tools) — 2026-08-05
- [x] `[FOND-05]` Tableau de bord, flow Connect, summary hub — 2026-08-05
