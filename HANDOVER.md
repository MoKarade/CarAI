# HANDOVER — état courant de CarAI

> À lire en premier à chaque reprise de session.

**Dernière mise à jour** : 2026-08-06 (après-midi) · branche `main`

## Où en est le projet

**La souscription ÉLARGIE tourne en production.** L'après-midi du 06/08 a révélé que le
webhook ne portait que les 11 signaux d'origine (3 utiles + 8 morts) pendant que le
catalogue en montrait 15 fonctionnels — Marc l'a élargie à **84 signaux** (clim,
températures, ampérage/tension/puissance de charge, HVAC, diagnostics, transmission,
batterie 12 V…). Première livraison LIVE élargie à 15:33 UTC : **84 reçus,
84 enregistrés** ; la suivante 84/80 (déduplication normale). La livraison TEST de
validation (Tesla fictive) a été tracée sans être enregistrée.

L'onglet **Base de données** (`/donnees`) est complet : tableau filtrable
(métrique/source/période) avec pagination bornée et total, export CSV de l'HISTORIQUE
COMPLET (`/api/donnees/export` — streaming avec contre-pression, curseur stable,
formules neutralisées), couverture des signaux confirmés, journal des livraisons,
rafraîchissement automatique 30 s. Garde d'affichage GPS par CONTENU (revue
adversariale : un code de position inconnu ne peut pas afficher ses coordonnées).

## L'étape exacte où reprendre

1. **Lire ce que la bZ accepte des 84** : colonne Statut de l'onglet Base de données
   (`signal_status` en base) — `SUCCESS` vs refus, signal par signal. Les codes
   confirmés `SUCCESS` sur du LIVE sont candidats à `SIGNAUX_CONFIRMES_BZ`
   (`lib/smartcar/signals.ts`) : les y ajouter DANS LE MÊME COMMIT que la mise à jour
   du test (15 → N). Les refus (`VEHICLE_ERROR`) sont tracés en base.
2. **Décision de Marc en attente** : débloquer `Motion.CurrentSpeed` /
   `VehicleIdentification.VIN` via `SMARTCAR_SCOPES_EXTRA` + re-Connect (option B), ou
   s'en passer (option A, recommandée).
3. `[INFRA-07]` toujours ouvert : `HUB_TOKEN` (CarAI) + `HUB_TOKEN_CARAI` (Hubperso)
   pour que la tuile CarAI apparaisse sur hubperso.com.
4. `[UI-01]` Graphiques : les séries sont désormais riches (84 signaux aux 20 min).

## Décisions de stockage (06/08, demande « BD de qualité pour plusieurs années »)

- **Les MESURES sont conservées à vie.** Une ligne par instant de mesure du véhicule
  (déduplication structurelle) : ~20-60 Mo/an, des années de marge sur le demi-Go Neon.
- **Le JSON BRUT des livraisons est purgé après 90 jours** (`WEBHOOK_RAW_RETENTION_JOURS`,
  `0` = tout garder). Il est redondant — chaque signal, connu ou inconnu, est déjà un
  snapshot, STATUT compris (`signal_status`) — et c'était LUI qui aurait rempli le plan
  gratuit en 1 à 3 ans. Les lignes de livraison restent (idempotence + détection de
  silence) ; seul le blob est vidé. Verrouillé par `tests/inventaire.test.ts` (PGlite,
  vrai schéma), discrimination prouvée par mutation (DELETE au lieu d'UPDATE → test rouge).
- **Garde anti-perte** (finding HIGH de la revue adversariale pré-merge, 21 agents) : la
  purge ne touche JAMAIS un raw reçu après la dernière écriture réussie. Si l'enveloppe
  Smartcar change (livraisons 200, 0 écrit), le raw devient l'unique copie des mesures —
  sanctuarisé jusqu'à réparation, et `/donnees` alerte « les livraisons arrivent mais
  rien ne s'écrit » (48 h sans écriture avec livraisons récentes). Les `VEHICLE_ERROR`
  sont désormais tracés en base, plus seulement dans les logs éphémères.
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
