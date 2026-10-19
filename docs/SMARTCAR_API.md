# Référence API Smartcar — capturée le 2026-08-14

> **Origine** : documentation officielle Smartcar, collée par Marc depuis son navigateur.
>
> ⚠️ **Pourquoi ce fichier existe.** Le code de CarAI répète à plusieurs endroits que « la doc
> Smartcar reste inaccessible depuis ces sessions » — le proxy sortant bloque `smartcar.com` et
> `compatibility.api.smartcar.com`. Plusieurs choix du projet ont donc été faits **de mémoire**,
> et au moins un s'est révélé faux (voir « Corrections » plus bas). Ce fichier est la première
> source de vérité écrite. Le tenir à jour quand Marc en colle davantage.
>
> **Ce fichier n'est PAS exhaustif** : il contient ce qui a été collé, pas toute la doc. Les
> pages de détail par commande (corps de requête, réponses) n'ont pas encore été récupérées.

## Adresses de base

| API | Chemin |
|---|---|
| Vehicle API | `https://vehicle.api.smartcar.com/v3` |
| Management API | `https://management.api.smartcar.com/v3` |
| Compatibility API | `https://compatibility.api.smartcar.com/v3/compatible-vehicles` |

Authentification : un seul jeton d'accès pour Vehicle et Management, obtenu en échangeant
`Client ID` + `Client Secret`. **Validité : 1 heure.**

## Commandes véhicule — la liste COMPLÈTE de la doc

C'est la section « Vehicle Commands » de l'aperçu de l'API. **Six commandes**, pas davantage.

⚠️ **L'aperçu de l'API n'en liste que six ; la référence détaillée en contient DIX.** Les
quatre horaires de charge n'apparaissent pas dans l'aperçu. Ne jamais traiter une page
d'aperçu comme un inventaire.

| Commande | Méthode et chemin (après `/v3`) | Corps | CarAI |
|---|---|---|---|
| Start charging | `POST /vehicles/{vehicleId}/commands/charge/start` | — | ✅ |
| Stop charging | `POST /vehicles/{vehicleId}/commands/charge/stop` | — | ✅ |
| Set charge limit | `POST /vehicles/{vehicleId}/commands/charge/set-limit` | oui | ✅ *(corrigé)* |
| Lock doors | `POST /vehicles/{vehicleId}/commands/security/lock` | — | ✅ |
| Unlock doors | `POST /vehicles/{vehicleId}/commands/security/unlock` | — | ✅ |
| Set destination | `POST /vehicles/{vehicleId}/commands/navigation/set-destination` | oui | ❌ |
| Set daily charge schedule | `POST /vehicles/{vehicleId}/charge-schedules/daily` | oui | ❌ |
| Set weekly charge schedule | `POST /vehicles/{vehicleId}/charge-schedules/weekly` | oui | ❌ |
| Set workweek charge schedule | `POST /vehicles/{vehicleId}/charge-schedules/workweek` | oui | ❌ |
| Delete charge schedule | `DELETE /vehicles/{vehicleId}/charge-schedules/{scheduleId}` | — | ❌ |

⚠️ **Les horaires de charge n'ont PAS de segment `/commands/`.** Leur chemin part directement
de `/vehicles/{id}/charge-schedules/…`. Irrégularité réelle de l'API, facile à « corriger »
à tort par symétrie.

### Bug trouvé par cette vérification

`set_charge_limit` pointait sur **`/commands/charge/limit`**, écrit de mémoire au cadrage. Le
vrai chemin est **`/commands/charge/set-limit`** : la commande renvoyait un 404 depuis
toujours.

Elle n'avait jamais été essayée sur la vraie voiture, et **aucun test ne codait le chemin** —
la suite était verte sur une commande morte. Un test qui vérifie qu'une table de chemins est
bien typée ne vérifie pas qu'elle est JUSTE ; seule une source externe peut le dire.

### En-tête `sc-user-id` — obligatoire sur CHAQUE commande

> « The bearer token is a machine-to-machine token and does not carry per-user context, so
> this header must be provided explicitly for **every command request**. »

Le jeton est machine-à-machine et n'identifie pas l'utilisateur : toute commande exige **à la
fois** le `vehicleId` (chemin) et le `sc-user-id` (en-tête).

✅ **CarAI le fait déjà** (`lib/smartcar/client.ts:88`) — vérifié, pas supposé.

### Réponses

`200 application/json`, enveloppe `data`. Pour les horaires : `data.attributes.action` vaut
`create` ou `delete`, `data.attributes.scheduleId` porte l'identifiant, et à la création
`data.links.schedule` donne le chemin pour relire ou supprimer la ressource.

⚠️ CarAI gère aussi un **202** (commande longue, > ~175 s) documenté au cadrage. Les pages
collées ne mentionnent que le 200 — ça ne prouve pas que le 202 n'existe pas, seulement qu'il
n'est pas sur ces pages. **Ne rien retirer sur cette base.**

### ⚠️ Écart non résolu entre la console et la doc

La console Smartcar de Marc (onglet Commands, capture du 14/08/2026) affiche **six familles**
de commandes activées pour son application :

| Console | Permission affichée | Présent dans la doc ci-dessus ? |
|---|---|---|
| Control EV Charge | Control charge | ✅ oui |
| Lock and Unlock the vehicle doors | Lock & unlock | ✅ oui |
| Send a destination to the vehicle's navigation | Control navigation | ✅ oui |
| Control the HVAC temperature | Manage climate settings | ❌ **absente de la doc** |
| Set/Remove a PIN to drive | PIN to drive | ❌ **absente de la doc** |
| Open and Close the vehicle's trunk | Control trunk | ❌ **absente de la doc** |

**Hypothèse de travail, non vérifiée** : la console liste le catalogue de permissions que
l'application *peut demander* (toutes marques confondues), tandis que la section « Vehicle
Commands » de la doc liste ce qui est réellement exposé par l'API générale. Trois lectures
possibles, et rien ne permet encore de trancher :

1. HVAC / coffre / NIP existent mais sont documentés ailleurs (pages non collées).
2. Ils existent pour certaines marques seulement, et pas pour Toyota.
3. Ils sont annoncés dans la console mais pas encore livrés côté API.

**Comment trancher** : l'API de compatibilité (ci-dessous) donne les commandes supportées
*par véhicule*. C'est la source qui ferme le débat.

## API de compatibilité — PUBLIQUE, sans authentification

> « The Compatibility API tells you which signals **and commands** each vehicle supports.
> The data comes from real connections on the Smartcar platform and updates daily. »

```
https://compatibility.api.smartcar.com/v3/compatible-vehicles?filter[make]=TOYOTA&filter[region]=CA
```

- **Aucune authentification** — ni identifiant, ni en-tête.
- Filtres en syntaxe JSON:API entre crochets : `filter[make]`, `filter[region]`,
  `filter[powertrainType]` (ex. `BEV`, `PHEV`).
  ⚠️ **Les paramètres plats sont IGNORÉS EN SILENCE** (`?make=TESLA` ne filtre rien et ne
  lève aucune erreur — on croit filtrer, on reçoit tout).
- Renvoie **tout le jeu de résultats d'un coup**. La pagination n'est pas honorée :
  mettre en cache localement et rafraîchir une fois par jour.
- Un navigateur peut aussi parcourir le jeu complet et le télécharger en CSV.

⚠️ **Bloquée depuis les sessions Claude** : `request blocked: no rule allows host
"compatibility.api.smartcar.com"`. Elle est en revanche accessible depuis le navigateur de
Marc, et depuis la production Vercel (à vérifier).

**C'est la vocation de `CLE_SMARTCAR_COMPAT`** — constante déclarée dans `lib/config.ts` et
utilisée nulle part. Quelqu'un avait prévu ce cache et ne l'a jamais branché.

## Connexions (Vehicle API)

| Opération | Endpoint |
|---|---|
| List Connections | `GET /connections` |
| Get Connection | `GET /connections/{connectionId}` |
| Remove Connection | déconnecte un véhicule |
| Remove User | supprime un utilisateur et TOUTES ses connexions |

`GET /connections/{connectionId}` — en-tête `Authorization: Bearer {token}` obligatoire,
`connectionId` en paramètre de chemin, réponse `200 application/json` avec un objet `data`.

## Webhooks (Management API)

Souscrire des véhicules pour recevoir des données **sur un horaire ou à l'événement**.
La doc les présente comme *« the recommended approach for most integrations »* — donc comme
préférables au sondage, ce que CarAI fait aussi.

**Authentification** : `Authorization: Bearer {jeton}` (`securitySchemes.bearerAuth`,
*« JWT or opaque »*). Pas de `sc-user-id` ici — ce n'est pas une API véhicule.
Base : `https://management.api.smartcar.com/v3`.

⚠️ **Erreur vécue le 17/08/2026** : ce jeton est le **même jeton M2M que la Vehicle API**
(`client_credentials` sur `SMARTCAR_CLIENT_ID`/`SMARTCAR_CLIENT_SECRET`, `lib/smartcar/auth.ts`
`obtenirToken`) — **PAS** `SMARTCAR_MANAGEMENT_TOKEN`, qui ne sert qu'à signer/vérifier les
webhooks entrants en HMAC (§ ci-dessous). La première version de `management.ts` avait supposé
que c'était le même jeton (une déduction, notée comme telle) ; Smartcar répondait 401 sur
`GET /webhooks` alors que les livraisons entrantes étaient acceptées avec succès — la preuve que
les deux jetons sont indépendants. Symptôme si reproduit : le panneau de `/donnees` affiche
« L'état des webhooks n'a pas pu être lu » alors que le tableau de bord Smartcar montre le
webhook `Enabled` et les livraisons en `200 OK`.

### Ce que l'API expose — la liste COMPLÈTE

| Opération | Endpoint | Réponse |
|---|---|---|
| Lister les webhooks | `GET /webhooks` | `WebhookListResponse` |
| Lire un webhook | `GET /webhooks/{webhookId}` | `WebhookDataResource` |
| Lister les abonnements | `GET /subscriptions` | `WebhookSubscriptionListResponse` |
| Lire un abonnement | `GET /subscriptions/{subscriptionId}` | `WebhookSubscriptionDataResource` |
| **Abonner un véhicule** | `POST /subscriptions` | **`202`** + `meta.message` |
| Désabonner | `DELETE /subscriptions/{subscriptionId}` | `204` |

Filtres `GET /webhooks` : `filter[name]`, `filter[callbackUri]`, `filter[isEnabled]`,
`filter[autoSubscribe]`, `page[number]`, `page[size]`.
Filtres `GET /subscriptions` : `filter[userId]`, `filter[webhookId]`, `filter[vehicleId]`,
`filter[vehicle.mode]`, pagination JSON:API (`page[size]` max 100, défaut 25).

Corps de `POST /subscriptions` (`SubscriptionRequest`) — les trois champs sont **requis** :

```json
{ "data": { "attributes": { "webhookId": "…", "userId": "…", "vehicleId": "…" } } }
```

⚠️ **La réponse nominale est un `202` « subscription creation in progress »**, pas un `200` :
l'abonnement n'existe PAS encore au retour de l'appel. Annoncer « abonné » sur ce 202 serait
la même erreur que lire le statut d'une commande dans son code HTTP (cf. plus haut).

### Deux ABSENCES, vérifiées dans la spec

1. **Il n'existe pas de `POST /webhooks`.** Un webhook ne se crée pas par l'API : ça se fait
   dans le tableau de bord Smartcar.
2. **`WebhookAttributes` ne porte AUCUN champ d'horaire.** Ses champs requis sont exactement
   `name`, `callbackUri`, `isEnabled`, `triggers`, `data`, `errorCallbackUri`,
   `autoSubscribe`. La FRÉQUENCE d'un webhook programmé n'est donc **ni configurable ni même
   lisible** par l'API.

⇒ Ce que le code peut faire : **constater** (le webhook existe-t-il, est-il actif, pointe-t-il
vers la bonne adresse, le véhicule y est-il abonné, livre-t-il encore) et **abonner**. Pas
créer, pas planifier. C'est ce que fait `lib/smartcar/webhookEtat.ts` (verdict pur) +
`lib/smartcar/management.ts` (accès), affiché en tête de `/donnees`.

⚠️ Le TYPE de webhook (programmé / événementiel) n'est pas un champ non plus. CarAI le
**déduit** de `triggers` : un webhook événementiel liste ses signaux déclencheurs, un webhook
programmé n'en a pas. C'est une lecture, étiquetée comme telle à l'écran, et elle ne sert
qu'à nuancer la gravité d'un silence — un webhook événementiel muet sur une voiture garée
est normal, un webhook programmé muet ne l'est pas.

### Désactivation automatique — la panne silencieuse à connaître

Le cadrage (Doc 2 §6.4) le documente : si le callback ne répond pas `2xx`, Smartcar retente
**6 fois avec backoff exponentiel puis DÉSACTIVE le webhook**. Une panne passagère de CarAI
coupe donc le flux **définitivement**, longtemps après que la cause a disparu, et rien ne
devient rouge nulle part. `isEnabled: false` est le seul témoin — c'est précisément ce que le
panneau de `/donnees` va lire.

## Schéma des signaux

Format d'appel : `GET /vehicles/{vehicleId}/signals/{catégorie}-{nom}`, tout en minuscules.
Exemples : `charge-amperage`, `hvac-cabintargettemperature`, `closure-reartrunk`.

Deux pages de référence existent et **n'ont pas encore été récupérées** :
- `/api-reference/signals/schema` — liste complète des signaux
- `/api-reference/permissions` — **permission requise par signal** ← répond à la question
  des noms exacts de portées OAuth

### Inventaire des signaux collés

**Charge** (22) — `amperage`, `amperagemax`, `amperagerequested`, `chargelimits`,
`chargeportstatuscolor`, `chargerate`, `chargerecords`, `chargerphases`, `chargetimers`,
`chargingconnectortype`, `detailedchargingstatus`, `energyadded`, `fastchargertype`,
`ischarging`, `ischargingcableconnected`, `ischargingcablelatched`, `ischargingportflapopen`,
`isfastchargerpresent`, `timetocomplete`, `voltage`, `wattage`

**Closure** (8) — `doors`, `enginecover`, `fronttrunk`, `islocked`, `reartrunk`, `sunroof`,
`tailgate`, `windows`

**ConnectivitySoftware** (1) — `currentfirmwareversion`

**ConnectivityStatus** (3) — `isasleep`, `isdigitalkeypaired`, `isonline`

**Diagnostics** (23) — `abs`, `activesafety`, `airbag`, `brakefluid`, `driverassistance`,
`dtccount`, `dtclist`, `emissions`, `evbatteryconditioning`, `evcharging`, `evdriveunit`,
`evhvbattery`, `lighting`, `mil`, `oillife`, `oilpressure`, `oiltemperature`, `telematics`,
`tirepressure`, `tirepressuremonitoring`, `transmission`, `washerfluid`, `waterinfuel`

**HVAC** (5) — `cabintargettemperature`, `iscabinhvacactive`, `isfrontdefrosteractive`,
`isreardefrosteractive`, `issteeringheateractive`

**InternalCombustionEngine** (4) — `amountremaining`, `fuellevel`, `oillife`, `range`

**Location** (2) — `isathome`, `preciselocation`

**LowVoltageBattery** (2) — `stateofcharge`, `status`

**Motion** (1) — `currentspeed`

**Odometer** (1) — `traveleddistance`

**Service** (2) — `isinservice`, `records`

**Surveillance** (2) — `brand`, `isenabled`

**TractionBattery** (4) — `isheateractive`, `maxrangechargecounter`, `nominalcapacity`, `range`

**Transmission** (2) — `drivemode`, `gearstate`

**VehicleIdentification** (5) — `exteriorcolor`, `nickname`, `packages`, `trim`, `vin`

**VehicleUserAccount** (2) — `permissions`, `role`

**Wheel** (2) — `style`, `tires`

### Signaux notables pour CarAI

- **`motion-currentspeed`** et **`vehicleidentification-vin`** — les deux signaux que le
  rapport du 06/08/2026 montrait en erreur `PERMISSION`. Ils existent bel et bien ; il ne
  manque que la portée. La page `/api-reference/permissions` donnerait son nom exact.
- **`vehicleuseraccount-permissions`** — « Permissions granted by the connecting account with
  the OEM. **These may be different than your application's Smartcar permissions** as they can
  be managed directly with the OEM. » Autrement dit : une commande peut échouer parce que le
  compte **Toyota** de Marc ne l'accorde pas, indépendamment de Smartcar. Ce signal permettrait
  de le dire à l'écran au lieu de laisser croire à une panne.
- **`connectivitystatus-isasleep` / `isonline`** — distinguent « voiture endormie » de
  « service en panne ». CarAI journalise aujourd'hui les deux comme un échec indifférencié.
- **`hvac-*`** (5 signaux) et **`closure-reartrunk` / `fronttrunk` / `tailgate`** — la LECTURE
  de l'état HVAC et du coffre est documentée, même si les COMMANDES correspondantes ne le sont
  pas. L'app pourrait afficher l'état sans pouvoir l'actionner.
- **`charge-chargelimits`** — structure bien plus riche que la limite unique gérée aujourd'hui :
  limite globale, limites par lieu (domicile), limites par type de charge (AC/DC).
- **`charge-chargerecords`** — historique des sessions de charge fourni par le véhicule
  (énergie, coût, lieu, bornes de SoC). CarAI reconstruit son propre historique par sondage ;
  cette source est native.

## Corrections apportées par cette doc

À garder : ce sont des affirmations qui ont été faites **de mémoire** puis démenties.

1. **« Le préchauffage, le klaxon et le coffre ne sont pas des commandes Smartcar »** — faux
   sur le fond : la console de Marc les propose (HVAC, coffre). L'API documentée ne les liste
   pas, ce qui est un écart réel, mais l'affirmation était trop catégorique et fondée sur rien.
2. **« La surface de commandes de Smartcar est petite : verrouillage, charge, c'est à peu
   près tout »** — incomplet : `Set Destination` existe et n'avait pas été envisagée.

Règle qui en découle, et qui vaut au-delà de Smartcar : **quand la doc d'un fournisseur est
inaccessible, une réponse de mémoire s'annonce comme une supposition, jamais comme un fait.**
Le coût ici a été faible (une question de plus à Marc). Il aurait pu être un scope invalide
écrit en dur, qui casse le Connect en entier — ce que le code de `connect.ts` documente
explicitement comme le risque à ne pas prendre.

3. **Le corps de `set_charge_limit` supposait une FRACTION** (0,5–1,0) et la clé `limit`. Le
   schéma réel est `{"data":{"attributes":{"percent":80}}}`, `percent` **entier de 50 à 100**.
4. **Le statut d'une commande était déduit du code HTTP.** Faux et dangereux : voir ci-dessous.

Règle qui en découle, et qui vaut au-delà de Smartcar : **quand la doc d'un fournisseur est
inaccessible, une réponse de mémoire s'annonce comme une supposition, jamais comme un fait.**
Le coût ici a été faible (une question de plus à Marc). Il aurait pu être un scope invalide
écrit en dur, qui casse le Connect en entier — ce que le code de `connect.ts` documente
explicitement comme le risque à ne pas prendre.

## Corps de requête (spec OpenAPI, section `components/schemas`)

```jsonc
// SetChargeLimitRequest — percent ENTIER, minimum 50, maximum 100
{ "data": { "attributes": { "percent": 80 } } }

// SetNavigationDestinationRequest — NavigationPoint (lat -90..90, lon -180..180)
{ "data": { "attributes": { "latitude": 46.8139, "longitude": -71.2080 } } }

// SetDailyScheduleRequest — heures "HH:MM" 24 h, volontairement SANS fuseau
{ "data": { "attributes": {
    "location": { "latitude": 46.8139, "longitude": -71.2080 },
    "startTime": "23:00", "stopTime": "07:00" } } }

// SetWeeklyScheduleRequest — au moins UN jour ; les jours omis ne sont pas planifiés
{ "data": { "attributes": { "location": {…}, "days": {
    "monday": { "startTime": "23:00", "stopTime": "07:00" } } } } }

// SetWorkWeekScheduleRequest — weekdays ET weekends tous deux requis
{ "data": { "attributes": { "location": {…},
    "weekdays": {…}, "weekends": {…} } } }
```

Toutes les commandes paramétrées partagent l'enveloppe `{ data: { attributes } }` —
d'où `corpsCommande()` dans `lib/smartcar/commands.ts`.

## ⚠️ Le statut d'exécution est dans le CORPS, jamais dans le code HTTP

C'est la découverte la plus importante de cette capture, et elle a corrigé un vrai bug.

`data.attributes.status.value` vaut **`SUCCESS`**, **`FAILURE`** ou **`PENDING`** — et un
`FAILURE` est servi **sous un HTTP 200 ou 202**. L'exemple officiel de la spec, pour un
verrouillage :

```jsonc
{ "data": { "attributes": {
    "commandType": "security-lock",
    "status": { "value": "FAILURE", "error": {
        "type": "VEHICLE", "code": "LOCK_FAILED",
        "detail": "The vehicle was unable to lock its doors." } } } } }
```

CarAI déduisait le statut du code HTTP : tout 200/202 porteur d'un corps devenait
« success ». **L'app annonçait donc « Verrouillé » sur une voiture qui avait refusé** —
précisément le « j'ai verrouillé et la voiture était ouverte » que l'en-tête de
`commands.ts` dit vouloir élucider.

Corrigé par `lireStatutExecution()`, verrouillé par `tests/commandes.test.ts` (discrimination
prouvée par mutation : remettre l'ancienne heuristique fait tomber 4 tests).

`error.suggestedUserMessage` — « a user-facing message that can be displayed directly to end
users » — est privilégié à l'affichage quand il existe.

Le **202** est confirmé par la spec : *« A 202 was sent to keep the connection alive; the body
contains the final command result. »* La prudence de la section précédente était justifiée.

## Codes d'erreur — de quoi diagnostiquer au lieu de dire « échec »

Types (`errors[].type`) : `AUTHENTICATION`, `BILLING`, `COMPATIBILITY`,
`CONNECTED_SERVICES_ACCOUNT`, `RATE_LIMIT`, `RESOURCE_NOT_FOUND`, `SERVER`, `UPSTREAM`,
`VALIDATION`, `VEHICLE_STATE`.

| HTTP | Sens |
|---|---|
| 409 | **`VEHICLE_STATE` / `ASLEEP`** — la voiture dort, réessayer plus tard |
| 429 | `RATE_LIMIT` — en-tête **`retry-after`** en secondes |
| 430 | `BILLING` — limite de véhicules du forfait |
| 501 | **`COMPATIBILITY` / `MAKE_NOT_COMPATIBLE`** — la marque ne sait pas faire |
| 502 | `UPSTREAM` — donnée invalide reçue en amont, `resolution: RETRY_LATER` |
| 504 | `SERVER` / `GATEWAY_TIMEOUT` |

Beaucoup portent aussi `resolution.type` (`RETRY_LATER`, `CONTACT_SUPPORT`, `REAUTHENTICATE`)
et `suggestedUserMessage`. De quoi distinguer « ta voiture dort » de « ta bZ ne sait pas
faire ça » de « Smartcar est en panne » — trois messages, trois actions différentes.

## Authentification

`POST https://iam.smartcar.com/oauth2/token`, corps JSON :
`{ client_id, client_secret, grant_type: "client_credentials" }`.
Réponse : `access_token`, `token_type`, `expires_in` (3600).

**Aucun jeton de rafraîchissement** — on en redemande un à l'expiration. `400 invalid_request`
= paramètre manquant ; `401 invalid_client` = identifiants faux.

## Deux endpoints que CarAI n'exploite pas

- **`GET /vehicles/{id}/signals`** — lit TOUS les signaux en un appel (paginé), au lieu d'un
  appel par signal. À confronter à la façon dont le poll s'y prend aujourd'hui.
- **`GET /vehicles/{id}/signals/{code}/values`** — **historique natif** d'un signal. CarAI
  reconstruit le sien en sondant et en stockant ; la source existe côté Smartcar.

Aucune conclusion tirée ici : les deux méritent une mesure avant tout changement.

## Correction à l'inventaire des signaux

La spec ajoute un groupe **Climate**, absent de la première capture :
`climate-externaltemperature` (température extérieure) et `climate-internaltemperature`
(température de l'habitacle) — distincts du groupe `HVAC`. L'inventaire ci-dessus les
omettait ; c'est un rappel qu'une liste tirée d'une page de doc n'est pas un schéma.

## Ce qui reste à récupérer

- [ ] `/api-reference/permissions` — **noms exacts des portées OAuth**. Toujours le point
      bloquant : un scope invalide fait échouer le Connect en entier. Rien dans la spec
      OpenAPI capturée ne les nomme.
- [ ] Réponse de l'API de compatibilité pour la bZ — tranche l'écart console/doc sur HVAC,
      coffre et NIP (publique, mais bloquée depuis les sessions Claude)
- [x] ~~Pages Webhooks~~ — **fait le 17/08/2026** depuis la spec OpenAPI de la Management
      API : voir la section « Webhooks » ci-dessus. Reste hors API et donc hors du code :
      la CRÉATION d'un webhook et le choix de sa FRÉQUENCE, qui se font dans le tableau de
      bord Smartcar.
