# HANDOVER — état courant de CarAI

> À lire en premier à chaque reprise de session.

**Dernière mise à jour** : 2026-10-26 · branche `claude/lia-etat-partage`

## 26/10 — Sorties CarAI vers MemoryAI (CarAI#174)

- Après une écriture Smartcar ou Toyota réussie, CarAI prépare en arrière-plan les trajets terminés, recharges terminées et changements notables d’état ; `recordedAt` et la source sont conservés. Les sorties ne contiennent ni coordonnées ni adresse. Sans `MEMORYAI_SORTIES_TOKEN`, aucun envoi n’est tenté. `MEMORYAI_URL` est facultative (défaut : `https://memoryai.hubperso.com`) ; le jeton et l’URL restent côté serveur.
- L’envoi `POST /api/sorties` est attendu par `insererSnapshots` (une fonction Vercel ne survit pas à sa réponse) mais borné : 1,5 s par requête, 4 s pour l’ensemble préparation et envoi. Les échecs ne remontent pas à la collecte ; le journal serveur ne contient ni jeton ni corps de réponse. Les trajets et recharges se reconstituent sur les 3 derniers jours (5 000 lignes au plus), jamais sur 400 jours ; un rejeu (`lib/smartcar/rejeu.ts`) ne publie rien.
- Verrous : `tests/sortiesMemoryAI.test.ts`. Preuve de production attendue après la pose du jeton par le fil Secrets : une recharge apparaît dans MemoryAI avec source et date, puis `memoryai_chercher` la retrouve. Tant que le jeton n’est pas posé : `preuve-attendue`.
- Tâche : MoKarade/CarAI#174.

## 27/10 — LIA : lia-ui v0.42.1, la discussion la plus récente l'emporte (CarAI#195)

CarAI épingle `@mokarade/lia-ui` v0.42.1 (sha pelé `b8967ec`), seul changement (`package.json`, lock). Au montage, la discussion de l'onglet était datée « maintenant » et passait devant celle de l'état partagé : une question posée sur le hub ne se retrouvait pas dans CarAI. v0.42.1 range le vrai instant avec la discussion de l'onglet, et la plus récente gagne à la première lecture de l'état. Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, puis relevé du PC (lia-ui#140).

## 26/10 — LIA : lia-ui v0.42.0, la hauteur de la bulle se révèle en douceur (CarAI#184)

CarAI épingle `@mokarade/lia-ui` v0.42.0 (sha pelé `cff04f4`), seul changement (`package.json`, lock). La bulle de v0.41.1 restait dans l'écran mais changeait de hauteur d'un coup à chaque réponse. v0.42.0 découvre la hauteur gagnée en 280 ms depuis le bord fixe, sans ombre coupée, et ne bouge rien avec `prefers-reduced-motion`. Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, bundle servi contenant `inset(-24px)` sur carai.hubperso.com, puis mesure sur la page de connexion publique ; la tâche reste ouverte jusque-là.

## 26/10 — LIA : lia-ui v0.41.1, la bulle ne dépasse plus de l'écran (CarAI#178)

CarAI épingle `@mokarade/lia-ui` v0.41.1 (sha pelé `90dc7e7`), seul changement (`package.json`, lock). Le relevé du PC sur v0.41.0 montrait la bulle hors écran à l'ouverture et à l'arrivée de la réponse, puis un saut. v0.41.1 place sans glisser quand la taille ou l'écran change et fait grandir la bulle vers le haut quand elle est dans la moitié basse. Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, bundle servi contenant `lia-ui__chat--glisse` sur carai.hubperso.com, puis relevé du PC ; la tâche reste ouverte jusque-là.

## 26/10 — LIA : lia-ui v0.41.0, sources cliquables et chat en bulle lissée (CarAI#175)

CarAI épingle `@mokarade/lia-ui` v0.41.0 (sha pelé `4d0c6f9`), seul changement (`package.json`, lock). v0.40.0 : les marques `[→lien]` d'une réponse de LIA deviennent une ligne « Sources » de petits liens (https, sans identifiants). v0.41.0 : le chat ne se replace plus à chaque image, reste dans l'écran visible (clavier du téléphone compris), glisse vers sa place, ne bouge pas quand le texte arrive. Retours de Marc du 26/10 : « incompréhensible, trop de texte, pas de liens » et « clunky, ça bug quand ça sort de la page ». Rien à brancher côté app. Preuve : déploiement Vercel de production `READY` sur le commit fusionné, bundle servi contenant `lia-ui__sources` et `lia-ui__chat--glisse` sur carai.hubperso.com, puis une réponse réelle de LIA ; la tâche reste ouverte jusque-là.

## 26/10 — LIA partage son état unique avec le hub (CarAI#166)

- Avant : CarAI démarrait LIA sans l'option `etat` ; humeur, envies et discussion restaient locales au navigateur, donc différentes du hub (constaté : la discussion repartait à zéro d'une app à l'autre). Marc, 23/10 : « une seule LIA, un seul état ».
- Maintenant : `GET|PUT /api/lia/etat` (`app/api/lia/etat/route.ts`), derrière le proxy ET `requireSession()`, relaie `/api/lia/etat` du hub avec le cookie de session de l'utilisateur (jamais `HUB_TOKEN`), comme BatchChef. `LiaDemarrage` passe `etat: etatHttp("/api/lia/etat")` dans le navigateur. Sans session, hub injoignable ou réponse hors contrat : 401 / 503 et LIA garde son état local. Même pin que le hub : lia-ui v0.39.0 (la discussion suit Marc, `validerEtat` ne la retire plus). Détail : `docs/claude/13-lia.md`.
- Verrous : `tests/lia.etat.test.ts` (jugement, relais, route, discussion), `tests/lia.hubCookie.test.ts` (le cookie survit à la redirection apex → www), `tests/auth.test.ts` (la route reste gardée). Preuve en production : `GET /api/lia/etat` rend l'état du hub avec la session de Marc ; la tâche reste ouverte jusque-là.


## 24/10 — LIA présente sur toutes les pages, `/login` comprise (CarAI#132)

- Décision de Marc (23/10/2026) : LIA « présente tout le temps ». `app/layout.tsx` rend `<LiaDemarrage />` sans condition de session ; `lib/lia/monter.ts` (`liaAutorisee`) est retiré, et le layout ne lit plus la session. Sans session, `POST /api/lia/ask` reste derrière le proxy (401) : LIA répond « indisponible », aucune donnée n'est exposée.
- Mesuré en local sur le build de production (Chromium, session fictive) : 2 canvas LIA sur `/login` sans session, sur `/tendances` avec session et sur une 404 avec session. Verrous : `tests/lia.monter.test.ts` et `tests/liaMouvement.test.ts`.
- Limite connue : `app/global-error.tsx` remplace le gabarit racine ; ce cas (erreur du layout lui-même) n'est pas mesuré.

## 26/10 — LIA : lia-ui remis à v0.38.0 (CarAI#167)

- Dependabot (#162, fusionnée le 26/10 à 07:33Z) avait rétrogradé `@mokarade/lia-ui` de v0.38.0 à **v0.31.0** : il lit mal les tags, comme pour `@mokarade/hub-contract`. Re-pin à **v0.38.0** (commit `9faf1ac`, package.json et lockfile) et `@mokarade/lia-ui` ajouté aux `ignore` de `.github/dependabot.yml` : le re-pin se fait à la main à chaque version. Aucun changement de code. À vérifier après le déploiement : `/login` répond 200.

## 24/10 — LIA : lia-ui v0.38.0 (CarAI#157)

- `@mokarade/lia-ui` passe de v0.37.2 à **v0.38.0** (tag, commit `9faf1ac`) : quand LIA analyse un élément, ses 100 nanobots dessinent eux-mêmes l'animation d'analyse (quatre coins, ligne qui balaie, points qui s'allument) sur l'élément. Aucun changement de code. Vérifier après le déploiement : `/login` répond 200.

## 24/10 — LIA : lia-ui v0.37.2 (CarAI#153)

- `@mokarade/lia-ui` passe de v0.32.0 à **v0.37.2** (tag, commit `5ab9a08`) : plus de carré ni de scène pendant l'analyse (seuls les 100 nanobots travaillent), popup à côté de l'élément, chat plus grand et plus discret, réponses plus courtes. Aucun changement de code. Vérifier après le déploiement : `/login` répond 200.

## 24/10 — LIA : lia-ui v0.32.0 (CarAI#147)

- `@mokarade/lia-ui` passe de v0.28.0 à **v0.32.0** (tag, commit `09781a…`) : nanobots, pensée, pause et souvenirs, portés par le paquet ; aucun changement de code : `demarrerLia` et `ask` gardent leur signature. `/login` répond 200 (relu en local sur le build de la PR et en production après déploiement).

## 24/10 — BACKLOG.md réduit à un renvoi (CarAI#138)

- `BACKLOG.md` (747 lignes) n'est plus qu'un renvoi vers les issues du dépôt, comme dans app-template : la ligne 11 de la grille de conformité passe au vert. Fait en deux PR (#143 puis celle-ci) parce que la règle de taille compte les suppressions ; l'ancien texte reste dans l'historique git. `CLAUDE.md`, `docs/claude/00-introduction.md`, `docs/claude/08-documentation.md` et `docs/ETAT.md` ne le présentent plus comme le plan. Les anciennes entrées de ce journal qui citent `BACKLOG.md` ou des identifiants `[XXX-NN]` décrivent l'état de leur date.

## 24/10 — LIA : lia-ui v0.28.0 (CarAI#140)

- `@mokarade/lia-ui` passe de v0.23.1 à **v0.28.0** (tag, commit `ffea03…`) ; aucun changement de code : `demarrerLia` et `ask` gardent leur signature. Contrôle demandé par le coordinateur : le rendu serveur ne casse pas (`/login` répond 200, relu en local sur le build de la PR et en production après déploiement).

## 24/10 — Contrôles communs de MoKarade/.github (CarAI#15)

- `.github/workflows/ci.yml` appelle `securite.yml` (job `securite-commune`, à côté de `securite` : le renommer changerait le contrôle que `.mergify.yml` exige ; apporte OSV-Scanner et CodeQL) et `conformite.yml` (`bloquant: false`). Nouveau `.github/workflows/fumee.yml` : fumée de production (santé, connexion) après chaque déploiement `Production`, sans contrôle summary tant que `HUB_TOKEN` n'est pas un secret du dépôt (CarAI#136).
- Grille lue le 24/10 en local avec le script commun : 9 vert, 5 rouge, 1 à relire. Corrigées ici : ligne 2 (le gabarit inutilisé `ci-reutilisable.yml` nomme maintenant une machine GitHub pour un dépôt public), 5 (fumée), 8 (`vercel.json` : `**` et `*` coupés, `main` seule déployée). Ligne 11 : `BACKLOG.md` (747 lignes) à réduire à un renvoi vers les issues, dans sa propre PR (CarAI#138, la réduction dépassait seule la règle de taille). Ligne 6 : CodeQL et OSV par `securite-commune` ; reste le scan de secrets et la protection au push, réglages que seul Marc active (CarAI#135). Ligne 10 : à relire par nature (la sauvegarde vit sur le PC).

## 24/10 — LIA : lia-ui v0.23.1 (CarAI#131)

- `@mokarade/lia-ui` passe de v0.16.0 à **v0.23.1** (tag, commit `23dbd4…`) ; aucun changement de code : les nouvelles options du paquet (cadre d'analyse, humeurs récentes, physique, bonds, état partagé) sont toutes facultatives et `demarrerLia` / `ask` gardent leur signature. Le démarrage hors du rendu et le verrou `tests/liaMouvement.test.ts` (≥ 0.16) restent valables.
- Constat en chemin (CarAI#132, pas corrigé ici) : en local, `/login` sans session affiche aussi LIA, sur v0.16.0 comme sur v0.23.1 ; la phrase « pas de LIA sur `/login` » de #124 était fausse. Sans conséquence en production (`/login` redirige vers le hub, `/api/lia/ask` reste derrière le proxy).

## 23/10 — LIA : présente tout le temps (lia-ui v0.16.0, CarAI#124)

- `@mokarade/lia-ui` passe de v0.15.0 à **v0.16.0** (tag, commit `3061f1…`). LIA est démarrée par `demarrerLia` (`@mokarade/lia-ui/boot`) au chargement du module `components/LiaDemarrage.tsx` (remplace `components/LiaMontee.tsx` et `<Lia />`, une seule voie) : elle se pose dans `document.body` hors du rendu, donc même pendant un chargement ou si une page plante. L'accès ne change pas : le layout ne rend `LiaDemarrage` que si `liaAutorisee()` est vrai, donc pas de LIA sur `/login` ni pour un refus. Verrou : `tests/liaMouvement.test.ts` (voie unique, aucun réglage commun posé, démarrage hors effet).

## 23/10 — LIA : lia-ui v0.15.0

- `@mokarade/lia-ui` passe de v0.14.0 à **v0.15.0** (tag, commit `cff62b…`) ; aucun changement de code : `ask` reçoit un 3e argument `contexte` optionnel que `LiaMontee` ignore. LIA répond sur son humeur, analyse tout élément et s'ouvre par appui long au tactile (portés par le paquet). Verrou `tests/liaMouvement.test.ts` (≥ 0.13.0) inchangé.

## 23/10 — LIA : lia-ui v0.14.0

- `@mokarade/lia-ui` passe de v0.13.0 à **v0.14.0** (tag, commit `dbe316…`, lia-ui#47) ; aucun changement de code : parole propre et physique sont par défaut dans le paquet, aucune option dans `components/LiaMontee.tsx`. Le verrou `tests/liaMouvement.test.ts` (≥ 0.13.0) reste valable.

## 23/10 — CarAI#16 : le poll Smartcar sans le robot du PC

- `.github/workflows/smartcar-poll.yml` : `runs-on: ubuntu-latest`, plus aucune mention de `self-hosted` ni de `pc-marc` (décision de Marc : le dépôt est public). Les autres workflows gardent le choix par visibilité (`ci.yml`, `garde-fou.yml`…). Verrou de source dans `tests/pollJournalPublic.test.ts`.
- Preuves déjà posées : le lancement planifié 39999554737 du 23/10 (18:11Z) a tourné sur une machine GitHub avec « HTTP 200 » et `ok:true` (CarAI#84) ; depuis la PR #103 le journal n'écrit plus que le code HTTP et un verdict court.
- La ligne de `CLAUDE.md` qui disait que ce poll reste sur le PC est corrigée.

## 23/10 — LIA : lia-ui v0.13.0

- `@mokarade/lia-ui` passe de v0.12.2 à **v0.13.0** (tag, `4ccdb41`) ; réglages inchangés (aucune option dans `components/LiaMontee.tsx`). Verrou `tests/liaMouvement.test.ts` relevé à ≥ 0.13.0.

## 23/10 — LIA : lia-ui v0.12.2, la même partout

- `@mokarade/lia-ui` passe de v0.2.1 à **v0.12.2** (tag `bf2c744`). Aucune option réglée dans `components/LiaMontee.tsx` : le mouvement complet (même si le système demande de réduire les animations) et la pastille d'humeur du paquet sont ses défauts, comme au hub (`Hubperso` `components/LiaHub.tsx`). Verrou de source `tests/liaMouvement.test.ts` (pas de `quandMouvementReduit` ni `humeurVisible`, version ≥ 0.12.2).
- Non branché ici, volontairement (hors tâche) : `etat` (état partagé de LIA chez MemoryAI), `onSpontane`, `entrees`, `monde`.

## 22/10 — CarAI#93 : LIA, l'assistant, branchée sur les pages connectées

- `@mokarade/lia-ui` v0.2.1 (tag, jamais une branche ; elle suit le curseur et le défilement et vit comme dans la maquette, sans parole spontanée tant que l'app ne branche pas `onSpontane`) monté dans `app/layout.tsx` par `components/LiaMontee.tsx`, seulement quand `requireSession()` passe : pas sur `/login`. Clic = discussion, clic droit = menu.
- Route `POST /api/lia/ask` (`app/api/lia/ask/route.ts`) : derrière le middleware (jamais dans ses exclusions, verrou `tests/auth.test.ts`) ET `requireSession()`, relaie la question au hub avec `HUB_TOKEN` (le hub parle à MemoryAI). Elle dit au hub si la session est celle du propriétaire (`AUTHORIZED_EMAIL`) : un invité n'atteint pas la mémoire de Marc. Échec fermé : sans réponse conforme, LIA dit « indisponible ».
- Copie de la référence `app-template` (`lib/lia/`, tests `tests/lia.*.test.ts`), sans écart. Détail et contrat : `docs/claude/13-lia.md`.
- **Tant que `POST /api/lia/ask` n'existe pas chez le hub (Hubperso#337) et MemoryAI**, LIA vit mais répond « indisponible ».

## 22/10 — Icône de CarAI = logo série A (CarAI#74, mission .github#467)

Marc a validé le 21/10 la série de logos A : une voiture avec un éclair, dessin vert `#A3E635` sur tuile sombre `#0B0D12`, étincelle IA
argent `#E6EAF2`. `app/icon.svg` (onglet, traits épais) et les PNG `public/icon-192`, `icon-512`, `icon-maskable-512` (plein cadre) et
`apple-touch-icon` (180 px) sont régénérés depuis ce dessin ; noms de fichiers et manifeste inchangés. Il n'y a pas d'autre marque dans
l'application (le menu est du texte ; `IcoEclair` reste une icône d'interface). Le service worker ne met rien en cache : l'icône change
au prochain chargement. Une PWA déjà installée se rafraîchit seule en quelques jours sur Android et PC ; sur iPhone, retirer l'app de
l'écran d'accueil puis la rajouter.

## 21/10 — « Nommer ce lieu » sur une recharge au lieu inconnu (CarAI#8)

Sur chaque ligne de recharge « lieu inconnu » d'Activité (quand la position pendant la recharge est connue), un `<details>`
« Nommer ce lieu » ouvre un formulaire (nom, tarif facultatif, facturation) : `app/activite/FormulaireNommerLieu.tsx`, action
`app/activite/actions.ts` (`requireSession()` revérifiée), règle pure `lib/vehicle/nommerLieu.ts` (`ajouterLieuNomme`). Le lieu
rejoint la liste de Réglages (même clé `CLE_LIEUX`, pas de migration) au rayon par défaut de 120 m : les recharges au même
endroit, passées comme à venir, prennent le nom. ⚠️ `SchemaLieu` : `mode` et `tarif` deviennent FACULTATIFS, mais vont
ensemble (refus sinon). Sans tarif, le nom s'affiche et `prixSession` traite le lieu comme inconnu : le coût reste une
estimation, jamais un tarif par défaut. Avec un tarif au kWh, le coût passe à « mesure » ; une borne horaire dont la durée est une
fenêtre de sondage reste un plafond (règle du 17/09, inchangée). Nom déjà pris : refusé (Retirer désigne par le nom). Lieu voisin :
accepté, la réponse le signale (le plus proche gagne). Le contrôle navigateur rejoue le geste sur la base fictive (positions
fictives de la liste blanche, la voiture dort la nuit à un point sans nom) : `preuve-activite-avant.png` / `-apres.png`.
Verrous : `tests/nommerLieu.test.ts`, `tests/preuveEcran.test.ts`.

## 21/10 — Sauvegarde externe chiffrée, voie B (CarAI#13)

Choix de Marc (21/10) : DriveAI dépose l'export dans le dossier Drive dédié ; CarAI ne parle jamais à Google. CarAI SERT des
lots chiffrés : `GET /api/export/sauvegarde[?apres=<curseur>]`, en-tête `x-export-token` (`EXPORT_TOKEN`), 503 sans
`EXPORT_TOKEN` ou sans `EXPORT_KEY`, route hors du proxy d'auth énumérée à l'égalité stricte (`authGuard.ts`, `middleware.ts`).
Un lot = NDJSON → gzip → AES-256-GCM (`lib/export/sauvegarde.ts`, 10 000 rangées ou 4 Mo de clair au plus), curseur par table pour
l'incrémental, `app_config` en entier dans le dernier lot. Interface complète pour DriveAI : `docs/export-sauvegarde.md`.
Restauration : `scripts/restaurer-sauvegarde.mjs` (cible `RESTAURATION_DATABASE_URL`, jamais `DATABASE_URL`, base vide exigée,
tout déchiffré avant la première écriture). `tests/exportSauvegarde.test.ts` rejoue export → restauration contre un vrai Postgres
et compare table par table. ⚠️ NON FAIT, et c'est ce qui garde #13 ouverte : la clé et le jeton (Marc, via le PC,
.github#299), le premier export réel déposé par DriveAI, et la restauration essayée sur une base d'essai à partir de CE fichier.

## 21/10 — Prévision de fin de mois dans « Consommation réelle » (CarAI#31)

Une ligne « Prévision de fin de mois (estimation) » : km et kWh d'ici la fin du mois (minuit du 1er, heure du
Québec), en FOURCHETTE — du bloc de 7 jours le plus calme au plus chargé des 30 derniers jours (`lib/vehicle/prevision.ts`,
`previsionFinDeMois`, pure). Fenêtre FIXE de 30 jours, deux lectures dédiées : elle ne suit pas le sélecteur de période.
Elle se tait, avec la raison affichée, si : moins de 14 jours de relevés, dernier relevé de plus de 3 jours, aucun
kilomètre, aucune consommation mesurée, ou plus d'un relevé d'odomètre sur dix incohérent. Un relevé qui recule ou
implique plus de 250 km/h est écarté et compté. Pas de dollars : aucun prix du kWh n'est mesuré. ⚠️ Écart avec le
texte de l'issue : « aucune recharge mesurée » est lu comme « aucune CONSOMMATION mesurée » — les kWh viennent de la
consommation (kWh/100 km), la bZ ne publie aucune énergie ajoutée. Le contrôle navigateur tourne maintenant deux fois
(6 jours : elle se tait ; 30 jours : elle s'affiche en fourchette) ; la base fictive varie son rythme d'une semaine
à l'autre pour que la fourchette ne soit pas un point. Verrous : `tests/previsionFinDeMois.test.ts`,
`tests/ordreTendances.test.ts`, `tests/preuveEcran.test.ts`.

## 21/10 — Les écrans se prouvent par navigateur, sans la session de Marc (CarAI#44)

`npm run preuve:ecran` (après `npm run build`) lance l'app construite avec une base FICTIVE (PGlite migrée par
`drizzle/`, servie comme Neon en HTTP : `scripts/preuve-ecran/base-fictive.mjs`) et une session d'essai (cookie
Auth.js signé avec un `AUTH_SECRET` tiré au hasard, adresse `essai@example.invalid`), puis lit `/tendances` avec
Playwright. Il vérifie d'abord que SANS cookie la réponse reste 307 vers `/login` (le garde n'est pas touché), puis
l'ordre des blocs (CarAI#30) et la première courbe (CarAI#41) ; il écrit `preuve-tendances.png` et `.json`.
`.github/workflows/preuve-ecrans.yml` le rejoue après chaque fusion sur `main` (dépôt public seulement) et joint
la capture en artefact. ⚠️ Un écran de plus à prouver = une vérification de plus dans `lancer.mjs`, pas un second
contrôle ; les données fictives n'ont aucune donnée personnelle (verrou `tests/donneesPerso.test.ts`).

## 21/10 — Une courbe de consommation ouvre « Évolution » (CarAI#41)

« Consommation (estimation) » est la première série des courbes liées de `/tendances` : un point par segment retenu
par `calculerConsommation` (nouveau champ `segments`), à sa date de fin, en kWh/100 km (`serieConsommation`, pure).
Elle partage l'axe et le zoom des autres courbes (règle du 14/08), donc elle est DANS `GraphiquesLies` ; les pneus
restent au-dessus sur leur axe unique. Fenêtre sans segment retenu : pas de courbe, une ligne le dit. Verrous :
`tests/serieConsommation.test.ts`, `tests/ordreTendances.test.ts`.

## 21/10 — Tendances s'ouvre sur la consommation (CarAI#30)

Choix de Marc (19/10) : « Consommation réelle » est le premier bloc de `/tendances`, avant « Le véhicule maintenant » ;
les déductions restent. `tests/ordreTendances.test.ts` verrouille l'ordre dans le rendu de `app/tendances/page.tsx`, y
compris la carte de la zone parcourue SOUS les courbes (elle y était déjà : la demande supposait le contraire). ⚠️ Il
n'existe pas de courbe de consommation dans « Évolution » (la consommation est un bloc calculé, `lib/vehicle/consommation.ts`) :
la mettre en première courbe est la tâche CarAI#41, pas faite ici.

## 21/10 — Le dépassement du forfait s'affiche en dollars (CarAI#7)

Marc a saisi le coût du km excédentaire dans Réglages (jamais écrit hors de la base). `libelleDepassementProjete`
(`lib/vehicle/lease.ts`, pure, testée par `tests/depassementEnDollars.test.ts` avec un tarif FICTIF) donne « Dépassement
projeté : x km, ~ y $ (estimation) » seulement quand le tarif est connu ET qu'un dépassement est projeté ; sinon `null`, et
l'écran ne change pas (la limite « tarif inconnu » reste, jamais de « 0 $ » pour un coût inconnu). Elle alimente une pastille du
bandeau du bail de l'accueil (`BandeauBail`, `app/page.tsx`) et l'outil MCP `bail` (`lib/mcp/outils.ts` : `depassementProjeteKm`,
`coutDepassementProjete`, `devise`, `coutDepassement`, ajoutés seulement dans ce cas). Preuve du tarif en production sans lire
sa valeur : `bail` annonçait un dépassement projeté avec `limites` vide, donc la branche « tarif connu » de `calculerEtatBail`.

## 16/10 — Les termes du bail ne sont plus dans le code (CarAI#239)

Décision de Marc du 15/10 (« Retirer », carte CarAI#219). `BAIL_DEFAUT` est supprimé : `lireBail()` (`lib/config.ts`)
lit la base SEULEMENT et rend `null` quand rien n'est enregistré (Réglages, « Les termes du bail »). Sans bail, aucun
chiffre n'est inventé : l'accueil, Tendances et l'outil MCP `bail` (et `etatBail` du serveur MCP) disent
« Bail non renseigné » (`MESSAGE_BAIL_NON_RENSEIGNE`, `lib/vehicle/lease.ts`), l'accueil garde les km du jour et du mois
(`calculerBilan` accepte une allocation `null`), le summary du hub n'envoie aucune métrique de bail et Réglages affiche le
formulaire vide avec un bandeau. Les fixtures de tests (dates, allocation) sont fictives, et le verrou
`tests/donneesPerso.test.ts` porte l'empreinte du kilométrage autorisé et de la date de signature. Limite dite : la durée
(en mois) reste dans les fixtures, trop courte pour être verrouillée par empreinte. ⚠️ Sans bail en base, la production affiche « non renseigné » :
avant ce retrait le repli du code masquait la base, donc seule la lecture de l'outil MCP `bail` en production APRÈS
déploiement prouve que Marc l'a enregistré (sinon : le saisir dans Réglages, rien d'autre à faire).

## 16/10 — Suivi des erreurs : Sentry (CarAI#218)

Même branchement que app-template#40 (`instrumentation.ts`, `instrumentation-client.ts`, `app/global-error.tsx`, `lib/sentryConfig.ts`),
plus `app/error.tsx` qui envoie aussi l'erreur. **Éteint sans `SENTRY_DSN`** : l'app se construit et démarre sans rien.
**Aucune donnée personnelle** (CarAI sert la position du véhicule) : ni IP, cookies, en-têtes, corps, chaîne de requête,
utilisateur ni fil d'appels (`breadcrumbs`) ; et la ligne `params:` des messages d'erreur Drizzle est remplacée, car elle
contient les valeurs de la requête (coordonnées, kilométrage). Verrou : `tests/sentryConfig.test.ts`. La CSP (en observation)
déclare l'hôte d'envoi `https://*.ingest.us.sentry.io` (organisation `mokarade`, région us).

- **Ce qui est branché en production** : le code. **Ce qui ne l'est PAS** : `SENTRY_DSN` n'est pas posé dans les variables Vercel
  (décision de Marc du 16/10, « on laisse »). Tant qu'il ne l'est pas, les déploiements Vercel n'envoient rien à Sentry.
- **Preuve de la chaîne** : workflow manuel « Essai Sentry » (Actions > Essai Sentry > Run workflow, ou `npm run sentry:essai` avec
  `SENTRY_DSN` dans l'environnement) : il lit le secret `SENTRY_DSN` du dépôt, envoie une erreur volontaire par les MÊMES réglages que
  l'app et échoue si Sentry ne répond pas 2xx. Il tourne sur le robot du PC (dépôt privé).
- Pour allumer la production : poser `SENTRY_DSN` dans Vercel (geste soumis à l'accord de Marc), redéployer, déclencher une erreur.

## 16/10 — Contrat hub v1.5.0 (zod 4) (CarAI#289)

`@mokarade/hub-contract` passe de `#v1.4.0` à `#v1.5.0` (commit `440a301`, hub-contract#56) : le contrat est en zod 4, donc
l'arbre n'a plus qu'un seul zod (4.6.7, `npm ls zod`), la copie zod 3 imbriquée du contrat disparaît du lockfile.
Le contrat `/hub/summary` n'a pas bougé : typecheck 0 erreur, mêmes 1 735 tests, build et portes verts. Le plancher
« jamais sous v1.3.0 » reste vrai (commentaire `//hub-contract` du `package.json`).

## 16/10 — Socle visuel commun : jetons hexadécimaux aux noms d'app-template (CarAI#217)

Décision 14 du plan de standardisation (15/10) : les neuf apps parlent le même vocabulaire visuel. CarAI
reste SOMBRE SEUL (décision de Marc du 17/08, relue dans `docs/claude/02-conventions.md`) et garde ses valeurs :
les `oklch` d'avant sont convertis en hexadécimal d'après le rendu réel de Chromium (canvas) : mêmes teintes,
à 1/255 près (accent clair ≤ 21/255 au milieu du dégradé de la barre de titre, cyan hors gamme sRGB).
Comparaison faite pixel par pixel avant la fusion, sans image gardée dans le dépôt (CarAI#295). **Deux écarts visibles, tous deux des bugs d'avant
corrigés au passage** : la minification de Next transformait les `oklch` littéraux en bloc `@supports (color:lab…)`
qui redéclarait `background` en raccourci, ce qui (1) dégelait le fond à halos (`background-attachment: fixed` perdu,
le dégradé se répétait à la hauteur de l'écran) et (2) faisait du chiffre de marge de l'accueil (`.verdict-nombre`,
`background-clip: text` perdu) un rectangle plein vert. Plus aucun `oklch(` littéral ne subsiste, donc plus de `@supports`. Verrou : `tests/theme.test.ts` (couleurs hors `:root`, contrastes, cibles de
44 px, champ à 16 px, vocabulaire), complété par `tests/aides/couleurs.ts` (clarté OKLab, contraste WCAG).

- **Renommés** (feuille et tests) : `--bg` → `--fond`, `--bg-2` → `--fond-2`, `--surface-2` → `--surface-douce`,
  `--text` → `--texte`, `--text-soft` → `--texte-doux`, `--text-faible` → `--texte-faible`, `--border` →
  `--bordure`, `--border-net` → `--bordure-nette`, `--ok` / `--attention` / `--danger` → `--succes-texte` /
  `--alerte-texte` / `--erreur-texte`. `.card` et `.card-large` deviennent `.carte` et `.carte-large`.
- **Ajoutés** : `--bordure-champ`, `--accent-fonce`, `--sur-accent`, `--repere`, `--repere-doux`, `--succes-fond`,
  `--alerte-fond`, `--erreur-fond` (le contrat du socle), plus une vingtaine de teintes nommées par emploi
  (`--erreur-vif`, `--groupe-voiture`, `--neutre` …) qui remplacent les 100 `oklch(…)` écrits dans les règles.
  Une teinte translucide s'écrit `color-mix(in srgb, var(--jeton) 40%, transparent)`, jamais en dur.
- **Vocabulaire commun** ajouté en fin de feuille (`.bouton`, `.bouton-principal`, `.bouton-second`,
  `.bouton-danger`, `.champ`, `.doux`, `.succes`, `.texte-succes`, `.texte-erreur`, `.bandeau`, `.surtitre`) :
  aucun JSX d'aujourd'hui ne les pose, donc aucun écran ne change. **Non ajoutés** car déjà pris ici avec un autre
  sens : `.alerte`, `.erreur`, `.pastille`, `.etiquette` (liste et raisons dans `PRIS_AILLEURS` du test).
- **Doublon retiré** : `--serie-0` à `--serie-3` étaient définis deux fois ; la seconde définition gagnait, la
  première était morte. Le test « chaque couleur est définie une seule fois » le garde.
- **Écart connu (corrigé le 16/10, CarAI#284)** : `--texte-faible` faisait 4,25:1 sur `--surface` ; il passe de
  `#757a85` à `#808690` (4,99:1 sur `--surface`, 4,61:1 sur `--surface-douce`), verrouillé par `COUPLES`.
- **Exceptions TypeScript nommées** : `lib/hubSummary.ts` (couleur du widget, champ du contrat), `lib/carteVivante.ts`
  (API Google Maps), `app/manifest.ts` et `app/layout.tsx` (égalité avec `--fond` vérifiée), page OAuth
  `app/api/mcp/authorize/route.ts` (HTML autonome, sans la feuille globale).
- Captures avant/après : retirées du dépôt (CarAI#295), parce qu'elles montraient des mesures qui paraissent réelles. Le constat reste écrit ci-dessus.

## 15/10 — Les écrans secondaires en colonnes sur PC (CarAI#188, REFONTE-UI lot 3)

Activité, Tendances et Données posent des groupes de blocs de même rang dans `.colonnes-pc`
(`app/globals.css`, juste après les paliers du héros, sous `@media (min-width: 900px)`) :
`auto-fit` + `minmax(min(100%, 24rem), 1fr)`, donc un groupe dont un membre est absent laisse
l'autre pleine largeur. Sous 900 px la classe ne fait rien : le téléphone est inchangé.
Verrou : `tests/grillesEcransPc.test.ts`. Mesuré sur une maquette (Chromium, données fictives) :
2 colonnes à 1280 px, 1 bloc seul pleine largeur, `display: block` à 390 px. Pas vérifié sur les
vraies pages (derrière la session du hub).

## 15/10 — Tendances s'ouvre sur 7 jours, lecture brute plafonnée (CarAI#200)

La limite mensuelle de transfert Neon a été dépassée. `/tendances` sans paramètre affiche
« 7 derniers jours » (`DEFAUT_TENDANCES`, `lib/vehicle/fenetre.ts`, partagé avec le bouton
« Effacer ») ; « Tout » reste un clic. `lireSerie` en brut porte un `.limit()`
(`LIMITE_SERIE_BRUTE` = 50 000, ancré côté RÉCENT) et `Serie.tronquee` dit quand il a mordu
(l'outil MCP `historique` ajoute alors `noteTroncature`). Verrou : `tests/tendancesSeptJours.test.ts`.
Les courbes longues sont agrégées en SQL depuis CarAI#254 (section suivante).

## 16/10 — Courbes longues de Tendances agrégées en SQL (CarAI#254)

Jusqu'à 7 jours (+ 2 h de tolérance au changement d'heure), une courbe lit les relevés bruts comme
avant. Au-delà, `serieCourbe` (`lib/vehicle/analyse.ts`) demande à la base UN point par tranche :
à l'heure jusqu'à 45 jours, au jour au-delà ou sur « Tout » (`granulariteCourbe`). Moyenne, sauf
l'odomètre (maximum) ; par source, jamais mêlées ; les deux bornes sont appliquées en SQL (la
première tranche, partielle, est gardée). L'écran le DIT : une phrase sous les courbes, et
« 720 points — moyenne de l'heure » à la place de « N relevés » dans le relevé détaillé. Une
moyenne lisse un pic bref : pour le détail exact, 7 jours ou l'onglet Données.
Les tranches « jour » suivent le fuseau de session de la base (UTC sur Neon), pas celui de Marc : une
tranche va donc de 20 h à 20 h heure du Québec (19 h à 19 h en hiver). Acceptable pour une courbe ; le test fige UTC.
Pas touché : la consommation (kWh/100 km) lit toujours l'odomètre et la charge bruts sur la
fenêtre. Verrou : `tests/tendancesAgregats.test.ts` (base de test). Pas vérifié sur les vraies pages
(derrière la session du hub).

## 16/10 — La couverture s'affiche dans le résumé de la CI, seuils resserrés (CarAI#215)

Le cliquet de couverture existait déjà (`qualite/portes.mjs`, seuils dans `qualite/seuils.json`) ; il
manquait de le VOIR et de le resserrer. Le job « Qualité » écrit maintenant le tableau des portes dans le
résumé du job (étape « Résumé des portes » de `ci.yml`, lecture seule de `qualite/rapport.json` : le
verdict reste celui de `portes.mjs`). Seuils resserrés sur la mesure du 16/10 : `lib/` 80.9, global 54.3
(lignes), 51.2 (branches), code mort 127, avertissements lint 0. Aucun chiffre cible : ils ne font que monter
(`npm run portes:maj`). Preuve du rouge : seuil global posé à 99 en local → `RECUL`, code de sortie 1.
Le tableau « Seuil de départ » plus bas dans ce fichier est l'historique du 23/09, pas l'état courant.

## 16/10 — Seule `main` déploie : plus de préversion pour la file de fusion (CarAI#216)

`vercel.json` désactive aussi `mergify/**`, `dependabot/**` et `feature/**` (en plus de `claude/*`). Avant,
chaque fusion créait une préversion Vercel pour le brouillon de la file Mergify (`Merge of #n`, branche
`mergify/merge-queue/...`) en plus du déploiement de production : deux déploiements sur le quota partagé
pour un seul effet. La CI ne dépend pas de Vercel (robot du PC), donc rien ne manque à la file. La liste est
FERMÉE : un préfixe de branche nouveau déploierait encore. Preuve attendue après fusion : aucun déploiement
pour la branche `mergify/merge-queue/...` de cette PR, et la production déployée sur le commit fusionné.

## 16/10 — Les quatre derniers tests PGlite sur le montage commun (CarAI#204)

`tests/inventaire`, `analyse`, `mesures` et `position` montent leur base par `baseDeTest([...tables])`
(`tests/aides/basePGlite.ts`) au lieu de recopier client, migrations, nettoyage et fermeture. Le
nettoyage se compose depuis les tables Drizzle (un renommage casse le typecheck). Aucun changement de
comportement : mêmes 121 tests verts. Dans `analyse` et `mesures`, les `beforeEach` internes à un
`describe` (autres tables ou autre moment) restent tels quels. `[QUAL-01]` est clos ; `tendancesSeptJours` et `tendancesAgregats` montent encore leur base à part (hors de cette tâche).

## 16/10 — Une recommandation sur l'accueil quand il y a une action (CarAI#190)

Sous la voiture, une phrase (`.recommandation`) apparaît seulement quand une action est calculable,
sinon rien. Une seule règle pour l'instant : charge basse et non branchée → « Branche la voiture. ».
`recommander()` (`lib/vehicle/recommandation.ts`, pure) la déduit de la clé de l'alerte `charge-basse`
déjà produite par `construireAlertes` : le seuil (20 %) n'est écrit qu'à un endroit. Le bloc
« Ce qui cloche » est inchangé et dit toujours la mesure. Verrou : `tests/recommandation.test.ts`.
Pas vu sur l'écran réel (derrière la session du hub) ; ajouter d'autres phrases (verrou, pneus,
ouvrants) est une ligne dans `ACTIONS`, à décider avec Marc.

## 16/10 — Le reste du style mort retiré (CarAI#249)

`app/globals.css` ne déclare plus `.heros`, `.trajet-barre`, `.panneau-image`, `.faits-vehicule`,
`.fait-valeur` ni `.fait-libelle` (91 lignes) : aucun JSX ne les posait (revérifié avant le retrait).
`.heros-constructeur`, qui est vivante, n'a pas bougé. Aucun changement visible attendu. Verrou :
`tests/styleMort.test.ts`. Pas comparé à l'écran réel (derrière la session du hub).

## 16/10 — Un seul `secretValide` pour les routes hors session (CarAI#203)

La comparaison en temps constant du secret partagé vit dans `lib/secretPartage.ts` et sert
`/api/cron/smartcar-poll`, `/api/cron/toyota-poll` et `/api/webhooks/toyota-otp`. Aucun changement
de comportement : mêmes 503 (secret non configuré) et 401 (refusé), chacun resté dans sa route
parce que le secret attendu (`CRON_SECRET` ou `TOYOTA_OTP_WEBHOOK_SECRET`) et le message diffèrent.
Verrou : `tests/secretPartage.test.ts` (comportement, et « défini une seule fois » par lecture
des sources). Pas de page à regarder : ces routes n'ont pas d'écran.

## 16/10 — La liste de purge ne se charge que sur clic (CarAI#202)

`/reglages` ne lit plus `inventaireSimulees()` à l'ouverture (il parcourt toutes les positions,
tous les odomètres et toutes les pressions). La section « Purge du véhicule de test » reste repliée
et montre un bouton « Chercher les mesures impossibles » : il appelle la Server Action
`chargerInventairePurge` (`app/reglages/actions.ts`, session revérifiée), puis l'écran à deux temps
d'avant s'affiche tel quel. Un échec de lecture se dit (`MESSAGE_ECHEC_INVENTAIRE`) et ne se lit jamais
comme « rien à purger ». La suppression n'a pas changé (identifiants recoupés avec l'inventaire).
Verrou : `tests/purgeSurDemande.test.ts`. Pas vérifié sur la vraie page (derrière la session du hub).
Avec ceci, `[NEON-TRANSFERT]` a ses parties (a), (b) et (c) faites.

## 15/10 — ⚠️ Aucune donnée perso dans un fichier versionné (CarAI#219)

Décision de Marc du 15/10 (« aucune donnée perso en ligne ») : coordonnées GPS réelles,
montants de financement, relevés d'odomètre réels et noms de rues ont été remplacés par des
valeurs **fictives** dans les tests, le code et les docs. Le verrou `tests/donneesPerso.test.ts`
lit tous les fichiers suivis par git et échoue sur une coordonnée précise hors liste blanche,
ou sur un mot ou un nombre retiré (empreintes SHA-256, pas les valeurs). Ce verrou attrape ce
qu'on lui a appris ; une nouvelle donnée réelle trouvée se retire ET son empreinte s'ajoute.
Les termes du bail (repli `BAIL_DEFAUT`, fixtures) ont été retirés ensuite (CarAI#239, entrée du 16/10 en tête) ;
la section « Ce dépôt est PUBLIC » plus bas décrit l'accord du 12/08, que la règle du 15/10 remplace.

## 18/09 (6) — ⚠️ LES `min`/`max` D'UN ACCESSEUR NE DISENT PAS OÙ EST L'OBJET

Marc, capture à l'appui, dès que la 3D a été en ligne : « **marche pas elle est minus** ».
La voiture était un point de quelques pixels au milieu de marqueurs parfaitement lisibles.

**La cause, mesurée dans le fichier livré.** Les douze nœuds de `public/modele/bz.glb`
portent chacun, en propre :

| | |
|---|---|
| `scale` | `[0,01 · 0,01 · 0,01]` → la scène est en **mètres** |
| `rotation` | quaternion `(0,7071 · 0 · 0 · 0,7071)` → **+90° autour de X, déjà appliqué** |

Composé sur les `min`/`max` des accesseurs, ça donne une boîte de **2,116 × 1,510 × 4,689 m**
— la bZ4X réelle, déjà debout et déjà dans le bon sens.

Le lot 4b avait mesuré la géométrie dans les **buffers**, c'est-à-dire l'espace LOCAL des
maillages, et en avait déduit le repère de la scène. D'où deux défauts, tous deux livrés :

1. Le rendu appliquait `gltf.scene.rotation.x = +90°` **par-dessus** celle du fichier : la
   voiture partait couchée.
2. Les ancres restaient en unités de buffer, donc **cent fois trop grandes**. Le cadrage
   calculé pour un objet de 2,7 « unités » plaçait la caméra à des centaines de mètres —
   et le plafond d'orbite écrit en dur (`1600`) valait 1,6 **kilomètre** une fois interprété
   en mètres.

⚠️ **Pourquoi aucun test ne l'a vu** : les marqueurs et le cadrage étaient à la MÊME fausse
échelle, donc parfaitement cohérents entre eux. Toute la géométrie se vérifiait elle-même.
Ce qui manquait, c'est le lien avec la seule chose qui ne mentait pas — **le fichier livré**.

`tests/modele3d.test.ts` compose désormais la transformation TELLE QU'ELLE EST ÉCRITE dans
le glTF et exige que les ancres tombent dans la carrosserie. Prouvé par perturbation : sur
`ECHELLE_MODELE = 1` (le défaut exact), **5 tests rougissent** ; sur un rendu qui re-tourne
la scène, **1** ; sur les bornes d'orbite en dur, **3**.

**La leçon, et elle dépasse la 3D** : lire les bornes d'un tableau de données donne la forme
de l'objet, jamais sa PLACE. Entre les deux il y a une chaîne de transformations, et un
fichier exporté par un outil en porte presque toujours une.

---

## 18/09 (5) — ⚠️ « AUCUN DÉPLOIEMENT » LU DANS L'API N'EST PAS « AUCUN DÉPLOIEMENT CRÉÉ »

Marc, quatre minutes après la fusion de #132 : « je vois pas le 3d ». Il avait raison sur
le symptôme — la production servait encore le build d'avant. **J'ai eu tort sur la cause**,
et je l'ai annoncée avant de l'avoir établie.

**Ce que j'ai lu, et ce qui était vrai** :

| heure (UTC) | ce que j'ai mesuré | ce qui était vrai au même instant |
|---|---|---|
| 20:20:36 | merge de #132 sur `main` (`21bc66c`) | — |
| 20:22 | aucun déploiement pour `21bc66c` | exact : il n'existait pas encore |
| **20:23:39** | *(pas de mesure)* | **le déploiement est créé**, `QUEUED` |
| 20:25 | `latestDeployment` = `e9c596d`, `updatedAt` = 19:58:15 | **faux** — l'API servait une vue vieille de deux minutes |
| 20:27 | `dpl_7WyRT…`, `QUEUED`, SHA `21bc66c`, `repoPushedAt` 20:20:36 | — |

Le webhook GitHub → Vercel a donc parfaitement fonctionné : **3 minutes** entre le push et
la création du déploiement. Ce qui restait à attendre n'était pas une livraison manquante
mais la **file d'attente de Vercel** — et ce lot embarque 6 Mo de modèle plus le moteur de
rendu, donc un build plus long que d'habitude.

⚠️ **LA LEÇON, ET ELLE EST GÉNÉRALE** : `get_project` et `list_deployments` peuvent servir
une vue RETARDÉE de plusieurs minutes. Un déploiement `QUEUED` n'y apparaît pas tout de
suite. « Aucun déploiement pour ce SHA » à un instant T n'est donc **pas** le diagnostic
d'un webhook perdu — c'est une observation, et elle doit être REFAITE à quelques minutes
d'intervalle avant de conclure. Le §6 apprend à se méfier de `READY` qui ne dit pas quel
commit ; il lui manquait le symétrique : **une ABSENCE lue dans cette API n'est pas une
absence dans le monde.**

⚠️ **Ce que ça a coûté** : un push de rattrapage (#133) déclenché sur un diagnostic
prématuré, donc un déploiement de plus sur un quota de 100/jour PARTAGÉ entre les six
projets — exactement ce que la §6 bis demande d'éviter. Le correctif qu'il porte est réel
(une prop sans producteur), mais il aurait dû attendre le lot suivant.

⚠️ **Le discriminant qui manquait, et qui aurait tranché en une lecture** : `repoPushedAt`
du dernier déploiement connu. À 20:22 il valait 19:57 — donc « rien reçu depuis le merge »,
ce qui est compatible avec « en retard » ET avec « perdu ». Pour distinguer les deux, il
n'y a qu'une chose à faire : **attendre et re-mesurer**. Un délai de 5 minutes avant de
conclure est le minimum ; l'incident du 31/07 durait TROIS HEURES, et celui du 13/08 avait
tenu assez longtemps pour se lire sans hâte.

---

## 18/09 (4) — LA VOITURE EN VOLUME : le modèle rendu, et les états posés dessus

Demandé par Marc au cadrage de la refonte : « limite une interface 3D que je peux voir la
voiture, tourner autour etc et voir les états de chaque élément ». Le lot 4a avait posé le
modèle et calculé OÙ chaque état se pose ; ce lot-ci le rend et le branche à l'accueil.

**Ce que tu verras** : un bouton « Voir en 3D · 6 Mo » sous la voiture dessinée. Il ouvre la
bZ en volume, par-dessus la page — on tourne au doigt, on pince pour approcher. Les mêmes
pastilles qu'en 2D sont posées sur la carrosserie, et celles qui passent derrière s'éteignent
au lieu de rester cliquables au travers de la tôle.

### 🟦 CE QUI ATTEND TON ŒIL — une seule chose, et elle tient en un coup d'œil

**Quel côté du modèle est la gauche ?** Rien dans le fichier ne le dit : il faudrait un
élément asymétrique (le volant, la trappe de charge), et l'intérieur est fusionné tandis que
la trappe n'existe sous aucun nom. Tant que ce n'est pas confirmé, `COTE_VERIFIE` vaut
`false` et l'écran affiche une réserve sous la vue. Si les pressions tombent du bon côté,
dis-le et la réserve disparaît ; si elles sont inversées, ça se corrige en changeant **un
signe** dans `lib/vehicle/ancresVoiture.ts`.

### Ce qui a été tranché, et pourquoi

- **Rien n'est redérivé.** La vue 3D reçoit les mêmes `PointVoiture` que le schéma 2D. Deux
  dérivations auraient donné deux voitures qui ne disent pas la même chose — et c'est l'écran
  qu'on regarde le moins qui aurait menti, sans que rien ne rougisse.
- **Ce qui n'a pas de lieu sur une carrosserie n'en reçoit pas.** L'odomètre et la dernière
  synchro s'affichent SOUS la vue, en clair. Les poser sur une portière inventerait un
  endroit, et l'endroit se lirait comme un sens.
- **Le chargement est différé, et le poids est écrit sur le bouton.** Mesuré après build :
  l'accueil reste à 111 kB de premier chargement, aucun chunk d'entrée ne contient `three`.
  Six mégaoctets qui partent sans prévenir, sur un forfait mobile, ça se découvre sur une
  facture.
- **La rotation qui redresse le modèle est +90°, pas −90°** comme le backlog l'annonçait.
  Elle se dérive de la matrice ; à −90° la voiture serait sur le toit, et **rien n'aurait
  planté**.

### Ce qui reste du chantier d'interface

Le **lot 3** — la vraie grille en colonnes sur PC, les quatre écrans — n'est pas commencé.
Le **lot 5** (Tendances, « à améliorer beaucoup ») attend un cadrage court, et le **lot 6**
(les recommandations) vient après.

---

## 18/09 (3) — `[BAIL-04]` : le pourcentage du forfait, et ce qui permet de le lire

**Livré, mais pas comme le ticket le décrivait.** Il disait « `consommePourcent` est déjà
calculé, rien ne le lit ». Recensé : la barre « Allocation du bail » de l'accueil le
MONTRAIT déjà — en le RE-CALCULANT à la main. Ce n'était donc pas un cadran qui manquait,
c'était le CHIFFRE, et surtout son point de comparaison.

**Pourquoi le chiffre seul ne suffisait pas.** « 6,8 % du forfait » est excellent au bout
d'un an et catastrophique au bout d'un mois : le point de comparaison n'est pas 100 %, c'est
le temps ÉCOULÉ. Cette règle existait déjà, écrite EN DUR dans `lib/hubSummary.ts` — le
seul endroit qui lisait le champ. Elle est extraite en source unique (`avanceSurLeBail`,
`lib/vehicle/lease.ts`, PURE), et le hub comme l'accueil la consomment.

À l'accueil : une pastille « X % du forfait · Y % du temps », dont le ton suit l'écart
(seuils +5 et +15 points, nommés en constantes).

⚠️ **Le ton de la barre n'a PAS bougé**, délibérément : il suit `ecartKmParJour` — le
rythme actuel dépasse-t-il ce qui reste autorisé par jour — qui est PROSPECTIF. L'avance
sur le forfait est rétrospective. Deux signaux distincts : les fondre en dirait un pour
l'autre.

⚠️ **Ce que la mesure du jour apprend sur `[SANTE-01]`, avant que quelqu'un ne code pour
rien.** La dégradation de la batterie est le rapport `tractionbattery-capacity` /
`tractionbattery-nominalcapacity`. Sur la base réelle : le dénominateur porte 46 valeurs,
le numérateur **aucune ligne, jamais**. Le rapport n'est pas calculable aujourd'hui. C'est
écrit dans le ticket.

## 18/09 (2) — « ÇA COUPE À LA MOITIÉ DU TRAJET » : un seuil calibré sur la mauvaise cadence

**Le symptôme.** Marc : « le trajet sur la carte marche pas ça coupe à la moitié du
trajet ». Ce n'était pas la carte — c'était le découpage des trajets.

**La mesure qui tranche.** Sur les 34 trajets réels des 7 jours précédents, **tous avaient
exactement 2 relevés**. Aucun n'en avait jamais trois. L'aller Maison → Travail du 18/09,
110 km d'un seul tenant, sortait en TROIS trajets — 6 km, 91 km, 13 km — séparés
d'« arrêts » de 38 et 39 secondes. La carte montre le dernier trajet par défaut : Marc
voyait donc ses 13 derniers kilomètres.

**La cause.** `PAUSE_MINUTES = 45` fermait tout segment plus long que 45 minutes. Sa
justification écrite confondait deux cadences : celle du POLL (« il passe toutes les 30
minutes ») et celle à laquelle **la voiture republie sa position**. Le poll ne crée pas de
relevé, il en LIT un. Mesurée, la seconde cadence est de **46 à 99 minutes** — le seuil
était donc structurellement SOUS ce que la bZ produit, et aucun trajet ne pouvait jamais
enchaîner deux segments. Ce n'est pas une régression du correctif de cadence de la veille :
les trajets du 14 et du 16/09 portent déjà le défaut.

**Ce qui est livré** (arbitrage de Marc : « carte complete et plus long delai ») :
- `PAUSE_MINUTES` : 45 → **120**, avec sa mesure et sa date écrites à côté. Un vrai
  stationnement ferme de toute façon par `bouge` (compteur immobile) ou `estArret`
  (`LAST_PARKED`) : le seuil ne mord que là où la voiture a réellement roulé.
- La carte d'Activité couvre désormais la **journée** du trajet sélectionné
  (`trajetsDuMemeJour`, PURE), pas ce seul trajet. Quand la journée en porte plusieurs,
  l'écran le DIT — la carte et le panneau de détail ne parlent alors plus du même objet.

⚠️ **Le test qui manquait, et pourquoi il manquait.** Tripler le seuil ne faisait rougir
AUCUN des 55 tests de `trajets.test.ts`. Ce n'était pas une preuve d'innocuité : aucune
fixture n'exerçait la coupure par DURÉE avec un compteur qui AVANCE — les deux tests
voisins ferment par immobilité. La garde ajoutée rejoue le cas réel du 18/09 (49, 49,
13 min) ; remettre le seuil à 45 la fait tomber avec exactement le défaut de production
(3 trajets au lieu d'1).

⚠️ **Ce que l'arbitrage laisse ouvert.** Marc a écarté l'option « le compteur tranche »
(la vitesse moyenne du segment décide, sans plafond de durée). Conséquence assumée : un
segment de plus de 120 minutes se coupe encore, même en mouvement, et un arrêt réel de
moins de 120 minutes sans relevé `LAST_PARKED` est désormais fusionné dans le trajet.

## 17/09 (2) — CarAI a enfin des en-têtes de sécurité

`[SEC-01]`. CarAI était **le dernier dépôt de l'écosystème sans aucun en-tête** — Hubperso,
BatchChef et DriveAI les portent depuis le 31/07 — alors qu'elle sert sur Internet la
position du véhicule, son kilométrage et les habitudes de charge.

Cinq en-têtes **enforcés** (HSTS `includeSubDomains`, `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`) et la CSP en
**Report-Only**, dans `next.config.mjs`.

⚠️ **La CSP OBSERVE, elle ne protège pas encore** — et c'est une décision, pas un oubli.
Deux ressources externes en dépendent, et une CSP trop serrée les couperait **sans que le
build ni les tests ne le voient** (leçon DriveAI) :
- `tile.openstreetmap.org` — les tuiles de carte sont des `<img>` ; sans elles la carte
  devient blanche ;
- `www.google.com` — l'iframe `maps/embed` de l'itinéraire.

➜ **Pour l'enforcer** : ouvrir l'app, parcourir accueil / trajets / activité / réglages et
la carte, vérifier qu'aucune violation n'apparaît en console, puis renommer la clé
`Content-Security-Policy-Report-Only` en `Content-Security-Policy`. La marche à suivre est
aussi dans `next.config.mjs`.

⚠️ `geolocation=()` est sûr **parce que c'est vérifié** : l'app ne demande jamais la
position du navigateur, elle lit celle de la voiture. Un test le re-mesure à chaque gate —
le jour où une carte « autour de moi » arriverait, cette ligne la couperait en silence.

### Deux tickets redressés au passage

Recensés plutôt que recopiés, comme le veut la règle « le périmètre d'un ticket se RECENSE » :

- `[COUT-01]` (tarif du kWh) était **fait** : les recharges sortent « Maison — tarif $/kWh »
  en qualité `mesure`, ce qui n'est possible que si la valeur est renseignée. Coché.
- `[UI-02]` (bouton « rafraîchir maintenant ») annonçait que le chemin `demandeExplicite`
  « existe déjà ». **Faux pour le sujet qui compte** : il ne vit que dans le module Toyota,
  désactivé. Côté Smartcar il n'existe pas, et la route de poll n'a **aucune
  contre-pression** — un bouton sans plancher permettrait de marteler Smartcar au clic. Le
  ticket porte maintenant le vrai périmètre.

## 17/09 — POURQUOI DES RECHARGES DISPARAISSAIENT

Marc : « trop long entre les signaux, parfois je vois même pas une recharge, c'est vraiment
pas fiable, pas assez précis, ça donne l'impression d'un produit non fini. » Quatre causes
distinctes, toutes mesurées, trois corrigées ici.

### 1. Le poll tournait 6 fois par jour sur 48 demandées

Mesuré sur les 60 derniers runs (8 → 17 septembre) : écart **médian 237 min**, **jamais
moins de 121 min**, maximum 413 min. Les minutes de déclenchement sont réparties sur tout
le cadran alors que le cron demandait `:00` et `:30` — GitHub ne tente même pas à l'heure
voulue, il coalesce. Sur toute la vie du workflow : 536 runs en 37 jours, soit 14,5/jour.
**La cadence de 30 min n'a jamais existé.**

Ni une recharge ni un trajet n'est mesuré par la voiture : les deux sont DÉDUITS de relevés
qui les encadrent. Une recharge commencée et finie dans un silence de quatre heures ne
laisse donc aucune trace — ce n'est pas un défaut d'affichage, c'est une mesure qui n'a
jamais été prise.

⚠️ **Accélérer le cron n'y changerait rien** (c'est le NOMBRE de runs qui est plafonné, pas
leur date) et **boucler dans le run n'est pas payable** : dépôt privé, 2 000 min/mois, une
boucle de 4 h coûterait 1 440 min par jour.

### 🟦 CE QUI RESTE À TON GESTE — sans lui, rien de tout ça ne change

Le déclencheur principal doit vivre hors de GitHub (ton choix du 17/09 : **cron-job.org**).

| | |
|---|---|
| URL | `https://carai.hubperso.com/api/cron/smartcar-poll` |
| Méthode | `GET` |
| En-tête | `Authorization: Bearer <la valeur de CRON_SECRET dans Vercel>` |
| Intervalle | 15 min |

La route accepte aussi `x-cron-secret` si le service ne permet pas `Authorization`. Le
workflow GitHub reste en **filet**, aligné sur la même cadence.

⚠️ Cette configuration vit HORS du dépôt : aucun test ne peut la vérifier. Ce qui la
surveille est la cadence **observée** — page Données de l'app, et `expectedMaxAgeSec`
publié au hub.

⚠️ **Le coût Smartcar de l'accélération n'a PAS pu être mesuré** depuis une session (le
domaine est filtré par la politique d'egress). Passer de 6 à 96 polls par jour multiplie
par 16 le nombre de lectures. Le geste qui la finance est sur
`https://carai.hubperso.com/analyse` : il liste les signaux que la bZ refuse
systématiquement, et les retirer de la souscription cesse de payer pour des erreurs.

### 2. Une nuit branchée s'affichait en trois recharges

`chargesDepuisSoc` clôturait la session dès qu'un relevé ne montait pas. Un palier — arrondi
du capteur, fin de charge, équilibrage — suffisait à couper. Données réelles du 17/09 :
79→84, 84→87, 87→90, bornes jointives au point près, pour une seule nuit où le câble n'avait
pas bougé. `TROU_MINUTES` (75 min) existait pour ça mais n'était appliqué que sur le chemin
`etatsCharge`, celui que la bZ n'alimente pas. Un palier est désormais TRAVERSÉ, jamais
accumulé : la fin de session reste la dernière montée réelle.

### 3. Un coût facturé à l'heure sur une fenêtre de sondage

« Travail — 1,00 $/h sur 3 h 52 » affichait 3,86 $ en qualité « mesure ». La durée est un
majorant assumé par le code ; un majorant multiplié par un tarif ne donne pas une mesure. Le
montant reste affiché — un trou dans un cumul coûte plus cher qu'un chiffre dont on dit la
valeur — mais il passe en « estimé » et dit qu'il est un plafond. Au kWh, rien n'est dégradé :
la durée n'entre pas dans le calcul, donc la maison reste une mesure.

### 4. Deux recharges avaient pour lieu « ~0.00, 0.00 »

Le connecteur MCP remplaçait une position absente par `{ lat: 0, lng: 0 }`. Une coordonnée
fabriquée ENTRE dans la recherche de lieu : un lieu enregistré près du point nul se verrait
attribuer des sessions qui n'y ont jamais eu lieu. Deux lignes du même fichier traitaient
déjà ce `null` de deux façons — le prix honnêtement, le nom en fabriquant un point.

## 15/09 (3) — la branche de travail du 14/08 est ARCHIVÉE, pas perdue

`origin/claude/carai-electric-car-app-wdya72` était figée au **14/08/2026** et avait divergé :
49 commits d'un côté, 47 de l'autre, et elle n'est pas un ancêtre de `main`. Un garde d'arrêt
de session la lisait comme « 47 commits non poussés » — un faux positif : le travail courant
est sur `main` (`origin/main..HEAD` = 0).

**Avant de la déclarer morte, son contenu a été comparé à `main`** (leçon BatchChef : une
branche qualifiée « abandonnée » y portait 75 commits uniques) :

- Tous les fichiers créés par ses huit commits de tête existent sur `main`, la plupart plus
  étoffés — `charges.ts` 634 → 842 lignes, `trajets.ts` 696 → 902, `carte.ts` 234 → 304.
- Trois sont **identiques au blob près** : `lib/smartcar/commands.ts`, `lib/vehicle/graphique.ts`,
  `tests/graphique.test.ts`. Le correctif « une commande refusée n'est plus annoncée comme
  réussie » est donc sur `main` au octet près.
- Deux fonctions n'existent plus : `puissanceMoyenneKw` et `rythmeChargePointsParHeure`.
  `main` porte à la place `statutDeCharge`, `etatBandeauCharge` et `estimerBorne` (qui déduit
  la puissance de kWh ÷ heures) — une refonte du même besoin, pas une disparition du sujet.

⚠️ **Le seul résidu réel** : avec ces deux fonctions, deux gardes ont disparu et ne sont
couvertes nulle part ailleurs sur `main` — « calcule la puissance moyenne » et « refuse un
delta nul ou négatif ». Elles vivent encore dans l'archive, dans `tests/charges.test.ts`.

**L'archive** : `archive/carai-2026-08-14`, pointe `409d938c`, poussée et vérifiée côté
serveur. Rien n'a été forcé, rien n'a été réécrit.

⚠️ **La branche périmée n'a PAS pu être supprimée depuis une session** : le proxy git rend
`HTTP 403` sur la suppression de ref (même classe que l'impossibilité de pousser un tag chez
`hub-contract`, vérifiée en essayant), et le garde-fou de mode automatique refuse l'opération
de son côté. C'est un geste du poste de Marc, ou l'écran *Branches* de GitHub. Tant qu'elle
existe, le garde d'arrêt continuera d'annoncer des commits non poussés qui n'existent pas.

## 15/09 (2) — LE BAIL EN DOLLARS : CarAI lit FinanceAI

Marc : « fais le lot B ». Le bandeau Bail de l'accueil montrait des KILOMÈTRES et aucun
dollar — pas par oubli : **CarAI n'en connaît aucun**. `TermesBail` porte des dates et des
kilomètres, jamais une mensualité.

### Ce qui a été livré, des deux côtés

- **FinanceAI** (PR #967) : `GET /vehicule/bail`, un endpoint minuscule qui publie UNE dette,
  gardé par un secret **dédié** (`FINANCEAI_VEHICULE_TOKEN` — jamais celui du hub, qui
  ouvrirait la valeur nette pour lire une mensualité). 409 quand deux véhicules coexistent :
  publier la mauvaise dette mettrait un montant faux et *crédible* sur l'accueil.
- **CarAI** : `lib/financeai/bail.ts` (le client, sept états), `lib/vehicle/paiementsBail.ts`
  (le calcul, PUR), `lib/vehicle/messageBail.ts` (sept messages distincts), et la barre
  « Payé sur le bail » sous celle des kilomètres.

### ⚠️ Les trois pièges du lot

1. **Le total d'un bail est `mensualité × durée`, JAMAIS le montant financé.** Les deux ne
   coïncident qu'à taux nul — le second est le CAPITAL, pas la somme des versements. Il est
   publié quand même, et sert de CONTRÔLE de cohérence.
2. **« Injoignable » est un état NORMAL.** FinanceAI tourne sur le PC de Marc. Les sept modes
   de lecture donnent sept messages DISTINCTS, parce que chacun appelle un geste différent
   (poser deux variables, rallumer le PC, corriger un jeton, nommer la bonne dette, renseigner
   une mensualité). Un tiret unique les confondrait tous.
3. **Un `var(--jeton)` inexistant est un no-op SILENCIEUX.** J'ai écrit `var(--texte-doux)` :
   les jetons de ce dépôt s'appellent `--text-soft`. Rien ne rougit — ni typecheck, ni lint,
   ni build ; la règle s'applique et la couleur est héritée. D'où `tests/jetonsCss.test.ts`,
   qui refuse tout jeton employé mais jamais déclaré (et qui connaît ceux posés en style
   inline depuis le TSX, sinon il crierait sur `app/ui/Graphique.tsx`, parfaitement sain).

### ⚠️ Ce qui N'EST PAS dans ce lot, et pourquoi

Le **coût des recharges** n'est pas ajouté au bandeau, alors que Marc avait répondu « contrat
+ recharges ». Le cumul depuis la signature exige tout l'historique de positions — **685
lignes aujourd'hui (mesuré), et ça grandit chaque mois** — que l'accueil ne charge pas (il
s'en tient au mois). Le dupliquer ici le paierait sur l'écran le plus consulté, ou produirait
un second cumul qui divergerait de celui d'Activité. Le bandeau porte donc le CONTRAT ;
Activité garde le cumul. Un lot à part si Marc veut les deux au même endroit.

### ⚠️ Deux gestes de Marc restent

`FINANCEAI_BAIL_URL` + `FINANCEAI_BAIL_TOKEN` côté CarAI (Vercel), `FINANCEAI_VEHICULE_TOKEN`
(même valeur, ≥ 16 caractères) côté FinanceAI, puis **redémarrer le serveur MCP**. Sans eux,
le bandeau affiche « FinanceAI n'est pas branché » — honnête, et aucun chiffre inventé.

### Vérifications

Gate complet vert. **8 perturbations, 8 rouges** sur le calcul, le client et les messages ;
**2 de plus** sur la garde des jetons CSS. Banc Chromium sur le vrai CSS, quatre états du
bandeau, à 360 · 390 · 430 px, **témoin à 54,1 px** : 0 débordement, 0 cible sous 44 px.
Coût en hauteur mesuré : le bandeau passe de **169 px à 315 px** (nominal), 424 px avec deux
réserves affichées, 256 px quand les montants manquent.

### ✅ Déploiement VÉRIFIÉ (15/09, 15 h 30 Z) — et la moitié qui n'a PAS pu l'être

Ce lot change ce que le site SERT (CSS + accueil), donc le §6 s'applique. Ce qui est **mesuré** :

1. **Le merge est un SQUASH** : `git log --format='%h %p %s' -1 origin/main` rend
   `322ddc9 41bd4cd [COUT-04] … (#115)` — un seul parent, titre en « (#N) ». La présence sur
   `main` se prouve donc par le CONTENU.
2. **Contenu sur `main`** : les trois règles CSS (`bail-dollars-absent` ×2, `bail-dollars-detail`
   ×1, `bail-dollars-reserves` ×2) et les cinq fichiers du lot (`lib/financeai/bail.ts`,
   `lib/vehicle/paiementsBail.ts`, `lib/vehicle/messageBail.ts`, `tests/jetonsCss.test.ts`,
   l'ADR 0004).
3. **Déploiement de production `READY`**, `meta.githubCommitSha` = `322ddc95…`, soit le HEAD réel
   de `main`. ⚠️ `READY` seul ne dit pas QUEL commit.
4. **Le CSS servi est le bon, prouvé par son EMPREINTE.** La page du déploiement référence
   `/_next/static/css/ca7ec556e8347f4d.css`. Un build PROPRE relancé ici sur `main` (322ddc9,
   `rm -rf .next && npm run build`) produit **exactement le même nom de fichier** — or ce nom est un
   condensé du CONTENU : deux contenus différents ne peuvent pas le partager. Le CSS servi est donc
   mon fichier local au octet près, et il porte les trois règles avec les BONS jetons
   (`var(--text-soft)`, `var(--text)`, `var(--accent)`, `var(--attention)` — la faute que
   `tests/jetonsCss.test.ts` vient de fermer n'est pas revenue). Témoins dans ce même fichier :
   `onglets` ×15, `bandeau-bail` ×3 ; contre-témoin `bail-dollars-inexistant` à **0**.

⚠️ **CE QUI N'A PAS PU ÊTRE VÉRIFIÉ, et il faut le dire plutôt que de laisser croire.**
`carai.hubperso.com` est **injoignable depuis ce conteneur** : `403 au CONNECT` du proxy, quatre
essais, pendant qu'`api.github.com` répond `200` à la même minute — donc un refus de POLITIQUE, pas
une panne du site. C'est un CHANGEMENT : le même domaine était lisible une heure plus tôt pour le
lot A. L'URL `*.vercel.app` ne sauve pas : la page passe, mais l'asset CSS rend `302` vers
`vercel.com/sso-api`. Donc **ce qui reste non mesuré est que le DOMAINE pointe bien sur ce
déploiement** — `target: production` et `branchAlias: car-ai-git-main-…` le rendent très probable,
ce n'est pas une preuve. Si Marc veut la fermer : ouvrir `carai.hubperso.com` et regarder si le
bandeau Bail porte la barre « Payé sur le bail » (ou, sans les deux variables encore à poser, le
message « FinanceAI n'est pas branché », qui est l'état honnête attendu).

## 15/09 — LES COÛTS DE RECHARGE : quatre irritants, et un chiffre qui aurait été faux

Marc : « je veux une meilleure affichage pour le prix des recharges et prix total ». Quatre
irritants nommés par lui : le mesuré et l'estimé collés dans un même montant, le coût aux 100 km manquant, le
détail par session, la tendance.

### ⚠️ LE PIÈGE QUI A FAILLI PASSER — et c'est la leçon du lot

Le coût aux 100 km se calcule en divisant des dollars par des kilomètres. Les deux ne
couvraient pas la même période : **l'odomètre portait plusieurs milliers de km depuis la signature, les
recharges observées ne commencent que trois semaines plus tard**. Le chiffre obtenu était
**quatre fois trop bas**, parfaitement crédible, et rien à l'écran n'aurait cloché.

Pire, même sur une fenêtre commune, l'historique a des trous : **quelques centaines de kWh
observés pour des milliers de km, soit moins de 4 kWh/100 km** — impossible pour une bZ, qui en consomme ~15. Une recharge
que le canal n'a pas vue manque au numérateur, jamais au dénominateur.

Le coût affiché est donc un **PLANCHER**, et la tuile le dit : « ces recharges n'expliquent
que 25 % de ces km ». La couverture se **dérive du véhicule** (capacité × état de charge ÷
autonomie annoncée), jamais d'une consommation écrite en dur — qui serait fausse pour un
autre véhicule ou un autre hiver.

### Ce qui change à l'écran

- **Le montant collé disparaît.** Le mesuré porte la tuile, la part estimée descend d'une
  ligne. ⚠️ Les FONDRE était exclu : `totaliserPrix` l'interdit, et sur les données du jour
  l'estimé pèse **58 %** du tout — un « 57,50 $ » unique serait à 58 % une supposition
  présentée comme une dépense. La lisibilité vient de la MISE EN PAGE.
- **Coût / 100 km**, avec sa couverture.
- **Le détail des recharges**, replié : tendance mois par mois, puis chaque session avec son
  lieu, son énergie et l'explication de son prix.
- Le formateur `dollars` vivait en double (accueil + Activité) : il monte dans
  `app/ui/Montant.tsx` avec le composant.

### Vérifications

Gate complet vert. **7 mutations, 7 rouges** — dont « le coût repasse à `kmDepuis` » et « le
mois se décide en UTC ». Banc Chromium sur le vrai CSS, section dépliée, à 360 · 390 · 430 px :
**0 cible sous 44 px sur 23, 0 champ sous 16 px, 0 débordement** (le tableau de cinq colonnes
défile dans son cadre).

⚠️ **Un incident de méthode, payé une heure.** La sauvegarde des mutations gardait le
BASENAME des fichiers : `app/page.tsx` et `app/activite/page.tsx` se sont écrasés, et la
« restauration » a recopié l'accueil par-dessus Activité. Tout le travail sur cet écran a dû
être rejoué. Une sauvegarde de mutation se fait par **chemin complet**, jamais par nom de
fichier — deux écrans de Next s'appellent toujours `page.tsx`.

### ✅ Déploiement VÉRIFIÉ dans la réponse réelle (15/09, 14 h 01 Z)

Ce lot change ce que le site SERT (CSS + deux pages), donc le §6 s'applique. Les quatre
maillons, mesurés — pas déduits :

1. **Le merge est un SQUASH** : `git log --format='%h %p %s' -1 origin/main` rend
   `4127a92 720ce96 feat: … (#113)` — un seul parent, titre en « (#N) ». Donc la présence
   sur `main` se prouve par le CONTENU ; `merge-base --is-ancestor` rendrait ici un faux
   négatif (c'est exactement la correction du §6 mergée juste avant, en #112).
2. **Contenu sur `main` : 8 jetons sur 8** — `liste-sessions` et `tuile-estime`
   (`globals.css`), `MontantPrix`, `COUVERTURE_SUFFISANTE`, `estimeLibelle`,
   `rechargesParMois`, `kmEntre`, `coutParCentKm`.
3. **Déploiement de production `READY`**, `meta.githubCommitSha` = `4127a928…`, soit le HEAD
   réel de `main`. ⚠️ `READY` seul ne dit pas QUEL commit : c'est le SHA qui tranche.
4. **Les règles sont dans le CSS RÉELLEMENT SERVI.** `carai.hubperso.com` renvoie
   `/_next/static/css/95c68d1db1a887e7.css` — **hash CHANGÉ** (le build d'avant servait
   `0aee303c…`), 200, `text/css`, 56 910 caractères. Comptées dedans : `.tuile-estime` ×1,
   `.liste-sessions` ×2, `.ls-quand` ×1, `.ls-montant` ×1, `.ls-lieu` ×2, `.ls-detail` ×2.
   Témoin (`.indicateur > summary`, posé au lot d'avant) toujours présent ×4 ; contre-témoin
   (`.tuile-inexistante`) à 0 — le relevé discrimine, il ne dit pas « oui » à tout.

## ÉTAT COURANT — au 15/09/2026

> Ce bloc est le seul du fichier qui décrit le PRÉSENT ; tout ce qui suit est un journal
> chronologique, donc un RÉCIT daté qui ne se met pas à jour. Les chiffres ci-dessous
> portent leur date : re-mesurer plutôt que recopier.

**En ligne** : `main` = `322ddc9`, déployé en production et vérifié le 15/09 à 15 h 30 Z —
déploiement `READY` sur ce SHA, et le CSS servi prouvé par son EMPREINTE (`ca7ec556e8347f4d.css`,
reproduit à l'identique par un build propre local). ⚠️ Cette fois `carai.hubperso.com` était
**injoignable depuis le conteneur** (403 au CONNECT du proxy) : ce qui reste non mesuré est que le
DOMAINE pointe sur ce déploiement — détail dans le bloc du 15/09 (2). Le HEAD qui fait foi se lit
par `git ls-remote origin refs/heads/main`, jamais ici.

**Les deux lots du 15/09 sont livrés** — lot A : coûts de recharge lisibles (montants, coût aux
100 km avec sa couverture, détail par session, tendance par mois). Lot B : le **bail en dollars**,
lu chez FinanceAI sur `GET /vehicule/bail` (son ADR 0017, PR #967). ⚠️ Le bandeau affichera
« FinanceAI n'est pas branché » tant que `FINANCEAI_BAIL_URL` et `FINANCEAI_BAIL_TOKEN` ne sont pas
posées ici et `FINANCEAI_VEHICULE_TOKEN` (même valeur) côté FinanceAI — c'est l'état honnête
attendu, pas une panne.

**Refonte mobile : finie et mesurée** (14/09). Les cinq écrans — Accueil, Activité,
Tendances, Données, Réglages — donnent **0 cible sous 44 px, 0 champ de saisie sous 16 px,
0 débordement**, à 360 · 390 · 430 px, mesurés sur le CSS **servi en production**. Deux
exemptions nommées et voulues : un lien à l'intérieur d'une phrase (WCAG 2.5.8) et les
curseurs de la brosse temporelle, qui ne reçoivent aucune mise au point texte.

**Ce qui garde ça** : le gate (`typecheck && lint && test && build`, **1 319 tests dans 76
fichiers** au 15/09) ; les gardes de FAMILLE de `tests/reglagesMobile.test.ts` et
`tests/donneesMobile.test.ts`, qui DÉRIVENT du code les types de contrôle employés et
rougissent si un nouveau type naît trop petit ; l'auto-merge, réparé le 14/09 (`actions:
read`) et verrouillé par `tests/autoMerge.test.ts`.

**Ce qui reste** : `BACKLOG.md` fait foi (**22 items ouverts, re-comptés le 15/09**). Deux d'entre eux
attendent une SAISIE de Marc et rien d'autre — `[COUT-01]` le tarif du kWh et `[BAIL-01]`
le coût au kilomètre excédentaire, tous deux dans Réglages ; sans eux, l'app estime et le
DIT, elle n'invente pas.

**Une décision t'attend** : le `CLAUDE.md` §6 prescrit `git merge-base --is-ancestor` pour
prouver qu'une PR a atterri. Cette commande rend un **faux négatif** sur un squash-merge —
le mode que l'auto-merge emploie aujourd'hui. Détail et mesure dans la section du
14/09 · 20 h 50 Z, juste en dessous.

## 14/09 (20 h 50 Z) — ⚠️ TROIS CIBLES À 40 px trouvées APRÈS la refonte : le banc recopié ne voyait pas tout l'écran

Marc : « vérifie sur mon téléphone que tout est beau ». Vérification faite sur **le CSS
SERVI EN PRODUCTION** (récupéré sur `carai.hubperso.com` : 200, `text/css`, 55 230
caractères), appliqué au balisage des **cinq** écrans, aux largeurs **360 · 390 · 430 px**.
Témoin vérifié avant chaque lecture : barre du bas à **54,1 px**.

### Ce que la vérification a trouvé

| Écran | Cibles < 44 px | Champs de saisie < 16 px | Débordement |
|---|---|---|---|
| Accueil | 0 / 16 | 0 | 0 |
| Activité | 0 / 22 | 0 / 2 | 0 |
| Tendances | 0 / 20 (+1 lien dans une phrase, exempté WCAG 2.5.8) | 0 / 2 | 0 |
| Données | 0 / 19 | 0 / 3 | 0 |
| **Réglages** | **3 / 25 — les trois pastilles de santé, 40 × 40 px** | 0 / 11 | 0 |

⚠️ **POURQUOI LE LOT DU 14/09 NE LES A PAS VUES, et c'est la leçon du jour.** Son banc
recopiait le balisage à la main et comptait **quatorze** cibles. Le banc refait depuis le
vrai balisage en compte **vingt-cinq** : les onglets, la liste des lieux et ces trois
indicateurs n'y étaient tout simplement pas. **Un banc recopié ne couvre que ce que son
auteur y a mis**, et « 0 cible sous 44 px » ne vaut que pour les cibles qu'il porte. La
mesure était juste ; c'est son PÉRIMÈTRE qui était faux, et rien ne le signalait.

⚠️ **Et `min-height` ne les aurait pas corrigées** : les pastilles sont RONDES
(`width`/`height: 2.5rem`), donc la hauteur minimale ne les touche pas. Les deux dimensions
se reprennent — une cible ronde trop étroite reste trop petite quel que soit son axe haut.

### Fausse alerte levée en chemin

Le premier rapport annonçait « 2 champs à 13,3 px » sur Tendances et sur Données. Ce sont
les **curseurs** (`input[type="range"]`) de la brosse temporelle : un curseur ne reçoit
aucune mise au point texte, donc **aucun zoom d'iOS**. Le rapport distingue désormais les
contrôles de SAISIE des autres — sans quoi la prochaine session « corrigerait » une police
qui ne fait rien.

### Le correctif

`.indicateur > summary { width: 44px; height: 44px }` dans le bloc téléphone. `<Indicateur>`
n'est employé que par l'écran Réglages (vérifié par grep) : aucun autre écran ne bouge.

- **Après : 0 cible sous 44 px sur les cinq écrans**, aux trois largeurs. Coût : +4 px de
  page (3 128 → 3 132 px à 360 px).
- **Desktop prouvé identique** : 1280 px, 108 boîtes, **0 écart**, hauteur au pixel près.
- Garde dans `tests/reglagesMobile.test.ts`, **3 mutations, 3 rouges** : règle retirée,
  seule la hauteur reprise, règle qui fuit hors du bloc téléphone.

### ✅ Déploiement VÉRIFIÉ dans la réponse réelle (14/09, 20 h 55 Z)

Ce lot changeait ce que le site SERT — contrairement au précédent. La vérification du §6
est donc allée jusqu'au bout, maillon par maillon :

1. **Déploiement de production `READY`**, `meta.githubCommitSha` = `f0b70d13…`, soit
   exactement le HEAD de `main`. (`READY` seul ne dit pas QUEL commit — cf. l'incident du
   13/08 où la production servait un commit vieux de deux PR.)
2. **Le bundle CSS servi a CHANGÉ** : `63a747fe0b300ed9.css` → `0aee303c779ced20.css`.
   C'est ce qui distingue « un nouveau build est en ligne » de « READY mais périmé ».
3. **La règle se lit dans le CSS réellement renvoyé** par `carai.hubperso.com` (200,
   `text/css`, 55 273 caractères) : `.indicateur>summary{width:44px;height:44px}` vit bien
   dans un `@media (max-width:700px)`, pendant que la règle de base garde ses `2.5rem`
   HORS media — le grand écran est intact par construction, pas par espoir.
4. **Les cinq écrans remesurés avec CE CSS** : **0 cible sous 44 px, 0 champ de saisie sous
   16 px, 0 débordement**, aux trois largeurs. Témoin à 54,1 px vérifié à chaque lecture.

⚠️ **`git merge-base --is-ancestor <sha-de-la-PR> origin/main` REND UN FAUX NÉGATIF APRÈS
UN SQUASH-MERGE**, et le `CLAUDE.md` §6 prescrit encore cette commande. Vécu ici : la
réponse a été « ABSENT » sur un merge parfaitement réussi, parce qu'un squash crée un
commit NEUF (`f0b70d1`, parent unique `9a84868`) et que le SHA de la branche (`9179ecd`)
n'entre jamais dans l'histoire de `main`. Ce qui se vérifie après un squash, c'est le
CONTENU — `git show origin/main:<fichier> | grep <ce qu'on vient d'écrire>` — jamais le
SHA de branche. La commande du §6 reste juste pour un merge commit (le cas des PR
empilées du 13/08, qu'elle a été écrite pour attraper) ; elle est fausse pour le mode de
merge que l'auto-merge emploie aujourd'hui. **À trancher avec Marc** : corriger la §6 ou
lui ajouter le cas du squash.

## 14/09 (20 h 30 Z) — La garde de FAMILLE passe à Réglages, et le recensement devient partagé

Marc : « fais la garde de famille pour reglages ». Suite directe du lot Données, dont la
leçon était : **une famille de règles qui ÉNUMÈRE des types de contrôle en oublie un**, et
l'oubli ne se voit que sur l'écran qui l'emploie.

### Ce qui est MESURÉ (14/09, dérivé du code)

| Conteneur | Contrôles employés | Couverture du bloc téléphone |
|---|---|---|
| `.reglages` | `button`, `input` | 44 px ✅ · police 1rem ✅ |
| `.form-lieu` | `button`, `input`, `select` | 44 px ✅ · police 1rem ✅ |
| `.filtres` | `a`, `button`, `input`, `select` | 44 px ✅ · police : voir plus bas |

**Aucun défaut réel aujourd'hui.** `.reglages` n'emploie AUCUN menu déroulant — la règle
n'en porte donc pas, et c'est cohérent. Ce que la garde ajoute, c'est que le jour où le
formulaire du contrat en reçoit un, il naîtra à **29,6 px** et **c'est le gate qui le
dira**, au lieu que Marc le découvre en tapant dessus.

### Ce qui a été RETIRÉ, et pourquoi

Le test « les quatre familles de cibles de cet écran sont couvertes » vérifiait une LISTE
écrite à la main. Deux raisons de la remplacer plutôt que de l'empiler :

1. Elle a **rougi à tort le 14/09** — elle repérait sa règle par son CORPS, et le lot
   Données venait d'écrire un corps IDENTIQUE 198 caractères plus haut.
2. Une liste écrite à la main ne sait rien de ce que l'écran gagnera demain : c'est
   littéralement le défaut qu'on vient de corriger chez `.filtres`.

Ses deux assertions qui ne sont PAS de famille (`.lien-bouton`, `.replie > summary` — un
lien déguisé en bouton et le résumé d'un bloc replié) sont conservées à part.

### Le recensement est PARTAGÉ (`tests/aides/controles.ts`)

Il vivait dans `donneesMobile.test.ts` ; le recopier aurait donné deux recenseurs dont un
seul connaîtrait le prochain cas tordu — exactement l'histoire de `tests/aides/css.ts`,
extrait le même jour pour la même raison.

⚠️ **La portée est désormais BORNÉE à la balise fermante**, et ce n'est pas du raffinement :
« prendre jusqu'à la fin du fichier » ne tenait que par accident de position. Dans
`app/reglages/page.tsx`, le formulaire est suivi de trois blocs repliés et précédé de trois
liens ; une portée large exigerait un jour `.reglages a` pour un lien qui n'est pas dans le
formulaire. Un faux positif qu'on « assouplit une fois parce que c'en était un » est une
garde qui ne garde plus rien. Témoin discriminant dans le test : la portée contient
`name="tarifKwh"` et **ne contient pas** « Connecteur MCP ».

⚠️ **Ce que le recensement NE VOIT PAS** : les contrôles rendus par un COMPOSANT appelé à
l'intérieur (`<ChoixLieu />` dans `.form-lieu`). Côté CSS ils sont bien couverts — un
sélecteur descendant traverse les composants — mais la garde sous-compte. C'est le bon sens
de l'erreur : elle peut rater une exigence, elle n'en invente jamais.

### Une mesure qui CONFIRME, publiée comme les autres

`.filtres input` ne porte **pas** `font-size: 1rem`, contrairement à `.reglages input`. Ce
n'est pas un trou : aucun champ de saisie d'un `.filtres` n'est nu — ceux du sélecteur de
fenêtre sont pris par `.selecteur-fenetre .filtres input` (lot Activité), ceux du
formulaire de lieu par `.form-lieu input`, et le seul `<input>` du formulaire de Données
est `hidden`. La garde ÉCRIT cet état plutôt que de le taire, pour qu'un futur champ ajouté
à un `.filtres` sans conteneur plus spécifique se remarque là plutôt qu'en tapant dessus.

### Vérifications

Gate complet vert. **6 mutations, 6 rouges**, chacune avec le message attendu : un
`<select>` ajouté au formulaire du contrat, un `<textarea>`, la police retirée de la règle,
la hauteur retirée, le bornage de portée cassé, et la règle des menus déroulants de Données
supprimée. Restauration par copie de sauvegarde (jamais `git checkout <fichier>`, qui
emporterait tout le travail non commité du fichier).

## 14/09 (19 h 44 Z) — ⚠️ INCIDENT : l'AUTO-MERGE ÉTAIT MORT DEPUIS AU MOINS 18 h 22

Aucune PR de CarAI ne partait toute seule, et **rien ne le disait**. Trouvé par accident :
la PR #105 est restée ouverte avec sa CI verte, et il a fallu ouvrir les journaux du
workflow pour voir pourquoi.

### Ce qui est MESURÉ

- Runs **594 à 601** de `Auto-merge` en échec, passes planifiées comprises — soit toutes
  les tentatives entre **18 h 22 et 19 h 44 Z**, sur `main` comme sur les PR.
- Toujours la même erreur, au même chemin GraphQL :
  `Resource not accessible by integration (…checkSuite.workflowRun)`, cinq essais, puis
  refus de merger.
- Le workflow déclarait `contents: write`, `pull-requests: write`, `checks: read` et
  `statuses: read`. Il manquait **`actions: read`** : `gh pr view --json
  statusCheckRollup` descend jusqu'à `checkSuite.workflowRun`, qui relève de l'API Actions
  et **non** de `checks`. [Certain — le message d'erreur nomme ce chemin exact.]
- Pourquoi maintenant : [Probable] une version de `gh` plus récente sur le runner, qui
  demande un champ de plus dans la même requête. Rien n'a changé dans le dépôt entre le
  dernier merge réussi et le premier échec.

### ⚠️ La leçon, et c'est la DEUXIÈME fois

Le 21/08, ce sont `checks: read` et `statuses: read` qui manquaient — l'en-tête du
workflow le raconte déjà. Aujourd'hui, la même panne, un champ plus loin.

**Une permission manquante ne se manifeste jamais par « il manque une permission ».** Elle
se manifeste par du SILENCE : le workflow échoue *fermé* (c'est le bon comportement —
aucune PR mal fusionnée), donc rien n'est rouge là où quelqu'un regarde. Le seul signal est
un run d'Actions en échec sur la branche par défaut, que personne n'ouvre.

### Le correctif, et sa garde

`actions: read` ajoutée — et surtout, la liste est désormais **verrouillée par
`tests/autoMerge.test.ts`** : retirer n'importe laquelle des cinq permissions fait rougir
le gate, que tout le monde lit, au lieu d'arrêter les merges en silence. Discrimination
prouvée par cinq mutations, cinq rouges.

⚠️ Ce fichier de test portait jusqu'ici la DÉCISION d'auto-merge. Il porte maintenant aussi
son CARBURANT : sans les permissions, la décision n'est jamais prise, parce que la lecture
de la PR échoue avant. Les deux incidents ont eu lieu à cet étage-là, pas dans la logique.

## 14/09 — DONNÉES AU DOIGT : le trou d'une famille de règles, et un tableau qu'on ne « corrige » pas

Cinquième et dernier écran de la refonte mobile (accueil, Réglages, Activité, Tendances,
Données). Même méthode : banc Chromium sur le vrai `app/globals.css` et le balisage exact,
témoin de la barre du bas à **54,1 px** vérifié avant chaque lecture.

### Ce qui était mesuré AVANT (360 et 390 px)

| Ce qu'on tape | Mesure | Seuil |
|---|---|---|
| Les trois menus déroulants des filtres | **29,6 px de haut**, **14,1 px de police** | 44 px · 16 px |
| « ← Précédente » / « Suivante → » | **16 px** | 44 px |
| Le bouton « Filtrer », les deux liens d'export | 44 px — déjà bons | — |
| Débordement de la PAGE | **aucun** | — |

### ⚠️ La leçon : une famille de règles qui ÉNUMÈRE des types en oublie un

Le bloc mobile portait déjà `.filtres input[type="date"]`, `.filtres button` et
`.filtres a` — trois règles écrites pour le sélecteur de fenêtre, qui n'a **pas** de menu
déroulant. Le formulaire de Données, lui, n'est QUE des menus déroulants. Le trou ne se
voyait donc que sur l'écran qui les emploie, à côté de contrôles parfaitement dimensionnés.

D'où la **garde de famille** de `tests/donneesMobile.test.ts` : elle DÉRIVE du code la
liste des contrôles réellement employés dans un `.filtres` (`select`, `button`, `a`,
`input` non caché) et exige que le bloc téléphone couvre chacun. Une liste écrite à la
main se périmerait au premier écran ajouté — c'est exactement ce qui vient de se passer.

### La pagination porte sa RELATION, pas une énième classe

Les deux liens de navigation d'un tableau de 125 pages vivaient dans le paragraphe qui
explique la pagination, donc à 16 px. Ce sont des ACTIONS, pas de la prose : WCAG 2.2
SC 2.5.8 n'exempte une cible que dans une PHRASE, et « Suivante → » n'en est pas une.

Ils portent désormais `rel="prev"` / `rel="next"` — les types de lien standard de la
pagination. L'attribut a sa valeur propre (navigateurs et outils d'assistance le lisent),
il les désigne sans ambiguïté dans toute l'app, et il évite d'inventer une classe jumelle
de `.lien-action` (PR #105), qui rend déjà un lien tapable ailleurs.

### ⚠️ Les tableaux ne sont PAS touchés, et c'est une mesure — pas un oubli

Le tableau de mesures fait **688 px dans 325 px** visibles. Il défile dans son cadre
(`.defilement`, `overflow-x: auto`) et la page, elle, ne défile pas latéralement.

Essai fait au banc avant de conclure : laisser les cellules revenir à la ligne
(`white-space: normal` sur téléphone) **ne le fait pas tenir** — 426 px, il déborde encore
de 101 — et lui coûte **+93 % de hauteur** (201 → 387 px), la page passant de 2 414 à
2 907 px. Le remède était pire que le mal. Une garde fige la décision pour qu'on ne la
« corrige » pas sans re-mesurer.

⚠️ **Mon détecteur de débordement comptait 47 faux positifs** avant d'être corrigé : il
relevait tout ce qui dépasse le bord droit, y compris les tableaux DANS leur cadre à
défilement. Une mesure qui compte le comportement voulu comme un défaut fait « corriger »
ce qui marche.

### ⚠️ Au merge : une garde de Réglages a rougi, et elle avait TORT

`tests/reglagesMobile.test.ts` (PR #104) vérifie que quatre familles de cibles sont
couvertes par la même règle. Pour délimiter la liste de sélecteurs, elle prenait
`mobile.slice(indexOf(".reglages input,"), indexOf(bloc))` — où `bloc` est le **corps** de
la règle.

Un corps n'est pas une identité. La règle `.filtres select { min-height: 44px; font-size:
1rem; }` de ce lot-ci porte **exactement le même corps**, et se trouve **198 caractères
plus haut** dans le fichier (mesuré) : `indexOf(bloc)` rendait la position de CETTE
règle-là, la tranche devenait vide, et la garde rougissait sur du CSS parfaitement sain.
Les quatre familles étaient couvertes du début à la fin.

Corrigé : la tranche se prend désormais sur les **sélecteurs** (du début du groupe jusqu'à
l'accolade ouvrante), ce qui est déterministe. Discrimination re-prouvée par deux mutations,
deux rouges. C'est la même famille de piège que la garde vacueuse ci-dessus, vue par
l'autre bout : **un repère choisi pour sa commodité d'écriture — un corps, une forme de
sélecteur — finit par désigner autre chose que ce qu'on visait.**

### Après

À 390 px : **11 → 6 cibles sous 44 px** (les six restantes sont le contrôle de temps, que
la PR #106 traite) et **0/3 champs de saisie sous 16 px**.

**Toutes branches combinées (#105 + #106 + celle-ci) : 0 cible sous 44 px sur 19, 0 champ
sous 16 px, 0 débordement de page.** C'est la fin de la refonte mobile au sens des cibles.

Le desktop ne bouge pas, mesuré : à 1280 px, **0 écart sur 26 boîtes**, hauteur de page
identique au pixel (1 969 px).

### ⚠️ Une garde satisfaite par la FORME du sélecteur ne garde rien

Ma première version de « la hauteur des menus ne fuit pas hors du bloc téléphone »
cherchait `.filtres select {` dans le CSS de base et rendait `null` — donc passait
toujours. La règle de base s'écrit `.filtres select, .filtres button { … }`, un sélecteur
GROUPÉ que ce motif ne voit pas. **Mesuré par mutation** : ajouter `min-height: 44px` à
cette règle de base laissait le test vert. Corrigé par `reglesVisant`, qui découpe les
sélecteurs groupés — et la mutation rougit.

## 14/09 — TENDANCES AU DOIGT : le contrôle de temps, et le prix d'un bloc COLLÉ

Quatrième écran de la refonte mobile (accueil, Réglages, Activité, puis celui-ci). Même
méthode : banc Chromium sur le vrai `app/globals.css` et le balisage exact, témoin de la
barre du bas à **54,1 px** vérifié avant chaque lecture.

### Ce qui était mesuré AVANT (360 et 390 px)

| Ce qu'on manipule | Mesure | Seuil |
|---|---|---|
| Les deux curseurs de la brosse temporelle | **16 px de haut** | 44 px |
| Les quatre boutons (+, −, Tout, 24 h) | **34,1 px** | 44 px |
| Débordement en largeur | **aucun** | — |

La brosse est le geste principal de cet écran : on y glisse le doigt pour cadrer la
période, et toutes les courbes suivent. Une cible de 16 px pour un geste de glissement,
c'est trois fois trop fin.

### ⚠️ Le vrai sujet n'était pas la taille des cibles, c'était le COLLAGE

`.controle-temps` est `position: sticky` : il reste en haut pendant qu'on fait défiler les
courbes. Mesuré, il occupait déjà **195 px sur 844**, soit **23 % de l'écran** en
permanence. Agrandir ses cibles à 44 px le porte à **257 px** — il aurait mangé **30,5 %**
de l'écran, tout le temps. Les deux corrections se contredisaient.

Il est donc **décollé sur téléphone**, et il garde ses cibles. Ce que le collage portait,
c'est le confort de zoomer en regardant une courbe plus bas. Ce qu'il ne portait PAS,
c'est l'échelle commune entre les courbes — elle vient de `GraphiquesLies`, qui pilote
toutes les séries depuis un seul état de zoom. La demande du 14/08 (« une échelle
identique, même quand je zoome ») est donc intacte, et `tests/tendancesMobile.test.ts`
l'ancre : il exige qu'il n'y ait **qu'un seul** `useState<Zoom>` dans le composant.

⚠️ **Le test compare aussi les POSITIONS des deux règles dans le fichier.** Un media query
n'ajoute aucune spécificité : `position: static` ne bat `position: sticky` que parce
qu'elle est écrite APRÈS. Écrite avant, elle ne ferait rien — et rien ne le dirait, la page
s'afficherait avec le bloc toujours collé. Ce fichier a déjà payé ce piège plusieurs fois.

### Après

**1 cible sous 44 px sur 20**, et c'est le lien « Données » à l'intérieur d'une phrase —
WCAG 2.2 SC 2.5.8 exempte explicitement une cible dans un bloc de texte, et l'agrandir
casserait l'interligne. Même arbitrage que sur Activité.

Le desktop ne bouge pas, et c'est mesuré : à 1280 px, **0 écart sur 24 boîtes**, hauteur de
page identique au pixel (3 495 px), contrôle toujours `sticky`.

### Les champs de date ne sont PAS retouchés ici

Ils sont à 14,1 px sur cet écran aussi — même composant `SelecteurFenetre`, même défaut —
mais la règle qui les corrige (`.selecteur-fenetre .filtres input`) part déjà dans la PR
#105 (Activité). La remettre ici créerait une seconde écriture de la même règle, donc un
conflit certain et une divergence à terme. Mesuré avec les deux branches combinées :
**0 champ de saisie sous 16 px** sur Tendances une fois #105 fusionnée.

### `blocTelephone` et `regleCss` montent dans `tests/aides/css.ts`

Deux gardes mobiles en ont désormais besoin. ⚠️ `tests/activiteMobile.test.ts` (PR #105)
les définit encore CHEZ LUI : au merge des deux branches, le faire pointer sur les aides
partagées — sinon on retombe sur « deux découpeurs de media queries dont un seul connaît
le prochain cas tordu », qui est la raison d'être de ce fichier d'aides.

### Ce qui reste, et que je n'ai pas touché

L'écran fait **4 110 px** sur téléphone. Les gros postes sont le panneau d'état (603 px),
les quatre déductions (889 px à elles seules) et les courbes liées (948 px) — tous des
contenus demandés, aucun « bloc rare » à replier au sens des Réglages. Le relevé détaillé
de chaque métrique est déjà replié.

## 14/09 — ACTIVITÉ AU DOIGT : les cibles du fil, les dates, et la concordance repliée

Troisième écran de la refonte mobile (après l'accueil et les Réglages), même méthode : on
MESURE au banc Chromium sur le vrai `app/globals.css` et le balisage exact, on corrige, on
remesure. Le témoin — la barre du bas à **54,1 px** — est vérifié avant chaque lecture ;
un témoin qui dévie invaliderait tout le reste.

### Ce qui était mesuré AVANT (360 et 390 px)

| Ce qu'on tape | Mesure | Seuil |
|---|---|---|
| « Voir » d'une rangée du fil | **26 × 16 px** | 44 px |
| « Maps » d'une rangée du fil | **36 × 16 px** | 44 px |
| Les deux champs de date du sélecteur | 44 px de haut, **police 14,1 px** | 16 px |
| « Voir les 7 derniers jours » (état vide) | **16 px** | 44 px |
| Débordement en largeur | **aucun** | — |

⚠️ **Un des quatre irritants n'existait pas ici**, et le dire vaut mieux que de « corriger »
ce qui marche : zéro élément ne dépasse le bord droit, à 360 comme à 390 px.

⚠️ **Les 14,1 px des champs de date ne sont pas une question de confort** : sous 16 px, iOS
ZOOME la page à la mise au point du champ. L'écran saute, le reste sort du cadre, et il faut
repincer pour revenir — à chaque fois qu'on veut filtrer par date. C'est la définition
mesurable de « les formulaires sont pénibles ».

### Après

**0 cible sous 44 px** et **0 champ sous 16 px** aux deux largeurs, zéro débordement.
Le coût est assumé et chiffré : **+12 px par rangée du fil** (la première ligne de la grille
passe de 26 à 44 px). C'est le prix d'une cible tapable.

### La concordance se replie — et ne tait rien

Elle poussait le fil, ce qu'on vient voir, **213 px** plus bas (marges comprises), sur les
~1 814 px qui le précédaient déjà. Repliée, elle en rend 138 : **1 814 → 1 736 px avant le
premier événement**, et la page perd 41 px (390) / 62 px (360).

⚠️ **Son résumé porte le verdict COMPLET, écart compris** — « Compteur 128 km · trajets
126 km — 2 km sans relevé de position ». Un titre neutre (« Concordance ») aurait été plus
court et aurait caché exactement ce que ce bloc existe pour dire : des kilomètres qui
comptent pour le bail et manquent au détail. Replier n'autorise pas à taire.

⚠️ **Le résumé et l'explication dérivent du MÊME jugement** (`jugerConcordance`, pure, dans
`lib/vehicle/trajets.ts`). Deux ternaires écrits côte à côte finissent par diverger — c'est
le défaut que ce dépôt a déjà payé plusieurs fois. La fonction rend des FAITS, jamais du
texte : le formatage des kilomètres appartient à l'écran.

### Le desktop ne bouge pas, sauf là où le balisage a changé

Mesuré à 1280 px, boîte par boîte : **une seule** des onze boîtes de premier niveau change,
la concordance (81,3 → 51,6 px, repliée). Tout le reste est identique au dixième de pixel.
Les trois règles neuves vivent sous `@media (max-width: 700px)` et `tests/activiteMobile.test.ts`
vérifie les DEUX sens — présentes sous 700 px, absentes du CSS de base. Un media query
n'ajoute aucune spécificité : une règle sortie de son bloc s'appliquerait partout sans que
rien ne le signale.

⚠️ **Le repli vaut aussi sur grand écran**, et c'est structurel : un `<details>` ne peut pas
être fermé sur téléphone et ouvert sur desktop par le seul CSS (mesuré lors du lot Réglages —
à 1280 px, une règle d'auteur sur les enfants ne défait pas le masquage natif, le contenu ET
le titre disparaissent). Les blocs qu'on replie sont donc ceux qu'on n'ouvre presque jamais.

### ⚠️ Prettier n'est PAS l'outil de formatage de ce dépôt

Lancé par réflexe sur `app/activite/page.tsx`, il a reformaté **323 lignes** — dont un appel
`serieNumerique("battery_soc", { depuis: null, limite: LIMITE_HISTORIQUE_COMPLET })` éclaté
sur quatre lignes, ce qui a fait ROUGIR `tests/filtreActivite.test.ts` : cette garde ancre la
chaîne exacte, donc la FORME. Le fait qu'elle défend (la lecture porte la borne complète)
n'avait pas bougé d'un caractère.

Le dépôt ne porte **aucune configuration prettier**, et son code n'est pas conforme au
prettier par défaut — vérifié en le passant sur la version `HEAD` du fichier. L'arbre a été
rendu à `HEAD` et les changements réappliqués à la main : **75 lignes** au lieu de 323. Deux
leçons, dont une déjà écrite ailleurs dans le dépôt : un formateur qu'aucune config ne
réclame n'est pas « l'outil du projet », et une garde qui ancre une forme coûte un
aller-retour à chaque reformatage.

### Ce qui n'a PAS été fait, et pourquoi

- **Les liens à l'intérieur d'une phrase** (`.hint a`, `.lead a` autres que les deux liens de
  secours) restent à 16 px. WCAG 2.2 SC 2.5.8 les EXEMPTE explicitement quand la cible est
  dans un bloc de texte, et les agrandir casserait l'interligne du paragraphe. Les deux liens
  qui ne sont pas dans une phrase — ceux des états vides, seule action de l'écran à ce
  moment-là — portent `.lien-action` et font 44 px.
- **Il reste ~1 736 px avant le fil** sur téléphone. L'ordre (tuiles, filtre, courbe, grande
  carte, panneau, fil) est le choix de cadrage de Marc du 17/08 — « la grande carte en haut,
  les tuiles en tête » — et le réorganiser serait le défaire, pas le corriger.

## 14/09 — RÉGLAGES sur téléphone, et « signalé mais tout estimé »

Marc : « fais les réglages maintenant ». Deuxième écran de la refonte mobile, et celui qui
porte son irritant nommé — « les formulaires sont pénibles ».

**Mesuré d'abord**, au banc Chromium à 360 et 390 px, avec le vrai `globals.css` et le
balisage de `app/reglages/*.tsx`, validé sur un témoin connu (barre du bas, 54,1 px) :
**12 des 14 cibles sous 44 px** (champs du contrat à 42, « Enregistrer » à 43,6, champs
d'ajout de lieu à 21, sélecteur à 29,6, « Retirer » à 25,6), **trois champs sous 16 px**, et
une page de **2 006 px**.

⚠️ **Le défaut qui compte le plus ne se voit sur aucune capture.** Sous 16 px de police, iOS
ZOOME tout seul à la mise au point d'un champ : on tape un tarif, la page saute, on la
recadre à la main. C'est ça, « pénible » — et un champ à 13 px reste parfaitement lisible
sur une image. Seule la mesure le trouve.

**Après** : 0 cible sous 44 px, 0 champ sous 16 px, et **−321 px** de page grâce au repli.
Le formulaire d'ajout de lieu passe en colonne : trois champs côte à côte à 360 px, c'étaient
trois champs trop étroits pour ce qu'on y écrit.

⚠️ **LE REPLI VAUT AUSSI SUR GRAND ÉCRAN, et ce n'est pas un choix.** J'ai cherché à le
limiter au téléphone : un `<details>` fermé masque son contenu par le shadow DOM du
navigateur, et une règle d'auteur sur les enfants ne le défait pas. Mesuré avec
`checkVisibility()` et un `<details>` nu comme témoin — la tentative rendait le contenu ET
son résumé invisibles à 1280 px, donc le bloc inatteignable. Replier partout est la seule
forme honnête ; le desktop y gagne −319 px.

⚠️ **Mon premier jet créait une classe `.repli` alors que `.replie` existait**, en service
sur Tendances depuis le 13/08, avec dans `globals.css` un commentaire qui décrit ce besoin
mot pour mot. Greper le CONCEPT avant d'écrire un style, pas seulement le nom qu'on
s'apprête à lui donner.

⚠️ **Les règles de taille ne touchent pas le grand écran** : banc à 1280 px, ancien CSS
contre nouveau sur le même balisage — **60 boîtes, 0 écart, même hauteur (1 737 px)**.

### « Signalé mais tout estimé » — un arbitrage qui déplace une frontière

Marc, en réponse à la question sur le tarif manquant. Les deux moitiés comptent.

**Estimé** : `prixSession` reçoit un cinquième et dernier repli,
`TARIF_DOMESTIQUE_ORDRE_DE_GRANDEUR` (0,08 $/kWh), quand ni lieu, ni borne rapide, ni tarif
au contrat ne s'appliquent. Mesuré sur les 27 sessions réelles : **0 sans prix** (il en
restait 4), pour un montant estimé, toujours séparé du mesuré.

**Signalé** : l'écran Réglages porte un bandeau tant que `tarifKwh` est absent, et il
disparaît dès que le champ est rempli — un avertissement permanent est un avertissement mort.

⚠️ **Ça déplace le « no fake data », et c'est écrit dans le `CLAUDE.md` §1** plutôt que laissé
à la lecture de chacun : sans ça, la prochaine session lit « appliqué à la lettre » et retire
le repli en croyant restaurer le principe. Trois conditions le rendent acceptable — qualité
`estime` (jamais `mesure`, et les deux ne s'additionnent nulle part), explication qui dit
d'où vient le chiffre et comment l'exacter, bandeau tant que le tarif manque. Ce qui reste
refusé : inventer la GRANDEUR. Sans kWh connus, aucun montant.

⚠️ **Trois textes de l'écran affirmaient le contraire** et ont été corrigés dans le même lot
(l'en-tête du fichier, l'aide du champ, le rappel de bas de formulaire). Un écran qui promet
« — au lieu d'un chiffre inventé » pendant qu'il affiche une estimation est pire qu'un écran
muet.

⚠️ **Un test a rougi, et il avait à moitié raison** : il ancrait la PHRASE du refus
(« enregistre ce lieu »). Le fait qu'il défend — jamais zéro, `null` quand on ne sait pas —
n'avait pas bougé ; c'est le MOTIF du refus qui a changé, l'énergie inconnue étant désormais
le seul cas irréductible. Réécrit sur le fait, pas sur la formulation.

**Verrous** : `tests/reglagesMobile.test.ts` (8 gardes) et les 6 nouvelles de
`tests/tarifsBornes.test.ts`. Discrimination prouvée par **6 mutations, 6 rouges**.

## 14/09 — ✅ CLÔTURE de l'alerte du 21/08 : le déploiement fonctionne

L'alerte qui suit est restée en tête de ce fichier pendant trois semaines, avec sa consigne
« Marc doit re-lier le dépôt ». Mesuré aujourd'hui, elle est **close** :

- Le merge de #100 (`24211c2`) a **créé un déploiement de production**, passé à `READY`, et
  son `meta.githubCommitSha` est bien `24211c2`. L'intégration Git reçoit donc les merges.
- Entre les deux, `main` n'a reçu qu'**un seul** commit : `dd6ca65` (24/08), de la
  documentation seule. Vercel a créé son déploiement puis l'a marqué `CANCELED` — le script
  rejoué dessus rend « build ignoré : documentation et tests uniquement », exit 0. **C'est le
  comportement voulu, pas une panne.**
- Donc la production servait `842756d` depuis le 21/08 parce qu'**aucun commit de code
  n'avait été fusionné depuis**, et non parce qu'elle était bloquée.

⚠️ **Je ne sais pas ce qui a réparé la panne du 21/08** — Marc a peut-être re-lié le dépôt,
ou elle s'est rétablie seule côté Vercel. Ce qui est mesuré, c'est qu'elle ne se manifeste
plus depuis au moins le 24/08. L'écrire ainsi plutôt que d'inventer la cause : c'est déjà
deux fois ce jour-là qu'une cause a été annoncée avant d'être isolée.

⚠️⚠️ **Et cette alerte périmée a coûté une demi-journée le 14/09.** Elle est la première
chose qu'on lit en reprenant le dépôt : je l'ai citée à Marc comme un fait — « la prod est
figée, Vercel n'est plus relié » — sans la re-mesurer, alors qu'un seul appel à l'API
Vercel la démentait. **Une alerte en tête de HANDOVER doit être close dès qu'elle l'est**,
sinon elle ne signale plus un incident : elle en fabrique un.

## 21/08 (21 h) — ⚠️ CarAI NE DÉPLOIE PLUS, et ce n'est pas le script — ✅ CLOS le 14/09

**État à 21:05 Z : le dernier déploiement de production de CarAI est `842756d`, créé à
20:14:42 Z.** Trois merges vers `main` depuis, zéro déploiement. Rien de rouge nulle part.

| Heure | Commit | Ce que le script décide | Déploiement |
|---|---|---|---|
| 20:14:39 | `842756d` (#92) | build | **créé à 20:14:42** |
| 20:35:11 | `ec5b4a5` (#93) | build (`app/globals.css`) | aucun |
| 20:39:45 | `d94598d` (#94) | ignorer (documentation seule) | aucun — normal |
| 20:54:13 | `5f98fc4` (#96) | build (`app/page.tsx`) | aucun |

### Ce qui est MESURÉ, pas supposé

- **Le script n'est pas en cause.** Rejoué sur les commits réels, sous CHACUNE des bases
  que Vercel pourrait choisir : `842756d..ec5b4a5` → build · `d94598d..5f98fc4` → build ·
  `842756d..5f98fc4` → build. Deux des trois commits DOIVENT construire quoi qu'il arrive.
- **Le quota du compte n'est pas épuisé.** FinanceAI a créé un déploiement de production à
  **20:47:29 Z**, c'est-à-dire ENTRE deux merges CarAI restés sans effet. Le quota est
  partagé entre les six projets : s'il était au mur, FinanceAI n'aurait rien eu non plus.
- Reste donc, par élimination : **l'intégration Git de CE projet ne reçoit plus rien**
  (famille du 31/07, cf. §6 du `CLAUDE.md`). À confirmer par Marc dans le tableau de bord.

### ⚠️ Correction — le message de `5f98fc4` raconte une histoire probablement fausse

Ce commit affirme que la cause était le **commit enjambé** : Vercel ne construit que le plus
récent d'une poussée, `ec5b4a5` aurait été sauté et seul `d94598d` (documentation) évalué.

Deux faits la contredisent : #93 et #94 sont espacées de **4 min 34 s** — largement de quoi
traiter la première seule — et surtout **#96, qui doit construire sous n'importe quelle base,
n'a rien produit non plus**. La correction du script reste bonne (le cas « commit enjambé »
est un vrai défaut latent, et il aurait mordu un jour), mais elle ne réglait pas CETTE panne.

C'est la **deuxième fois de la journée** que j'annonce une cause avant de l'avoir isolée —
la première fois j'avais accusé l'intégration Git alors que c'était le quota, cette fois
l'inverse. La leçon n'est pas « c'est l'un ou l'autre » : c'est qu'un déploiement absent a
au moins trois causes possibles (quota, intégration, build sauté) qui donnent **exactement
le même écran vide**, et qu'aucune ne se déduit — chacune a son test.

**Le test de chacune, pour la prochaine fois :**
- *build sauté* → rejouer `scripts/build-necessaire.sh <base> <tête>` sur les vrais commits ;
  (variable d'environnement changée puis « Redeploy » annulé : voir `docs/claude/06-bis-quota-deploiement.md`, il faut un commit sur `vercel-rebuild.txt`) ;
- *quota du compte* → regarder si un AUTRE projet du compte a déployé dans la même fenêtre ;
- *intégration Git* → ce qui reste quand les deux premiers sont écartés.

### Ce que Marc devait vérifier — ⚠️ SANS OBJET depuis le 14/09

*(Conservé tel quel : c'est un récit daté. Ce qui suit était la consigne du 21/08 ; elle
n'est plus à faire, voir la clôture en tête de fichier.)*

Tableau de bord Vercel → **car-ai** → *Deployments*. Si la liste s'arrête bien à 20:14 :
Settings → Git, et re-lier le dépôt. ⚠️ **« Redeploy » ne sert à rien ici** — il rejoue le
commit du déploiement choisi, donc `842756d`, pas `main`.

## 21/08 — CHOISIR UN LIEU SUR LA CARTE, et deux corrections de conduite

Marc : « quand je choisis un lieu de recharge je veux pouvoir choisir sur la map, choisir
une adresse, choisir le rayon et tarif ». Livré (#88) : la carte se tape pour poser le lieu,
l'adresse la recentre, le curseur de rayon dessine le cercle **à l'échelle réelle du
terrain**, et le formulaire RÉPOND enfin — succès comme refus.

Le déclencheur était une capture : Marc avait tapé `460926.9` dans le champ Latitude. Le
schéma le refusait, le formulaire ne disait rien (`if (!valide.success) return;`). Une
coordonnée n'est pas une donnée qu'on saisit, c'est une donnée qu'on DÉSIGNE.

Trois pièges traités, chacun invisible sans test :
- l'inverse de Mercator passe par `atan(sinh())`, pas par une division — une inversion
  linéaire poserait le lieu à plus d'un degré de l'endroit tapé ;
- le rayon a besoin du **cosinus de latitude** : sans lui, à Québec, un cercle annonçant
  120 m en couvrirait 176, et apparierait la borne du voisin ;
- `premierPoint` vérifie le TYPE avant de convertir : `Number(null)` vaut 0, et 0,0 est un
  point valide au large de l'Afrique.

### ⚠️ Correction de diagnostic — j'ai accusé le mauvais coupable

Le merge de #86 n'avait produit AUCUN déploiement de production. J'ai annoncé à Marc « c'est
le scénario du 31/07, l'intégration Git n'a rien reçu ». **C'était faux** : le quota Vercel
était épuisé, ce que Marc m'avait d'ailleurs dit lui-même dans le même échange. J'ai agi sur
son information (ne plus pousser) sans revenir corriger le diagnostic déjà donné.

Ça compte parce que **les deux causes appellent des gestes opposés** : un webhook manqué se
répare par un nouveau push, un quota épuisé ne se répare que par l'attente. Marc pouvait
partir chercher un problème d'intégration Git qui n'existait pas.

**Leçon : quand une information nouvelle arrive, re-vérifier les diagnostics DÉJÀ ÉNONCÉS,
pas seulement les décisions à venir.** Un diagnostic faux ne s'annule pas parce qu'on a
cessé d'agir dessus — il reste dans la tête de celui à qui on l'a donné.

### État des déploiements

`main` porte TROIS lots non encore servis (#84 voiture 3D était déployée ; #86 carte pleine
hauteur + désélection, #88 choix de lieu, ne le sont pas). La production sert `9ac33b1`.
Un seul déploiement les rattrapera tous — c'est le bon côté de l'attente forcée.

⚠️ Rappel : ne PAS utiliser « Redeploy » pour rattraper, il rejoue le commit du déploiement
choisi et non le HEAD de `main`. Un push, puis comparer le SHA servi au SHA attendu.

## 20/08 (soir) — LA VOITURE EST UN VRAI RENDU 3D

Marc : « voiture comme une image 3d d'une bZ ». C'est fait, et le modèle est arrivé par
`git clone` d'un dépôt jetable (`MoKarade/bz-modele`) — le canal qui écrit sur le DISQUE
sans passer par le contexte.

**La chaîne**, entièrement ici : `.glb` de 81 Mo → three.js + Chromium headless
(`--use-angle=swiftshader`) → caméra **orthographique** zénithale, fond transparent, studio
sombre à lampes **rasantes** → 812 × 1800 → réduit une fois → **WebP de 80 Ko**.

L'orthographique n'est pas un détail d'esthète : elle garantit que les quatre roues ont
rigoureusement la même taille, ce qui est la condition pour qu'une pastille de pression
tombe sur la bonne roue.

**Les ancres ne sont plus posées au jugé.** Un second rendu où SEULES les roues étaient
visibles (matériaux `M_TYRE_*`) a donné leurs boîtes au pixel : 13,8 / 85,1 % en abscisse,
21,2 / 78,5 % en ordonnée, 10,5 % de large — soit exactement un 235 mm sur une voie de
2 117 mm. Un premier motif (`rubber|wheel|rim`) attrapait des pièces de liaison au sol et
donnait des « roues » de 41 % : la mesure ABSURDE est ce qui a permis de la rejeter.

### ⚠️ Trois erreurs sur la MÊME constante, toutes d'apparence raisonnable

`HAUTEUR_PASTILLE_PCT`, la hauteur d'une pastille en % du cadre :

| Essai | Valeur | Ce qui n'allait pas |
|---|---|---|
| 1 | 2,4 % | divisé par la hauteur de l'**image** (1 685 px) au lieu du **cadre rendu** (603 px) |
| 2 | 5,8 % | mesuré — mais sur un banc où les pastilles n'avaient **pas leur classe d'apparence** |
| 3 | **4,7 %** | mesuré sur un banc fidèle |

L'essai 2 est le plus instructif : **mon banc rendait des boutons par défaut du navigateur**
— gris, opaques, plus gros — et c'est cette image-là que Marc a vue. Son « le texte est
agressif, mets des icônes reconnaissables » portait donc sur un artefact de mon banc : les
vraies pastilles étaient déjà des pilules translucides floutées, et les vraies icônes
(`IcoPneu`, `IcoPortiere`, `IcoJauge`…) existaient depuis la veille.

### Leçon

**Un banc infidèle ne corrige pas une erreur : il en fabrique une autre, avec l'autorité
d'une mesure.** C'est pire qu'un raisonnement, parce qu'un chiffre mesuré ne se remet plus
en question. Un banc doit donc partir des VRAIES classes et des VRAIS composants — le mien
recomposait le balisage à la main, et il a suffi d'oublier une classe pour que tout ce qu'il
montrait devienne faux. Ce qui a sauvé la mise : re-mesurer après avoir rendu le banc
fidèle, au lieu de croire la première mesure sous prétexte qu'elle était chiffrée.

Corollaire de conduite : quand Marc signale un défaut visuel, **vérifier d'abord que ce
qu'il a vu est bien ce que l'app produit**. Ici il décrivait fidèlement mon banc, pas
l'application — et j'aurais « corrigé » du code qui n'avait rien.

## 20/08 (fin) — CORRECTION : LE RENDU 3D SE FAIT ICI

Marc : « tu peux pas visualiser en 3d toi ? ». **Si.** Et le document que je venais d'écrire
disait le contraire.

⚠️ **L'erreur de raisonnement, à retenir : j'ai conclu « je ne peux pas faire de 3D » à
partir de « je ne peux pas récupérer le fichier ».** Deux problèmes distincts, dont un seul
était réel — et je n'avais vérifié ni l'un ni l'autre avant d'écrire un plan complet dessus.

Vérifié depuis, en produisant l'image avant d'écrire la phrase : three.js installé depuis
npm (registre autorisé par le proxy), `GLTFLoader` chargé, WebGL rendu par Chromium
headless (`--use-angle=swiftshader`), caméra orthographique, fond transparent.

**Et le canal de transport existait aussi : `git clone`.** Il écrit sur le DISQUE sans
passer par le contexte — exactement ce que l'outil Drive ne sait pas faire, lui qui rend le
fichier encodé en texte. 81 Mo n'est pas trop gros pour git ; c'était trop gros pour un
transfert *par texte*. J'avais testé trois canaux et arrêté ma recherche à celui-là.

Ce que le rendu ici apporte sur une capture d'écran, et qui n'est pas cosmétique :
la caméra **orthographique** supprime toute perspective, donc les quatre roues gardent
exactement la même taille — condition pour que les quatre pastilles de pression tombent sur
la bonne roue. Plus : fond transparent d'origine, éclairage réglé pour le thème sombre
(dont un contre-jour qui détache le pavillon noir du fond, remède n°1 du risque §5),
résolution choisie, et un autre angle plus tard = une ligne à changer.

`docs/RENDU-3D.md` est corrigé, avec l'erreur laissée visible en tête de §1 plutôt
qu'effacée.

### Leçon

**Une impossibilité se VÉRIFIE avant de bâtir un plan dessus.** Trois canaux testés puis
« c'est impossible » — alors que le quatrième était le canal que j'utilisais déjà toute la
journée pour pousser du code. Et surtout : deux impossibilités différentes (« rendre » et
« recevoir ») s'étaient fondues en une seule dans ma tête, ce qui a fait porter la
conclusion de la vraie sur la fausse. Réflexe : quand une limite en implique une autre,
nommer les deux séparément et tester chacune.

## 20/08 (suite) — LA FIN DE CHARGE SUR LA VOITURE, ET LE PLAN DU RENDU 3D

Marc : « Fin prévue 15 h 35 (2 h 30 annoncées par la voiture au relevé) — je veux que ce
soit sur le véhicule aussi ». L'heure ne vivait que dans le bandeau. Elle est maintenant
sur la pastille de la trappe (`84 % · 15 h 35`), collée à l'unité plutôt que dans un
onzième point : « 84 % » et « prêt à 15 h 35 » répondent à la MÊME question, et la
carrosserie est déjà dense.

Le statut de charge est désormais calculé **une seule fois** et partagé par le bandeau et
la pastille. Deux appels séparés, c'est deux vérités qui finissent par diverger — et ici
elles auraient affiché deux heures de fin différentes sur le même écran.

### ⚠️ Le modèle de chevauchement, TROISIÈME version

- v1 : distance entre CENTRES. Vert au test pendant que les pastilles se recouvraient.
- v2 : boîtes, mais d'une largeur UNIQUE prise sur la plus large. Tenait tant que les
  pastilles se ressemblaient.
- v3 (aujourd'hui) : la charge a gagné son heure de fin et est passée à 46 % de large.
  Prendre 46 pour tout le monde aurait déclaré en conflit deux pastilles étroites pourtant
  séparées de 40 points. **Un garde trop strict ne vaut pas mieux qu'un garde trop laxiste :
  les deux mentent.** Chaque point déclare sa CLASSE de largeur, et deux points se gênent
  quand leur écart horizontal est sous la DEMI-SOMME de leurs largeurs — la vraie condition
  de recouvrement de deux boîtes.

⚠️ La classe décrit le **pire cas** (`charge` est `large` même batterie pleine) : sinon la
disposition serait valide débranchée et cassée en charge — un défaut qui n'apparaîtrait
qu'une fois branché, c'est-à-dire au moment précis où on regarde l'écran.

### Un tripwire qui décrivait la syntaxe, pas l'invariant

`statutCharge.test.ts` exigeait `<BandeauCharge statut={statutDeCharge(` **écrit en ligne**.
Extraire le calcul en constante partagée l'a fait tomber alors que l'invariant — le bandeau
n'est pas conditionné à une déduction réussie — était intact. Reformulé pour vérifier le
LIEN (le statut vient bien de ce calcul, directement ou par la constante qui le porte) et
qu'aucune condition ne s'est glissée dans la constante.

### Le rendu 3D : plan écrit, pas encore livré

Voir **`docs/RENDU-3D.md`**. En résumé : le modèle (81 Mo) est inatteignable d'ici — les
trois chemins réseau sont fermés — donc **le rendu se fait chez Marc, une fois**, et l'app
ne reçoit qu'un PNG. C'est de toute façon ce qu'on voudrait : embarquer un moteur 3D pour
afficher une vue fixe coûterait des centaines de Ko à chaque visite.

Le document nomme d'avance le risque principal : **le toit de la bZ est noir et l'app est
sombre**, donc le pavillon — la moitié de la vue de dessus — risque de se fondre dans le
fond avec les deux pastilles qui s'y posent. Trois remèdes classés, à trancher au banc.

## 20/08 — TOUTES LES INFOS SUR LA VOITURE, CLIQUABLES

Marc : « toutes ces infos je veux qu'elles soient sur la voiture d'une manière ou d'une
autre (voiture comme une image 3d d'une bZ, avec toutes les infos dessus, cliquables) ».

L'anneau de charge, l'autonomie et la rangée de quatre pastilles ont disparu **en tant que
blocs séparés** : ils redisaient à côté ce que la carrosserie peut porter. Dix points sont
posés dessus — autonomie au capot, charge à la trappe, verrou au toit, ouvrants à
l'habitacle, odomètre au hayon, dernier relevé à l'aile droite, et **une pression sur
chaque roue**. Les deux qui COMMANDENT (charge, verrou) portent leur valeur au lieu d'un
pictogramme muet posé à côté d'elle.

Trois fichiers, séparés parce qu'ils changent pour des raisons différentes :
`pointsVoiture.ts` (**où** ça se pose, en % du cadre), `pointsAccueil.ts` (**ce que** ça
dit), et le dessin. Les ancres sont en POURCENTAGE : remplacer l'illustration par un rendu
3D sera un re-réglage de nombres dans un fichier, pas une refonte.

### ⚠️ Le garde de disposition mesurait la MAUVAISE GRANDEUR

Premier jet : « deux ancres ne doivent pas être à moins de 12 points l'une de l'autre »,
distance entre CENTRES. Vert au test, et au banc les pastilles se recouvraient de moitié —
parce que ce qui se chevauche, ce sont des BOÎTES de ~20 à 34 % de large, pas des points.
Un garde qui mesure la mauvaise grandeur donne exactement la confiance qu'il ne mérite pas.

Remplacé par un modèle de boîte (proche en X **et** en Y), dont les dimensions viennent
d'une **mesure au banc Chromium** — pastilles rendues 40 à 91 px dans un cadre de 272 ×
508 —, pas d'une intuition. Et le test porte le cas qui l'avait berné.

### Deux autres choses que seul le banc a montrées

- **Le cadre ne faisait que 171 px de large.** Un `max-height: 20rem` posé sur le SVG le
  rendait plus étroit que son conteneur : les pastilles, positionnées en % du CONTENEUR,
  se décalaient de la carrosserie qu'elles désignent. La taille se pose désormais sur le
  conteneur, **en un seul endroit** — et c'est le bloc du BAS qui gagne, comme toujours à
  spécificité égale (troisième fois que ce fichier le rappelle).
- **Les roues criaient plus fort que les pressions.** Remplies de leur couleur d'état, les
  quatre roues devenaient des barres fluo alors que ce qu'on vient lire, c'est le chiffre.
  L'état vit maintenant dans le CONTOUR ; le caoutchouc reste noir. Le signal ne se perd
  pas, il change de support.

### La voiture : ce qui est possible et ce qui ne l'est pas

Marc a proposé de passer le dépôt en privé pour y mettre un vrai rendu 3D. **Le privé ne
donne pas de licence** — il réduit l'exposition, pas les droits. Ce qui est publié ici est
donc un DESSIN (SVG au trait, volume par dégradés), pas un rendu Toyota.

Chemin propre, en cours : Marc dépose un `.glb` sous licence Creative Commons dans son
Google Drive (le fichier fait > 30 Mo — il n'a rien à faire dans git, et Sketchfab est
bloqué par le proxy réseau d'ici). Il sera rendu **hors ligne** en une image PNG, seule
l'image entrera dans le dépôt, avec son attribution. Les ancres étant en pourcentage, la
bascule ne touchera aucun composant.

### Leçon

**Un garde de mise en page se calibre sur une MESURE, jamais sur une intuition — et il doit
mesurer la grandeur qui cause la panne.** Ici la panne était un recouvrement de boîtes ; le
garde comparait des distances entre points. Les deux se ressemblent assez pour qu'on écrive
le mauvais sans s'en apercevoir, et le mauvais reste vert pendant que l'écran est cassé.
Corollaire : quand un rendu se juge à l'œil, le banc n'est pas une vérification finale,
c'est l'INSTRUMENT — il a fourni ici les trois chiffres qui ont décidé du code.

## 20/08 (nuit) — molette de la carte, fin de charge, et l'accueil devient visuel

### 1. ⚠️ Le MÊME bug de molette, dans un composant que je n'avais pas cherché

Marc : « nulle la maps de tendance quand je zoom ça scroll la page ». `CarteInteractive`
attachait `onWheel` **en React** — écouteur passif, `preventDefault()` ignoré : la page
défilait EN MÊME TEMPS que la carte zoomait. C'est **exactement** le bug corrigé le matin
même dans `GraphiquesLies`, dans un fichier voisin, et un `grep onWheel` l'aurait trouvé
le jour même.

Le garde a donc changé de nature : au lieu de nommer les deux fichiers connus,
`tests/moletteZoom.test.ts` **balaie tout `app/ui/`** et interdit `onWheel={` partout. Une
troisième surface qui apparaîtra demain tombera dessus toute seule. La légende disait aussi
« molette pour zoomer » : consigne **inapplicable**, elle envoie chercher le défaut au
mauvais endroit. Elle nomme désormais `Ctrl/⌘ + molette`, comme la carte Google.

### 2. « Je vois pas le temps de charge prévu »

La voiture le publie — `charge_time_remaining` — et l'app le jetait. À raison **hors
charge** : la bZ ne remet pas ce compteur à zéro et rediffuse la dernière valeur (constaté
le 19/08 : 250 annoncées sur une batterie pleine, câble débranché). Mais **pendant** une
charge, c'est la meilleure source qui existe.

`statutDeCharge` publie donc `finAnnoncee`, uniquement en charge. Deux règles verrouillées
par mutation :
- la fin se compte depuis le **relevé**, jamais depuis « maintenant » (le relevé de Marc
  avait 64 min : compter à partir de maintenant décalerait la fin d'une heure) ;
- refus de tout ce qui ne peut pas être vrai (≤ 0, > 48 h, valeur non finie, pas d'instant).

⚠️ **L'unité n'est pas publiée** (`unit: null`) et ce projet s'interdit de deviner une
unité. Elle est tranchée par l'**arithmétique**, sur des mesures réelles : 70 % de 57,7 kWh
⇒ ~17 kWh à mettre ⇒ ~4,7 h sur une borne domestique ; 250 **minutes** = 4 h 10, même ordre
de grandeur. En secondes ce serait 4 minutes, en heures dix jours. Le doute résiduel est dit
à l'écran (« annoncées par la voiture ») et le rythme mesuré depuis le niveau de charge
reste affiché à côté : s'ils divergent, Marc voit les deux.

### 3. L'accueil devient visuel

« Je veux genre une image ou un logo électrique, un le plug qu'on branche, que ce soit
visuel… pareil pour tout dans accueil. »

`IllustrationCharge` (`app/ui/Icones.tsx`) dessine le connecteur et son câble, à 72 px, dans
les quatre états : branché avec un éclair **plein et animé** en charge, branché et inerte en
attente, **écarté du socle** débranché (l'écart EST l'information, et les broches ne se
dessinent que branché — jamais un contact qui n'existe pas), pointillé si on ne sait pas.
Toujours du SVG au trait, `currentColor`, aucun asset, aucun emoji : le style du 17/08 tient,
c'est l'échelle qui change. Les tuiles et les titres de section reçoivent chacun leur icône.

### 4. Diagnostic du repli Google

Le message disait « Google n'a pas répondu » — ce qui ne permet pas de distinguer **le geste
de Marc qui manque** (« Maps JavaScript API » pas activée) de **mon code qui échoue**. Le
repli nomme désormais sa cause : clé refusée / script bloqué / délai / SDK vide, avec le
remède propre à chacune. Un outil de diagnostic qui ne distingue pas ses cas ne diagnostique
rien.

### Leçon

**Un correctif d'interaction est une RÈGLE, pas une retouche : il se cherche partout où la
règle s'applique, dans le même jet.** J'ai corrigé la molette des graphiques le matin, laissé
la même ligne fautive dans la carte à côté, et Marc l'a trouvée le soir. Le remède durable
n'était pas de corriger le second fichier mais de faire **balayer le dossier** par le test :
tant qu'un garde nomme ses cibles, il vieillit à la vitesse où le code grandit.

## 20/08 (soir) — la carte devient VIVANTE, et l'accueil dit si la voiture charge

### 1. « Je peux pas zoomer ni me déplacer, inutile »

Troisième et dernier tour sur la même carte. Elle était nette, bien cadrée, bien
contrastée — et c'était une **image**. Les deux produits Google utilisés jusqu'ici ne
peuvent pas faire mieux : Maps **Static** rend un raster, Maps **Embed** est vivant mais
ne sait afficher NI plusieurs marqueurs NI un tracé arbitraire. Il fallait le troisième :
**Maps JavaScript API** (`lib/carteVivante.ts` + `app/ui/CarteGoogleVivante.tsx`).

⚠️ **Geste requis côté Marc, une fois** : activer « Maps JavaScript API » dans Google Cloud
Console pour la clé — produit SÉPARÉ de « Maps Static API », exactement comme celle-ci
l'était de l'Embed.

**Le repli est interactif lui aussi.** Si le SDK ne charge pas (API pas activée, clé
refusée, réseau), on rend `CarteInteractive` — la carte CarAI sur tuiles OSM, qui zoome et
se déplace. **Aucun chemin ne peut redonner une image figée** : c'était le défaut, il ne
doit pas pouvoir revenir par la porte du repli. L'image Static a donc été SUPPRIMÉE
(`lib/carteStatique.ts`, `CarteGoogleZone`, `CarteZoneAvecRepli`, et `CarteGooglePositions`
qui était déjà morte).

Trois pièges qui ne lèvent **aucune erreur**, tous couverts par test :
- `gm_authFailure` est le SEUL signal d'une clé refusée — le script se charge (200), la
  carte se construit, et l'affichage part en filigrane « for development purposes only ».
- Le conteneur doit avoir une **hauteur définie** en CSS, sinon la carte se rend sur 0 px.
- `loading=async` **exige** un `callback` : sans lui, rien ne dit quand le SDK est prêt.

Et `gestureHandling: "cooperative"` — la molette nue fait défiler la page, Ctrl/⌘ zoome.
Même règle que les graphiques ce matin : une carte qui capture la molette rend une page
longue infranchissable.

### 2. « Dans accueil je veux voir si le véhicule est en charge ou non »

Le bandeau existait, mais il **DÉDUISAIT** la charge d'un SOC qui monte — donc il
disparaissait quand la voiture ne charge pas, quand elle est au palier, ou quand deux
relevés manquent. « Rien à l'écran » ne répond pas à « est-ce qu'elle charge ».

Or la bZ publie le fait DIRECTEMENT, vérifié sur les vraies mesures via le connecteur MCP
le 20/08 : `charging_status` (true), `charging_status_detail` (`CHARGING`) et
`charge_plugged_in` (true). `statutDeCharge()` (pur, testé) les lit et rend **cinq** états
distincts, dont deux que personne n'affichait :

| État | Signification |
|---|---|
| `en-charge` | la voiture le dit |
| `branchee-en-attente` | câble branché, charge à l'arrêt |
| `debranchee` | pas en charge, câble débranché — les deux signaux concordent |
| `pas-en-charge` | pas en charge, **câble inconnu** — on n'affirme pas « débranchée » |
| `inconnu` | signal non publié ; rien n'est déduit |

`branchee-en-attente` compte particulièrement pour Marc : il a **trois minuteries de
charge** (08:00→00:00, 13:00→17:00, 18:15→06:40), donc « branchée mais pas en charge » est
chez lui un état NORMAL, à ne pas confondre avec un câble oublié.

La déduction depuis le SOC (rythme, fin estimée) reste — comme **détail** sous le fait, plus
jamais à sa place. Et l'InfoTap du bandeau affirmait « la bZ ne publie ni "branchée" ni
temps restant » : **c'était faux**, elle publie les deux. Corrigé.

### Leçon

**Une déduction ne remplace pas un fait publié.** Le bandeau a passé des semaines à inférer
d'un SOC qui monte ce que la voiture déclarait en clair dans une colonne d'à côté — et
l'inférence, honnête, se taisait précisément dans le cas que Marc voulait lire. Réflexe :
avant de calculer un état, **chercher si la source le publie**, et si oui, l'afficher LUI,
la déduction en second. Corollaire vérifié ici : l'écran affirmait par écrit que la donnée
n'existait pas. Une phrase d'interface est une doc — elle se périme comme une doc.

## 20/08 — molette, zone parcourue, et la carte qui « ne montre pas tous les trajets »

### 1. La molette (`claude/molette-et-zone`)

« J'arrive pas à scroll sur les graphs, ça me fait descendre la page. » React attache
`onWheel` en écouteur **PASSIF** : `preventDefault()` y est ignoré. Le zoom s'appliquait,
en même temps que le défilement qui emportait le graphique hors de l'écran. Corrigé par un
écouteur natif `{ passive: false }` — et le zoom exige **Ctrl/⌘** : capturer la molette nue
sur un écran qui empile huit courbes rendrait la page infranchissable. Sur trackpad macOS
le pincer envoie `ctrlKey`, donc le pincement zoome sans une ligne de plus. La légende
nomme désormais les boutons + et − : les captures de Marc viennent d'un TÉLÉPHONE, où il
n'y a aucune molette.

### 2. ⚠️ « Ça me fait pas tous les trajets » — le diagnostic était FAUX au départ

Premier réflexe : accuser la **troncature d'URL** (Google refuse au-delà de ~8 192
caractères, on coupe les trajets anciens). Une refonte du paramètre `markers` était écrite
et testée quand la MESURE l'a contredite : sur la vraie semaine de Marc — 32 trajets, deux
relevés chacun (la bZ ne publie qu'à l'arrêt) — l'URL fait **3 732 caractères sur 8 000**
et les 32 trajets sont TOUS tracés. Rien n'était coupé. La légende ne l'annonçait d'ailleurs
pas, ce qui aurait dû mettre la puce à l'oreille avant de coder.

**La vraie cause est la FORME du cadre.** Sa semaine couvre 44,8 km de large sur 71,2 km de
haut — du **portrait** — pendant que l'image était figée en `640x360`, du **paysage**.
Google cadre sur la contrainte la plus serrée : **198 m par pixel**, donc douze trajets sur
trente-deux tracés sur moins de dix pixels, indistinguables d'un point. Les deux tiers de la
largeur de l'image ne servaient à rien.

Trois correctifs, tous mesurés :

- **Le cadre épouse la donnée** (`cadrePourPoints`) : même surface Google (640 au plus grand
  côté), `480x640` au lieu de `640x360` → **111 m/px, 1,78× plus de détail**. Borné entre
  16/9 et 3/4 pour qu'une donnée dégénérée ne produise pas un bandeau, et jamais sous 100 px
  par côté — ce qui garantit une longueur de `size=` CONSTANTE, dont dépend le calcul de la
  coupe (verrouillé par test).
- **La légende DIT ce qui est trop petit** (`nbTropCourts`) : « N des M tracés font moins de
  dix pixels — ils sont bien là, mais indistinguables d'un point tant que la même image doit
  contenir le plus long trajet. » C'est la réponse à la question de Marc, à l'endroit où il
  se la pose. Une image ne peut pas montrer un trajet de 100 km et un de 1 km à la fois ;
  elle peut le dire.
- **Un seul `markers=` partagé** : gardé, mais pour ce qu'il vaut vraiment. Le préfixe de
  style (`size:tiny|color:0x…`) coûte ~45 caractères une fois encodé et était répété par
  trajet. Sans effet sur « 7 j » (rien n'y est coupé), le plafond passe de **50 à 66
  trajets** — ça compte sur « 30 j » et « tout l'historique », où la coupe mord pour de bon.

⚠️ Le CSS avait un piège associé : `img.carte-google { object-fit: cover }` **rogne**
l'image pour remplir son cadre. Servir une image portrait dans un cadre 16/9 aurait coupé
des trajets en haut et en bas, **silencieusement**. `.carte-google-zone` laisse donc l'image
imposer sa forme (`width`/`height` viennent du cadre) et borne la hauteur.

### 3. ⚠️ Le correctif du cadre a d'abord RÉTRÉCI la carte (même journée)

Marc, capture à l'appui : « trop petit la map, impossible à lire, je vois pas les
trajets ». Le premier jet bornait la HAUTEUR (`max-height: 34rem`) avec `width: auto` :
sur une donnée portrait, l'image tombait à **409×544 px** dans une carte de ~1 240 —
le détail gagné dans le fichier était jeté au rendu. Juste sur le fond, raté à l'écran.

Ce qui manquait : **Google plafonne CHAQUE côté à 640.** Pour une donnée portrait, c'est
la hauteur qui contraint le détail — donc demander `640×640` donne EXACTEMENT le même
détail que `480×640`, tout en s'affichant sur toute la largeur. Le carré est gratuit en
détail et gagnant à l'écran ; les marges latérales de carte sont du contexte, pas du
gâchis. D'où `RATIO_MIN = 1` (jamais plus étroit qu'un carré) et `width: 100%` côté CSS.

Mesuré au banc Chromium avec le vrai `globals.css` :

| Écran | Avant | Après |
|---|---|---|
| Capture de Marc (carte ~1 240 px) | 409 × 544 | **768 × 768** |
| Téléphone (390 px) | 325 × 433 | 325 × 325 |

Compromis assumé sur téléphone : la largeur y est déjà pleine, donc un cadre portrait y
gagnait un quart de hauteur. Si ça devient gênant, la réponse est un `<picture>` avec deux
URL — le navigateur n'en charge qu'une, donc aucun appel Google supplémentaire.

**Et la moitié invisible du problème : le CONTRASTE.** Les marqueurs étaient en
`0x93c5fd`, un bleu pâle tiré de la palette d'accent de l'app SOMBRE. Or le fond de carte
de Google est CLAIR quel que soit le thème : terre ~`#f2efe9`, eau ~`#aadaff`. Écart de
luminance perçue avec l'eau : **23** — invisible. En `0x2563eb` : **115**. Verrouillé par
un test qui DÉRIVE la luminance au lieu de juger la couleur à l'œil, et qui prouve sa
discrimination en refaisant le calcul sur l'ancienne couleur.

### Leçon

**Mesurer avant de corriger, même quand l'hypothèse est plausible et déjà codée.** La
troncature était une explication crédible, elle avait un mécanisme réel dans le fichier, et
elle était fausse pour ce cas. Ce qui l'a tranchée : instancier les VRAIES données (32
trajets × 2 relevés, via le connecteur MCP) et compter les caractères. Corollaire : quand un
code sait déjà DIRE qu'il a coupé (`nbAffiches < nbTrajets`) et qu'il ne le dit pas, c'est
qu'il n'a pas coupé — lire le signal que le code émet déjà avant d'en supposer un autre.

**Et la mesure ne s'arrête pas au fichier : ce qui compte est ce que l'ŒIL reçoit.**
Gagner 1,78× de détail dans l'image ne sert à rien si le CSS l'affiche deux fois plus
petite — c'est exactement ce qui s'est passé, et Marc l'a vu en une capture. Toute
optimisation de résolution se termine par une mesure de la taille RENDUE (banc Chromium +
le vrai `globals.css`), jamais par le contenu du fichier servi. Même famille : une couleur
choisie dans la palette de l'app ne vaut rien sur un fond qu'on ne contrôle pas — celui de
Google est clair, l'app est sombre, et personne ne l'avait vérifié.


## 19/08 — CONNECTEUR MCP en OAuth 2.1 (`[MCP-02]`, `[MCP-03]`)

Demande de Marc : « je veux un connecteur MCP à l'app pour que Claude ait toutes les infos
de ma voiture ». `POST /api/mcp`, JSON-RPC, cinq outils en LECTURE SEULE.

### ⚠️ L'erreur de la journée, à ne pas refaire

On a d'abord fait accepter le jeton dans l'URL (`?jeton=`), en concluant de l'écran
« connecteur personnalisé » de claude.ai — une URL et deux champs OAuth — qu'il ne savait
pas envoyer d'en-tête. **C'était faux.** Cet écran n'offre QUE OAuth, et claude.ai découvre
les endpoints tout seul à partir du `WWW-Authenticate` du 401. Le paramètre d'URL
n'apportait donc rien, tout en exposant un secret dans les journaux de requêtes de
l'hébergeur — il a été retiré (test de non-réintroduction dans `tests/mcp.test.ts`).

Ce qui aurait évité deux PR : **DriveAI avait déjà résolu ça**, dans le même écosystème,
avec un ADR qui écrit la contrainte noir sur blanc. Avant de contourner la limite d'un
outil, vérifier qu'elle existe — et regarder si une app voisine a déjà répondu.

### Comment c'est gardé

`lib/mcp/oauth.ts` est un **port fidèle** de DriveAI (ADR-0042), lui-même port de FinanceAI :
on ne réécrit pas une pile OAuth, on porte celle qui tourne en production avec ses findings
de revue sécurité. Sans état (jetons = payload signé HMAC), PKCE S256 obligatoire,
`redirect_uri` sur allowlist claude.ai + loopback et liée au code, DCR sans base
(`client_secret` dérivé du `client_id`). Préfixe de jeton `ca1.` : un jeton DriveAI (`da1.`)
ou FinanceAI (`fa1.`) ne passe jamais ici, même en cas de clé partagée par erreur.

La VRAIE porte est `MCP_ACCESS_KEY`, saisie une fois sur `/api/mcp/authorize` (comparaison
en temps constant). Le limiteur d'échecs est un **filet faible** en serverless et c'est dit
dans le code : N requêtes parallèles = N compteurs à zéro. Ce qui protège est l'ENTROPIE de
la clé — d'où le générateur aléatoire de l'écran Réglages et le refus des clés courtes.

### ⚠️ Bug trouvé au PREMIER test HTTP réel — la logique juste, le câblage faux

`contexteMcp()` reconstruisait le provider **à chaque requête**. Or l'anti-rejeu des codes
d'autorisation (`consumedJti`) vit DANS l'instance : la liste repartait donc vide à tous les
coups, et **rejouer un code d'autorisation émettait de nouveaux jetons indéfiniment**
(mesuré : HTTP 200 + access_token sur le rejeu). Aucun test unitaire ne pouvait le voir —
ils tiennent tous un seul provider, ce qui prouve la logique et jamais son câblage.

Corrigé par mémoïsation des providers (clé = secrets + issuer, table plafonnée puisque
l'issuer vient d'un en-tête manipulable). Deux tests de câblage ajoutés, prouvés par mutation.
**Règle à retenir : une garde qui vit dans un état d'instance doit être testée sur DEUX
requêtes, pas sur deux appels.**

### Mise en service

Tout se fait dans l'app : Réglages → « Connecteur Claude (MCP) » → *Générer les clés*.
L'écran donne les quatre gestes avec un bouton *Copier* : poser `MCP_SIGNING_KEY` et
`MCP_ACCESS_KEY` chez Vercel · redéployer · coller `https://carai.hubperso.com/api/mcp`
dans claude.ai (Client ID/Secret vides, Claude s'enregistre seul) · saisir la clé d'accès
sur la page d'autorisation.

Les clés sont tirées dans le NAVIGATEUR (`crypto.getRandomValues`) et n'en sortent pas :
ni envoyées, ni stockées. L'app ne peut donc pas vérifier ce qui a été collé chez Vercel —
c'est dit à l'écran, et c'est le prix de ne pas garder un secret de plus dans une base
qu'on sauvegarde.

`MCP_TOKEN` reste accepté en EN-TÊTE, optionnel, pour un client qui pilote ses en-têtes
(Claude Code, curl). Sans rapport avec claude.ai.

### Vérifier un déploiement

Ouvrir `https://carai.hubperso.com/api/mcp` dans un navigateur : le 405 porte `configure`
(une auth est-elle configurée ?) et `oauth` (le flux claude.ai est-il utilisable ?). Une
variable d'environnement ne prend effet qu'au déploiement SUIVANT celui où on la pose ;
sans ces champs, « c'est déployé » se dirait sur la foi d'un statut de build, et ce projet
a déjà payé ce raccourci (CI verte + production figée cinq jours, 31/07).

**Prouvé en vrai HTTP** (local, 19/08) : découverte aux deux chemins `.well-known`, DCR
refusant une redirection tierce (400), page d'autorisation, mauvaise clé → 403, bonne clé →
302 avec `state` rejoué, échange du code → jetons, rejeu du code → 400, jeton bidouillé →
401. **Non prouvé depuis une session Claude Code** : le proxy d'egress bloque
`carai.hubperso.com`, donc aucun POST ne part d'ici — seul un ajout réel du connecteur
depuis claude.ai prouve la chaîne de bout en bout.

### Outils

- `etat_vehicule`, `trajets`, `recharges`, `bail`, `sante_donnees`. Chacun réutilise les
  fonctions PURES des écrans (`decouperTrajets`, `reconstituerCharges`, `calculerEtatBail`…)
  — aucun calcul neuf, sinon Claude dirait autre chose que l'écran.
- **Lecture seule, structurellement** : `lib/mcp/outils.ts` n'importe aucune fonction de
  commande, et un test refuse tout nom d'outil qui ressemble à un pilotage. Ouvrir le
  verrouillage ou la charge à distance serait une décision à part, pas un effet de bord.

## 19/08 — le VRAI bug des trajets : des données de TEST dans les totaux

⚠️ **Correction d'un diagnostic FAUX de ma part.** J'ai annoncé à Marc que la purge 0005
avait supprimé son historique de positions. **C'était faux** : les positions n'ont jamais
été supprimées (la purge ne visait un `metric_type` que si AUCUNE de ses lignes ne portait
de valeur, et les positions en portent). J'ai bâti un rejeu, une réparation automatique et
une alerte de perte de données pour un dégât inexistant. La leçon : **avant d'annoncer une
perte, PROUVER l'absence** — une ligne du tableau de `/donnees` l'aurait montré en dix
secondes, et c'est ce qui a fini par trancher.

**Le vrai symptôme** : « compteur : 1751 km · trajets : 91 930 km », 90 179 km de trop, avec
des trajets « Maison → The Mall, 75 042 km » et « → Boul. Exemple, 10 152 km ».

**La cause** : la coordonnée `51.5014, -0.1419` — Londres, position du véhicule **simulé**
de Smartcar — et l'odomètre de ce même véhicule de test (Tesla à 78 432 km, cf. le
commentaire de `ingererLivraison`). Quelques livraisons de test étaient entrées AVANT que
la garde `simulee` n'existe. Elles dorment en base depuis, et fabriquaient des trajets
fantômes dès qu'on totalisait.

**Le correctif** : `VITESSE_MAX_KMH = 200` dans `lib/vehicle/trajets.ts`. Un segment dont
la vitesse moyenne implicite dépasse ce seuil n'est pas une mesure : il ferme le trajet en
cours et n'est jamais assemblé. Le garde regarde les DEUX distances (géométrie ET compteur)
— la pollution avait touché les deux. ⚠️ Il ne juge QUE les segments qui ont une durée :
deux relevés au même instant sont un cas distinct, déjà traité (le trajet existe, aucune
vitesse n'est affirmée) — l'étendre là ferait disparaître ces trajets.

**Rien n'est supprimé** : ces lignes restent en base et restent lisibles dans Données.
On refuse de les COMPTER, on ne les efface pas. Verrouillé par `tests/sautsImpossibles.test.ts`,
écrit avec des coordonnées FICTIVES (le dépôt n'en contient aucune de réelle) et prouvé par
mutation (3 tests tombent sans le garde ; le trajet ordinaire de ~70 km passe dans les deux cas).

## ⚠️ INCIDENT du 18/08 — la purge 0005 a supprimé l'historique de POSITIONS

**Ce que j'ai cassé.** La migration `0005_purge_signaux_sans_valeur.sql` devait supprimer
l'historique des signaux « qui n'ont jamais eu de data » (demande de Marc). Son SQL testait
`value_numeric IS NULL AND value_text IS NULL` — **en oubliant `value_json`**. Or c'est là
que vivent les positions GPS (`coordonneesDuJson`), les pressions de pneus et l'état des
ouvrants. `bool_and(...)` était donc VRAI pour la métrique `location` : **tout l'historique
de positions a été supprimé**, et avec lui les trajets (« 1040 km roulés sans relevé de
position ») et les prix de recharge, qui dépendent du LIEU.

**Le prédicat juste existait déjà**, dans `ingest.ts`, à trois lignes de la version
amputée que j'ai écrite dans le SQL. C'est la leçon « une même règle tenue à deux endroits
diverge, et le mauvais exemplaire gagne » — payée en données réelles.

**La réparation est AUTOMATIQUE** (Marc, 18/08 : « récupère tous les trajets et
recharges et mets dans l'app » — le bouton demandait une action, il a disparu).
`reparerEnArrierePlan()` la déclenche via `after()` (Next 15) sur l'accueil ET Activité :
le travail part APRÈS la réponse, donc l'écran ne ralentit pas. ⚠️ Un `after()` HÉRITE de
la durée de vie de son invocation, il ne s'y ajoute pas (leçon JobAI, trois pages tuées
par « Task timed out ») — d'où `BUDGET_PAGE_MS = 6 s`, des lots de 50, et un curseur
réécrit à CHAQUE lot pour qu'une coupure ne fasse jamais recommencer de zéro. Le cron
garde la même boucle avec 20 s. Réglages n'affiche plus qu'un ÉTAT d'avancement.

**La réparation.** `lib/smartcar/rejeu.ts` relit `webhook_deliveries.raw` (90 jours
conservés, JAMAIS touchés par la purge — exactement le filet que le CLAUDE.md décrivait) et
réécrit les mesures manquantes. Sûr par construction : `insererSnapshots` fait
`onConflictDoNothing` sur l'index unique, donc rejouer deux fois n'écrit rien la seconde
fois. Un lot de 200 livraisons par passage du poll, curseur en base
(`CLE_REJEU_CURSEUR`), arrêt sur lot incomplet. Bouton « Reconstruire un lot maintenant »
dans Réglages, parce que le poll saute des passages et qu'attendre pouvait durer des heures.

⚠️ **Ce qui est plus vieux que la fenêtre de rétention du raw (90 j) est PERDU.** Ici tout
l'historique tient dans la fenêtre (l'app a un mois), donc la reconstruction est complète.

⚠️ **NE PAS « corriger » `drizzle/0005_*.sql`.** Drizzle identifie une migration par le
HASH de son contenu : modifier le fichier en ferait une migration inconnue, appliquée au
prochain démarrage — donc **une seconde suppression**, des données qu'on vient de
restaurer. Le fichier reste tel quel, exempté NOMMÉMENT dans `tests/rejeu.test.ts`, et le
tripwire protège les migrations SUIVANTES : toute migration qui supprime des lignes de
`vehicle_snapshots` doit citer `value_json`.

## 18/08 : charge visible, commandes sans rechargement, élagage

Cinq retours de Marc, plus un diagnostic du canal de données.

### Le canal de données (à SURVEILLER — aucun code ne le répare)

Marc : « je suis en charge depuis des heures, ça affiche pas », badge d'accueil ORANGE.
Mesuré côté Vercel sur 3 h : **1 seule livraison webhook** et **3 passages de poll** là où
la cadence de 30 min en promet 6. Le webhook ne se déclenchant que sur CHANGEMENT, son
silence est normal quand la voiture est à sa limite de charge — mais le poll à moitié
cadencé, lui, ne l'est pas (GitHub Actions retarde/saute les `schedule` sous charge ; c'est
exactement ce que `CadencePoll` mesure sur `/donnees`). **Aucun code ne peut forcer GitHub
à tenir la cadence** : ce qui change ici, c'est que l'app le DIT au lieu d'afficher un
écran figé sans explication.

### Ce qui est livré

- **Bandeau charge à TROIS modes** (`etatBandeauCharge`, pur, 6 tests). L'ancien bandeau
  n'existait que si `estimerFinCharge` répondait ; or elle refuse honnêtement dès que le
  SOC ne monte plus — donc une charge ARRIVÉE À SA LIMITE depuis des heures n'affichait
  RIEN. Trois modes désormais : `estimation` (rythme mesurable), `en-charge` (le SOC monte
  sans rythme mesurable), `limite` (SOC ≥ limite CONFIGURÉE). ⚠️ Le mode `limite` exige une
  limite MESURÉE : sans elle on n'affirme rien (la jauge dit déjà le pourcentage), et on ne
  dit JAMAIS « branchée » — la bZ ne publie pas ce signal.
- **Recharges : le POURQUOI du vide** (`app/activite/page.tsx`). Zéro recharge affichait un
  silence indéchiffrable. Trois phrases distinctes selon la cause : aucun relevé de SOC
  (⇒ canal), relevés mais aucune montée ≥ `HAUSSE_MIN_POINTS`, ou sessions hors période
  (avec leur nombre). Plus un lien « voir les 7 derniers jours » quand la période est le jour.
- **Commandes SANS rechargement** (`commanderInline` + `SchemaInteractif`). L'action
  RETOURNE son résultat au lieu de rediriger : plus de `redirect`, plus de
  `revalidatePath`, donc la carte ne bouge plus. Confirmation par **appui maintenu**
  (800 ms, remplissage progressif) à la place de la case à cocher. ⚠️ L'appui long est une
  commodité de SAISIE — `autoriserCommande` re-valide la confirmation côté serveur, et
  l'ordre des gardes (session → catalogue → connecté → envoi) est verrouillé par test.
- **Zone parcourue de TENDANCES sur Google** (`CarteGooglePositions` + `urlCartePositions`).
  Un NUAGE de points, **aucun trait** : relier des positions d'arrêt indépendantes
  dessinerait un chemin que personne n'a mesuré (les trajets, eux, ont leurs polylignes).
  Repli SVG sans clé. Même geste Google Cloud : « Maps Static API » activée pour la clé.
- **Accueil plus dense** : au-delà de 1200 px, `display: contents` sur `.hc-etat` promeut
  jauges et carte en colonnes du héros (voiture · état · carte sur UNE ligne) — la carte ne
  s'empile plus sous les jauges en laissant une colonne à moitié vide.
- **Élagage** (choix de Marc) : migration **0005** qui SUPPRIME l'historique des métriques
  n'ayant JAMAIS porté de valeur (bornée par `bool_and` : une seule ligne valorisée sauve
  toute la métrique — les vraies mesures restent à vie, décision du 06/08 intacte).
  `inventaireMesures` expose `nbValeurs` et `/donnees` masque les lignes à zéro, en DISANT
  combien sont masquées. Ce qui MANQUE reste nommé par `bilanCouverture` : masquer ≠ taire.

## Correctifs post-étape 2, 2ᵉ salve (17/08, nuit) : zone parcourue sur Google + fraîcheur

Trois retours de Marc sur la version en ligne :

- **« quand je clique sur tous les trajets c'est l'ancienne map »** — la vue d'ensemble
  (`?trajet=tous`) passait encore par l'OSM même avec la clé. L'Embed ne sait afficher
  ni N marqueurs ni un tracé libre → **image Maps Static** (`lib/carteStatique.ts`, pur :
  encodeur polyligne vérifié contre le vecteur de la doc Google, un chemin par trajet,
  bornes aux extrémités, cadrage auto). Honnêteté : Static ne pointille pas → trait
  SEMI-TRANSPARENT (alpha verrouillé par test) + légende « relie les relevés réels ».
  URL bornée à 8 000 : le récent survit, la coupe est DITE. ⚠️ **Geste Marc** : activer
  « Maps Static API » sur le projet de la clé (sinon l'image répond 403 — l'`alt` le
  dit). L'OSM interactive ne sert plus que SANS clé (verrouillé par test refonte).
- **« je veux que ce soit indiqué clairement c'est quand la dernière update »** — badge
  `DerniereMaj` tout en haut de l'accueil : `recordedAt` le plus frais (jamais l'heure de
  réception), ton par `tonFraicheur` (ok < 90 min — rythme Toyota 30–60 min ; attention ;
  danger ≥ 6 h, ÉGAL au seuil de silence du summary, égalité verrouillée par test sans
  import croisé). Moins de 24 h → heure seule (la date complète débordait sur téléphone,
  capture à l'appui) ; `.maj .insigne` est le seul badge autorisé à replier.
- Harnais Playwright rejoué (desktop + mobile, 3 tons) après la correction du débordement.

## Correctifs post-étape 2 (17/08, nuit) : l'itinéraire des BOUCLES + les titres

Deux retours de Marc sur l'étape 2 déployée :

- **« marche pas, je vois que la destination pas le trajet »** — un trajet en BOUCLE
  (départ ≈ arrivée) donnait `origine = destination` à l'Embed `directions` : Google
  affichait UNE épingle, aucun tracé. La préparation des relevés vit désormais dans
  **`lib/itineraire.ts`** (pur, 8 tests) : dédoublonnage des relevés d'arrêt (< 120 m),
  étapes écartées trop près des ancres (< 150 m), **apex FORCÉ** quand on échantillonne
  (le relevé le plus loin de l'origine — sans lui, une boucle échantillonnée se referme
  au plus court ; prouvé par mutation), plafond 9 étapes réparties par position
  kilométrique. Boucle SANS relevé éloigné → repli honnête « sur place » (mode `place`
  + explication sous la carte), jamais une épingle muette. La légende d'honnêteté vit
  maintenant DANS `CarteGoogleItineraire`, à côté de l'iframe qu'elle décrit.
- **« enlève le hubperso.com · CarAI, juste un beau titre »** — le sur-titre `.eyebrow`
  est retiré des CINQ pages et du CSS ; le `h1` grossit (clamp 1,75→2,5 rem) et porte la
  barre d'accent dégradée en soulignement (même langage que les `h2`). Tripwires dans
  `tests/refonte.test.ts` (le sur-titre reviendrait par copier-coller d'une ancienne
  Coquille — chaque page a la sienne). Vérifié au harnais Playwright (desktop + mobile,
  titre court et long) + sonde des styles calculés du `::after`.

## Refonte — ÉTAPE 2 (17/08, nuit) : 4 écrans, fil mêlé, Commandes dissous

Huit réponses de plus (salves A/B — 24 au total). Livré :

- **Nav 4 écrans** : Accueil · Activité · Tendances · Réglages, icônes + libellés,
  **barre EN BAS fixe sur téléphone** (au pouce), en haut sur grand écran.
  `/trajets`, `/recharges` → `/activite` ; `/analyse` → `/tendances` ; `/commandes` → `/`
  (pages de redirection : les URL survivent, le test d'auth continue de les voir).
- **Activité** (`app/activite/page.tsx`) : FIL MÊLÉ par jour (`lib/vehicle/fil.ts`, pur,
  10 tests — un trajet se trie sur son ARRIVÉE, une recharge sur son DÉBUT ; frontière de
  jour dans le fuseau de Marc). Tuiles du mois en tête ($ mesuré/estimé jamais additionnés,
  ~kWh, trajets). Période défaut AUJOURD'HUI + sélecteur (jour · 24h · 7j · 30j · tout).
  Carte : le DERNIER trajet par défaut — **Google `directions`** quand la clé est là
  (itinéraire RECONSTITUÉ par Google entre les relevés réels, dit sous la carte — l'Embed
  ne dessine pas de polyligne), carte OSM interactive sinon et pour la vue d'ensemble
  (`?trajet=tous`). Panneau d'insignes sous la carte. Par trajet : heures/durée/distance +
  **~kWh et ~kWh/100** (SOC×capacité, `null` sur delta négatif) + **adresses lisibles**.
- **Géocodage inverse** (`lib/geocodage.ts` + table `geocode_cache`, migration 0004) :
  lieu de Marc D'ABORD (jamais son domicile vers Google), cache à VIE (clé lat,lng à 4
  décimales ≈ 11 m), Google borné à 20 lookups/page, pannes JAMAIS en cache. Libellé court
  voie+ville, jamais de numéro civique. **2ᵉ clé requise** : `GOOGLE_GEOCODING_KEY`
  (server-side, restreinte à la Geocoding API — la clé Embed, verrouillée au référent, ne
  marche pas du serveur). Sans elle : coordonnées, rien ne casse.
- **Commandes dissous** : la LIMITE DE CHARGE est un curseur 50–100 dans la feuille
  « Charge » du schéma ; le journal vit dans Réglages. Gardes serveur inchangées.
- **Réglages** : santé EN TÊTE (webhook · poll · lien Données en icônes-tap), puis bail,
  lieux, journal des commandes.
- **Tendances** = ex-Analyse retitrée (élagage signaux + tuiles conso/coûts par mois → étape 3).

## Refonte — 2ᵉ passe (17/08, nuit) : hotfix visuel + Google Maps + accueil dense

Retour de Marc sur l'étape 1, captures à l'appui : « texte fucké un peu partout », « le
bouton ⓘ beaucoup trop gros », « trop vide d'info », « je veux google maps », « pas de
texte pour la voiture, juste des couleurs/icônes ». Puis SEIZE réponses de cadrage (4
salves) qui fixent la cible de TOUTE l'app — voir tâches #6/#7.

### Les trois bugs à l'écran, et leurs verrous (`tests/refonte.test.ts`, 12 tests)

1. **Textes superposés** : mon composant de badges réutilisait la classe `pastille`, qui
   appartenait DÉJÀ aux puces de légende (rond de 0,6 em). La règle historique
   `width: 0.6em` restait la plus forte → badges de 0,6 em, textes empilés. Renommé
   `insigne` — même famille de bug que `tuile` vs `tuile-osm`, même remède, tripwire.
2. **ⓘ géant** : `.graphique svg { width: 100% }` attrapait l'icône du ⓘ. Règle scopée
   (`svg.graphe`, classe posée sur les 4 svg de `Graphique.tsx`) + taille du ⓘ ÉPINGLÉE
   dans `.itap`.
3. **Vérification VISUELLE désormais** : harnais HTML avec le vrai `globals.css`, capturé
   par Playwright (desktop + mobile) AVANT push — le gate ne voit pas un badge écrasé.

### Google Maps (choix de Marc : Embed API avec clé)

`app/ui/CarteGoogle.tsx` — iframe officiel, gratuit illimité. **Geste pour Marc** :
Google Cloud Console → activer « Maps Embed API » → créer une clé → Application
restrictions : HTTP referrers → `carai.hubperso.com/*` → poser `GOOGLE_MAPS_EMBED_KEY`
dans Vercel. ⚠️ La clé finit dans le HTML (modèle de l'Embed API) : sa protection est la
restriction de référent, pas le secret. Sans clé → repli carte OSM, rien ne casse.
Conséquence assumée par Marc au cadrage : la position part vers Google à l'affichage.

### L'accueil dense (2ᵉ passe)

- Sous la voiture : **icônes seules** (`IndicateursVoiture.tsx`) — verrou/ouvrants/pneus/
  synchro en ronds colorés, détail complet au tap. Zéro texte à l'écran.
- **Bandeau charge en cours** en tête quand `estimerFinCharge` a une réponse honnête.
- **Tuiles enrichies** : aujourd'hui (+ nb trajets), mois, budget %, **recharges du mois**
  (mesuré et ~estimé JAMAIS additionnés), **dernière recharge** (quand · lieu · ~kWh · $).
  Même chaîne de calcul que l'écran Recharges (reconstituerCharges → prixSession →
  totaliserPrix), fenêtres de mois/jour dans le fuseau de Marc.

## Refonte « style constructeur » — ÉTAPE 1 livrée (17/08, soir)

Marc : « gros retravail de l'affichage, j'aime pas, j'ai du mal à utiliser l'app, trop de
texte ». **Dix questions de cadrage posées, dix réponses** — chaque choix ci-dessous est
le sien : sobre type constructeur · **sombre assumé** (remplace « suivre le système »
pour CarAI) · icônes SVG, PAS d'emoji (son choix explicite malgré sa demande initiale) ·
hero = charge/autonomie + position (le bail passe après) · actions SUR le schéma ·
« pastilles + ⓘ » à la place des paragraphes · 4 écrans (étape 2) · défilement OK.

### Ce que l'étape 1 livre

- **Thème sombre unique** : plus aucun `@media (prefers-color-scheme)` dans
  `globals.css`, valeurs sombres promues dans `:root`, `themeColor`/manifest alignés
  (`#060911`, calculé de l'OKLCH). L'ancien clair est SUPPRIMÉ, pas caché.
- **`app/ui/Icones.tsx`** : ~18 icônes SVG au trait, grille 24×24, `currentColor`.
- **`app/ui/Pastille.tsx`** : `Pastille` (badge d'état), `PastilleAge`, `InfoTap` (ⓘ en
  `<details>` natif — l'explication COMPLÈTE reste accessible, repliée). Les explications
  des graphiques (`Graphique.tsx`, `GraphiquesLies.tsx`) passent par `InfoTap`.
- **Accueil refait** (`app/page.tsx`) : héros `HerosVoiture` = schéma PILOTABLE + jauge de
  charge géante + autonomie en très gros + **mini-carte de la dernière position** (tap →
  /trajets ; lien Maps = clic, jamais un appel auto). Le bail devient `BandeauBail`
  compact sous les tuiles. `PanneauVehicule` et les cadrans dupliqués ont disparu.
- **Le schéma se PILOTE** (`app/ui/SchemaInteractif.tsx`, client) : cadenas au centre du
  toit, prise à l'aile avant — tap → feuille de confirmation → action serveur PARTAGÉE
  `app/actions/commandes.ts` (extraite de la page Commandes ; mêmes gardes : session
  revérifiée, catalogue, confirmation re-validée serveur ; `origine` validée contre une
  table fermée, jamais une URL du formulaire). Résultat affiché depuis le JOURNAL
  (`/?envoi=<id>`).
  ⚠️ Le schéma arrive en `children` du composant client — l'importer directement aurait
  tiré la chaîne `schemaVehicule → alertes → analyse → db` dans le bundle navigateur.

### Reste à faire (étapes 2-3, tâches #6-#7)

1. **Navigation 4 écrans** : Accueil · Activité (trajets+recharges) · Tendances
   (analyse) · Réglages — barre en bas sur mobile, /donnees derrière une icône discrète.
2. Pastilles + ⓘ sur les écrans restants ; tuiles coûts du mois / dernière recharge sur
   l'accueil (données de /recharges).


## Webhook Smartcar — CarAI surveille enfin son canal principal (17/08)

Marc : « fais le webhook programmé chez Smartcar ». Ce qui a été livré, et ce qui ne pouvait
pas l'être — les deux comptent.

### ⚠️ Ce que l'API ne permet PAS (vérifié dans la spec, pas supposé)

La Management API n'expose **aucun `POST /webhooks`**, et `WebhookAttributes` ne porte
**aucun champ d'horaire** (ses champs requis : `name`, `callbackUri`, `isEnabled`,
`triggers`, `data`, `errorCallbackUri`, `autoSubscribe`). **Créer un webhook et choisir sa
fréquence se fait dans le tableau de bord Smartcar, à la main.** Aucun code ne peut le faire
à la place de Marc, et prétendre le contraire aurait produit un endpoint inventé de plus.

**➜ Geste qui reste à Marc**, une fois : tableau de bord Smartcar → Webhooks → créer/éditer
→ type **programmé** + fréquence, callback `https://carai.hubperso.com/api/webhooks/smartcar`,
sélectionner les signaux. Le reste (abonner le véhicule, vérifier) est automatisé ci-dessous.

### Ce que le code fait maintenant

Un panneau en **tête de `/donnees`** (au-dessus de la couverture des signaux — un canal mort
explique toutes les absences listées en dessous) lit l'état RÉEL et rend un verdict :

| Verdict | Ce que ça veut dire | Qui corrige |
|---|---|---|
| `sans_jeton` / `illisible` | CarAI n'a pas pu demander — **il ne prétend rien** | Marc (variable d'env) |
| `aucun_webhook` | rien n'existe côté Smartcar | Marc (tableau de bord) |
| `autre_hote` | le webhook livre à une AUTRE adresse (vieille préévisualisation) | Marc |
| `aucun_pour_carai` | des webhooks existent, aucun ne vise CarAI | Marc |
| `desactive` | **désactivé automatiquement après 6 échecs** (Doc 2 §6.4) | Marc |
| `non_souscrit` | tout est en place mais le véhicule n'est pas abonné | **CarAI, bouton** |
| `muet` | plus de livraison depuis trop longtemps | selon le type |
| `ok` | actif, abonné, livraisons fraîches | — |

`POST /subscriptions` est la **seule écriture** que l'API permette : le bouton « Abonner le
véhicule » l'utilise. ⚠️ Smartcar répond **202 « creation in progress »** — le message dit
« accepté », jamais « abonné », et l'état se relit ensuite (même piège que les commandes
véhicule le matin même, où un `FAILURE` niché dans un 202 avait été annoncé en succès).

### Le point qui évite les fausses alertes

Le TYPE de webhook n'est pas un champ de l'API : il se **déduit** de `triggers` (vide ⇒
programmé). Ça sert à UNE chose — nuancer la gravité d'un silence. Un webhook **événementiel**
muet huit heures sur une voiture garée est **normal** (constat du 11/08) ; un webhook
**programmé** muet six heures ne l'est pas. Deux seuils distincts, verrouillés par un test :
aligner les deux ferait disparaître la nuance en silence (prouvé par mutation).

Fichiers : `lib/smartcar/webhookEtat.ts` (verdict **pur**, 42 tests),
`lib/smartcar/management.ts` (accès API), `lib/smartcar/webhookDiagnostic.ts` (assemblage +
cache 5 min — `/donnees` se rafraîchit aux 30 s, sans cache c'était deux appels Smartcar par
demi-minute pour relire une config mensuelle ; les PANNES ne sont jamais mises en cache),
`app/donnees/webhook.tsx` (affichage). Doc : `docs/SMARTCAR_API.md` § Webhooks.

## Prix des recharges par lieu (13/08)

Marc : un tarif horaire à un endroit, le prix d'Hydro à la maison, et pour les autres bornes
trouver le fournisseur et estimer le prix.

⚠️ **Les adresses ne sont NULLE PART dans le dépôt.** Il est public. Les lieux et leurs
tarifs se saisissent dans **Réglages → Lieux de recharge** et vivent en base (clé `lieux`),
comme les termes du bail. `lib/vehicle/tarifsBornes.ts` ne contient que des formules et des
tarifs publics d'exploitants — aucune coordonnée personnelle, y compris dans les tests.

**Trois qualités de prix, qui ne se mélangent jamais** : `mesure` (tarif saisi par Marc),
`estime` (table publique des exploitants, ou repli sur son tarif du kWh), `inconnu` (montant
`null`, jamais zéro — zéro se lirait « gratuit »). L'écran affiche **deux totaux séparés**.

⚠️ J'avais recommandé de n'afficher AUCUN montant deviné ; Marc a tranché pour les tarifs
typiques codés en dur, en connaissance de cause. Le compromis tenu : chaque tarif typique est
**daté et sourcé** dans le code, l'estimation est étiquetée partout (`~`, italique), et un
tarif saisi par Marc l'écrase toujours.

⚠️ **Une borne HORAIRE se facture au temps branché, pas à l'énergie.** C'est le cas du
travail de Marc. Confondre les deux ferait payer une charge lente moins cher qu'une rapide.

### Le prix de la recharge rapide suit le DÉBIT (14/09)

Marc : « pour le prix de l'électricité je veux que ce soit par rapport au débit de charge ».

**Ce que faisait l'app avant**, mesuré en appelant le vrai code avec exactement ce que
passent les appelants de production : une recharge rapide de 50 kWh en 30 min (débit
100 kW) était facturée **3,91 $**, au tarif du kWh domestique. Son explication l'avouait
déjà — « cette borne facture peut-être autrement » — sans que le montant en tienne compte.
Le même cas rend maintenant **22,50 $**.

⚠️ **La table des exploitants était INATTEIGNABLE en production** : aucun des trois
appelants ne passe `exploitant`. Elle existe, elle est testée, elle n'a jamais servi. Elle
reste en place, mais ce n'est pas le chemin corrigé — le repli réel était le tarif d'Hydro.

**Comment ça marche** : `estimerBorne()` calculait déjà le débit (kWh ÷ h) sans que le prix
s'en serve. `palierRapide()` (dans `tarifsBornes.ts`) traduit ce débit en palier —
50 / 100 / 180 kW, les classes que Marc a demandées — et `prixSession` facture
`énergie × tarif du palier`. Ordre des sources inchangé et non négociable : **un lieu tarifé
par Marc gagne toujours**, même sur une charge rapide (charger vite chez soi reste facturé
au tarif de chez soi).

⚠️ **Les seuils sont DÉRIVÉS, pas choisis** : on classe sur un débit MESURÉ alors que les
paliers portent des puissances NOMINALES. La frontière neutre entre deux classes est leur
milieu — 75 kW entre 50 et 100, 140 kW entre 100 et 180. Écrire 100 et 180 aurait supposé
qu'une borne tient sa puissance nominale en moyenne sur toute la session, ce qu'aucune ne
fait.

⚠️⚠️ **Les tarifs par palier sont des ordres de grandeur DE MÉMOIRE, pas une grille
relevée.** La session n'a pas d'accès réseau vers le Circuit électrique ; Marc a choisi
cette option en connaissance de cause, après avertissement. Ce qui est SOLIDE est la forme
— le prix du kWh monte avec la puissance, et le rapide coûte plusieurs fois le domestique ;
ce qui est FRAGILE est chaque valeur. Le test ancre le RAPPORT et l'ORDRE, jamais les
montants. Les corriger : une seule table, `PALIERS_RAPIDE`.

⚠️ **Le débit mesuré SOUS-ESTIME la borne, et le biais est assumé.** C'est une moyenne sur
toute la session : une borne de 100 kW qui bride en fin de charge rend un débit moyen bien
plus bas. Le palier retenu est donc un minorant, donc le prix aussi — l'erreur va toujours
dans le même sens, on sous-facture, et c'est dit à l'écran.

⚠️ **Le paramètre `puissanceKw` est OPTIONNEL, donc un appelant peut cesser de le passer en
silence** et retomber sur le tarif domestique avec tous les tests au vert. Un scan de source
dans `tests/tarifsBornes.test.ts` vérifie que les **trois** appelants l'alimentent — c'est
le seul outil qui voie un appelant enfoui dans une page serveur.

### Le cumul « depuis le début », et la borne qui le rendait faux (14/09)

Marc : « je veux que ça fasse tout l'historique ».

**Ce qui manquait** : aucun écran ne montrait le total dépensé depuis le premier relevé —
l'accueil et Activité ne portent que le mois. Activité affiche désormais une troisième
tuile, **« Recharges depuis le début »**, avec son nombre de sessions, ses kWh et **sa date
de départ** (un « depuis le début » sans date ne dit pas depuis quand, et le début réel est
le premier relevé reçu, pas la signature du bail).

⚠️ **Et la période « tout » ne couvrait PAS tout.** `serieNumerique` borne à **4 000 points
par défaut**, fenêtre ancrée du côté récent. À 24-48 relevés par jour (Smartcar rafraîchit
aux 30-60 min), elle mord vers **3 à 5 mois de véhicule** — et ce sont alors les sessions
les plus VIEILLES qui disparaissent, c'est-à-dire précisément celles qu'un cumul doit
compter. Le bail a commencé le 14/07/2026 : la borne n'avait probablement pas encore mordu,
elle allait le faire, en silence. C'est la classe « une borne HAUTE sur une source qui CROÎT
fige l'UI EN SILENCE ».

Sans date de départ, la lecture passe donc à `LIMITE_HISTORIQUE_COMPLET` (**50 000**, soit
2,8 à 5,7 ans au pire débit — au-delà du bail). La borne reste : une requête sans borne sur
une table qui grandit pour toujours est une bombe à retardement.

⚠️ **Une SEULE définition de cette borne**, dans `lib/vehicle/analyse.ts`, importée par
l'écran ET par le connecteur MCP. Mon premier jet la recopiait aux deux endroits avec un
commentaire rappelant de les garder identiques — un commentaire qui réclame de la vigilance
est l'aveu qu'il manque une source unique. Deux valeurs différentes feraient répondre à
Claude un cumul qui n'est pas celui de l'écran.

⚠️ **La troncature se DIT** : `serieNumerique` rend `tronquee`, et la tuile affiche
« ⚠ historique tronqué, ce total sous-compte ». Un cumul amputé qui se présente comme
complet est pire qu'un chiffre absent.

⚠️ **Et `tronquee` est EXACT, pas prudent** : la requête lit `limite + 1` lignes et coupe en
mémoire. Avec `.limit(limite)`, une table contenant pile `limite` lignes est indiscernable
d'une table qui en contient davantage — il faudrait crier à chaque lecture pleine, et un
avertissement permanent est un avertissement mort. La ligne excédentaire coûte une ligne et
transforme la question en fait.

⚠️ Le compte se fait sur les lignes **LUES**, jamais sur les points rendus :
`filtrerPlausible` en écarte (sur `odometer`), donc compter les points dirait « pas de
troncature » sur une lecture pourtant bornée.

⚠️ `positionPendant` prend le dernier relevé **avant ou pendant** la session, jamais le
suivant : la bZ ne publie sa position qu'à l'arrêt, et le relevé qui suit une recharge est
souvent le stationnement d'ARRIVÉE du trajet suivant. « Le plus proche dans le temps »
apparierait la maison à une recharge faite au travail.

### Le filtre de dates d'Activité, et la courbe du cumul (14/09)

Marc : « je veux pouvoir voir le prix total, filtrer par date mois etc, et courbe aussi de
prix à rajouter ». Trois arbitrages pris avec lui : la courbe montre le **cumul qui monte**
(pas le prix de chaque recharge, pas des barres mensuelles — mesuré : l'historique commence
le 06/08, un graphe par mois n'aurait que deux barres) ; le filtre est **celui de Tendances,
réutilisé** ; les tuiles **suivent le filtre**, « depuis le début » restant le seul repère
fixe.

**Le filtre était déjà écrit.** `lib/vehicle/fenetre.ts` (13/08) fait raccourcis, jour précis
et plage — il n'était branché que sur Tendances, et son sélecteur était une fonction LOCALE
de cette page. Extrait dans `app/ui/SelecteurFenetre.tsx`, avec en paramètres ce qui diffère
d'un écran à l'autre : la destination, les raccourcis proposés, le défaut. Activité garde
« aujourd'hui » comme défaut (choix du 17/08) ; il a fallu l'ajouter à `fenetre.ts`, sous le
nom `aujourdhui` — et surtout PAS `jour`, que `ModeFenetre` emploie déjà pour « la plage dont
les deux bornes coïncident ».

⚠️ **UN BUG PRÉEXISTANT EST SORTI DE L'EXTRACTION** (corrigé, feu vert de Marc). Les
raccourcis de Tendances pointaient sur `/analyse`, l'ancien nom de l'écran. Or
`app/analyse/page.tsx` fait `redirect("/tendances")` — une chaîne littérale, donc **sans la
query string** : le `?periode=` était perdu en route, et cliquer « 7j » sur Tendances ne
faisait rien d'autre que recharger le défaut. Rien de rouge nulle part : la page s'affichait
parfaitement, avec la mauvaise fenêtre. D'où `base` en paramètre OBLIGATOIRE, et un test qui
compare cette `base` à la route RÉELLE du fichier appelant — dérivée de son chemin, jamais
d'une liste tenue à la main.

⚠️ **ET UN DÉFAUT DE MA PROPRE PASSE DE LA VEILLE.** Le cumul se calculait sur
`sessionsToutes` — mais la lecture était bornée par la période affichée (élargie au début du
mois pour les tuiles). `sessionsToutes` ne contenait donc pas toutes les sessions, seulement
toutes les sessions LUES : le cumul « depuis le début » **changeait quand on basculait le
sélecteur**, exactement ce que son commentaire promettait d'empêcher. Un nom qui ment
(« toutes ») sur une grandeur qui se veut un TOTAL est le pire des deux, parce que le chiffre
a l'air d'un cumul.

Corrigé en **séparant la lecture du filtre** : Activité lit désormais tout l'historique
(charges, états de charge ET positions), et la fenêtre ne s'applique qu'à l'affichage.
Mesuré avant de trancher : **661 relevés de charge, 669 positions, 1 257 d'odomètre** en base
— ~17 relevés de charge par jour depuis le 06/08, donc `LIMITE_HISTORIQUE_COMPLET` tient près
de huit ans à ce rythme.

⚠️ **Les positions suivent la même borne, et ce n'est pas un détail** : le prix d'une session
vient du LIEU, et le lieu vient de la position pendant la session. Lire les charges depuis
toujours mais les positions sur un mois ferait retomber toutes les vieilles sessions sur
« lieu non reconnu » — donc sans prix, donc un cumul sous-compté, avec une explication
plausible à l'écran.

⚠️ **La borne HAUTE n'existe que dans deux modes sur quatre**, et c'est précisément pour ça
qu'elle s'oublie. `instantDansLaFenetre` (PURE) la porte pour tout le monde — positions,
trajets, sessions — au lieu de laisser chaque filtre réécrire sa comparaison.

**La courbe** : `cumulerPrix` (PURE, dans `tarifsBornes.ts`) rend un point par recharge, du
plus ancien au plus récent, avec DEUX cumuls séparés — mesuré et estimé ne s'additionnent
jamais. Une courbe est pire qu'un total pour ça : on y lit une pente, une allure, sans jamais
revoir la note qui disait que la moitié est supposée.

⚠️ **Une recharge sans prix ne fait PAS de point**, et surtout pas un point à zéro : un
palier sur un cumul se lit « celle-là était gratuite ». Elles sont comptées à part et
l'écran le dit. Sur les données du 14/09, **8 recharges sur 27** sont dans ce cas.

⚠️ **Invariant verrouillé par test** : le dernier point de la courbe vaut exactement le total
de la tuile posée au-dessus. Les deux sont sur le même écran, nourris par les mêmes
sessions ; s'ils divergeaient, rien ne dirait lequel a raison. Le critère d'exclusion est
partagé (`prixExploitable`) au lieu d'être écrit deux fois.

⚠️ **La courbe suit le filtre**, comme les tuiles — d'où l'invariant ci-dessus. Et quand la
période n'a pas deux recharges chiffrées, l'écran DIT pourquoi et propose d'élargir : le
défaut d'Activité étant « aujourd'hui », un simple masquage aurait rendu la courbe invisible
la plupart du temps, ce qui se lit « la courbe n'existe pas ».

**Cibles tactiles** : mesurées au banc Chromium à 360 et 390 px, **9 des 13 cibles du
sélecteur étaient sous 44 px** (les cinq raccourcis à 31,8 px, les champs de date à 35,5,
« Afficher » à 34,1, « Effacer » à 22,5). C'était déjà vrai sur Tendances : le partage ne
crée pas ce défaut, il le rend visible, et une règle commune le corrige des deux côtés.
Après : **0 sur 13**, zéro débordement, les cinq raccourcis sur une ligne. Le padding est à
0,7rem parce que c'est la valeur mesurée qui les garde sur une ligne à 360 px. Prix assumé :
le sélecteur passe de 204 à 255 px de haut.

**Reste à faire** : la détection automatique de l'exploitant (FLO, Circuit électrique) via
OpenStreetMap. Marc l'a demandée ; `prixSession` accepte déjà un paramètre `exploitant`, il
n'a pas encore de source. ⚠️ C'est un appel réseau que je ne peux pas vérifier depuis le bac
à sable — il faudra le tester une fois déployé.


## Carte, accueil et échelle (13/08, second lot)

Six demandes de Marc en un message. Ce qui compte pour la suite :

### La carte : ce n'était pas la carte, c'était la refonte qui l'étirait

« Carte marche pas, y a des gros traits. » Elle se composait à **640×420** puis était étirée
à 100 % dans `.card-large` (**84 rem ≈ 1344 px**) : un agrandissement **×2**. D'où, en même
temps, des tuiles raster de 256 px affichées sur 512 (**floues**) et un `strokeWidth="7"`
rendu à **~14 px** — les « gros traits ».

⚠️ Deux correctifs, le second étant le durable : `vectorEffect="non-scaling-stroke"` sur les
tracés (l'épaisseur devient des pixels d'ÉCRAN — ce que faisaient déjà tous les graphiques de
l'app, la carte était la seule à ne pas le faire), et composition portée à **1280×620**
(`LARGEUR_DEFAUT`/`HAUTEUR_DEFAUT`), avec un tripwire qui interdit de redescendre sous 1024.

⚠️ La largeur d'une tuile était écrite **en CSS** (`calc(256 / 640 * 100%)`), le 640 en dur :
changer la taille de composition aurait décalé toutes les tuiles en silence. Elle se dérive
maintenant de `vue.largeur` côté composant.

### `lib/vehicle/etatSchema.ts` — l'état du véhicule, une seule définition

L'accueil montre désormais le schéma du véhicule (pressions des 4 roues, ouvrants,
verrouillage) plus charge, autonomie et dernière synchro. Cette construction vivait INLINE
dans l'onglet Analyse ; elle a été **extraite** avant d'être réutilisée — la recopier aurait
donné deux versions qui divergent par un bout (fenêtre de référence, repli du verrouillage,
fraîcheur retenue). Leçon JobAI appliquée telle quelle.

⚠️ La pression affichée est la **dernière disponible**, sans fenêtre (`etat.mesures`), et son
ÂGE se lit à côté. La fenêtre de 30 jours ne sert qu'à situer la DÉRIVE, jamais la valeur.

### Charge et autonomie dans UN graphique, sur DEUX échelles

`traceDouble` : deux séries d'unités différentes (% et km). Une échelle commune était
interdite (« jamais d'agrégat entre unités incomparables ») — 62 % et 240 km ne se comparent
pas. Chaque série garde son échelle, chaque bord porte son unité, et l'explication dit qu'un
croisement des deux traits ne veut rien dire.

⚠️ L'axe des **temps** est commun, calculé sur la réunion des deux séries. Projeter chacune
sur son propre intervalle les étirerait différemment : deux points côte à côte n'auraient pas
le même instant. Vérifié par MUTATION — la série courte doit finir à mi-largeur.

### Ce que la CAPTURE a trouvé, et que le gate ne pouvait pas voir

- Une fausse alerte de ma part : j'ai cru voir les pressions publiées en **pascals** sous une
  étiquette kPa. C'était ma fixture qui était fausse — les fixtures existantes (`282.68`) et
  les seuils (`ECART_PNEU_KPA = 20`) prouvent que la source publie des **kPa**. Vérifier
  avant d'accuser le code.
- « DÉVERROUILLÉE » se coupait en plein mot dans sa tuile → même vocabulaire que les tuiles
  du jour (`Fermée`/`OUVERTE`) ; c'est la couleur qui alerte, pas les majuscules.

### Échelle générale redescendue

« Un peu moins zoomé tout » : titre, verdict géant, tuiles, cadrans et rembourrage de carte
réduits d'environ 12 %. C'est l'ÉCART entre les tailles qui fait la hiérarchie, pas leur
valeur absolue — réduire les extrêmes la garde intacte.

### Carte de TOUS les trajets

Le défaut de `/trajets` est maintenant la vue d'ensemble (tous les stationnements de la
période), pas le dernier trajet : un seul trajet ne dit pas où on va d'habitude. Cliquer un
trajet cadre dessus, un lien ramène à l'ensemble. Toujours **une seule carte par page** — OSM
est bénévole.


## Refonte visuelle (13/08) — « on dirait un logiciel de gestion, c'est moche et plat »

Le diagnostic de Marc était juste, et « plat » en était la cause exacte : tout l'écran était
au même niveau — même fond, même bordure, même poids de texte, du titre au pied de page.
Rien ne disait quoi regarder en premier.

### Le système de design (`app/globals.css`, tokens réécrits)

Trois leviers, dans cet ordre d'importance : **hiérarchie** (échelle typographique large, un
chiffre de tableau de bord fait trois fois la taille de sa légende ; surfaces à plusieurs
profondeurs `bg` / `bg-2` / `surface` / `surface-2`), **couleur qui signifie** (l'accent
marque ce qui est vivant, les états gardent leurs teintes propres et ne se mélangent jamais
avec lui), **respiration** (élévation à trois marches plutôt qu'une ombre unique partout).

⚠️ Les deux thèmes restent pilotés par `prefers-color-scheme`. Le sombre n'est pas une
inversion mécanique : en sombre, une ombre portée ne se voit pas — c'est la LUMIÈRE du bord
haut qui détache une surface, et les tokens d'ombre le font.

### L'accueil — presque plus de texte

Deux sections titrées, deux listes de quatre chiffres et deux paragraphes d'explication ont
été remplacés par : un **héros** (l'écart au bail en très gros, la barre d'allocation, trois
**cadrans** circulaires — `app/ui/Jauge.tsx`), les alertes, et une rangée de **tuiles**.

⚠️ `AUTONOMIE_PLEINE_KM` est l'ÉCHELLE du cadran, comme le 8 000 d'un compte-tours — pas une
donnée du véhicule. Le nombre au centre reste la mesure réelle ; seule la longueur de l'arc
utilise ce repère. ⚠️ Une valeur absente ne dessine pas un anneau vide (qui se lirait
« batterie à plat ») : cadran gris en pointillé et « — ». ⚠️ `Barre` sait montrer un
DÉPASSEMENT — un cercle plein ne le peut pas, d'où deux composants et non un.

### La base de données sort de la barre d'onglets

Marc : « je veux qu'elle soit un peu cachée ». `/donnees` n'est plus dans `ONGLETS` ; elle
reste accessible depuis le pied de l'accueil et depuis l'Analyse. Ce n'est pas une
suppression : la route existe, elle est gardée (le test de découverte des pages le vérifie),
et son export sert toujours.

### Les trajets deviennent une FRISE

Fil vertical, une perle par trajet, et la distance devient une **barre proportionnelle au
plus long trajet de la journée** : on repère le trajet inhabituel sans lire un chiffre.

⚠️ **Défaut trouvé à la capture, pas au gate** : la barre et la durée partageaient la même
zone de grille (`grid-area: barre`), donc le texte s'écrivait PAR-DESSUS le trait. Ni le
typecheck, ni le lint, ni les 564 tests ne pouvaient le voir — seule l'image l'a montré.
Quatre zones distinctes désormais.

### Vérification

Composants RÉELS rendus (`renderToStaticMarkup` + le vrai `globals.css`), capturés au
Chromium en thème clair ET sombre.

### L'onglet Données trace enfin sa colonne (`[UI-16]`, même journée)

Marc : « uniquement des données en tableau Excel avec la possibilité de faire des graphs ».
Le tableau filtrable et l'export existaient ; il manquait la courbe. Elle s'insère **entre le
formulaire et le tableau** — on choisit, on voit, on lit le détail ligne à ligne — et
n'apparaît que si la métrique sélectionnée porte des valeurs NUMÉRIQUES.

⚠️ **Le geste est le filtre lui-même.** Pas de second réglage « tracer ceci » : la métrique
choisie dans le formulaire EST la courbe. Tracer « toutes les métriques » n'a volontairement
pas été offert — superposer des kilomètres, des pourcentages et des kilopascals sur un même
axe produit un dessin qui ne veut rien dire.

⚠️ **`serieNumerique` a reçu une option `source`.** Sans elle, filtrer par source aurait
rétréci le tableau pendant que la courbe aurait gardé TOUTES les sources : deux vérités sur
le même écran, et rien pour dire laquelle lire. La sélection de la courbe est désormais
identique à celle des lignes (métrique + source + période). Une source inconnue ne matche
rien — la courbe disparaît en même temps que les lignes, ce qui est honnête. Discrimination
du test prouvée par MUTATION (clause retirée ⇒ le test tombe), restauration par `cp`.

Métrique sans valeur numérique (état, position, signal refusé) : pas de courbe, et une phrase
qui DIT pourquoi. Le tableau, lui, reste complet. Zéro octet de JS client ajouté — `/donnees`
reste à 652 B, la courbe est du SVG serveur et le survol du CSS pur.


## Analyse interactive (13/08) — survol, fenêtre de temps, historique, déductions

Marc : « je veux pouvoir glisser la souris sur le graph pour voir les valeurs, sélectionner
la date ou la range ou le global, que les infos pneus/verrouillage/autonomie/charge soient
toujours à jour, un historique détaillé de toutes les données, et extrapoler — vas beaucoup
plus loin ».

### Le survol, sans une ligne de JavaScript

`bandesSurvol` découpe la largeur en colonnes, une par relevé, et le rendu est du HTML
positionné en POURCENTAGE par-dessus le SVG (`:hover` en CSS pur). Deux raisons : le SVG est
étiré (`preserveAspectRatio="none"`), donc tout texte à l'intérieur serait déformé ; et le
graphique reste ce qu'il a toujours été — du HTML rendu par le serveur, rien à hydrater.

⚠️ Les bandes ne sont PAS de largeur égale. Les relevés ne tombent pas à intervalle
régulier : des bandes égales décaleraient l'infobulle par rapport au point qu'elle décrit.
Chaque bande va de la mi-distance avec le précédent à la mi-distance avec le suivant.
Vérifié au navigateur avec une VRAIE souris (Playwright) : une seule bulle à la fois, et
elle bascule à gauche près du bord droit au lieu de sortir du cadre.

Compromis assumé : sur écran tactile il faut toucher plutôt que survoler.

### La fenêtre de temps — `lib/vehicle/fenetre.ts`

Raccourcis (24h/7j/30j/tout), plage `du`/`au`, et le JOUR précis comme cas où les deux
bornes coïncident — pas de troisième mode à comprendre. La sélection vit dans l'URL (GET),
donc elle se met en signet et survit au rafraîchissement de 30 s.

⚠️ **Le fuseau n'est pas un détail.** « 2026-08-13 » veut dire le 13 août CHEZ MARC. On
réutilise `debutDuJourLocal` plutôt que de recomposer un minuit local : deux façons de
calculer la même frontière divergent d'une heure au changement d'heure, une fois par an, et
personne ne le remarque avant des mois. Un test vérifie janvier (UTC−5) ET août (UTC−4).
⚠️ La borne de fin est EXCLUE et vaut minuit du LENDEMAIN : sélectionner le 13 doit inclure
toute la journée du 13. ⚠️ La lecture SQL ne connaît que la borne basse — `dansLaFenetre`
coupe la borne haute côté serveur, sinon une plage passée afficherait tout jusqu'à aujourd'hui.

### L'état « toujours à jour » — un vrai bug trouvé au passage

Les références de pression étaient lues **sur la période choisie**. Sélectionner « 24 h »
vidait donc la référence de chaque roue, et le schéma perdait sa détection de dérive au
moment précis où on zoomait. Elles sont maintenant lues sur une fenêtre FIXE de 30 jours,
indépendante du filtre — comme l'état courant, qui n'a jamais dépendu de la période.

### Les déductions — `lib/vehicle/deductions.ts`

La règle qui décide de ce qui entre : une déduction est légitime quand elle rend LISIBLE une
relation déjà contenue dans les mesures, pas quand elle comble un trou avec une hypothèse.

DEDANS : l'autonomie ANNONCÉE confrontée à celle que la consommation MESURÉE implique (deux
chiffres réels, et leur écart dit si la voiture est optimiste) ; les jours avant recharge au
rythme observé ; les km par jour de semaine (le dépassement vient-il du travail ou des fins
de semaine ? — ça change ce sur quoi on peut agir) ; la tendance de dégonflage par pneu avec
la date du seuil d'alerte.

DEHORS, et c'est écrit dans le fichier : estimer l'heure de départ depuis la distance et une
vitesse plausible (ce serait fabriquer la donnée manquante), un tarif « moyen » du kWh, une
courbe de dégradation de batterie sur trois semaines (on ne mesurerait que le bruit).

⚠️ **Le R² est le garde-fou central.** Une droite passe par n'importe quel nuage : sans lui
on annoncerait « −3 kPa/semaine » sur des mesures qui montent et descendent au hasard. En
dessous de `R2_MIN`, ou sous `DUREE_MIN_JOURS` d'observation, on ne conclut pas. Chaque
fonction rend `null` plutôt qu'un chiffre — une extrapolation n'est utile que si elle sait
se taire.

### L'historique détaillé

Replié sous CHAQUE courbe, avec l'écart au relevé précédent calculé (c'est lui qu'on
cherche ; une colonne de valeurs absolues oblige à soustraire de tête). Borné à 200 lignes,
avec renvoi vers l'export complet de `/donnees`.


## Deux défauts signalés DEUX FOIS (13/08) — heures de trajet, prix des recharges

Marc : « les heures pour les trajets sont toujours pas bonnes et le prix pour les recharges
marche toujours pas — sois plus précis et logique ». Les deux avaient déjà reçu un
correctif ; les deux correctifs étaient incomplets, chacun pour une raison différente et
instructive.

### 1. Les heures : le premier correctif ne mordait que les nuits de recharge

`affinerFenetre` (13/08, matin) resserrait le départ avec les relevés d'odomètre
intermédiaires — mais n'utilisait qu'UNE borne : le dernier relevé où le compteur n'avait
pas encore bougé. **Sur une nuit ordinaire, la voiture ne publie rien** : elle dort, il n'y
a aucun relevé intermédiaire, la boucle ne trouve rien, et le départ restait collé au ping
de la veille. Le correctif ne servait que les nuits où la voiture était réveillée pour
charger — c'est-à-dire celles où il servait le moins.

`bornerFenetre` ajoute la borne qui manquait : **le premier relevé où le compteur a DÉJÀ
bougé** prouve que le départ a eu lieu avant lui. Quatre bornes au lieu de deux
(`departAuPlusTot/AuPlusTard`, `arriveeAuPlusTot/AuPlusTard`), et `departIncertitudeMinutes`
porte la largeur de l'encadrement jusqu'à l'écran.

⚠️ **Et surtout : la limite est structurelle, donc on l'affiche au lieu de la masquer.**
Quand rien n'est publié de la nuit, l'heure de départ n'existe NULLE PART — ni en base, ni
chez Smartcar. Aucun calcul ne la retrouvera. L'écran affiche donc :

- l'**arrivée** en tête (elle, est mesurée : un ping `LAST_PARKED` est horodaté au moment où
  la voiture se gare) ;
- le départ comme un **intervalle explicite** (« départ entre 22 h 28 et 07 h 00 ») dès que
  l'incertitude dépasse `INCERTITUDE_MAX_MINUTES` (20 min, sous la cadence du poll) ;
- **aucune durée** dans ce cas — « durée inconnue » plutôt qu'un « 9 h 00 max. » qui faisait
  passer un trajet de vingt minutes pour une nuit de conduite.

Inventer une heure plausible depuis la distance et une vitesse moyenne aurait été la fausse
donnée classique. Tests : 8 nouveaux, **discrimination prouvée par mutation** (retirer la
borne haute fait tomber 3 tests).

### 2. Le prix : il n'existait aucun moyen de saisir le tarif

Le prix ne marchait pas, et ce n'était pas un bug de calcul — `reconstituerCharges` sait
multiplier des kWh par un tarif depuis le début. Le défaut était en amont : `tarifKwh` vit
dans la config (`CLE_BAIL`), et **rien dans toute l'application n'écrivait jamais cette
clé**. `ecrireConfig` n'était appelé que pour les identifiants Smartcar. Vérifié par grep
avant de coder quoi que ce soit.

C'est la leçon JobAI mot pour mot : *« une donnée qu'on ne peut ni fournir ni corriger n'est
pas une limite de produit, c'est un défaut »*. Refuser d'inventer un prix du kWh était juste ;
ne laisser aucun moyen de le fournir ne l'était pas. Les deux ensemble donnaient un écran
qui affiche « — » pour toujours.

**Nouvel écran `/reglages`** — les cinq chiffres qui décident de tout ce que CarAI peut
chiffrer : tarif du kWh, coût du km excédentaire, date de signature, durée, allocation,
odomètre à la signature. Validation pure et testée (`lib/vehicle/reglages.ts`, 15 tests).

⚠️ **VIDE ≠ ZÉRO.** `Number("")` vaut 0 — le même piège que `Number(null)` trouvé la veille
dans le schéma du véhicule, sous un autre visage. Un champ effacé rend `null` (« inconnu »,
les montants disparaissent) ; un `0` saisi reste `0` (« c'est gratuit »). Ce sont deux
réponses différentes et le parseur les distingue.

⚠️ La Server Action **revérifie la session** : une action est un point d'entrée POST à part
entière, et s'appuyer sur le fait que le formulaire n'est affiché qu'aux gens connectés
reviendrait à vérifier à l'AFFICHAGE ce qui doit l'être à l'ÉCRITURE.

### Filet ajouté au passage : les pages sont gardées par DÉCOUVERTE

`tests/auth.test.ts` énumère désormais les `page.tsx` depuis `app/` et exige qu'aucune ne
soit publique (sauf `/login`). Une liste écrite à la main aurait vieilli en silence ; le
risque n'est jamais la page qu'on écrit aujourd'hui, c'est la sixième.


## Refonte de l'onglet Analyse (13/08) — le schéma remplace la liste des variables

Marc : « améliore grandement la partie analyse — des explications, des graphs clairs, des
variables logiques, des images pour les pneus et pour tout ce qui serait pertinent ; clair,
simple, concis, beau à voir et utile ; enlève tout le texte inutile et la liste des variables ».

### Ce qui a été RETIRÉ, et pourquoi

- **Les quatre listes de signaux** (« qui fonctionnent », « à débloquer », « non fournis par
  la bZ », « refusés sans motif ») + « réponses sans valeur ». C'était LA « liste des
  variables ». Elles répondaient à une question d'INTÉGRATION (« Smartcar me sert-il ce
  code ? »), pas à une question sur la voiture. Cette question garde sa place — dans
  `/donnees`, qui porte déjà la couverture des signaux confirmés, les refus (`?tout=1`) et
  le journal des livraisons. Vérifié avant d'écrire le renvoi, plutôt que promis.
- **Le dépliage des métriques structurées** en tableaux `chemin → valeur` (portières, vitres,
  minuteries) et **les frises de bascules booléennes**. Le schéma les montre mieux : une
  portière ouverte se voit, elle ne se lit pas dans `values.2.isOpen = true`.
- **Les paragraphes sur la mécanique interne** (« rendu côté serveur », « la liste vient de
  la base »). Vrai, mais ça n'aide Marc à décider de rien.

### Ce qui a été AJOUTÉ

- **`app/ui/SchemaVehicule.tsx`** — la voiture vue de dessus, peinte par ses propres mesures :
  quatre roues à leur vraie position avec leur pression (kPa **et psi** — le psi est l'unité
  des pompes à air d'ici), portières/vitres ouvertes en évidence, verrouillage au centre.
  La logique est dans **`lib/vehicle/schemaVehicule.ts`**, PURE et testée (22 tests) : le
  composant ne fait que dessiner ce que ces fonctions décident.
- **`traceMulti`** (`lib/vehicle/analyse.ts`) — plusieurs séries sur un axe COMMUN, avec
  `GraphiqueMulti`. Les quatre pneus étaient tracés séparément, chacun avec SON axe : deux
  roues à 240 et 205 kPa donnaient deux courbes d'allure identique, l'axe indépendant
  EFFAÇAIT l'écart — c'est-à-dire la seule chose qu'on regarde sur des pneus.
- **Une phrase d'explication sous chaque courbe** (`explication`, table `EXPLICATIONS`) :
  ce que la courbe DIT, pas comment elle est faite.

### Trois décisions qui tiennent le module honnête

1. **Les seuils ne sont pas réinventés** : `schemaVehicule.ts` IMPORTE `ECART_PNEU_KPA` et
   `BAISSE_PNEU_KPA` de `alertes.ts`. Une roue peinte en rouge ici alors qu'aucune alerte ne
   tombe sur l'accueil (ou l'inverse) détruirait la confiance dans les deux écrans à la fois.
   Les tests dérivent leurs cas des CONSTANTES, jamais d'un « 20 » recopié.
2. **Une roue sans mesure est GRISE, jamais verte.** Sur un schéma, l'absence de couleur
   d'alerte se lit « tout va bien » — c'est exactement le chiffre inventé qu'on s'interdit.
3. **Une position n'est jamais devinée.** ⚠️ Bug trouvé PAR SON TEST : `Number(null)` vaut
   **0**, donc un champ `row` absent devenait « avant » et le module inventait la position
   qu'il promet de ne jamais deviner. Corrigé par un `coordonnee()` qui n'accepte qu'un vrai
   nombre ou une chaîne numérique. Un ouvrant non situé est COMPTÉ à côté du schéma, pas
   colorié au hasard.

⚠️ **La DÉCOUVERTE reste faite depuis la base** (`metriquesDisponibles`). Une liste de
courbes écrite à la main a toujours les deux mêmes défauts en même temps — promettre ce qui
n'existe pas et ignorer ce qui existe (leçon `SERIES_ANALYSE`, 12/08 : six de ses dix entrées
visaient des signaux que la bZ refuse). Une métrique numérique nouvelle apparaît donc encore
toute seule ; elle n'aura simplement pas de phrase d'explication tant qu'on ne lui en aura
pas écrit une. Seules les séries NUMÉRIQUES deviennent des courbes.

### Vérification visuelle — le vrai composant, pas une maquette

Les composants ont été rendus par `renderToStaticMarkup` avec le VRAI `app/globals.css`, puis
capturés au Chromium pré-installé en thème clair ET sombre. Deux défauts que ni le typecheck,
ni le lint, ni les 491 tests ne pouvaient voir :

- « pas de relevé » écrit sous les quatre roues : les libellés gauche et droite se
  CHEVAUCHAIENT au milieu du capot (« paspdeasrelevé »). La seconde ligne n'existe désormais
  que s'il y a une mesure — le tiret et la roue en pointillé disent déjà l'absence ;
- le pare-brise et la lunette arrière étaient trop peu contrastés pour donner un SENS à la
  silhouette. Sans eux, un rectangle à quatre roues n'a ni avant ni arrière, et le schéma ne
  sert plus à situer une roue.

⚠️ Non vérifié dans l'app réelle authentifiée (ce bac à sable n'a ni `DATABASE_URL` ni les
identifiants Google/Smartcar) : le rendu avec de VRAIES données reste à confirmer par Marc.


## ⚠️ Intégration Git muette, DE NOUVEAU — Vercel Pro n'y change rien (13/08, ~15h05-15h20 UTC)

Les PR #35 (ce fichier) et #36 (connexion unique) ont mergé à 20 secondes d'écart
(15:05:13 et 15:05:27 UTC). **Aucun déploiement — ni preview, ni production — n'a été créé
pour aucun des deux commits**, vérifié à plusieurs reprises sur ~15 minutes
(`mcp__Vercel__list_deployments`, projet `car-ai`). Le dernier déploiement connu du projet
restait un preview d'AVANT ces merges.

Marc a pris **Vercel Pro** pendant l'attente, en pensant au quota gratuit (100
déploiements/jour) déjà épuisé une fois aujourd'hui sur ce compte. **Ça n'a rien débloqué** :
toujours aucun déploiement après l'upgrade. Ça élimine le quota comme cause ICI — un blocage
de quota laisse une trace explicite (`Resource is limited...`, vu ailleurs aujourd'hui sur
BatchChef), alors qu'ici il n'y a même pas de TENTATIVE enregistrée. C'est donc la même panne
que le 31/07 (« l'intégration Git n'a rien reçu ») qui se reproduit, pas un problème de plafond.

**Rattrapage appliqué** : ce commit lui-même. Un nouveau push sur `main` est la seule façon
connue de relancer le webhook sans dashboard (cf. l'entrée du 13/08 00h14 plus bas). À
vérifier après ce merge : un déploiement `target: production` apparaît-il enfin pour ce SHA ?
Si NON, le rattrapage manuel (Vercel → Settings → Git, vérifier que l'intégration GitHub est
toujours connectée / reconnecter) devient nécessaire — geste que seul Marc peut faire.

## Quatre retours de Marc (13/08) — texte, heures de trajet, type de borne, pleine largeur

Un seul message : « beaucoup trop de texte », les heures de trajet ne sont jamais les
bonnes (parti à 6 h 50 le 13/08, l'app montrait la fenêtre de stationnement qui l'encadre),
pour la charge récupérer plus d'info ou au moins le type de borne + un prix, et utiliser
tout l'espace disponible.

### Les heures de trajet — resserrées par l'odomètre, jamais devinées

Le symptôme n'était pas un bug de fuseau : un trajet-FENÊTRE affiche les deux instants de
STATIONNEMENT qui l'encadrent, pas le moment réel où la voiture s'est mise à rouler — d'où
« 22 h 28 → 8 h 05 » pour un départ réel à 6 h 50.

`affinerFenetre` (`lib/vehicle/trajets.ts`) resserre ces bornes avec les relevés d'odomètre
**intermédiaires**, quand il y en a : tant qu'une lecture égale l'odomètre de départ, le
trajet n'a pas commencé, la borne avance jusqu'à elle — symétrique côté arrivée. Sans
lecture intermédiaire, aucun changement : jamais un resserrement deviné. PURE, testée (6
tests unitaires + 1 test d'intégration bout-en-bout dans `decouperTrajets`), et elle ne
peut par construction QUE resserrer, jamais élargir.

⚠️ `dureeEstFenetre` et `vitesseMoyenne` gardent leur sémantique d'avant : même resserrée,
une fenêtre reste marquée « max. » et ne produit pas de vitesse moyenne — resserrer l'HEURE
affichée n'affirme pas une DURÉE exacte.

### Le type de borne, jamais le prix sans tarif

`charge-wattage`/`-amperage`/`-voltage` restent `ERROR (COMPATIBILITY)` — rien de plus à
récupérer de Smartcar pour de vrais graphiques de puissance. `estimerBorne`
(`lib/vehicle/charges.ts`) déduit la puissance implicite (kWh ÷ heures) et classe par bande
d'usage : Niveau 1 (< 2,5 kW), Niveau 2 (2,5-20 kW), Rapide DC (≥ 20 kW) — des bandes de
l'industrie, pas une invention. Colonne « Borne » sur `/recharges`, préfixée `≥` quand la
durée elle-même est une fenêtre estimée (`bornesEstimees`) : la puissance calculée n'est
alors qu'un MINORANT, la vraie borne ne peut être que plus rapide.

⚠️ **Aucun prix n'en sort.** Marc a demandé « estimer le prix » — mais un prix déduit du
SEUL type de borne serait un tarif générique présenté comme le sien, exactement la fausse
donnée que `coût` refuse déjà de produire sans `tarifKwh` (le commentaire d'origine du
fichier le disait déjà : « le prix du kWh d'Hydro-Québec est public, mais dépend du palier,
de l'abonnement et de la date »). `[COUT-01]` reste donc le seul chemin vers un vrai
montant — inchangé par ce tour.

Ajouté aussi : un graphique d'énergie par recharge sur `/recharges` (même composant
`Graphique` que l'accueil/l'analyse — un point par session chiffrée, chronologique).

### Le doublon « limites » sur l'accueil

Confirmé par la capture d'écran de Marc : la boîte « Tarif au km excédentaire inconnu… »
apparaissait deux fois d'affilée. Cause : `GraphiqueBail` rend déjà `limites` en interne
(`app/ui/Graphique.tsx`), et `app/page.tsx` la rendait une seconde fois juste en dessous —
les deux viennent du même `calculerEtatBail`, donc littéralement le même texte. Le repli
externe ne s'affiche plus que quand `GraphiqueBail` n'a PAS pu se tracer (`!grapheBail`).

### Moins de texte, partout

Densité réduite sur l'accueil, `/trajets` et `/recharges` : hints raccourcis à l'essentiel,
plusieurs explications déplacées en `title` (infobulle) plutôt qu'affichées en permanence.
Rien de retiré côté honnêteté — chaque limite reste dite, juste plus courte ou accessible
au survol plutôt qu'imposée à la lecture.

### Toute l'app utilise l'espace disponible

`app/page.tsx` était la SEULE page encore sur la carte étroite (`.card`, 34 rem) — les
quatre autres (`/trajets`, `/recharges`, `/analyse`, `/donnees`) utilisaient déjà
`.card-large`. Elle bascule dessus, et `.card-large` passe de 56 rem à 84 rem. Les
graphiques (`.graphique svg`) passent d'une hauteur fixe (190px) à `clamp(190px, 22vw,
320px)` : à 84 rem de large, une hauteur figée aurait aplati les courbes
(`preserveAspectRatio="none"` les étire dans les deux sens).

⚠️ Vérifié visuellement (mockup HTML statique important le vrai `globals.css`, capturé au
Chromium pré-installé à 1600/900/420 px de large) : aucune régression de mise en page aux
trois gabarits — mais **pas testé dans l'app réelle authentifiée** : ce bac à sable n'a ni
`DATABASE_URL` ni les identifiants Google/Smartcar, donc chaque page y rend sa branche
« panne de configuration », pas son contenu réel.

### Gate

`npm run typecheck && npm run lint && npm run test && npm run build` verts — 446 tests
(dont les nouveaux : 6 `affinerFenetre` + 1 intégration dans `decouperTrajets`, 12
`estimerBorne`/`libelleEstimationBorne`).

## ✅ Rattrapage du quota — MAIS un piège à part vérifié en le trouvant (13/08, 00h14 UTC)

Suite de l'entrée ci-dessous. Deux faits mesurés au réveil du rappel programmé :

1. **Le quota s'est rouvert bien avant les 24 h annoncées.** Un déploiement de production a
   RÉUSSI dès 20h32 UTC — vingt minutes après le blocage de 20h12, pas vingt-quatre heures.
   Le message d'erreur de Vercel donne une borne prudente, pas la vraie fenêtre.
2. **Mais ce déploiement ne sert PAS le dernier code.** Ses métadonnées le confirment :
   `"action": "redeploy", "originalDeploymentId": "dpl_9oL5…"`, commit `797f6db` (PR #30) —
   quelqu'un a cliqué *Redeploy* sur le DERNIER déploiement de production existant, et
   Vercel a REJOUÉ SON COMMIT D'ORIGINE, pas le HEAD actuel de `main`. C'est exactement la
   leçon déjà écrite chez JobAI (« *Redeploy* rejoue le commit du déploiement existant, PAS
   le dernier commit ») — vécue ici pour la première fois dans CarAI, avant même d'avoir eu
   le temps de l'appliquer depuis qu'elle a été notée hier.

**Le signal qui l'a révélé** : `carai.hubperso.com` était `READY`, en production, sans
aucune ligne rouge — et pourtant deux PR de retard (`ec48f4c`, `9943465`). Un déploiement
`READY` ne prouve donc PAS qu'il sert le bon commit ; il faut lire `githubCommitSha` dans
ses métadonnées et le comparer au HEAD réel de `main`, jamais se fier à l'état seul.

**Correctif** : un nouveau commit (celui-ci) pousse une vraie mise à jour de `main`, ce qui
déclenche un déploiement lié au GIT REF plutôt qu'un rejeu d'un ancien déploiement — la
seule façon fiable de faire avancer la production au bon commit sans dashboard.

⚠️ **Piège de session, troisième occurrence** : le conteneur a de nouveau réinitialisé le
workspace local pendant l'attente du rappel (HEAD retombé sur un commit d'il y a plusieurs
jours, `smartcar-poll.yml` absent du disque). Rien n'était perdu — `origin/main` faisait
foi — mais le réflexe reste le même à chaque fois : `git fetch` + comparer avant de croire
qu'un fichier a disparu.

## ⚠️ Quota Vercel épuisé (12/08, 20h12 UTC) — PRODUCTION FIGÉE sur `797f6db`

Le compte Vercel gratuit plafonne à **100 déploiements/jour**, PARTAGÉ entre les six projets
de l'écosystème. Épuisé ce soir : `MoKarade/CarAI#32` a été mergée (CI GitHub verte —
typecheck, lint, tests, build) mais **aucun déploiement n'a pu être créé**, ni preview ni
production. Le message Vercel : `Resource is limited - try again in 24 hours (code:
"api-deployments-free-per-day")`.

⚠️ **Ce n'était pas un incident subi, c'est un coût auto-infligé.** Chaque vérification
« est-ce déployé ? » de cette session a interrogé l'API Vercel, mais c'est surtout le rythme
des PUSH qui a consommé le quota : neuf commits distincts poussés dans la soirée (trajets,
carte, jour du trajet, recharges, accueil), chacun générant AU MOINS un déploiement preview
sur la branche PUIS un déploiement de production au merge — 2 déploiements par correctif,
sans compter les re-déclenchements manuels faits pour vérifier le re-Connect. C'est
exactement la leçon déjà écrite chez JobAI (« un quota de déploiement est une ressource
PARTAGÉE, et pousser à chaque correctif la brûle ») — pas encore appliquée ici.

**Conséquence concrète** : `carai.hubperso.com` sert `797f6db` (PR #30, les recharges) —
PAS `ec48f4c` (PR #32, l'accueil sans liste brute + les deux graphes) — jusqu'à ce que le
quota se libère. `git log origin/main` et ce que sert le domaine peuvent donc diverger
pendant des heures sans qu'aucune ligne ne soit rouge nulle part (même famille que la
leçon du 31/07 sur les intégrations Git qui cessent de déployer en silence — ici la cause
est visible, mais l'effet est identique : `main` en avance sur ce qui est en ligne).

**Ce qui a été fait en réponse** : PAS de nouvelle tentative de déploiement après l'échec —
retenter échoue à l'identique tant que le quota n'est pas revenu, et chaque appel API
supplémentaire n'aide personne. La règle pour la suite de cette session ET les prochaines :

- **Grouper les correctifs** avant de pousser, au lieu d'un commit-push-vérification par
  bug trouvé. Un retour de Marc peut attendre d'être groupé avec le suivant si les deux
  arrivent à quelques minutes d'écart — la CI locale (`npm run typecheck && lint && test &&
  build`) donne déjà la confiance qu'il faut avant de pousser, sans consommer le quota.
- **Vérifier le déploiement UNE fois par lot**, pas après chaque commit individuel.
- **Rattrapage** : dès que le quota se libère (24 h, ou plus tôt si la fenêtre de Vercel
  n'est pas glissante), soit Marc relance manuellement (*Deployments* → dernier de `main` →
  *Redeploy*), soit la prochaine session pousse un commit qui redéclenche naturellement.
  Vérifier ALORS que la production sert bien `ec48f4c` ou plus récent — pas seulement que
  `main` le contient.

## L'accueil redevient visuel (12/08, tard) — deux graphes remplacent la liste brute

Marc : « enlève toutes les mesures de la page d'accueil, rajoute des graphs de l'onglet
analyse, pas tous mais améliore-les visuellement ».

- **Retiré** : la section « Toutes les mesures » (`<ul className="mesures">`), le dump
  brut de chaque signal connu — pneus, portières, etc. C'était le nom exact de la section
  que Marc visait ; les trois moments au-dessus (`AvantDePartir`, `PointDuSoir`,
  `VerdictBail`) restent, ce sont des RÉPONSES, pas des mesures brutes.
- **Ajouté** : deux graphes, choisis pour répondre aux questions déjà posées sur l'écran —
  la charge des 14 derniers jours sous « Avant de partir », le kilométrage vs allocation du
  bail sous « Vais-je payer ? ». Pas les autres (pneus, portières…) : ceux-là restent dans
  l'onglet Analyse, qui a son sélecteur de période, ce que l'accueil n'a jamais eu.
- **Le rendu est désormais PARTAGÉ** entre les deux écrans : `Graphique` et `GraphiqueBail`
  ont déménagé d'`app/analyse/page.tsx` vers `app/ui/Graphique.tsx`. Une seule définition,
  deux consommateurs — l'amélioration visuelle profite donc aussi à l'onglet Analyse.
- **L'amélioration visuelle** : dégradé sous la courbe (`aireSvg`, PURE, testée — referme
  la même polyline sur la ligne de base, ne peut donc jamais dessiner une forme différente
  de la courbe qu'elle habille ; purement décoratif, aucun chiffre n'en dépend), traits aux
  extrémités arrondies, carte plus haute et plus respirante (ombre intérieure, coins plus
  ronds). Rien de tout ça ne change une valeur affichée — seuls `reperes` et les axes
  textuels portent les chiffres, comme avant.

## Où en est le projet

**Le POLL périodique est en production, et c'est le changement majeur du 12/08.**

Diagnostic qui l'a motivé : le webhook ne se déclenche que sur `SIGNAL_UPDATED` — un
CHANGEMENT, pas une lecture. Le tableau de bord Smartcar l'a montré noir sur blanc sur un
même signal : « Smartcar retrieved at 20:52 » (Smartcar interroge bien la bZ) mais
« Vehicle updated at 17:05 » (la donnée n'a pas bougé). Voiture stationnée ⇒ zéro
livraison pendant des heures. Rien n'était cassé ; CarAI n'apprenait simplement plus rien.

⚠️ **Piège de diagnostic à ne pas refaire** : les logs d'exécution Vercel (plan Hobby) ont
une rétention TRÈS courte. Une requête qui rend « aucun log » ne prouve PAS qu'aucune
livraison n'est arrivée — j'en ai conclu à tort « plus rien depuis 4 jours », alors que le
tableau de bord Smartcar montrait des livraisons `200 OK` le jour même. Vérifier la
DESTINATION (la base, `/donnees`) ou la source (dashboard Smartcar), jamais l'absence de
trace dans un journal éphémère.

`GET /api/cron/smartcar-poll` (garde `CRON_SECRET`) + workflow GitHub Actions toutes les
30 min — le plan Vercel Hobby ne permet que du quotidien. Mesuré en production le 12/08 :
`74 signal(aux) lu(s) (9 SUCCESS, 65 en échec), 0 mesure(s) écrite(s), 58 refus déjà
connu(s) écarté(s)`.

Deux défauts trouvés PAR LA MESURE et corrigés le jour même :
1. `normaliserSignal` ne lisait `code`/`status` qu'à la racine ; la réponse de l'API les
   place sous `attributes`. Le poll aurait écrit **zéro mesure, en silence**.
2. Un signal refusé n'a aucun horodatage du véhicule ⇒ `recordedAt` retombait sur
   l'instant de lecture ⇒ 58 lignes vides écrites à CHAQUE poll (~2 800/jour). Une ligne
   sans valeur n'est désormais écrite que si son statut a CHANGÉ (transitions gardées,
   répétitions écartées et COMPTÉES).

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
rafraîchissement automatique 30 s. Les positions sont rendues en COORDONNÉES lisibles
(détection par CONTENU, quatre signaux indépendants : un code de position inconnu est
reconnu quand même et ne tombe pas en JSON tronqué).

## Le verdict des 84 signaux (livraison LIVE du 12/08 14:27 UTC, voiture en marche)

Le compte est exact — 16 + 52 + 15 + 1 = 84. Il ne se retranscrit plus à la main : l'onglet
**Analyse** le recalcule depuis la base à chaque rendu, refus SÉPARÉS PAR MOTIF parce que
les trois appellent des gestes opposés.

| Famille | Nb | Ce qu'on en fait |
|---|---|---|
| `SUCCESS` | 16 | rien, ça marche |
| `ERROR (COMPATIBILITY)` | 52 | **à décocher** — la bZ ne les produira jamais |
| `ERROR (PERMISSION)` | 15 | **à récupérer** par un re-Connect avec les scopes ; surtout ne pas décocher |
| `ERROR (UPSTREAM)` | 1 | `service-records`, panne passagère Toyota — ne rien faire |

Les 16 qui marchent : `charge-chargetimers`, `charge-detailedchargingstatus`,
`charge-ischarging`, `charge-ischargingcableconnected`, `charge-ischargingportflapopen`,
`charge-timetocomplete`, `closure-doors`, `closure-enginecover`, `closure-islocked`,
`closure-windows`, `location-preciselocation`, `odometer-traveleddistance`,
`tractionbattery-nominalcapacity`, `tractionbattery-range`,
`tractionbattery-stateofcharge`, `wheel-tires`.

⚠️ La clim se joue en DEUX morceaux qu'il ne faut pas confondre : `hvac-*` (5) est
`PERMISSION` — **récupérable**, tandis que `climate-internaltemperature` /
`climate-externaltemperature` sont `COMPATIBILITY` — perdus. Dire « la clim est
indisponible » était faux ; seules les températures le sont.

## La projection du bail sous-estimait le dépassement (trouvé le 12/08 par la tuile hub)

La tuile annonçait un dépassement projeté très inférieur à celui que le kilométrage depuis la
signature laissait attendre. Ni l'un ni l'autre n'était un bug de calcul : la régression ne
voit que l'historique de CarAI (à partir du 6 août), soit **6 jours** sur les **29** de bail
écoulés — et cette fenêtre-là était plus calme que la moyenne depuis la signature. Projeté
sur quatre ans, l'écart vaut des dizaines de milliers de km.

Correctif : `bail.kilometrageInitial` (odomètre au contrat, nullable). Renseigné, il ancre
la régression sur la date de signature et la projection porte sur TOUT le bail. Absent, la
limite est NOMMÉE dans `EtatBail.limites` et affichée sous le graphique — un chiffre
incomplet qui ne le dit pas est indiscernable d'un chiffre solide.

## L'affichage vient de la BASE, plus d'une liste écrite d'avance (12/08)

L'onglet Analyse portait `SERIES_ANALYSE`, dix métriques à tracer écrites à la main. Le
verdict des 84 l'a condamnée : **six des dix** (températures, ampérage, tension, puissance
de charge, batterie 12 V) sont refusées par la bZ — l'app réservait des graphiques à des
données qui n'arriveront jamais, pendant que `wheel-tires`, `closure-doors`,
`closure-windows`, `charge-chargetimers` et `charge-detailedchargingstatus` n'avaient
aucune place alors que la donnée était là depuis le début. Une liste à la main a toujours
les deux défauts en même temps : elle promet ce qui n'existe pas et ignore ce qui existe.

`metriquesDisponibles()` interroge la base (« quelles métriques, de quelle forme ? ») et le
visuel se choisit sur la FORME :

| Forme | Visuel | Exemples |
|---|---|---|
| `numerique` | courbe SVG, décimales déduites de l'amplitude (`decimalesPour`) | charge, autonomie, odomètre |
| `etat` | frise des CHANGEMENTS + état courant (`serieEtat`) | verrouillage, câble branché, statut de charge |
| `structure` | tableau du dernier relevé déplié (`aplatirJson`) | portières, vitres, minuteries |
| position | tracé du trajet à l'échelle (`traceTrajet`) | `location-preciselocation` |

Deux métriques gardent un rendu DÉDIÉ plutôt que le générique, parce qu'elles ont mieux :
les pneus (une courbe PAR ROUE — une moyenne masquerait le pneu qui se dégonfle) et la
position (un plan, pas un tableau de chiffres).

## Le GPS est affiché depuis le 12/08 — et ce qui l'encadre

Les coordonnées étaient enregistrées mais masquées à l'écran (« position (voir export
CSV) »). **Marc a levé cette réserve** : c'est sa voiture, dans son app privée derrière le
login du hub ; refuser de lui montrer sa propre position ne le protégeait de personne.
(À noter depuis l'étape 2 de l'ADR 0001 : l'app n'est plus réservée à une seule adresse.
Accorder `carai` à quelqu'un dans `hubperso.com/administration` lui donne donc aussi la
POSITION du véhicule — c'est le genre d'accès qu'on accorde en le sachant.) `/donnees` affiche les coordonnées, `/analyse` trace le trajet.

Ce qui reste vrai et ne bouge pas :

- **Aucune position ne sort** vers le hub ni vers un tiers — le contrat `hub-contract` n'en
  porte aucune.
- ⚠️ **CETTE LIGNE A CHANGÉ LE 12/08 AU SOIR.** Elle disait « le tracé est rendu côté
  serveur, SANS fond de carte : afficher la page n'envoie aucune position à un service de
  cartographie ». Ce n'est plus vrai : Marc a demandé les vraies rues, et la carte
  (`app/ui/Carte.tsx`) demande des tuiles à openstreetmap.org — leurs coordonnées révèlent
  approximativement où on regarde. Le CALCUL du tracé reste côté serveur, mais le FOND
  vient d'un tiers. C'était un arbitrage explicite, pas un glissement.
- **Rien n'est deviné** : `coordonneesDuJson` refuse un couple incomplet ou hors bornes
  plutôt que de retomber sur (0, 0) — le golfe de Guinée est la fausse position classique.
- La projection **corrige la longitude par `cos(latitude)`** : à 46,8°, un degré de
  longitude vaut ~76 km contre ~111 km pour un degré de latitude. Sans ça, le trajet serait
  étiré de ~46 % en largeur. Verrouillé par un test qui vérifie qu'un carré RÉEL reste un
  carré à l'écran.

⚠️ `estMetriquePosition` et le refus de `serieNumerique` SUBSISTENT, mais leur raison a
changé : ce n'est plus de la confidentialité, c'est du sens (une « latitude au fil du
temps » ne veut rien dire) et de l'aiguillage vers le rendu dédié. Le dire exactement évite
qu'une prochaine session croie protéger quelque chose en les gardant.

⚠️ **Les 52 `COMPATIBILITY` restent vus par le POLL après la décoche.** Le poll lit tout ce
que l'API expose pour le véhicule, indépendamment des cases du webhook : leur présence dans
la liste n'est PAS un geste en attente. Ils sont donc repliés (`<details>`, « rien à
faire ») au lieu d'occuper l'écran.

## « L'app me sert à rien » — la refonte du 12/08

Verdict de Marc, et il était juste : CarAI était un EXPLORATEUR DE DONNÉES (listes de
codes, courbes, tableau) là où il fallait des réponses. Un état de charge et un odomètre,
le tableau de bord de la voiture les donne mieux.

Cinq onglets, chacun répondant à UNE question — c'est le découpage demandé par Marc
(il a choisi les quatre axes, plus « toutes les informations extractables ») :

| Onglet | La question |
|---|---|
| **Tableau de bord** | Où j'en suis de mon bail, et qu'est-ce qui cloche ? |
| **Trajets** | Où et quand j'ai roulé (itinéraire complet sur Maps) |
| **Recharges** | Combien j'ai chargé, et ce que ça coûte |
| **Base de données** | Tout, filtrable et exportable |
| **Analyse** | Le détail des signaux et les courbes |

### Le chiffre qui commande le tableau de bord

`rythmeRestantAutoriseKmParJour` = `(allocation − odomètre) / jours restants`. La moyenne
du contrat ne sert plus à rien passé le premier mois : elle ignore l'avance prise. Plancher
à 0 (allocation épuisée ⇒ chaque km est facturé), `null` sur un bail échu (l'infini se
lirait « roule tant que tu veux »).

### ⚠️ L'ancre a changé le portrait d'un FACTEUR QUATRE

Marc a donné l'odomètre de signature le 12/08. Il est saisi dans Réglages, donc en base (plus dans le code).

Sur la fenêtre CarAI seule (6 jours), le rythme était nettement plus bas et le dépassement
projeté sous-estimé ; ancré sur la signature, la projection porte sur tout le bail.

Le correctif d'ancrage n'était donc pas une précaution théorique : sans lui l'app annonçait
un problème quatre fois plus petit que le vrai, sur la décision financière qui justifie le
projet. Le budget restant par jour se compare au rythme observé.

### Ce que les modules REFUSENT d'affirmer

- **Trajets** : distance de l'odomètre = exacte ; distance des points GPS = borne
  INFÉRIEURE, marquée « min. » au chiffre même. Odomètre hors tolérance ou delta négatif ⇒
  refusé plutôt qu'apparié au hasard.
- **Alertes** : aucun seuil constructeur écrit (la pression nominale de la bZ n'est pas
  dans les données). Détection par comparaison — une roue contre les autres (médiane), et
  contre sa propre référence passée, celle-ci EXCLUANT les dernières 24 h sinon la dérive
  masquerait la dérive.
- **Recharges** : les kWh sont DÉDUITS (ΔSOC × capacité), jamais mesurés — la bZ refuse
  `charge-energyadded`. Affichés avec « ~ ». Le total vaut `null` dès qu'UNE session n'est
  pas chiffrable : un total partiel qui a l'air complet est pire qu'une absence.
- Coût au km excédentaire et tarif du kWh restent `null` : un montant plausible serait la
  fausse donnée classique sur exactement les chiffres que Marc comparera à ses factures.

## Les retours de Marc du 12/08 (soir) — ce qu'ils ont fait sortir

Il a essayé l'app et signalé six choses. **Deux étaient des bugs de DONNÉES**, pas des
questions d'affichage — et aucun des deux n'aurait été trouvé sans son retour.

### ⚠️ Le kilométrage des trajets — DEUX passes, et la première était incomplète

**Passe 1 (12/08, après-midi).** Deux causes cumulées, invisibles séparément :

1. `historiqueOdometre` renvoyait des agrégats **par jour**. Bon pour la projection du bail
   sur quatre ans, ruineux pour un trajet de vingt minutes.
2. L'appariement cherchait « le relevé le plus proche à ±20 min ». Les relevés d'odomètre
   ne tombent pas aux mêmes instants que les points GPS.

La distance retombait donc systématiquement sur la ligne droite entre points GPS. Le
correctif d'alors — `odometreEncadrant`, dernier relevé AVANT le départ et premier APRÈS
l'arrivée — a corrigé ce cas et **en a introduit un autre**.

**Passe 2 (12/08, soir) — le correctif de la passe 1 était lui-même faux.** Marc :
« les km tjrs pas bons… devrait concorder avec le nombre de km effectués ». Deux défauts
OPPOSÉS coexistaient, et c'est ce qui rendait le symptôme illisible :

- **Des trajets DISPARAISSAIENT.** Le découpage groupait les relevés distants de moins de
  45 min et jetait tout groupe réduit à un seul point. Or la bZ ne publie sa position, pour
  l'essentiel, qu'à l'ARRÊT : l'aller du matin et le retour du soir sont deux relevés séparés
  de neuf heures — donc deux groupes d'un seul point, donc **zéro trajet pour la journée**.
- **D'autres étaient comptés en DOUBLE.** L'encadrement attribuait à CHAQUE trajet le delta
  de compteur de toute la fenêtre qui l'entoure. Deux trajets dans la même fenêtre recevaient
  chacun sa totalité.

Mesuré en rejouant l'ancien code sur les fixtures des tests : `0 trajet / 0 km` là où il y
en avait 2 pour 28 km, et **80 km annoncés EXACTS pour 40 km réels**. Les deux tests de
non-régression de `tests/trajets.test.ts` échouent sur l'ancien code — c'est ce qui les rend
utiles.

**Le modèle actuel.** `odometreALinstant(t)` ne dépend QUE de l'instant : deux segments qui
se touchent partagent la même valeur à leur frontière, donc leurs deltas se **télescopent**
et aucun kilomètre ne peut être compté deux fois. Le découpage ne se fait plus à l'horloge
mais au COMPTEUR : entre deux relevés de position, la voiture a roulé si et seulement si
l'odomètre a avancé — ce qui voit enfin l'aller-retour qui revient se garer au même endroit
(la géométrie y voyait une immobilité). On coupe à un relevé `LAST_PARKED` et au-delà de
`PAUSE_MINUTES`.

⚠️ Un compteur immobile qui contredit FRANCHEMENT la géométrie (≥ `SEUIL_INCOHERENCE_KM`)
est écarté : c'est le relevé d'odomètre qui manque, pas le trajet. Croire le compteur
l'effacerait — exactement le défaut qu'on vient de corriger.

⚠️ Toute lecture d'odomètre **à un instant précis** doit passer `granularite: "brut"`.

### La CONCORDANCE — parce qu'un total reconstitué n'est pas une mesure

`reconcilier` affiche côte à côte le compteur de la voiture sur la période et la somme des
trajets, puis NOMME l'écart. C'est la réponse directe à « ça devrait concorder » : un doute
(« est-ce que ce chiffre est bon ? ») devient un fait vérifiable, et le seul cas qui reste
possible — des kilomètres roulés pendant que la voiture ne publiait aucune position — est
dit plutôt que laissé à deviner. La vérification lit les relevés BRUTS du compteur, jamais
les trajets : sinon elle partagerait les biais de ce qu'elle vérifie. Elle s'affiche AUSSI
quand il y a zéro trajet, cas où elle sert le plus.

### ⚠️ Le passage de minuit

Vercel tourne en UTC, Marc vit à UTC−4 : « aujourd'hui » calculé en UTC bascule à **20 h
locale**. Le bilan du soir — celui qu'il regarde justement à cette heure-là — aurait été
faux tous les soirs. `debutDuJourLocal` compose minuit LOCAL exprimé en UTC.

### Le piège des booléens

`signalVersSnapshot` écrit un booléen dans les DEUX colonnes (`value_text` ET
`value_numeric`). La règle « du numérique ⇒ une courbe » classait donc « verrouillé » et
« en charge » comme des séries numériques : l'écran les traçait en créneaux 0/1. Le
discriminant est la PROPORTION — un booléen a autant de texte que de numérique.

### « Je veux que les données que j'ai »

La table porte une ligne par signal REFUSÉ. Sur 74 signaux dont 58 en échec, les vraies
mesures étaient noyées aux trois quarts. `avecValeurSeulement` est le défaut de l'écran ;
`?tout=1` rouvre les traces. Défaut d'AFFICHAGE, pas une purge.

### La carte dans l'app

Tuiles OSM en `<img>` + tracé SVG, rendu côté serveur. Aucune dépendance, aucune clé d'API.
⚠️ La projection est le point critique : fausse d'un cheveu, le tracé passe À CÔTÉ des rues
et la carte a l'air juste. Vérifiée contre la formule slippy-map officielle sur trois points
(Québec, origine, Londres), correspondance à la 4ᵉ décimale. Mes premiers numéros de tuile
étaient DEVINÉS et faux — ils auraient « prouvé » une projection fausse.

⚠️ Nouveauté pour la vie privée : afficher la carte fait demander des tuiles à
openstreetmap.org. Marc l'a demandé en connaissance de cause. Pour `[SEC-01]`, la future CSP
devra autoriser `img-src tile.openstreetmap.org`, sinon la carte disparaîtra en silence.

### ⚠️ « Ça devrait pas faire vol d'oiseau » — et pourquoi ça ne peut pas faire mieux

Marc, 12/08 au soir, capture à l'appui : un trait rouge droit en travers du quartier. Il a
lui-même posé la bonne question — « je sais pas si ça peut marcher au mètre près ».

⚠️ *(Le nom du quartier figurait ici dans une première rédaction. Retiré : **ce dépôt est
PUBLIC**, et un nom de quartier situe Marc bien plus précisément qu'une coordonnée de test.
Rien de ce qui décrit ses déplacements ne doit entrer dans un fichier versionné — voir
« Ce qui reste ouvert ».)*

**Non, et la mesure le dit.** Le poll du 12/08 18:55 UTC rend la liste des signaux qui
répondent : `location-preciselocation`, `odometer-traveleddistance`,
`tractionbattery-nominalcapacity`, `wheel-tires`. **`motion-currentspeed` est refusé
(ERROR PERMISSION)**, comme `vehicleidentification-vin`. La position n'arrive donc pas en
continu : elle arrive quand le véhicule la republie, c'est-à-dire à l'arrêt. Entre deux
relevés, la rue empruntée **n'existe nulle part** — ni dans la base, ni chez Smartcar.

Trois façons de réagir, une seule tenable :

- inventer la route via un service de calcul d'itinéraire → un chemin PLAUSIBLE présenté
  comme le sien. C'est de la fake data, quel que soit son réalisme ;
- garder le trait plein → ce que Marc a vu, et qui affirme un chemin qu'on ne connaît pas ;
- **le dire** : trait POINTILLÉ (`.trace-devinee`), pastilles sur chaque relevé réel, et une
  légende qui nomme la limite. C'est ce qui est livré.

Le chiffre, lui, reste exact : la distance vient du COMPTEUR, pas du dessin. `cheminInconnu`
porte cette distinction du module jusqu'à la carte, et `profilerReleves` compte les relevés
par type pour qu'on puisse distinguer « la voiture ne publie que des arrêts » d'un tracé
cassé — un outil de diagnostic qui se tait quand tout est à l'arrêt ne diagnostique rien.

⚠️ Corollaire sur la DURÉE : un relevé `LAST_PARKED` est horodaté à l'ARRIVÉE. L'écart entre
deux relevés contient donc le temps garé. `dureeEstFenetre` le signale, la durée s'affiche
« max. », et la vitesse moyenne n'est plus calculée dans ce cas — 12 km en six heures
affichait « 2 km/h en moyenne », un chiffre faux qui avait l'air d'une mesure.

### ⚠️ « La recharge je vois rien du tout » — le même piège que les trajets

Signalé par Marc le 12/08 au soir. La page ne savait reconstituer une session QUE depuis
`charging_status` (`charge-ischarging`) — mesuré le jour même en **`ERROR (UPSTREAM)`** :
Toyota ne sert pas ce signal de façon fiable. Sans lui, `etatsCharge` arrivait vide, donc
zéro session, donc un écran vide, **alors que la voiture chargeait et que le SOC le montrait**.

C'est exactement l'erreur du découpage des trajets, sur un autre écran : bâtir sur le signal
qu'on VOUDRAIT au lieu de celui qu'on A. `chargesDepuisSoc` part donc du SOC — une recharge,
c'est un état de charge qui monte pendant que la voiture ne roule pas.

- **L'odomètre est la garde** : sans lui, une longue descente en récupération passerait pour
  une charge. `KM_MAX_PENDANT_CHARGE` tranche.
- **Le seuil** `HAUSSE_MIN_POINTS` (3 pts ≈ 2 kWh) met le bruit de capteur hors d'atteinte.
- **Pas de double comptage** : une session déduite qui CHEVAUCHE une session déclarée est
  écartée — ce sont les deux visages du même branchement, et les additionner doublerait
  l'énergie, donc la facture le jour où `tarifKwh` sera renseigné.
- **Les bornes sont une FENÊTRE** (`bornesEstimees`) : la charge a commencé quelque part
  entre deux relevés. La durée s'affiche « max. ». Le gain de batterie et l'énergie, eux, ne
  dépendent pas de ça — ils restent exacts au ΔSOC près.

⚠️ Réflexe à garder pour tout écran qui reste vide : **demander d'abord de quel signal il
dépend, et si ce signal arrive vraiment**. Les trois derniers défauts trouvés ce soir sont
tous des variantes de ça.

### La consommation réelle (kWh/100 km)

Le chiffre par lequel une électrique se juge. Dérivé de l'odomètre, du SOC et de la capacité
nominale. Refuse : les segments où la charge REMONTE (une recharge n'est pas une
consommation — l'inclure inverserait le signe), ceux passés à l'arrêt (écartés ET comptés),
ceux de moins d'un km, et tout calcul sans capacité.
⚠️ Surestime de la décharge à l'arrêt (veille, préchauffage), que la voiture ne détaille
pas : c'est un PLAFOND honnête, et l'écran le dit.

## Le verdict du re-Connect (mesuré, poll du 12/08 18:55 UTC)

`ResultatPoll.codes.parStatut` rend enfin les NOMS et pas seulement les comptes — c'est ce
qui a permis de trancher. « 9 sur 74 » et « 4 sur 74 » racontent deux histoires opposées, et
les comptes seuls ne disaient pas laquelle.

| Statut | Combien | Ce que ça veut dire |
|---|---|---|
| `SUCCESS` | 4 | `location-preciselocation`, `odometer-traveleddistance`, `tractionbattery-nominalcapacity`, `wheel-tires` |
| `ERROR (UPSTREAM)` | 13 | **transitoire** — véhicule endormi. Dont `tractionbattery-stateofcharge`, `-range`, `charge-*`, `closure-*`. Ils étaient à 9 SUCCESS 50 min plus tôt. |
| `ERROR (PERMISSION)` | 5 | **permanent jusqu'à un nouveau Connect** — `motion-currentspeed`, `vehicleidentification-vin`, 3 `internalcombustionengine-*` (sans objet sur une électrique) |
| `ERROR (COMPATIBILITY)` | 52 | la bZ ne les fournit pas. Rien à faire. |

⚠️ Conclusion à ne pas confondre : la chute 9 → 4 n'est PAS une régression du re-Connect,
c'est la voiture qui s'endort (`UPSTREAM`). En revanche `motion-currentspeed` reste refusé.

⚠️ Et une précision qui évite une fausse promesse : **la vitesse ne donnerait PAS le chemin**.
Un relevé de vitesse toutes les 30 minutes ne dessine aucune route ; il affinerait tout au
plus une durée de conduite. Ce qui donnerait un chemin, ce sont des POSITIONS pendant le
trajet — et on ne sait pas encore si la bZ en publie jamais. C'est précisément ce que
`profilerReleves` répond sur `/trajets` (« N à l'arrêt · N en roulant ») : si `en roulant`
reste à 0 après plusieurs jours, la question est tranchée et aucun scope n'y changera rien.

### ✅ Re-Connect refait par Marc (12/08, 20h00 UTC) — `motion-currentspeed` débloqué

Mesuré au poll du même instant : `motion-currentspeed` est passé en **`SUCCESS`**
(`SMARTCAR_SCOPES_EXTRA` posé + redéploiement + Connect refait, suivant la procédure
ci-dessus). `tractionbattery-stateofcharge` était en `UPSTREAM` à ce même poll — véhicule
endormi, pas un effet du re-Connect.

⚠️ Rappel de la limite déjà posée plus haut, pour ne pas se raconter une fausse victoire :
ce signal donne une VITESSE, pas une POSITION. Il n'ajoute rien au tracé de `/trajets` —
seul `profilerReleves` (compte des relevés « en roulant ») pourra dire un jour si la bZ
publie sa position en continu. `motion-currentspeed` reste donc un signal SANS consommateur
dans l'app pour l'instant ; à brancher (ex. vitesse instantanée sur l'accueil) seulement
si Marc le demande — ajouter un signal reçu, pas afficher, n'est pas la fin du travail.

## L'étape exacte où reprendre

1. `[BAIL-01]` Tarif au km excédentaire, `[COUT-01]` tarif du kWh : les deux seuls chiffres
   qui manquent pour passer des kilomètres aux dollars.
2. Les codes confirmés `SUCCESS` sur du LIVE sont candidats à `SIGNAUX_CONFIRMES_BZ`
   (`lib/smartcar/signals.ts`) : les y ajouter DANS LE MÊME COMMIT que la mise à jour du
   test (15 → N, `motion-currentspeed` compris depuis le re-Connect du 12/08).
3. ✅ `[INFRA-07]` clos, ✅ `[BAIL-02]` clos (odomètre initial renseigné), ✅ re-Connect
   `motion-currentspeed` clos (voir plus haut).

⚠️ **Piège de session** : le conteneur a fait DEUX retours arrière du workspace le 12/08,
ramenant le clone au 6 août. Symptôme trompeur — `lib/smartcar/poll.ts` et
`app/api/cron/smartcar-poll/` semblaient ne jamais avoir existé alors qu'ils tournaient en
production. Rien n'était perdu (tout était mergé). Réflexe : quand un fichier attendu
manque, comparer au DISTANT (`git ls-tree origin/main`, ou l'API GitHub) avant de conclure,
et refaire `git fetch` — le `origin/main` local peut être périmé lui aussi.

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

## ⚠️ Ce dépôt est PUBLIC — constaté le 12/08

`githubRepoVisibility: "public"` dans les métadonnées du déploiement Vercel. L'APP est bien
privée (login par le hub, autorisation par la table `acces`) ; le CODE et les DOCS, non.

Conséquence à garder en tête à chaque commit : tout ce qui est versionné est lisible par
n'importe qui. Deux catégories à surveiller —

- **Ce qui situe Marc** : nom de quartier, adresse, coordonnées réelles. Un nom de quartier
  a déjà dû être retiré de ce fichier. Les coordonnées des tests sont volontairement
  génériques (46,8 / −71,2, le centre de la ville).
- **Ses chiffres de contrat** (kilométrage autorisé, durée, odomètre de signature) et les projections de
  dépassement figuraient en clair dans le code et les docs. Retirés (CarAI#239) : ils vivent en base.

*(Historique — voir la section du 15/10 en tête de ce fichier pour la règle en vigueur.)*

✅ **TRANCHÉ par Marc le 12/08 : le dépôt RESTE public.** La règle qui en découle, et qui
s'applique à chaque commit désormais :

- **Rien qui SITUE Marc** ne va dans un fichier versionné — quartier, adresse, coordonnées
  réelles, nom de rue. Les coordonnées des tests restent génériques (46,8 / −71,2).
- **Les termes du bail** étaient dans `BAIL_DEFAUT` (`lib/config.ts`), retiré le 16/10/2026 (CarAI#239) :
  la valeur vient de la base seulement. Ne pas les réécrire dans le code ni dans une fixture.
- **Aucun secret, jamais**, ici comme ailleurs : jetons, `CRON_SECRET`, identifiants Smartcar
  vivent dans l'environnement. Cette règle-là ne dépend pas de la visibilité du dépôt.

⚠️ Corollaire pour les journaux de CI (publics eux aussi) : le poll ne publie que des NOMS de
signaux, jamais leurs valeurs. Ne pas y ajouter de mesures — pas de kilométrage, pas de
position, pas de SOC.

## Ce qui reste ouvert

Voir `BACKLOG.md` — notamment `[SEC-02]` (visibilité du dépôt, ci-dessus), `[SC-05]`
(couverture à confirmer sur quelques heures de livraisons), `[DATA-01]` (sauvegarde
externe), `[UI-01]` (graphiques — les agrégats par métrique de `lib/vehicle/inventaire.ts`
disent déjà quelles séries sont assez fournies pour être tracées), `[SEC-01]` (en-têtes de
sécurité).

## Portes qualité de l'Atelier (S6, 23/09/2026)

Contrôles automatiques en CI, jobs **Qualité** et **Sécurité** : la fusion automatique les attend.
Principe du **cliquet** : `qualite/seuils.json` fige l'état du jour de la mise en place ; rien ne peut
reculer. `npm run portes` mesure en local, `npm run portes:maj` resserre après une amélioration.

| Porte | Seuil de départ |
|---|---|
| Typage (erreurs) | ≤ 0 |
| Lint (erreurs) | ≤ 0 |
| Lint (avertissements) | ≤ 2 |
| Tests en échec | ≤ 0 |
| Couverture `lib/` (% lignes) | ≥ 78.8 |
| Couverture globale (% lignes) | ≥ 43.2 |
| Couverture globale (% branches) | ≥ 90.0 |
| Code mort (knip) | ≤ 128 |
| Règles d'architecture (dependency-cruiser) | ≤ 0 |

Sécurité : gitleaks sur tout l'historique + Semgrep (TypeScript, React, Next.js, secrets, OWASP), bloquants.
Dependabot : mises à jour hebdomadaires (npm + actions), fusion automatique si tout est vert.

## 2026-10-01 : fusion native (P1)
Le kit d'auto-fusion maison (workflow, config, modeles/auto-merge, COPIES.md) est retire : GitHub fusionne seul (auto-merge natif + controles requis). CODEOWNERS ajoute ; Dependabot attend 3 jours.
