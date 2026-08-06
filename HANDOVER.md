# HANDOVER — état courant de CarAI

> À lire en premier à chaque reprise de session.

**Dernière mise à jour** : 2026-08-06 (après-midi) · branche `main`

## Où en est le projet

**Les données RÉELLES arrivent.** Le pipeline complet fonctionne en production :
Connect réussi, webhook vérifié, livraisons `VEHICLE_STATE` signées, ingérées et
dédupliquées. Dernière livraison observée dans les journaux Vercel : 11 signaux reçus,
11 enregistrés. Marc a fait le ménage dans la souscription (retrait des signaux
`VEHICLE_NOT_CAPABLE` et thermiques).

Le rapport Smartcar du 06/08 fait foi : **15 signaux confirmés `SUCCESS`** sur la bZ
(liste dans `SIGNAUX_CONFIRMES_BZ`, `lib/smartcar/signals.ts`), 2 bloqués en
`PERMISSION` (vitesse, VIN), 1 `UPSTREAM` temporaire (`Service.Records`).

## L'étape exacte où reprendre

1. **Vérifier la couverture sur du réel** : ouvrir `carai.hubperso.com/donnees` (page
   privée) — elle compare la base aux 15 signaux confirmés et NOMME les manquants.
   Côté session Claude : les journaux Vercel listent désormais les CODES de chaque
   livraison (`Codes : charge-ischarging, …`), plus seulement les comptes. Une seule
   livraison ne suffit pas à conclure : Smartcar peut livrer par lots — juger sur
   quelques heures.
2. **Décision de Marc en attente** (PR #11 mergée) : tenter de débloquer
   `Motion.CurrentSpeed` / `VehicleIdentification.VIN` via `SMARTCAR_SCOPES_EXTRA`
   (option B — exige de trouver le nom exact des scopes dans le dashboard Smartcar,
   puis un re-Connect), ou s'en passer (option A, recommandée : la vitesse d'une
   voiture stationnée est 0, le VIN est sur la carte grise).
3. `[INFRA-07]` toujours ouvert : `HUB_TOKEN` (CarAI) + `HUB_TOKEN_CARAI` (Hubperso)
   pour que la tuile CarAI apparaisse sur hubperso.com.

## Décisions de stockage (06/08, demande « BD de qualité pour plusieurs années »)

- **Les MESURES sont conservées à vie.** Une ligne par instant de mesure du véhicule
  (déduplication structurelle) : ~20-60 Mo/an, des années de marge sur le demi-Go Neon.
- **Le JSON BRUT des livraisons est purgé après 90 jours** (`WEBHOOK_RAW_RETENTION_JOURS`,
  `0` = tout garder). Il est redondant — chaque signal, connu ou inconnu, est déjà un
  snapshot — et c'était LUI qui aurait rempli le plan gratuit en 1 à 3 ans. Les lignes de
  livraison restent (idempotence + détection de silence) ; seul le blob est vidé.
  Verrouillé par `tests/inventaire.test.ts` (PGlite, vrai schéma), discrimination prouvée
  par mutation (DELETE au lieu d'UPDATE → test rouge).
- **Sauvegarde externe : rien en place.** Neon gratuit n'a qu'une restauration courte —
  et le dépôt étant PUBLIC, aucun dump n'y sera jamais poussé. → `[DATA-01]`.

## Ce qui a été appris en branchant pour de vrai (05-06/08)

- **Trois bugs sur quatre venaient de chemins d'API devinés** (doc Smartcar filtrée
  côté réseau). Règle : rendre CONFIGURABLE ce qu'on ne peut pas vérifier
  (`SMARTCAR_CONNECT_CLIENT_ID`, `SMARTCAR_SCOPES_EXTRA`) ou l'APPRENDRE de ce qui
  arrive (`apprendreVehicleId`).
- **Le repli par groupe perdait 7 mesures sur 15** (collision avec l'index unique,
  silencieuse par construction). Retiré du chemin d'écriture ; un code inconnu devient
  sa propre métrique.
- **Un journal qui ne trace que les anomalies est indiagnosticable** : chaque livraison
  logue reçus/écrits ET les codes. « 0 écrit » est normal (rien n'a bougé) ; c'est
  « 0 reçu » ou un code absent des logs qui parlent.
- **Les livraisons TEST sont tracées, jamais enregistrées** (une Tesla fictive à
  78 432 km aurait produit une fausse alerte de bail).

## Ce qui reste ouvert

Voir `BACKLOG.md` — notamment `[SC-05]` (couverture 15/15 à confirmer sur quelques
heures de livraisons), `[DATA-01]` (sauvegarde externe), `[UI-01]` (graphiques — les
agrégats par métrique de `lib/vehicle/inventaire.ts` disent déjà quelles séries sont
assez fournies pour être tracées), `[SEC-01]` (en-têtes de sécurité).
