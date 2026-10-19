# BACKLOG — CarAI

Convention : chaque tâche porte une case. Un item fini et validé (mergé, gate vert) part
dans la section « Livré » avec sa date. Une note sans travail à faire n'est pas une tâche.

## Où passe la frontière (recensé le 18/09/2026, après « fini backlog entier »)

Ce qui reste ne se ressemble pas, et les mélanger fait croire qu'il suffit de continuer à
coder. Trois familles :

| famille | items | ce qui débloque |
|---|---|---|
| **Un geste de Marc** | `[INFRA-08]` `[BAIL-01]` `[ENTRETIEN-01]` `[SC-03]` `[MCP-01]` `[DATA-01]` `[TOY-01]` à `[TOY-05]` | une variable à poser, un scope OAuth à accorder, un compte à créer, ou une commande réelle à envoyer au véhicule |
| **Une donnée qui n'arrive pas** | `[SANTE-01]` | `tractionbattery-capacity` n'a **jamais** livré une ligne (mesuré) : la dégradation n'est pas calculable, quel que soit le code écrit |
| **Un arbitrage produit** | `[COUT-03]` `[SC-08]` `[UI-03]` | ce que Marc veut VOIR — aucun n'est bloqué techniquement |
| **Rien du tout** | `[QUAL-01]` | ajouté le 18/09 en réparant la duplication que SonarCloud refusait sur `[SC-04]` : deux préambules recopiés, purement technique, personne à attendre |

⚠️ **Sauf `[QUAL-01]`, aucun de ces items ne se débloque en codant plus.** C'est pourquoi « finir le
backlog » s'arrête ici tant que Marc n'a pas tranché : livrer quand même produirait du code
sans usage (`[COUT-03]` visait une ambiguïté qui n'existe pas dans ses données), un écran
qui dit en permanence qu'il ne sait rien (`[SANTE-01]`), ou un scope OAuth demandé en
silence (`[ENTRETIEN-01]`) — ce que le workflow du dépôt interdit expressément.

## Installable sur le téléphone (Marc, 18/09/2026 — Android) ✅

- [x] **`id` et `launch_handler: navigate-existing` au manifeste.** Sans `id`, l'identité de
  l'installation EST le `start_url` : le jour où il change, Android installe une SECONDE app au
  lieu de mettre à jour la première. `navigate-existing` fait qu'un lien venu du hub réutilise la
  fenêtre ouverte plutôt que d'en empiler une. Garde : `tests/pwaManifeste.test.ts`, 3
  perturbations prouvées.
- [x] **Rien d'autre à faire ici, et c'est une mesure** : le manifeste avait déjà ses icônes 192,
  512 et maskable-512 DISTINCTES, et son service worker était bien enregistré. Sur les sept dépôts
  du parc, seul FinanceAI n'était pas installable (une unique icône SVG, que Chrome refuse pour
  fabriquer le WebAPK).
- [ ] **⏸️ La bascule « le lien du hub ouvre l'app installée » n'est pas vérifiable d'ici** : elle
  dépend de la version de Chrome, de l'installation réelle et d'un réglage système. C'est le
  téléphone de Marc qui tranche. Côté hub, le verrou était un `target="_blank"` retiré là-bas.

---

## Chaîne de build — le GITHUB_TOKEN restait lisible tout le run (audit du 18/09/2026)  ✅

Lot L2 de l'audit multi-outils, livré le 18/09.

- Les **3** étapes `actions/checkout` portent `persist-credentials: false`. La v2+ écrit le
  `GITHUB_TOKEN` dans la config git du runner POUR TOUT LE RESTE DU RUN : n'importe quelle
  étape suivante, y compris une action tierce, peut le lire. Vérifié un par un qu'aucun
  workflow ne fait de `git push` — `auto-merge.yml` passe par l'API avec `GH_TOKEN` en
  variable d'environnement, que `gh` lit SANS toucher à la config git.
- Les **2** `npm ci` portent `--ignore-scripts`. ⚠️ **MESURÉ avant d'être posé**, parce que le
  piège est réel ailleurs (Playwright, esbuild) : `npm ci --ignore-scripts` puis typecheck,
  build et **1 400 tests** — tous verts.
- `S8543` et `S7637` sont **sans objet ici** : aucun `npm install -g`, et uniquement des
  actions `actions/*`.
- ⚠️ **Le recensement se fait sur la forme syntaxique, jamais sur la mention** : le
  commentaire qui explique le correctif nomme `npm ci` et `actions/checkout`, donc un `sed`
  naïf le réécrit et un `grep` naïf le compte. Payé sur Hubperso le même jour (6 → 10
  checkout pour 4 corrections, et un commentaire abîmé). Classe dans
  `FinanceAI/docs/CONVENTIONS.md`.

⚠️ **Ce dépôt n'a JAMAIS été analysé par SonarCloud** (« Your default branch has not been
analyzed yet ») — ce n'est pas « 0 problème », c'est « aucune mesure », et les deux s'affichent
du même tiret. Le lot ci-dessus vient d'Aikido et d'un recensement à la main, pas de Sonar.
À déclencher côté SonarCloud si Marc le veut (§M3 du document d'audit).

---

## Demandé par Marc, à faire

- [ ] `[NEON-TRANSFERT]` **Réduire le transfert Neon (limite mensuelle dépassée).** (a) FAIT : auto-refresh 30 s retiré
      de /tendances et /activite (bouton manuel), /donnees à 15 min et en pause onglet caché.
      (b) FAIT le 15/10 (CarAI#200) : période de 7 j par défaut sur /tendances ; LIMIT (50 000, côté récent,
      `tronquee` le dit) sur `lireSerie` brut. (b bis) FAIT le 16/10 (CarAI#254) : au-delà de 7 j, les courbes de
      Tendances lisent un agrégat SQL (heure jusqu'à 45 j, jour au-delà). Reste : la CONSOMMATION de Tendances
      relit encore l'odomètre et la charge en brut sur la fenêtre (`calculerConsommation` a besoin des trajets) ;
      (c) FAIT le 16/10 (CarAI#202) : l'inventaire de purge ne se charge plus à l'ouverture de Réglages, un bouton le déclenche.

- [ ] `[REFONTE-UI]` **Refonte complète de l'interface, PC et téléphone** (Marc, 18/09/2026 :
      « je veux full retravailler l'interface sur PC et téléphone »). Cadrée par 21 questions
      et leurs réponses ; les décisions sont écrites ici parce qu'un arbitrage qui ne vit que
      dans une conversation se reperd à la session suivante.
      **Ce que Marc a arbitré** : pas d'usage dominant, **moitié PC / moitié téléphone**, une
      minute par visite. Trois chiffres au coup d'œil — **charge, coût total, autonomie**.
      Chiffres NUS (« pas trop de texte ou blabla ») mais une recommandation quand il y a une
      action à prendre. Alertes visibles **seulement si non vides**. Sombre **imposé**
      partout. **Plus** d'animation. Barre en bas sur téléphone. Vraie disposition en
      **colonnes** sur PC. Direction visuelle actuelle gardée — « on range », on ne change pas.
      - [x] **Lot 1 — fondations de style** (18/09). Six points de rupture → **deux**
            (`max-width: 700px`, `min-width: 900px`), dont QUATRE étaient dans des blocs
            MORTS. Verrouillé par `tests/pointsDeRupture.test.ts`.
      - [x] **Lot 2 — l'accueil** (18/09). Les trois chiffres de Marc remplacent
            charge/autonomie/« Aujourd'hui », le bandeau devient visible **sur les deux
            écrans**, et « Ce qui cloche » disparaît quand il n'y a rien.
            Verrouillé par `tests/essentielAccueil.test.ts`.
      - [x] **Lot 3 — le PC** (15/10, CarAI#188) : vraie grille en colonnes sur les quatre écrans.
            L'accueil garde `.heros-constructeur` ; Activité (les journées), Tendances (état +
            consommation, déductions + bail) et Données (cadence + livraisons) posent leurs
            groupes dans `.colonnes-pc`, sous `@media (min-width: 900px)`. Verrouillé par
            `tests/grillesEcransPc.test.ts`. Les grands blocs (cartes, courbes, tableaux de mesures)
            restent pleine largeur.
      - [x] **Lot 4a — le modèle et ses ancres** (18/09). Le modèle vient de Marc
            (`MoKarade/bz-modele`), donc pas de question de licence. Préparé et mesuré :
            **81,67 Mo → 6,05 Mo** (−92,6 %), 2 071 673 → 773 056 triangles, sans perte
            visible. Recette rejouable dans `scripts/preparerModele3d.mjs`.
            ⚠️ **Ce que le ménage a retiré** : un kayak, des skis, un vélo, une galerie
            Thule, et 47 maillages de nuanciers de sellerie posés À CÔTÉ de la voiture.
            Sans eux la boîte englobante passe de 583 à 212 cm de large — et elle concorde
            alors avec la bZ4X du catalogue à **0,02 %** sur la longueur, ce qui valide
            d'un coup l'échelle (1 unité = 1 cm) et l'orientation.
            ⚠️ **Le repère, établi par la mesure** : Y vers l'avant (pare-brise et feux
            arrière concordent), Z vers le BAS (sol à +2,4, toit à −161,2), essieux à
            ± 145 cm. `lib/vehicle/ancresVoiture.ts` en dérive les neuf marqueurs.
            ⚠️ **`COTE_VERIFIE` vaut `false`** : rien dans le modèle ne dit quel côté est la
            gauche — il faudrait un élément asymétrique, et l'intérieur est fusionné tandis
            que la trappe de charge n'existe sous aucun nom. Se confirme d'un coup d'œil,
            se corrige en changeant un signe. Tant que c'est `false`, l'interface doit dire
            que gauche et droite ne sont pas garanties.
      - [x] **Lot 4b — le rendu three.js** (18/09). Derrière un bouton qui écrit son poids,
            chargé par `next/dynamic` avec `ssr: false`. Mesuré après build : l'accueil reste
            à **111 kB** de premier chargement, aucun chunk d'entrée ne contient `three`.
            Verrouillé par `tests/chargementDiffere3d.test.ts`, dans les deux sens.
            ⚠️ **La rotation est +90°, pas −90° — cette ligne portait le mauvais signe.** Elle
            se DÉRIVE de la matrice (`y' = −z`, `z' = +y` à +90°) : le toit part en haut et le
            nez vers l'observateur. À −90° la voiture serait sur le toit, **et rien ne
            planterait**. `ROTATION_X_RAD` vit donc dans le module pur et un test compare le
            toit au sol — deux écritures de la même rotation, dans deux fichiers qui ne se
            lisent jamais ensemble, ce sont des marqueurs qui flottent à côté de la voiture.
            ⚠️ **Rien n'est redérivé** : la vue reçoit les mêmes `PointVoiture` que le schéma
            2D. Ce qui n'a pas de lieu sur une carrosserie (odomètre, horodatage) s'affiche
            SOUS la vue — l'y poser inventerait un endroit, et l'endroit se lirait comme un sens.
            ⚠️ **Le décodeur Draco est une COPIE de `node_modules`** (250 Ko, `public/draco/`) :
            le modèle déclare `KHR_draco_mesh_compression` en extension REQUISE. Une mise à
            jour de `three` ferait dériver la copie, et un décodeur désaccordé échoue au
            CHARGEMENT — pas au build, pas aux tests. `tests/decodeurDraco.test.ts` compare
            les octets.
            ⚠️ **Ce que le rendu décide quand même** : rendu À LA DEMANDE (rien ne bouge dans
            cette scène — une boucle à 60 images/s redessinerait la même image en brûlant la
            batterie), et un marqueur invisible n'est pas cliquable (sinon on vise une portière
            et on ouvre le pneu d'en face).
      - [ ] **Lot 4 — la voiture en 3D**. Marc : « limite une interface 3D que je peux voir
            la voiture, tourner autour, et voir les états de chaque élément ».
            ⚠️ **MESURÉ LE 18/09, ET ÇA BORNE LE LOT** : seuls **six** éléments physiques ont
            une donnée VIVANTE — les 4 pneus (1 412 mesures), les portières, les fenêtres, le
            verrouillage, le coffre avant, la trappe de charge. Le hayon, le toit ouvrant, le
            coffre arrière, la climatisation, les températures, la batterie 12 V et **tous**
            les `diagnostics-*` ont livré 3 valeurs en août puis plus rien : la bZ les refuse.
            Un modèle 3D complet AFFICHE pourtant un hayon et un toit — les colorier « tout va
            bien » serait inventer une mesure. Il faut une convention visuelle où le non
            instrumenté est éteint et le DIT.
            ⚠️ **Le modèle** : voie retenue (a) — carrosserie **construite par code**
            (three.js, formes primitives), gratuite et sans licence à obtenir. Écarté : (b) un
            modèle importé — il n'existe **pas** de bZ sous licence libre, et les modèles de
            voitures réelles sont payants ou interdisent la publication web ; (c) quatre vues
            SVG qui pivotent — léger, mais ce n'est pas « tourner autour ».
            ⚠️ **Poids** : three.js pèse ~150 Ko compressés. Chargement DIFFÉRÉ obligatoire —
            jamais au démarrage, sur une app dont le premier écran doit être court.
      - [ ] **Lot 5 — Tendances**. Marc l'utilise (« a ») mais « à améliorer beaucoup », sans
            préciser quoi. Quatre ou cinq questions ciblées avant d'y toucher.
      - [x] **Lot 6 — les recommandations** (« dis-moi quoi faire »), là où c'est calculable
            (16/10, CarAI#190). L'écran normal ne porte QUE des chiffres, une phrase courte
            n'apparaît que s'il y a une action à prendre. Une seule règle posée : charge basse
            et non branchée → « Branche la voiture. » (`lib/vehicle/recommandation.ts`, déduite
            de l'alerte `charge-basse`, aucun seuil recopié). Les autres alertes (verrou, pneus,
            ouvrants) n'ont pas encore de phrase : à décider avec Marc avant d'en ajouter.
            Verrou : `tests/recommandation.test.ts`.
- [ ] `[UI-CSS-MORT]` **Du CSS qui ne peint plus rien**, trouvé le 18/09 en unifiant les points
      de rupture. Les écrans `/trajets` et `/recharges` ont fusionné dans Activité le 17/08 et
      `.heros` a cédé la place à `.heros-constructeur` : leurs règles ne sont posées par aucun
      JSX. Seules leurs media queries avaient été retirées (c'était le sujet du lot).
      - [x] `.trajets` (18 règles) et `.panneau-vehicule` (1 règle) retirés de
            `app/globals.css` le 15/10/2026 (CarAI#187), sans changement visible.
      - [x] Reste retiré de `app/globals.css` le 16/10/2026 (CarAI#249), sans changement visible,
            après avoir revérifié qu'aucun JSX ne pose `.heros`, `.trajet-barre`, `.panneau-image`,
            `.faits-vehicule`, `.fait-valeur`, `.fait-libelle`. Verrou : `tests/styleMort.test.ts`.


- [x] `[SC-SIGNAUX-CONFIRMES]` **Deux signaux passaient `SUCCESS` sans figurer dans
      `SIGNAUX_CONFIRMES_BZ`** — ajoutés le 18/09/2026, la liste passe de 15 à 17.
      ⚠️ La stabilité a été MESURÉE avant l'ajout, pas déduite d'un poll : un statut de poll
      est un instantané (`charge-timetocomplete` sortait `ERROR (COMPATIBILITY)` le 17/09
      alors qu'il est confirmé et porte 603 valeurs — il ne répond que PENDANT une charge).
      Le discriminant retenu est l'HISTORIQUE de `inventaire_donnees` :
      - `motion-currentspeed` → 1 180 valeurs depuis le 06/08, dernière à la minute du
        relevé. Aucun doute.
      - `tractionbattery-nominalcapacity` → 46 valeurs, et surtout **`nbMesures` ==
        `nbValeurs`**, donc **jamais une seule ligne de refus** : `filtrerRepetitions`
        n'écrit une ligne sans valeur que sur un CHANGEMENT de statut. Son rythme lent
        (~1/jour) vient de l'horodatage du véhicule — une capacité nominale ne bouge pas.
      ⚠️ Ce qui était en jeu : `/donnees` compare la base à cette liste pour dire ce qui
      manque. Un signal absent de la liste ne pouvait pas être signalé manquant — le jour
      où la vitesse cesserait d'arriver, rien ne l'aurait dit. C'était un trou dans
      l'INDICATEUR, pas dans la donnée.

- [x] `[CHARGE-TEMPS-REEL]` — **TICKET FAUX, fermé le 18/09/2026 le jour même de son
      ouverture. Le remède était livré depuis le 20/08.**
      Il annonçait que `lib/vehicle/charges.ts` extrapole un temps de charge que le véhicule
      LUI DONNE. La première moitié était juste (la bZ publie bien `charge-ischarging`, 762
      valeurs, et `charge-timetocomplete`, 603) ; la seconde était fausse : `statutDeCharge()`
      rend déjà `finAnnoncee` depuis le 20/08, l'accueil l'affiche (`app/page.tsx`) et le hub
      la publie (`lib/hubSummary.ts`). Les deux chiffres — annoncé par la voiture, extrapolé
      du rythme — sont montrés CÔTE À CÔTE, par décision écrite dans le code.
      ⚠️ **D'où venait l'erreur, et c'est la leçon** : ce ticket a été écrit d'après un
      COMMENTAIRE de `charges.ts` (« la bZ ne publie ni l'un ni l'autre, elle ne sert que 15
      signaux »), pas d'après le code. Le commentaire était vrai en août et périmé depuis.
      **Un ticket écrit d'après un commentaire décrit le PASSÉ du commentaire.** Le
      commentaire est corrigé, et il porte désormais cette histoire pour que personne ne
      rouvre le ticket.

- [x] `[SEC-02]` **Cinq avis de sécurité sur des dépendances de PRODUCTION, dont une RCE
  critique non authentifiée** (14/09/2026). Trouvés parce que le job `audit` a rougi sur la
  PR `[HUB-01]`, qui ne touche aucune de ces dépendances. Vérifié préexistant avant d'agir :
  l'audit rejoué sur `origin/main` dans un worktree séparé rend les cinq mêmes avis.
  - `next` ≤ 15.5.23 — **critique** : GHSA-2xp9-vwfh-vxw4, RCE **non authentifiée** dans
    l'API d'optimisation d'images (fichiers AVIF). GHSA-p293-qw3h-jr36 ne vise que les
    serveurs Windows et ne s'applique pas à Vercel.
  - `fast-uri` 3.0.0-3.1.5 — **haute** : deux SSRF (normalisation IPv6 malformée,
    pourcent-décodage répété du nom d'hôte) et deux confusions d'hôte.
  - `sharp` < 0.35.4 — **haute** : GHSA-rgj7-g3m4-5g8c (libheif).
  - `hono` ≤ 4.13.4 et `qs` ≤ 6.15.3 — **modérées** (écriture hors répertoire, épuisement
    mémoire, différentiels de clé de cache, déni de service).

  Corrigé par `npm audit fix` : **lockfile uniquement**, aucune contrainte de version
  touchée. `npm audit --omit=dev` : 0 vulnérabilité. Gate rejoué entier après le bump.
  ⚠️ Ça change ce qui est SERVI (Next lui-même) : vérifier le déploiement de production
  après le merge, pas seulement la CI.
  ⬜ **Le même avis Next frappe TOUTE la constellation** — Hubperso était dans le même cas
  (corrigé le 14/09). À vérifier sur DriveAI, JobAI, BatchChef et FinanceAI.

- [x] `[HUB-01]` **Ce que CarAI publie au hub, enrichi du contrat v1.3** (14/09/2026).
  Marc, 14/09 : « les données ne sont pas à jour, le hub est assez inutile ». Sa liste pour
  CarAI — charge **et si elle charge**, bail consommé, autonomie, odomètre — était déjà
  publiée en entier ; ce qui manquait était ailleurs.
  - `expectedMaxAgeSec`, **dérivé** de `FRAICHEUR_STATUT_MINUTES` : le hub cesse de deviner
    si `dataAsOf` est bon. ⚠️ Conséquence assumée — le poll GitHub Actions étant mesuré à
    ~3× plus lent que déclaré (trou de 6 h 53 le 14/09), le hub dira « donnée figée » plus
    souvent qu'on ne l'aimerait. C'est le but ; relever le seuil masquerait la panne.
  - `primary` sur la charge : le hub retombait sur la première métrique du tableau, donc
    donnait le bon résultat par CHANCE — l'ordre de `hubSummary.ts` n'est garanti par rien.
  - `details` : deux sections qui EXPLIQUENT la carte (bail, charge), sans l'allonger.
  - 🔴 **Bug corrigé au passage** : le statut de charge publié valait `"true"`. Le hub
    affichait « Charge en cours — true ». `statutDeCharge` savait répondre depuis le 20/08.
  - ⬜ **Reste** : les ouvrants, la pression des pneus et le verrouillage ne sont PAS
    publiés. Leurs valeurs sont des structures JSON (`valeurStructuree`) qu'aucune fonction
    n'interprète encore en français — et Marc a rangé ça dans l'accueil de CarAI, pas dans
    le hub. À faire avec `[BAIL-04]` / la refonte d'accueil, pas ici.

- [x] `[MCP-02]` **Connecteur MCP vers CarAI** — que Claude ait toutes les infos de la
      voiture (demande de Marc, 19/08). L'ambition existe depuis le cadrage (« les expose
      à Claude via un serveur MCP », en-tête de `CLAUDE.md`) mais rien n'est écrit.
      Points à trancher AVANT de coder :
      - **Lecture seule d'abord.** Les commandes véhicule (verrouiller, charger) passent
        déjà par `autoriserCommande` ; les exposer au MCP ajoute une surface d'action à
        distance et demande sa propre décision — la séparer de la lecture.
      - **Auth.** Le MCP n'a pas de session Google : il lui faut son propre jeton, route
        déclarée UNE PAR UNE dans `ROUTES_A_AUTH_PROPRE` (jamais un préfixe), échec fermé.
      - **Vie privée.** La position exacte du domicile ne doit pas sortir telle quelle —
        appliquer la règle des lieux (`lireLieux`), comme l'écran le fait déjà.
      - **Outils probables** : état courant, trajets d'une période, recharges et coûts,
        bail et projection, santé du canal. Réutiliser les fonctions PURES existantes
        (`lireEtatVehicule`, `decouperTrajets`, `reconstituerCharges`, `calculerEtatBail`)
        plutôt que de recalculer — deux implémentations divergeraient.
- [x] `[COUT-04]` **Le bail en DOLLARS à l'accueil — « ce que j'ai payé vs le prix total »**
  (demande de Marc, 15/09 ; lot B du cadrage du jour). Bail **sans comptant**
  (confirmé par Marc), mensualité déduite de la série de projection de FinanceAI (soldes
  successifs), taux 0 %. Donc : total = mensualité × durée, payé = mensualité × mois
  écoulés, et le solde de FinanceAI sert de contrôle de cohérence.
  ⚠️ **CarAI ne connaît AUCUN de ces chiffres** : `TermesBail` porte les dates, les km et les
  tarifs, jamais la mensualité. Et le `/hub/summary` de FinanceAI ne les publie pas non plus
  (valeur nette, cashflow, liquidités, placements). Il faut donc un endpoint dédié côté
  FinanceAI — `GET /vehicule/bail`, gardé par jeton, même patron que `/hub/summary` — plus un
  ADR de chaque côté. Marc a demandé « que toutes les apps soient connectées entre elles » :
  l'analyse du coût de cette architecture est dans la session du 15/09 ; la décision reste à
  prendre, et ce ticket ne la préjuge pas.
  ⚠️ Si FinanceAI est injoignable (il tourne sur le PC de Marc), le bandeau le DIT — jamais
  un chiffre figé sans le dire.
  ✅ **Livré le 15/09** (ADR [`0004`](docs/adr/0004-bail-en-dollars-lu-chez-financeai.md) ici,
  ADR 0017 chez FinanceAI). Ce qui a été tranché en chemin : la mensualité DÉDUITE que ce
  ticket citait (un montant déduit) n'est pas utilisée — elle est LUE, et le solde sert de contrôle
  de cohérence. Le **total est `mensualité × durée`**, jamais le montant financé (faux dès que
  le taux n'est pas nul). ⚠️ **Le coût des recharges n'est PAS dans ce bandeau** alors que Marc
  avait répondu « contrat + recharges » : le cumul depuis la signature exige tout l'historique
  de positions, que l'accueil ne charge pas (et qui grandit). Il reste sur Activité, qui le
  porte déjà. Reste un lot à part si Marc veut les deux au même endroit.

- [ ] `[COUT-03]` **Le lieu d'une recharge quand l'app ne le reconnaît pas** (demande de
      Marc, 24/08) — **RE-CADRÉ le 18/09/2026 : le ticket visait un cas qui n'existe pas.**
      Il décrivait la DÉSAMBIGUÏSATION — « si plusieurs lieux tarifés sont assez proches, ne
      pas trancher au hasard, demander à Marc ». Mesuré sur les **20 sessions réelles des
      30 derniers jours** : **zéro ambiguïté**. Marc a deux lieux enregistrés (Maison,
      Travail), à des dizaines de kilomètres l'un de l'autre ; aucune session n'a jamais eu
      deux candidats. Coder la question à poser serait du code sans usage.
      **Ce que la même mesure montre, et qui est réel** : **4 sessions sur 20 sans lieu
      reconnu** — une à `null` (15/09, 7 h branché quelque part) et trois recharges rapides
      en voyage (`~46.83,-71.28`, `~46.33,-72.60`, `~48.43,-71.06`). Elles tombent donc sur
      une estimation d'ordre de grandeur alors que Marc, lui, SAIT où il était.
      Le vrai lot serait donc : **nommer APRÈS COUP le lieu d'une session sans lieu**, et
      pouvoir en faire un lieu tarifé d'un geste. À trancher avec Marc avant de coder —
      c'est une autre fonctionnalité que celle du ticket d'origine, même si elle sert la
      même intention.
      ⚠️ Ordre de grandeur qui dimensionne l'enjeu : sur 30 jours, **2,70 $ mesurés contre
      47,85 $ estimés**. L'essentiel de l'écart ne vient PAS des lieux inconnus mais du
      tarif HORAIRE de « Travail », dont la durée est une fenêtre entre deux relevés et non
      un temps de branchement mesuré — un sujet distinct, et sans solution côté données.
- [ ] `[SANTE-01]` **Section santé de la batterie** (demande de Marc, 24/08). Signaux déjà
      au catalogue et non exploités : `tractionbattery-capacity` (`battery_capacity`) et
      `tractionbattery-nominalcapacity` (`battery_capacity_nominal`) — leur rapport dans le
      temps EST la dégradation. Si l'historique est trop court pour une tendance, le dire
      plutôt qu'un pourcentage inventé (`no fake data`).
      ⚠️ **MESURÉ LE 18/09/2026, ET ÇA CHANGE LE TICKET : LA MOITIÉ DU CALCUL MANQUE.**
      Le ticket demandait de vérifier que le webhook porte bien ces signaux — fait, sur la
      base réelle : `battery_capacity_nominal` porte **46 valeurs**, et `battery_capacity`
      **aucune ligne, jamais**. Le dénominateur est là, le numérateur n'existe pas, donc le
      rapport n'est pas calculable aujourd'hui.
      Avant tout code : ou bien la bZ sert cette capacité sous un AUTRE nom (la chercher
      dans le catalogue réel, pas dans la doc), ou bien la dégradation ne se calcule pas et
      il faut le DIRE à l'écran. Écrire la section sans ce recensement produirait un écran
      vide sans explication — exactement ce que `no fake data` interdit.
- [ ] `[ENTRETIEN-01]` **Rappels d'entretien** (pneus, freins, etc.), avec ajout dans Tasks
      et Google Calendar (demande de Marc, 24/08). À ne pas confondre avec `[SC-04]`
      (`lireEntretiens` / `insererEntretiens`, `lib/vehicle/service.ts`) qui lit l'HISTORIQUE
      déjà survenu — ceci est prospectif : prévoir la PROCHAINE échéance et la pousser hors
      de l'app. Points à trancher avant de coder :
      - **Sur quoi ancrer l'échéance** — kilométrage projeté (réutiliser le rythme du bail,
        `lib/vehicle/lease.ts`) ou calendrier fixe (ex. pneus deux fois par an) ; les deux
        cohabitent probablement selon le type d'entretien.
      - **Scopes Google.** Aucune intégration Tasks/Calendar n'existe dans `auth.ts` —
        nouveaux scopes OAuth à ajouter, donc une reconnexion pour Marc (même famille que
        l'élargissement `gmail.modify` de DriveAI : à annoncer avant de merger, jamais
        silencieux).
      - **Écriture vers un service externe** : mêmes réflexes que les commandes véhicule
        (`autoriserCommande`) — confirmation explicite avant de créer quoi que ce soit chez
        Marc, jamais un ajout automatique en tâche de fond.
- [x] `[BAIL-04]` **Afficher le % du bail consommé à l'accueil** (demande de Marc, 24/08) —
      livré le 18/09/2026, mais **pas comme le ticket le décrivait**.
      ⚠️ Le ticket disait « `consommePourcent` est déjà calculé, rien ne le lit ». Recensé :
      la barre « Allocation du bail » de l'accueil le MONTRAIT déjà — en le RE-CALCULANT à
      la main (`kilometrageActuel / allocationTotale`). Ce n'était donc pas un cadran qui
      manquait, c'était le CHIFFRE, et surtout **ce qui permet de le lire**.
      ⚠️ `consommePourcent` seul ne dit RIEN : 6,8 % du forfait est excellent au bout d'un
      an et catastrophique au bout d'un mois. Son point de comparaison est le temps
      ÉCOULÉ. Cette règle existait, écrite en dur dans `lib/hubSummary.ts` — seul endroit
      qui lisait le champ. Elle est extraite en source unique (`avanceSurLeBail`), et le hub
      comme l'accueil la consomment.
      ⚠️ Le TON de la barre n'a pas bougé : il suit `ecartKmParJour` (prospectif), l'avance
      est rétrospective. Deux signaux distincts — les fondre en dirait un pour l'autre.

## Bloqué par une action de Marc

Voir `HANDOVER.md` pour la marche à suivre détaillée.

- [x] `[COUT-01]` Saisir le **tarif du kWh** dans **Réglages** — **fait par Marc**,
      constaté le 17/09/2026 sur les données réelles : les recharges à la maison sortent
      « Maison — tarif $/kWh » en qualité `mesure`, ce qui n'est possible que si la valeur
      est renseignée. Le ticket était resté ouvert alors que le geste avait eu lieu.
      ⚠️ Recensé, pas supposé : un ticket coché sur une intuition vaut moins qu'un ticket
      ouvert.
- [ ] `[INFRA-08]` `CRON_SECRET` (seulement si le module Toyota est activé), puis
      décommenter le `schedule` de `.github/workflows/toyota-poll.yml` et poser les
      secrets de dépôt `CARAI_URL` / `CRON_SECRET`.
      ⚠️ Le poll ne passe PAS par un cron Vercel : le plan Hobby n'autorise que des
      crons **quotidiens**, et `0 */2 * * *` fait échouer le déploiement. Voir
      « Le poll Toyota ne passe pas par Vercel » dans `CLAUDE.md`.

## À faire dès que des données réelles arrivent

- [ ] `[SC-03]` Confirmer que les commandes de sécurité répondent bien en V3
      (`lib/smartcar/commands.ts` → `CHEMINS_COMMANDES`). Le cadrage signalait que la doc
      mentionnait encore V2.0 pour cet endpoint. Si 404/501, corriger la table — c'est une
      ligne, et la commande est de toute façon journalisée avec sa réponse brute.
- [x] `[SC-04]` **Synchronisation de l'historique d'entretien** — livré le 18/09/2026.
      Le ticket disait vrai : la lecture (`lireHistoriqueEntretien`) ET l'écriture
      (`insererEntretiens`, dédoublonnée) existaient ; entre les deux, personne. L'historique
      n'est donc jamais entré en base, et le MCP le lisait sur une table vide.
      - `lib/smartcar/entretiens.ts` — `synchroniserEntretiens()`, qui NE LÈVE JAMAIS :
        chaque mode d'échec a son statut.
      - **Dans le poll, pas dans un cron à part** : un second déclencheur serait un second
        endroit qui peut cesser de tirer sans que rien ne le dise — et on vient de mesurer
        ce que vaut un `schedule` GitHub Actions (6 passages/jour sur 48). Gardée par un
        créneau de **24 h** en base : le passage aux 15 min ne coûte qu'un appel par jour.
      - ⚠️ **Enveloppée d'un try/catch**, comme la réparation voisine : une étape
        secondaire ne doit JAMAIS empêcher le flux vivant d'écrire (leçon DriveAI).
      - ⚠️ **Une enveloppe inconnue REFUSE au lieu de rendre une liste vide** : « aucun
        entretien » et « je n'ai pas su lire » sont deux informations différentes.
      - ⚠️ Le créneau est réservé **avant** l'appel : le réserver après ferait qu'un échec
        réseau rouvre la porte à chaque poll. Coût assumé — un échec fait attendre 24 h,
        pour une donnée qui bouge quelques fois par an.
      - `tests/aides/basePGlite.ts` — le montage de la base de test, extrait quand ce lot
        a fait du préambule de `rafraichissement.test.ts` sa deuxième copie mot pour mot
        (18 lignes). C'est SonarCloud qui l'a refusé, et il avait raison : la duplication
        restante est inventoriée sous `[QUAL-01]`.
      - ⚠️ La réservation est **atomique et partagée** avec `[UI-02]`
        (`lib/vehicle/creneau.ts`). Un défaut trouvé en écrivant les tests : la fonction
        pure autorisait à `>= plancher` quand la base exigeait `<` — une milliseconde
        d'écart, donc un bouton qui aurait semblé cassé une fois sur mille. Leur accord est
        désormais verrouillé par un test.
- [ ] `[BAIL-01]` Saisir le **coût au kilomètre excédentaire** dans **Réglages**. Sans lui,
      le dépassement reste en kilomètres — volontairement.

## Fonctionnalités

- [ ] `[SC-08]` **Brancher `motion-currentspeed`** (débloqué le 12/08 par le re-Connect,
      confirmé `SUCCESS` au poll). N'a aucun consommateur dans l'app pour l'instant — ce
      n'est PAS ce qui manque à la carte des trajets (une vitesse instantanée ne dessine
      aucune route). Piste honnête : une vitesse « au dernier relevé » sur l'accueil, si
      Marc le demande — recevoir un signal n'est pas la même chose que l'afficher.
- [x] `[UI-02]` **Bouton « rafraîchir maintenant »** — livré le 18/09/2026.
      Le ticket avait raison sur le point délicat : la route de poll n'a **aucune**
      contre-pression, et un bouton exposé à l'écran sans plancher permettrait de marteler
      Smartcar en cliquant. Ce qui est posé :
      - `lib/vehicle/rafraichissement.ts` — `deciderRafraichissement` (PURE) et
        `reserverRafraichissement` (ATOMIQUE). Plancher **60 s**, délibérément PAS aligné
        sur la cadence du poll : un bouton qui refuse un quart d'heure n'a aucun intérêt —
        Marc ouvre l'app justement pour voir MAINTENANT.
      - ⚠️ **Le plancher vit en BASE, et l'unicité dans l'ÉCRITURE** : un
        `INSERT … ON CONFLICT DO UPDATE … WHERE … RETURNING`, donc c'est Postgres qui
        arbitre. En serverless, un compteur de processus n'est pas une contre-pression, et
        « lire, comparer, écrire » laisse deux requêtes gagner ensemble. Prouvé par un test
        de COURSE (`Promise.all`) contre un vrai Postgres (PGlite + migrations réelles) :
        retirer la condition fait passer les deux.
      - `app/actions/rafraichir.ts` — Server Action derrière `requireSession()`. Elle
        appelle `pollerSignaux()` DIRECTEMENT : viser la route de cron obligerait à mettre
        `CRON_SECRET` dans le navigateur.
      - Le bouton dit ce qu'il fait pendant qu'il attend, et les trois issues sont
        distinguées : refus de plancher (avec les secondes restantes), échec Smartcar, et
        « rien de neuf » — qui n'est PAS un échec.
      - Le passage manuel est inscrit au journal du poll : l'ignorer creuserait un faux
        trou dans la cadence mesurée par la page Données.
- [ ] `[UI-03]` Compléter l'écran de diagnostic : santé Toyota et état de la connexion
      Smartcar (la partie « livraisons + couverture + mesures ligne à ligne, en live »
      est livrée dans l'onglet Base de données le 06/08)
- [ ] `[DATA-01]` **Stratégie de sauvegarde externe de la base.** Neon gratuit n'offre
      qu'une restauration courte, et le dépôt est PUBLIC — un dump n'ira jamais sur
      GitHub. Piste : export périodique chiffré (age) vers le Drive de Marc, déclenché
      par GitHub Actions. À cadrer avant que l'historique ait de la valeur (des mois de
      données).
- [ ] `[MCP-01]` Déployer le serveur MCP sur Cloud Run (patron `financeai-mcp`) —
      vient APRÈS `[MCP-02]`, qui définit les outils et l'auth. Déployer une surface
      qui n'existe pas encore n'aurait rien à servir.
- [x] `[SEC-01]` **En-têtes de sécurité** (17/09/2026). Les cinq enforcés (HSTS
      `includeSubDomains`, `X-Content-Type-Options`, `X-Frame-Options: DENY`,
      `Referrer-Policy`, `Permissions-Policy`) plus la CSP en **Report-Only**, dans
      `next.config.mjs`. CarAI était le dernier dépôt de l'écosystème sans en-têtes, alors
      qu'elle sert la position du véhicule et les habitudes de charge.
      ⚠️ La CSP reste **observée**, pas appliquée : deux ressources externes en dépendent
      (`tile.openstreetmap.org` pour les tuiles, `www.google.com` pour l'iframe Maps) et
      une CSP trop serrée coupe sans rien dire. `tests/enTetesSecurite.test.ts` DÉRIVE du
      code les domaines chargés et refuse qu'un domaine chargé par le NAVIGATEUR manque à
      la CSP — il prouve le caractère serveur plutôt que de lister des exceptions.
      ➜ Pour l'enforcer : parcourir l'app, vérifier qu'aucune violation n'apparaît en
      console, puis renommer la clé. La marche à suivre est dans `next.config.mjs`.
- [x] `[QUAL-01]` **Deux préambules recopiés, trouvés le 18/09 en réparant la duplication
      que SonarCloud refusait sur `[SC-04]`.** L'analyse mesure la duplication du code NEUF,
      donc elle n'a signalé que la moitié qui venait d'être écrite ; les deux blocs ci-dessous
      sont PRÉEXISTANTS et n'ont pas été touchés — c'est du périmètre non demandé.
      - ✅ Fait le 16/10 (CarAI#204) : `tests/inventaire.test.ts`, `analyse`, `mesures` et
        `position` montent leur base par `baseDeTest` (`tests/aides/basePGlite.ts`) ; « new PGlite »
        n'y apparaît plus. Restent hors périmètre `tendancesSeptJours` et `tendancesAgregats`
        (montage propre, plus récents). Texte d'origine : le montage PGlite (client,
        migrations, `beforeEach`, `afterAll`) vivait mot pour mot dans ces quatre fichiers.
      - ✅ Fait le 16/10 (CarAI#203) pour `secretValide` : définie une fois dans
        `lib/secretPartage.ts`, importée par les trois routes. Reste recopié, volontairement, le
        reste de la garde (`NO_STORE`, les réponses 503/401), dont le secret attendu et le message
        diffèrent d'une route à l'autre. Texte d'origine :
      - La garde `CRON_SECRET` (`NO_STORE`, `secretValide`, les trois réponses 503/401/200)
        est écrite trois fois : `app/api/cron/smartcar-poll`, `app/api/cron/toyota-poll`,
        `app/api/webhooks/toyota-otp` — **29 lignes identiques** entre les deux premières.
        ⚠️ Celle-là compte plus que la précédente : c'est un contrôle d'ACCÈS, et une
        comparaison en temps constant corrigée dans un seul exemplaire laisserait les deux
        autres derrière sans que rien ne rougisse.


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

## Atelier — chantiers en cours

- [ ] `[ST-CARAI-CI]` **Réécrire `ci.yml` sur `modeles/ci/gabarit-appelant.yml`** (reste de
      la partie A de st-carai, `C:\dev\_pc-local\agence\briefs\st-carai-modele-commun.md`).
      Volontairement PAS fait avec le reste de la partie A (29/09/2026) : le check requis
      passerait de 3 jobs nommés (« Gate… », « Qualité… », « Sécurité… ») à un seul
      « ci / portes », ce qui touche `auto-merge.json` (`controles_requis`) ET le ruleset
      GitHub de CarAI (réglage de dépôt, geste de Marc) — et affecterait la PR #156,
      alors en vol. **Décision du gérant, 29/09/2026** : à faire APRÈS la fusion de #156
      (01/10), en un seul lot coordonné (ci.yml + auto-merge.json + ruleset), relu par
      pole-securite avant toute fusion — jamais en PR armée.

## Dette assumée / à surveiller

> ⚠️ **Ces entrées n'ont PAS de case, et c'est délibéré** (règle de l'en-tête : une note
> sans travail à faire n'est pas une tâche). Ce sont des décisions PRISES, chacune avec la
> condition qui la rouvrirait. Elles portaient une case jusqu'au 18/09/2026 — elles
> comptaient donc comme du travail en attente dans chaque inventaire, et « finir le
> backlog » semblait exiger de les faire. Une dette assumée qui ressemble à une tâche finit
> par être « corrigée » par quelqu'un qui n'a pas lu pourquoi elle avait été choisie.

- `[DETTE-01]` Le cache du token Smartcar est un cache de **processus** : vide au démarrage
  à froid, non partagé entre instances serverless. Bénéfice partiel, sans risque.
  **Rouvrir si** le volume d'appels le justifie.
- `[DETTE-02]` Le webhook écrit AVANT de répondre 200 (le détachement tuerait le travail
  avec l'instance en serverless). Tenable à quelques livraisons par heure sur un véhicule.
  **Rouvrir si** ça grossit — et la réponse sera une file, pas un détachement silencieux.
- `[TRAJET-VITESSE-TRANCHE]` Le seuil `PAUSE_MINUTES` reste un PROXY : c'est le compteur qui
  sait si la voiture roulait. **Arbitrage de Marc le 18/09** — il a choisi « plus long
  délai » (45 → 120 min) plutôt que le discriminant par la VITESSE MOYENNE du segment.
  Deux conséquences assumées : un segment de plus de 120 min se coupe encore même quand le
  compteur prouve 135 km parcourus (vu le 14/09, un segment de 149 min), et un arrêt réel
  de moins de 120 min sans relevé `LAST_PARKED` est fondu dans le trajet.
  **Rouvrir si** un déplacement réel ressort coupé, ou si la bZ change son rythme de
  publication — le seuil est une mesure DATÉE. La piste écartée est écrite dans
  `PAUSE_MINUTES` : ne pas la redécouvrir de zéro.
- `[ST-CARAI-ESBUILD]` esbuild 0.18.20 reste imbriqué sous `@esbuild-kit/core-utils`, tiré
  par `drizzle-kit` 0.31.11 (dernière version au 30/09/2026) : alerte modérée
  GHSA-67mh-4wv8-2f99, en **dev seulement** (`npm audit --omit=dev` = 0). Un override
  ciblé (`"@esbuild-kit/core-utils": { "esbuild": "^0.25.0" }`) a été essayé le 30/09 :
  npm ne l'applique pas (`npm ls` le marque « invalid ») et il remanie ~7 600 lignes du
  lock. Abandonné. **Rouvrir quand** `drizzle-kit` n'utilisera plus `@esbuild-kit`.

## Livré

- [x] `[COUT-02]` **Prix des recharges par LIEU** (Marc, 13/08). `lib/vehicle/tarifsBornes.ts` :
      appariement de chaque session au lieu où la voiture était garée, puis prix selon le mode
      de facturation (horaire ou kWh). Les lieux et leurs tarifs se saisissent dans Réglages et
      vivent EN BASE — ⚠️ le dépôt est public, l'adresse du domicile et celle de l'employeur ne
      peuvent entrer dans aucun fichier versionné. Chaque montant porte sa QUALITÉ (mesuré /
      estimé / inconnu) et les deux totaux sont SÉPARÉS — 2026-08-13

- [x] `[CMD-01]` **Commandes du véhicule depuis l'app** (Marc, 13/08). L'envoi existait déjà
      (`lib/smartcar/commands.ts`, utilisé par le MCP) ; la surface web manquait. Écran
      `/commandes` : verrouiller, déverrouiller, démarrer/arrêter la charge, limite de charge,
      plus le journal des dernières commandes. ⚠️ Trois gardes : la Server Action revérifie la
      session, la confirmation d'une action PHYSIQUE est re-vérifiée côté serveur
      (`autoriserCommande` — un `required` de navigateur n'est pas un contrôle), et aucun
      libellé n'affirme que l'action a EU LIEU (Smartcar peut accepter sans que l'effet
      atteigne le véhicule) — 2026-08-13

- [x] `[UI-17]` **Carte, accueil et échelle** (six demandes de Marc, 13/08). La carte
      composait à 640×420 pour un affichage sur 1344 px : agrandissement ×2, tuiles floues et
      traits doublés — `non-scaling-stroke` + composition 1280×620, tripwire contre le retour
      en arrière. `/trajets` cadre par défaut sur TOUS les trajets. L'accueil porte le schéma
      du véhicule (pressions, ouvrants, verrouillage, autonomie, dernière synchro), via
      `lib/vehicle/etatSchema.ts` — construction EXTRAITE de l'Analyse, jamais recopiée.
      `traceDouble` combine charge (%) et autonomie (km) sur deux échelles et un axe des temps
      commun. Échelle typographique redescendue d'environ 12 % — 2026-08-13

- [x] `[UI-16]` **Onglet Données : tracer la métrique filtrée** (Marc, 13/08 : « uniquement
      des données en tableau Excel avec la possibilité de faire des graphs »). La courbe
      s'insère entre le formulaire et le tableau dès qu'une métrique NUMÉRIQUE est
      sélectionnée : le geste est le filtre lui-même, il n'y a pas un second réglage à
      apprendre. ⚠️ `serieNumerique` a reçu une option `source` pour que la courbe porte
      EXACTEMENT la sélection du tableau — sans elle, filtrer par source aurait rétréci les
      lignes en laissant la courbe couvrir toutes les sources : deux vérités sur le même
      écran. Discrimination du test prouvée par mutation — 2026-08-13

- [x] `[UI-15]` **Refonte visuelle** (Marc : « on dirait un logiciel de gestion tellement
      c'est moche et plat »). Système de design réécrit — hiérarchie typographique, surfaces
      à plusieurs profondeurs, élévation à trois marches, accent qui signifie au lieu de
      décorer, sombre pensé et non inversé. Accueil : héros (écart au bail en très gros,
      barre d'allocation, trois cadrans `app/ui/Jauge.tsx`) + tuiles, à la place de deux
      sections de texte. `/donnees` sort de la barre d'onglets. Trajets en FRISE avec barre
      de distance proportionnelle. ⚠️ Défaut trouvé à la CAPTURE et pas au gate : barre et
      durée partageaient une zone de grille, le texte s'écrivait par-dessus le trait — 2026-08-13

- [x] `[UI-14]` **Analyse interactive** (Marc, 13/08) : survol des courbes en CSS pur
      (`bandesSurvol`, bandes calées sur le temps RÉEL — des bandes égales décaleraient
      l'infobulle ; vérifié au navigateur avec une vraie souris) ; fenêtre de temps
      raccourci/plage/jour dans l'URL (`lib/vehicle/fenetre.ts`, fuseau de Marc testé en
      janvier ET en août) ; historique détaillé replié sous chaque courbe avec l'écart au
      relevé précédent ; déductions (`lib/vehicle/deductions.ts`) — autonomie annoncée vs
      réelle, jours avant recharge, km par jour de semaine, dégonflage projeté par pneu,
      chacune rendant `null` plutôt qu'un chiffre quand la donnée ne la porte pas (R² et
      durée minimale d'observation). **Bug corrigé au passage** : les références de pression
      étaient lues sur la période choisie, donc « 24 h » vidait la détection de dérive du
      schéma — fenêtre fixe de 30 jours désormais — 2026-08-13

- [x] `[FIX-08]` **Heures de trajet, deuxième correctif** (« toujours pas bonnes », Marc).
      Le premier n'utilisait qu'une borne et ne mordait que les nuits de recharge — une nuit
      ordinaire ne produit aucun relevé. `bornerFenetre` ajoute la borne HAUTE (premier
      relevé où le compteur a déjà bougé) ; l'écran met l'ARRIVÉE en tête (elle est mesurée),
      affiche le départ comme un INTERVALLE au-delà de 20 min d'incertitude, et n'affiche
      plus de durée quand elle n'est pas déductible. Discrimination prouvée par mutation — 2026-08-13
- [x] `[FIX-09]` **Le prix des recharges ne pouvait pas marcher** : `tarifKwh` n'était
      écrit par AUCUN code de l'app (vérifié par grep). Nouvel écran `/reglages` — tarif du
      kWh, coût du km excédentaire, termes du bail — avec validation pure testée, VIDE ≠ ZÉRO,
      et session revérifiée dans la Server Action. Débloque `[COUT-01]` et `[BAIL-01]`, qui
      redeviennent de simples saisies — 2026-08-13

- [x] `[UI-13]` **Refonte de l'onglet Analyse** (Marc, 13/08 : « améliore grandement la
      partie analyse… enlève tout le texte inutile et la liste des variables »). Retiré : les
      quatre listes de signaux + les réponses sans valeur (la « liste des variables » — cette
      question vit dans `/donnees`), le dépliage `chemin → valeur` des structures, les frises
      booléennes, les paragraphes sur la mécanique interne. Ajouté : le SCHÉMA du véhicule vu
      de dessus (`app/ui/SchemaVehicule.tsx` + `lib/vehicle/schemaVehicule.ts`, pur et testé —
      pression par roue en kPa et psi, ouvrants, verrouillage), les quatre pneus sur un axe
      COMMUN (`traceMulti`/`GraphiqueMulti` — un axe par roue effaçait l'écart, seule chose
      qui compte sur des pneus), et une phrase d'explication sous chaque courbe. Seuils
      IMPORTÉS d'`alertes.ts` (jamais recopiés), roue sans mesure GRISE et jamais verte,
      position jamais devinée — 2026-08-13

- [x] `[UI-12]` **Quatre retours de Marc (13/08)** : heures de trajet resserrées par
      l'odomètre intermédiaire (`affinerFenetre`, jamais un élargissement, jamais une
      heure devinée sans lecture réelle) ; type de borne déduit de kWh ÷ durée
      (`estimerBorne`/`libelleEstimationBorne`, Niveau 1/2/Rapide DC) + graphique
      d'énergie par recharge sur `/recharges` — **sans prix** : un montant déduit du seul
      type de borne serait un tarif générique présenté comme celui de Marc, `[COUT-01]`
      reste le seul chemin vers un vrai prix ; doublon de la boîte « limites » corrigé sur
      l'accueil (`GraphiqueBail` la rendait déjà, `app/page.tsx` la répétait) ; densité de
      texte réduite (accueil, trajets, recharges — plusieurs explications déplacées en
      `title` plutôt qu'affichées en permanence) ; l'accueil bascule sur `.card-large`
      (dernière page sur le format étroit) et `.card-large` passe de 56 à 84 rem — 2026-08-13
- [x] `[SC-07]` **Re-Connect avec les scopes** : `motion-currentspeed` récupéré. Confirmé
      par MESURE au poll du 12/08 20h00 UTC — passé de `ERROR (PERMISSION)` à `SUCCESS`.
      Les 3 `internalcombustionengine-*` (sans objet sur une électrique) et le VIN
      (cosmétique) restaient inutiles à demander — 2026-08-12
- [x] `[UI-11]` **L'accueil redevient visuel** (Marc : « enlève toutes les mesures...
      rajoute des graphs de l'onglet analyse, pas tous mais améliore-les visuellement »).
      Section « Toutes les mesures » (dump brut) retirée ; deux graphes ajoutés — charge
      des 14 derniers jours, kilométrage vs bail — choisis pour répondre aux questions déjà
      posées sur l'écran. `Graphique`/`GraphiqueBail` déménagés vers `app/ui/Graphique.tsx`
      (partagés avec l'onglet Analyse) ; dégradé sous la courbe (`aireSvg`, pure, testée),
      traits arrondis, carte plus respirante — 2026-08-12
- [x] `[FIX-01]` **Kilométrage des trajets faux d'un facteur trois** (signalé par Marc) :
      odomètre agrégé par jour + appariement à ±20 min ⇒ repli systématique sur le vol
      d'oiseau. `granularite: "brut"` — 2026-08-12
      ⚠️ Le correctif d'alors (`odometreEncadrant`) était lui-même faux : voir `[FIX-04]`.
- [x] `[FIX-04]` **Les km ne concordaient toujours pas** (« devrait concorder avec le
      nombre de km effectués », Marc). Deux défauts OPPOSÉS : des trajets entiers
      DISPARAISSAIENT (un groupe d'un seul relevé était jeté — le cas normal quand la
      voiture ne publie sa position qu'à l'arrêt) et d'autres étaient comptés en DOUBLE
      (l'encadrement donnait à chaque trajet toute la fenêtre d'odomètre qui l'entoure).
      Mesuré en rejouant l'ancien code : 0 trajet / 0 km au lieu de 2 pour 28 km, et 80 km
      annoncés EXACTS pour 40 km réels. Le découpage est désormais tranché par le COMPTEUR,
      `odometreALinstant` télescope (aucun km comptable deux fois), et `reconcilier` affiche
      l'écart au compteur sur la page — 2026-08-12
- [x] `[SEC-02]` **Visibilité du dépôt tranchée** : Marc garde le dépôt **public**
      (12/08). Règle qui en découle, dans `HANDOVER.md` : rien qui SITUE Marc dans un
      fichier versionné, les termes du bail restent (repli assumé), aucun secret jamais,
      et les journaux de CI ne portent que des noms de signaux — jamais de valeurs — 2026-08-12
- [x] `[FIX-06]` **« La recharge je vois rien du tout »** : la page ne savait reconstituer
      une session que depuis `charge-ischarging`, mesuré en `ERROR (UPSTREAM)` chez Toyota.
      Sans ce signal, zéro session — écran vide alors que la voiture chargeait et que le
      SOC le montrait. Même erreur que pour les trajets : bâtir sur le signal qu'on
      voudrait, pas sur celui qu'on a. `chargesDepuisSoc` déduit les sessions de la
      remontée de l'état de charge, avec l'odomètre en garde contre la récupération au
      freinage ; le statut déclaré, quand il arrive, garde la priorité et ses bornes
      exactes (pas de double comptage) — 2026-08-12
- [x] `[FIX-07]` **Le trajet du jour classé à hier** et absent sur « 24 h » : daté sur le
      départ (qui est le stationnement de la veille) et ancre filtrée hors fenêtre.
      `instantDuTrajet` + `MARGE_ANCRAGE_JOURS` + `trajetsDansLaFenetre` — 2026-08-12
- [x] `[FIX-05]` **« Ça devrait pas faire vol d'oiseau »** : la carte traçait un trait plein
      entre deux relevés de stationnement. La rue empruntée n'existe nulle part
      (`motion-currentspeed` refusé, mesuré au poll) ⇒ trait POINTILLÉ + pastilles sur les
      relevés réels + légende qui nomme la limite, plutôt qu'une route inventée. Et plus de
      « vitesse moyenne » sur une fenêtre qui contient du stationnement : 12 km en six heures
      affichait « 2 km/h en moyenne » — 2026-08-12
- [x] `[FIX-02]` **Passage de minuit** : « aujourd'hui » en UTC bascule à 20 h locale, le
      bilan du soir aurait été faux tous les soirs — 2026-08-12
- [x] `[FIX-03]` Booléens classés « numérique » (ils remplissent les deux colonnes) et
      tracés en créneaux 0/1 au lieu de frises — 2026-08-12
- [x] `[UI-07]` **Carte OSM dans l'app** : vraies rues, rendu serveur, zéro dépendance.
      Projection vérifiée contre le référentiel slippy-map — 2026-08-12
- [x] `[UI-08]` **Base de données = tes données** : défaut aux lignes portant une valeur,
      `?tout=1` pour les refus. Tableau type tableur (en-tête collant, libellés FR) — 2026-08-12
- [x] `[UI-09]` **Tableau de bord en trois moments** (réponse de Marc) : avant de partir,
      le point du jour, vais-je payer — 2026-08-12
- [x] `[UI-10]` **Consommation réelle en kWh/100 km** + autonomie théorique. Recharges
      exclues du calcul, segments à l'arrêt écartés et comptés — 2026-08-12
- [x] `[DIAG-01]` Le poll rend les CODES par statut, et la page Recharges dit POURQUOI elle
      est vide. Deux outils qui ne se taisent plus — 2026-08-12

- [x] `[UI-05]` **Refonte : l'app répond au lieu d'afficher** (« pour l'instant l'app me
      sert à rien », Marc). Cinq onglets, un par question : bail actionnable + alertes
      (accueil), trajets avec itinéraires Maps complets, recharges estimées, base de
      données, analyse. Le chiffre qui commande est le budget restant par jour, pas la
      moyenne du contrat — 2026-08-12
- [x] `[BAIL-02]` Odomètre de signature renseigné : **50 km** (Marc, 12/08). L'ancre change
      la projection d'un facteur QUATRE — dépassement projeté sous-estimé de plusieurs
      dizaines de milliers de km, corrigé une fois ancré. Sans elle, l'app annonçait un problème
      quatre fois plus petit que le vrai — 2026-08-12
- [x] `[UI-06]` Lien « Reconnecter le véhicule » PERMANENT. Il ne s'affichait qu'avec une
      base vide, donc jamais au moment où on en a besoin (élargir les permissions). Un geste
      possible mais introuvable équivaut à un geste impossible — 2026-08-12

- [x] `[SC-06]` Les 52 `COMPATIBILITY` retirés de la souscription du webhook par Marc.
      ⚠️ Ils restent visibles côté POLL (qui lit tout ce que l'API expose, hors
      souscription) : ce n'est pas un reste de travail. Section repliée dans `/analyse` — 2026-08-12
- [x] `[UI-01]` **Un visuel pour CHAQUE métrique**, découvert depuis la base au lieu d'une
      liste écrite d'avance (`metriquesDisponibles` + `formeDeMetrique`) : courbe pour les
      nombres, frise de changements pour les états, tableau du dernier relevé pour les
      structures. Portières, vitres, minuteries et statut de charge sont affichés pour la
      première fois. `SERIES_ANALYSE` supprimée — six de ses dix entrées visaient des
      signaux que la bZ refuse — 2026-08-12
- [x] `[UI-04]` **GPS affiché** (décision Marc, 12/08) : coordonnées lisibles dans
      `/donnees`, tracé du trajet à l'échelle dans `/analyse` (`lib/vehicle/position.ts`),
      lien Google Maps sur clic. Rendu côté serveur sans fond de carte — afficher la page
      n'envoie aucune position à un tiers, et rien ne part vers le hub. Les deux tests qui
      verrouillaient le masquage sont REFORMULÉS vers ce qu'ils protègent encore (une
      position doit être reconnue par CONTENU et rendue en coordonnées, jamais en JSON
      tronqué) — 2026-08-12
- [x] `[INFRA-07]` Tuile CarAI en ligne sur hubperso.com (charge, autonomie, odomètre,
      bail consommé), confirmée visuellement par Marc — 2026-08-12
- [x] `[ANALYSE-02]` Refus séparés PAR MOTIF dans `/analyse` (`motifDuRefus`) : à décocher /
      à récupérer par re-Connect / panne passagère / motif non déclaré. Trois gestes
      opposés qu'une liste unique « refusés » obligeait à démêler à la main. Liste des
      codes à décocher affichée nue, prête à relire en face de la console — 2026-08-12
- [x] `[BAIL-03]` Projection du bail ancrable sur l'odomètre de signature
      (`kilometrageInitial`) et couverture de la mesure exposée (`couvertureRythmeJours`,
      `rythmeAncreSurSignature`). Tant que l'ancre manque, la limite est nommée sous le
      graphique au lieu d'être masquée par un chiffre rassurant — 2026-08-12
- [x] `[SC-05]` Couverture confirmée sur du réel : les 15 signaux étaient tous `SUCCESS`
      au catalogue, mais la souscription du WEBHOOK ne portait que les 11 d'origine
      (3 utiles + 8 morts) — Marc l'a élargie à 84 signaux (clim, températures, ampérage,
      HVAC, diagnostics…). Première livraison LIVE élargie : 84 reçus / 84 écrits
      (15:33 UTC). Les statuts par signal (`signal_status`) diront ce que la bZ refuse — 2026-08-06
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
- [x] `[SC-07]` Poll Smartcar périodique (30 min, GitHub Actions) : le webhook ne se
      déclenche que sur CHANGEMENT, donc voiture stationnée = zéro donnée pendant des
      heures. Deux défauts corrigés par la mesure : forme API (`code`/`status` sous
      `attributes` — sinon zéro écriture en silence) et répétition des refus (58 lignes
      vides par poll, ~2 800/jour) — 2026-08-12
- [x] `[DATA-03]` Onglet Base de données : tableau filtrable (métrique/source/période),
      pagination avec total, export CSV COMPLET (`/api/donnees/export`, curseur stable,
      neutralisation des formules) ; lecture des corps sans `value` (enginecover) et du
      `locationType` de la position — 2026-08-06
- [x] `[FOND-01]` Fork d'app-template, schéma de données, migrations au démarrage — 2026-08-05
- [x] `[FOND-02]` Intégration Smartcar V3 (auth, signaux, webhooks, commandes) — 2026-08-05
- [x] `[FOND-03]` Module Toyota isolé (OTP, poll, santé) hors adaptateur réseau — 2026-08-05
- [x] `[FOND-04]` Serveur MCP (9 tools) — 2026-08-05
- [x] `[FOND-05]` Tableau de bord, flow Connect, summary hub — 2026-08-05
