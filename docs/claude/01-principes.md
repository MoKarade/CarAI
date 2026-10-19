<!-- Extrait de l'ancien CLAUDE.md (§ 1. Principes non négociables), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Principes non négociables

## 1. Principes non négociables

### Deux sources, une hiérarchie

- **Smartcar** (`lib/smartcar/`) — API officielle, socle stable. Tout ce qui compte en dépend.
- **Toyota NA** (`lib/toyota/`) — source complémentaire **non officielle**, fragile par
  nature (Toyota a déjà cassé ce type d'accès deux fois : DMCA en 2022, puis 2FA obligatoire).

⚠️ **Si Toyota tombe, CarAI continue normalement sur Smartcar seul.** Aucune fonctionnalité
cœur ne dépend du module non officiel. Il est **désactivé par défaut** (`TOYOTA_NA_ENABLED`),
s'auto-désactive après 5 échecs consécutifs, et se réactive tout seul 24 h plus tard —
une quarantaine sans chemin de retour transforme une panne passagère en perte définitive.

### Le reste

- **No fake data, appliqué à la lettre.** Une unité non déclarée ⇒ on affiche la valeur
  brute, jamais un pourcentage deviné (un état de charge de 1 % affiché « 100 % » serait
  faux au moment où l'information compte le plus). Un coût d'entretien absent reste absent.
  Un dépassement de bail est chiffré en kilomètres tant que le tarif au km est inconnu.

  ⚠️ **Ce que ce principe N'INTERDIT PAS : une estimation ANNONCÉE.** Arbitrage de Marc,
  14/09 (« signalé mais tout estimé »), après le prix au débit du même jour. Le prix d'une
  recharge a désormais un repli d'ordre de grandeur (`TARIF_DOMESTIQUE_ORDRE_DE_GRANDEUR`)
  quand ni lieu, ni borne rapide, ni tarif au contrat ne s'appliquent — parce qu'un TROU
  dans un cumul qui se veut un total coûte plus cher qu'un chiffre dont on dit la valeur.
  Trois conditions le rendent compatible avec ce qui précède, et elles ne se négocient pas :
  la qualité reste `estime` (jamais `mesure`, et les deux ne s'additionnent nulle part),
  l'explication dit d'où vient le chiffre et comment l'exacter, et l'écran Réglages porte un
  bandeau tant que le tarif manque. Ce qui reste refusé : inventer la GRANDEUR elle-même —
  sans kWh connus, aucun montant n'est produit.
- **Panne ≠ absence de données.** Les deux donnent un écran vide, mais l'une veut dire
  « le véhicule n'a rien envoyé » et l'autre « CarAI est cassé ». Le summary publie `error`
  dans le second cas, jamais `building`.
- **Une mesure porte TOUJOURS sa source et son `recordedAt`** (instant de la mesure côté
  véhicule, pas de la réception). La fraîcheur réelle est de 30-60 min : sans horodatage,
  l'affichage laisserait croire au temps réel.
- **Deux sources qui se contredisent sont montrées toutes les deux.** Jamais de moyenne,
  jamais d'arbitrage silencieux — 46 % entre 45 et 47 est un chiffre que le véhicule n'a
  jamais affiché.
- **App privée, échec fermé.** Middleware fail-closed, `requireSession()` revérifié côté
  serveur. Jamais de secret en base ni côté client.
- **La connexion vient du HUB, l'autorisation aussi — deux étages, pas un seul** (ADR 0001
  de Hubperso). `auth.ts` déclare `providers: []` : CarAI ne parle plus à Google, elle
  déchiffre le cookie posé sur `.hubperso.com`, et `/login` est un couloir vers
  `hubperso.com/login`. `AUTHORIZED_EMAIL` **n'est pas une allowlist** : c'est le
  PROPRIÉTAIRE, vérifié d'abord et **sans réseau**, pour qu'une panne du hub n'enferme pas
  Marc dehors. Tout le monde d'autre passe par `lib/accesHub.ts` → `POST /api/acces`, et se
  gère depuis `hubperso.com/administration` — jamais en éditant une variable ici.
  Le contrôle est **rejoué à chaque lecture** (callback `jwt`), pas seulement à la
  connexion : le cookie étant partagé, il pourrait venir d'une autre app du hub.
- **Aucune commande à taper.** Migrations appliquées au démarrage (`lib/migrations.ts`).
