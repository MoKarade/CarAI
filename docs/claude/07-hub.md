<!-- Extrait de l'ancien CLAUDE.md (§ 7. Intégration hub), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Intégration hub

## 7. Intégration hub

- CarAI publie `GET /hub/summary` conforme à `@mokarade/hub-contract`. Jeton `x-hub-token`
  comparé en **temps constant** ; `HUB_TOKEN` absent → 503, jeton faux → 401.
- ⚠️ **`HUB_TOKEN` sert dans LES DEUX SENS.** Entrant : le hub le présente pour lire le
  summary. **Sortant** : CarAI le présente au hub sur `POST /api/acces` (`lib/accesHub.ts`)
  pour demander qui a le droit d'entrer. C'est ce jeton qui IDENTIFIE CarAI côté hub — aucun
  `appId` n'est envoyé dans le corps, sinon une app pourrait interroger les accès d'une autre.
- ⚠️ **`NEXT_PUBLIC_HUB_URL` n'est pas décoratif** : `lib/connexionHub.ts` en tire `URL_HUB`,
  qui sert à la redirection de connexion ET de destination à `POST /api/acces`. La pointer
  ailleurs coupe l'accès de tout le monde sauf le propriétaire, **silencieusement**.
- **Période des coûts** : le hub somme PAR période et ne fusionne jamais « cumulé » avec
  « ce mois-ci ». Si CarAI publie un jour un coût, ce sera `total` — c'est ce que publient
  toutes les autres apps.
- ⚠️ **CarAI LIT aussi FinanceAI, et ce n'est PAS le hub.** Les MONTANTS du bail (mensualité,
  solde, taux) n'existent pas ici : `TermesBail` ne porte que des dates et des kilomètres.
  `lib/financeai/bail.ts` les lit sur `GET /vehicule/bail` de FinanceAI, avec un jeton
  **dédié** (`FINANCEAI_BAIL_TOKEN`, jamais `HUB_TOKEN` — celui du hub ouvrirait la valeur
  nette pour lire une mensualité). ⚠️ « Injoignable » est un état **NORMAL** — que le serveur
  soit le PC de Marc (éteint) ou Cloud Run en scale-to-zero (~2 s de réveil) — et les **sept**
  modes de lecture donnent **sept messages distincts** (`lib/vehicle/messageBail.ts`) : chacun
  appelle un geste différent, un tiret unique les confondrait.
  ⚠️ **UNE seule lecture par requête, et elle vit dans `collecter()`.** Le summary du hub et
  l'accueil ont tous deux besoin des montants ; l'accueil relisait FinanceAI de son côté, donc
  deux appels réseau pour la même question, et la possibilité que la carte du hub et l'écran
  affichent des montants différents sans que rien ne dise lequel a raison. Le délai reste
  paramétrable parce que les deux budgets diffèrent (3 s pour l'accueil, `DELAI_SUMMARY_MS`
  pour le summary — le hub accorde 9 s à chaque app).
  ⚠️ Le total d'un bail est `mensualité × durée`, JAMAIS le montant financé.
  ADR [`0004`](docs/adr/0004-bail-en-dollars-lu-chez-financeai.md).
- **CarAI déclare son propre rythme, et c'est le hub qui compare** (`expectedMaxAgeSec`,
  contrat v1.3). ⚠️ La valeur est DÉRIVÉE de `FRAICHEUR_STATUT_MINUTES`
  (`lib/vehicle/charges.ts`), jamais écrite une deuxième fois : ce seuil décide déjà, dans
  l'app, si un statut de charge s'énonce au présent ou au passé. Deux nombres sur la même
  question divergeraient au premier réglage, en silence.
  Ce que ça règle côté hub : il voyait `dataAsOf` sans savoir si sa valeur était bonne —
  40 min est sain pour la bZ et catastrophique pour un moteur qui passe aux 5 min — donc il
  ne pouvait que DEVINER, et un seuil deviné là-bas serait de la connaissance de CarAI codée
  en dur dans le hub.
- **La vue détaillée EXPLIQUE la carte, elle ne l'allonge pas** (`details`, contrat v1.3,
  `sectionsDetail` — PURE). Quatre sections : « Bail » donne les termes derrière le
  pourcentage consommé (km sur alloués — **c'est là que vit l'odomètre cumulé**, jours
  restants, rythme observé contre rythme encore permis, projection, et les RÉSERVES du
  calcul) ; « Charge » donne la fin annoncée derrière l'état ; « Route » donne la couverture
  réelle derrière « Km (7 jours) » **ou la raison de son absence** ; « Coût du véhicule »
  donne la composition derrière « Versé au bail », et **nomme ce qui n'y est pas compté**.
  Le plafond de six métriques reste entier — il protège la carte, pas le détail.
  ⚠️ Les libellés sont uniques DANS leur section : le hub retrouve une série historique par
  le couple (section, libellé), et le contrat rejette les homonymes. Ce n'est donc pas une
  vigilance, c'est un test.
- ⚠️ **LE PLAFOND DE SIX MÉTRIQUES EST ATTEINT, ET SA TRONCATURE EST SILENCIEUSE.** La carte
  publie exactement six lignes : Charge (`primary`), Autonomie, État de la charge,
  Km (7 jours), Bail consommé, Versé au bail. Une septième ne casse rien — `metrics.slice(0, 6)`
  la fait simplement disparaître, et `validateSummary` reçoit un tableau déjà tronqué, donc
  valide. `tests/summary.test.ts` énumère les six sur l'instantané le plus fourni : ajouter une
  métrique fait échouer ce test, et la question posée est alors la bonne — **laquelle des sept
  descend dans `details` ?** C'est comme ça qu'« Odomètre » a cédé sa place à « Km (7 jours) »
  le 15/09 : un cumul qui monte ne décide de rien, les kilomètres d'une semaine oui.
- ⚠️ **UNE MÉTRIQUE DE CARTE N'A PAS DE `hint` — donc un chiffre hors de son étiquette s'OMET.**
  « Km (7 jours) » se mesure entre deux relevés d'odomètre, qui ne tombent jamais pile sur les
  bords de la fenêtre. Un relevé de départ trop vieux fait SUR-estimer (des jours comptés en
  trop), un silence de la source fait SOUS-estimer. `kmPubliable` borne les deux — et pas
  symétriquement : la sur-estimation gonfle la seule métrique à partir de laquelle Marc
  déciderait de rouler moins, la sous-estimation ressemble à « la voiture n'a pas bougé ».
  Hors bornes, la carte n'affiche rien et la section « Route » DIT pourquoi : une absence
  expliquée vaut mieux qu'un nombre crédible et faux.
- ⚠️ **« Versé au bail » n'est PAS « prix total », et le libellé le dit.** Marc a demandé « le
  prix total depuis le début (avec prêt) » ; ce chiffre est la part exactement connue — les
  versements du contrat. Le coût des recharges n'y est pas : une partie est ESTIMÉE (tarif
  typique, jamais facturé) et `lib/vehicle/montants.ts` a déjà tranché que le mesuré et
  l'estimé ne s'additionnent pas pour porter une tuile ; et la couverture des sessions
  observées était mesurée à **0,25** le 15/09. Un total qui les mêlerait serait crédible et
  faux. La ligne « Recharges » de la section « Coût du véhicule » dit qu'il n'est pas compté,
  et où le trouver.
- ⚠️ **Ne jamais publier une valeur de capteur BRUTE sur la carte.** Le champ du statut de
  charge valait littéralement `"true"` jusqu'au 14/09 : le hub affichait « Charge en cours —
  true », en anglais et en jargon, sur une carte qui n'a que cinq lignes. La réponse
  interprétée existait depuis le 20/08 (`statutDeCharge`, cinq modes dont « branchée en
  attente », qui est NORMAL chez Marc). Ce qui manquait n'était pas la donnée, c'était de
  la faire passer par elle.
