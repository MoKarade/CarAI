# BACKLOG — CarAI

Convention : chaque tâche porte une case. Un item fini et validé (mergé, gate vert) part
dans la section « Livré » avec sa date. Une note sans travail à faire n'est pas une tâche.

## Bloqué par une action de Marc

Voir `HANDOVER.md` pour la marche à suivre détaillée.

- [ ] `[INFRA-01]` Créer la base Neon et poser `DATABASE_URL`
- [ ] `[INFRA-02]` Projet Vercel + domaine `carai.hubperso.com` (Cloudflare DNS-only)
- [ ] `[INFRA-03]` Client OAuth Google + variables d'auth
- [ ] `[INFRA-04]` Compte Smartcar : identifiants API + token de management
- [ ] `[INFRA-05]` Créer le webhook Smartcar et abonner le véhicule
- [ ] `[INFRA-06]` Lancer le Connect depuis CarAI (autorisation du véhicule)
- [ ] `[INFRA-07]` `HUB_TOKEN` côté CarAI **et** `HUB_TOKEN_CARAI` côté Hubperso
      (⚠️ exige un redéploiement de Hubperso — l'ajout de l'app est du code)
- [ ] `[INFRA-08]` `CRON_SECRET` (seulement si le module Toyota est activé), puis
      décommenter le `schedule` de `.github/workflows/toyota-poll.yml` et poser les
      secrets de dépôt `CARAI_URL` / `CRON_SECRET`.
      ⚠️ Le poll ne passe PAS par un cron Vercel : le plan Hobby n'autorise que des
      crons **quotidiens**, et `0 */2 * * *` fait échouer le déploiement. Voir
      « Le poll Toyota ne passe pas par Vercel » dans `CLAUDE.md`.

## À faire dès que des données réelles arrivent

- [ ] `[SC-01]` **Confronter le mapping des signaux au réel.** La première livraison de
      webhook révélera les codes qui existent vraiment. Corriger `CORRESPONDANCE_EXACTE`
      dans `lib/smartcar/signals.ts`. Aucun historique n'est perdu : `signal_code` garde
      toujours le code d'origine, une requête SQL suffit à reclasser.
- [ ] `[SC-02]` Vérifier le format des pourcentages (fraction vs 0-100) sur une vraie
      réponse, et compléter la table des unités reconnues si Smartcar en déclare une autre.
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
      `lib/vehicle/history.ts`, y compris agrégées)
- [ ] `[UI-02]` Bouton « rafraîchir maintenant » (le chemin `demandeExplicite` existe déjà
      dans `deciderPoll`, avec son plancher anti-abus)
- [ ] `[UI-03]` Écran de diagnostic : dernière livraison de webhook, santé Toyota, état de
      la connexion Smartcar
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

- [x] `[FOND-01]` Fork d'app-template, schéma de données, migrations au démarrage — 2026-08-05
- [x] `[FOND-02]` Intégration Smartcar V3 (auth, signaux, webhooks, commandes) — 2026-08-05
- [x] `[FOND-03]` Module Toyota isolé (OTP, poll, santé) hors adaptateur réseau — 2026-08-05
- [x] `[FOND-04]` Serveur MCP (9 tools) — 2026-08-05
- [x] `[FOND-05]` Tableau de bord, flow Connect, summary hub — 2026-08-05
