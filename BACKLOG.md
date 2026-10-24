# BACKLOG — CarAI

Convention : chaque tâche porte une case. Un item fini et validé (mergé, gate vert) part
dans la section « Livré » avec sa date. Une note sans travail à faire n'est pas une tâche.

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
