# Sauvegarde externe de la base — interface CarAI ↔ DriveAI (CarAI#13)

Voie B (choix de Marc, 21/10/2026) : **CarAI ne parle jamais à Google.** CarAI sert des lots chiffrés par une route à jeton ;
le script DriveAI les vient chercher et les dépose, sans les lire, dans le dossier Drive dédié. Aucun jeton Google côté CarAI,
aucune autorisation de plus.

| Qui | Fait quoi |
|---|---|
| CarAI | `GET /api/export/sauvegarde` : un lot chiffré par appel (`lib/export/sauvegarde.ts`). Lecture seule. |
| DriveAI | Boucle d'appels, dépôt des fichiers tels quels, mémorise le curseur. **N'a pas la clé, ne déchiffre rien.** |
| Marc | Pose la clé et le jeton partagé via le PC (.github#299), garde la clé au coffre. Jamais par un chat. |

## L'appel

```
GET https://carai.hubperso.com/api/export/sauvegarde[?apres=<curseur>]
x-export-token: <EXPORT_TOKEN>
```

Le domaine est `carai.hubperso.com`, jamais `*.vercel.app`. Sans `apres`, l'export part du début.

**Réponse 200** : le corps est un fichier binaire (`application/octet-stream`), à déposer tel quel.

| En-tête | Sens |
|---|---|
| `X-Export-Curseur` | Position après ce lot. À repasser en `apres` pour le lot suivant. |
| `X-Export-Termine` | `oui` : dernier lot de la passe (il porte la configuration complète). `non` : rappeler avec le curseur. |
| `X-Export-Table` | Table du lot (`vehicle_snapshots`, `service_history`, `vehicle_commands_log`, `poll_runs`, `app_config`). |
| `X-Export-Lignes` | Rangées de données dans le lot. |
| `Content-Disposition` | Nom proposé : `carai-<horodatage>-<table>.carai` (unique par lot, ordre alphabétique = ordre chronologique). |

**Erreurs** (corps JSON `{ "error": "…" }`, `Cache-Control: no-store`) :

| Code | Cause | Que faire |
|---|---|---|
| 503 | `EXPORT_TOKEN` ou `EXPORT_KEY` absent côté CarAI, ou base absente | Rien d'écrit. Signaler à Marc (réglage manquant), ne pas réessayer en boucle. |
| 401 | Jeton absent ou faux | Arrêter la passe. Ne pas insister. |
| 400 | Curseur invalide | Repartir **sans** `apres` (export complet). |
| 500 | Lecture impossible | Réessayer 3 fois (2 s, 4 s, 8 s) ; au quatrième échec, abandonner la passe SANS avancer le curseur mémorisé. |

## La boucle côté DriveAI

```
curseur = <curseur mémorisé, ou rien pour un export complet>
répéter :
  r = GET /api/export/sauvegarde?apres=<curseur>
  déposer r.corps dans le dossier dédié, sous le nom de Content-Disposition
  curseur = r.X-Export-Curseur
  si r.X-Export-Termine == "oui" : sortir
mémoriser `curseur` — SEULEMENT ici, une fois TOUS les fichiers de la passe déposés
```

- **Un lot déposé deux fois n'est pas une erreur** (nom unique, contenu identique en substance) ; un lot perdu en est une.
  D'où : le curseur n'avance en mémoire qu'en fin de passe réussie.
- **Cadence recommandée** : une passe par jour, à un événement ou une minute qui n'est pas pile (jamais à `:00`). Une passe où
  rien n'a changé ne rend qu'un lot : la configuration.
- **Export complet chaque mois** (passe sans curseur, rangée dans un sous-dossier daté) : un `id` en série peut se valider
  dans le désordre sous écritures concurrentes, et une passe incrémentale peut alors rater une rangée. La passe complète
  referme ce risque.
- **Dépôt** : fichiers de l'export = dossier Drive dédié, exclu du tri. **DriveAI ne les analyse pas avec le LLM, ne les renomme
  pas selon sa convention, ne les classe pas.** Ce sont des octets opaques.

## Format et taille

- Un lot = un fichier autonome : NDJSON → gzip → AES-256-GCM. Disposition : `CARAIX` (6 octets) · version `0x01` · IV (12) ·
  chiffré · étiquette (16). La version change si le format change ; DriveAI n'en dépend pas.
- **Taille** : au plus 10 000 rangées ou 4 Mo de clair par lot ; chiffré et compressé, un lot pèse de l'ordre de quelques
  centaines de Ko (au plus ~4 Mo, plafond d'une réponse Vercel de 4,5 Mo). Un appel `UrlFetchApp` y suffit largement.
  [Supposition] : le volume total d'un export complet n'a pas encore été mesuré ; il le sera au premier export réel.
- **Contenu** : `vehicle_snapshots` (l'historique), `service_history`, `vehicle_commands_log`, `poll_runs`, `app_config`.
  Exclus : `otp_codes` (secrets de quelques minutes), `webhook_deliveries` (journal d'idempotence), `geocode_cache` (se
  reconstruit seul).

## Secrets (jamais dans un chat, jamais dans le dépôt)

| Nom | Où | Contenu |
|---|---|---|
| `EXPORT_KEY` | Vercel (CarAI) et coffre de Marc | 32 octets aléatoires en base64. **Sans elle, la sauvegarde est illisible.** DriveAI ne l'a pas. |
| `EXPORT_TOKEN` | Vercel (CarAI) et Script Properties de DriveAI (nom proposé : `CARAI_EXPORT_TOKEN`) | Au moins 32 caractères aléatoires. La même valeur des deux côtés. |

Marc les pose via le PC (.github#299). Sans les deux, la route répond 503 et rien ne sort.

## Restaurer (essayé une fois sur une base d'essai)

```
EXPORT_KEY=… RESTAURATION_DATABASE_URL=<base d'ESSAI migrée et vide> \
  node scripts/restaurer-sauvegarde.mjs <dossier-des-fichiers-.carai>
```

Tout est déchiffré et vérifié avant la première écriture ; une mauvaise clé ou un fichier altéré n'écrit rien. La cible se
donne par `RESTAURATION_DATABASE_URL`, jamais `DATABASE_URL`. Une base qui contient déjà des mesures est refusée
(`--forcer-non-vide`). Rejouable sans doublon. Le test `tests/exportSauvegarde.test.ts` rejoue cette restauration contre un
vrai Postgres (PGlite, migrations réelles) et compare table par table.
