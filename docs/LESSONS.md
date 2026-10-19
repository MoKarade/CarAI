<!-- Extrait de l'ancien CLAUDE.md (§ 9. Leçons apprises), texte inchangé. Le CLAUDE.md court renvoie ici. -->

# Leçons apprises

## 9. Leçons apprises

### Les routes hors middleware, et pourquoi

`ROUTES_A_AUTH_PROPRE` (`lib/authGuard.ts`) énumère **une par une** les routes appelées par
des machines : `/hub/summary`, les deux webhooks, le cron. Chacune porte sa propre auth.

⚠️ **Jamais un préfixe de dossier.** Une nouvelle route non déclarée tombe derrière le garde
par défaut — le mauvais côté de l'oubli doit être le côté sûr. Verrouillé par
`tests/auth.test.ts`, qui compare aussi la liste au matcher du middleware.

⚠️ Pour Smartcar l'enjeu est concret : une route qui répond 302 ou 503 compte comme un
**échec de livraison**, et six échecs suffisent à ce que Smartcar **désactive le webhook**.
Le flux s'arrête alors en silence. C'est pour ça que `webhook_deliveries` existe et que le
summary alerte au-delà de 6 h sans livraison.

### Le poll Toyota ne passe pas par Vercel

⚠️ **Ne jamais remettre un bloc `crons` dans `vercel.json`.** Le Doc 3 §5.2 fixe le poll
léger à toutes les 2 h ; le plan **Vercel Hobby n'autorise que des crons quotidiens**, et
une expression comme `0 */2 * * *` fait **échouer le déploiement** avec « Hobby accounts
are limited to daily cron jobs ». Passer au plan Pro irait contre la règle « tout gratuit ».

Le déclencheur vit donc dans `.github/workflows/toyota-poll.yml` (GitHub Actions, gratuit à
cette fréquence). Il est en **déclenchement manuel seulement** tant que le module Toyota est
désactivé : douze runs verts par jour pour une route qui répond « module désactivé », c'est
exactement ainsi qu'un onglet Actions cesse d'être lu.

### Un `schedule` GitHub Actions ne tient AUCUNE cadence — c'est un filet, pas une horloge

Mesuré le 17/09/2026 sur les 60 derniers runs du poll Smartcar : **6 passages par jour**
là où `*/30` en demande 48. Écart médian **237 min**, **jamais moins de 121 min**, maximum
413 min — et des minutes de déclenchement réparties sur tout le cadran alors que le cron
demande `:00` et `:30`. GitHub ne tente donc même pas à l'heure voulue : il coalesce. Sur
toute la vie du workflow, 536 runs en 37 jours (14,5/jour) : **la cadence demandée n'a
jamais existé**, et elle se dégrade.

⚠️ **Demander plus souvent n'y change rien** — c'est le NOMBRE de runs qui est plafonné,
pas leur date. Et **boucler dans un run n'est pas payable** ici : dépôt privé, 2 000
min/mois, une boucle de 4 h coûterait 1 440 min par jour.

Conséquence structurelle, et c'est elle qui fait mal : ni une recharge ni un trajet n'est
MESURÉ par la voiture — les deux sont DÉDUITS de relevés qui les encadrent. Un silence de
quatre heures n'efface pas un affichage, il efface une mesure qui n'a jamais été prise.
Le déclencheur principal vit donc **hors du dépôt** (cron-job.org, 15 min) et le workflow
reste en filet. ⚠️ Aucun test ne peut vérifier une configuration qui vit dehors : ce qui la
surveille est la cadence OBSERVÉE (`lib/vehicle/cadence.ts`, page Données,
`expectedMaxAgeSec` au hub). Un déclencheur invisible ET une cadence non mesurée
redonneraient exactement le silence d'avant.

### La déduplication est structurelle, pas un détail

Smartcar livre **tous** les signaux souscrits à chaque événement, alors que le véhicule ne
se rafraîchit qu'aux 30-60 min. L'index unique `(source, metric_type, recorded_at)` fait
qu'une mesure est identifiée par l'instant où le *véhicule* l'a produite : une re-livraison
ne crée rien. C'est aussi ce qui rend l'ingestion idempotente sans faire confiance à un
identifiant d'événement. Corollaire assumé : quand une source ne date pas ses mesures,
`recorded_at` retombe sur la réception et la dédup ne joue plus — mieux vaut des doublons
visibles qu'une fraîcheur inventée.

⚠️ Corollaire vécu (06/08, 7 mesures sur 15 perdues) : **deux signaux ne doivent JAMAIS
partager un `metric_type`** — même horodatage ⇒ collision avec l'index unique ⇒ le second
écarté comme un doublon, sans erreur. C'est pour ça que `metriquePourSignal` n'a plus de
repli par groupe : un code inconnu devient sa propre métrique.

### Rétention : mesures à vie, transport 90 jours

Décision du 06/08 (« BD de qualité pour plusieurs années ») : les **mesures**
(`vehicle_snapshots`) sont conservées **pour toujours** — ~20-60 Mo/an, tenable des années
sur le demi-Go Neon gratuit. Le **JSON brut** des livraisons (`webhook_deliveries.raw`),
redondant par construction, est vidé après `WEBHOOK_RAW_RETENTION_JOURS` (90 par défaut,
`0` = tout garder) ; les lignes de livraison restent. La page privée `/donnees` compare la
base aux signaux confirmés (`SIGNAUX_CONFIRMES_BZ`, qui fait foi — le compte y vit et y
évolue) et nomme les manquants.

⚠️ **Garde anti-perte de la purge** (finding HIGH, revue adversariale du 06/08) : « le raw
est redondant » n'est vrai que si le pipeline SAIT LIRE les livraisons. La purge ne touche
donc JAMAIS un raw reçu après la **dernière écriture réussie** : si l'enveloppe Smartcar
change (200 OK, 0 écrit), tout ce qui suit la casse est sanctuarisé jusqu'à réparation, et
`/donnees` alerte « les livraisons arrivent mais rien ne s'écrit » (48 h sans écriture
avec des livraisons récentes). Le statut par signal (`signal_status`) est en base : une
ligne sans valeur reste interprétable après la purge du raw.

### Une mesure a TROIS colonnes de valeur, et c'est `value_json` qu'on oublie

`value_numeric`, `value_text`, **`value_json`**. La troisième porte les positions GPS, les
pressions des quatre pneus, l'état des ouvrants — tout ce qui est structuré. Le prédicat
« cette ligne porte-t-elle une valeur ? » est `porteValeur` (`lib/smartcar/ingest.ts`) :
**une seule définition, réutilisée**, jamais recopiée.

⚠️ Vécu le 18/08/2026 : la migration `0005` a réécrit ce prédicat EN DUR dans son SQL en
oubliant `value_json`, et a supprimé tout l'historique de positions — donc les trajets, et
les prix de recharge (qui dépendent du lieu). La bonne version était à trois lignes de là.
Réparation par rejeu du raw des livraisons (`lib/smartcar/rejeu.ts`) ; tripwire dans
`tests/rejeu.test.ts`. **Une migration qui SUPPRIME des lignes de `vehicle_snapshots` doit
citer `value_json`**, et un fichier de migration DÉJÀ APPLIQUÉ ne se corrige jamais : son
hash le ferait rejouer, donc supprimer une seconde fois. On exempte, on répare à côté.

### Le connecteur MCP est en LECTURE SEULE, et ça se garde

`POST /api/mcp` (jeton `MCP_TOKEN`, temps constant, route déclarée dans
`ROUTES_A_AUTH_PROPRE`) expose cinq outils à Claude : état, trajets, recharges, bail,
santé du canal. Ils réutilisent les fonctions PURES des écrans — **aucun calcul neuf**,
sinon Claude et l'écran diraient deux choses différentes.

⚠️ **Aucun outil ne pilote le véhicule.** `lib/mcp/outils.ts` n'importe aucune fonction de
commande, et `tests/mcp.test.ts` refuse tout nom d'outil qui ressemble à un pilotage.
Donner les infos ne doit pas, au passage, donner les clés : ouvrir le verrouillage ou la
charge à distance est une décision à prendre séparément.

⚠️ **La position exacte ne sort pas.** `nommerEndroit` rend le nom d'un lieu enregistré, et
sinon des coordonnées arrondies à ~1 km. L'état ne communique jamais la position structurée.

### Un échec « toujours retenté » peut marteler une panne SOUTENUE, pas juste un blip

`assurerMigrations()` (`lib/migrations.ts`) mémorise un succès une fois par processus, mais
oublie volontairement la mémorisation sur tout échec — pour qu'un blip réseau au démarrage
à froid ne condamne pas l'instance à ne plus jamais retenter. Bon principe, incomplet : sans
aucun délai entre deux tentatives, il ne distingue pas un blip (quelques secondes) d'une
panne soutenue (des heures).

⚠️ **Vécu le 29/09/2026** : Neon a dépassé son quota (`HTTP 402`, panne soutenue). Comme
`assurerMigrations` est appelé par la quasi-totalité de `app/`, chaque requête suivante a
retenté la migration COMPLÈTE. Mesuré dans les journaux Vercel (24 h, pendant l'incident) :
~1 240 requêtes (`/activite` 785, `/api/mcp` 310, webhooks et crons compris) — donc environ
autant de tentatives de migration martelant une base déjà à quota, plausiblement ce qui a
empêché toute reprise naturelle. Aucune donnée ne s'affichait : la base refusait TOUT,
lecture comme écriture, pas seulement l'écriture.

⚠️ **Corrigé par un cooldown (`COOLDOWN_ECHEC_MS`, 60 s), pas par un déplacement au build.**
Déplacer les migrations au build/déploiement a été proposé puis écarté : ça aurait annulé
l'exigence documentée de Marc (Doc 1 §4.1) — les tâches de fond (webhooks, poll) doivent
pouvoir réparer le schéma SANS attendre un redéploiement. Le cooldown garde cette propriété
(une instance retente encore après un échec) tout en arrêtant le martèlement. **La leçon,
et elle dépasse les migrations** : un mécanisme « ne jamais verrouiller un échec » doit
distinguer la DURÉE de la panne, sinon la protection contre le blip devient elle-même une
attaque par déni de service sur sa propre dépendance.
