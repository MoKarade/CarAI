# carai-mcp — serveur MCP de CarAI

Expose l'état du véhicule et ses commandes à Claude, sur le même patron que `financeai-mcp`.

## Lancer en local

```bash
npm run mcp:dev        # transport stdio
```

Le serveur lit la **même base** que la webapp (`DATABASE_URL`). Aucune duplication de
données : le MCP consulte et écrit dans la source que les webhooks alimentent.

## Tools

| Tool | Rôle |
|---|---|
| `ping` | Santé du serveur + indique si la base est configurée |
| `get_vehicle_status` | État courant, toutes sources, avec fraîcheur et provenance |
| `get_vehicle_history` | Série temporelle d'une métrique (graphiques, tendances) |
| `get_service_history` | Historique d'entretien |
| `get_lease_mileage_status` | Kilométrage vs allocation du bail, projection de dépassement |
| `lock_vehicle` / `unlock_vehicle` | Verrouillage — **action physique** |
| `start_charging` / `stop_charging` | Charge |
| `set_charge_limit` | Limite de charge (50 % à 100 %) |

## Trois choses à savoir avant de lire une réponse

**La fraîcheur n'est pas le temps réel.** Chaque mesure porte `recordedAt`, l'instant où le
*véhicule* a produit la donnée — pas celui de la réception. Toyota via Smartcar se
rafraîchit toutes les 30 à 60 minutes. Une réponse sans mention d'âge serait trompeuse.

**Deux sources qui se contredisent sont renvoyées toutes les deux.** Si Smartcar annonce
45 % et Toyota 47 %, les deux valeurs apparaissent avec leur horodatage, et la métrique est
listée dans `desaccords`. Aucune moyenne, aucun arbitrage : 46 % serait un chiffre que le
véhicule n'a jamais affiché.

**Une commande acceptée n'est pas une commande effectuée.** Smartcar documente qu'une
commande peut réussir côté API sans se propager au véhicule. Toute réponse de commande
porte cette note, et chaque commande est journalisée dans `vehicle_commands_log` avec sa
réponse brute — c'est le seul moyen d'élucider a posteriori un « j'ai verrouillé et la
voiture était ouverte ».

## Confirmation des commandes

Pas de paramètre `confirm`, par choix (Doc 4 §4) : la confirmation se fait **en langage
naturel avant l'appel**. Les descriptions des tools le rappellent — c'est là que ça se joue,
puisque le tool exécute dès qu'il est appelé.

## Déploiement

Cloud Run, même patron que `financeai-mcp`. Le serveur a besoin de `DATABASE_URL`, et de
`SMARTCAR_CLIENT_ID` / `SMARTCAR_CLIENT_SECRET` pour les commandes (les lectures se
contentent de la base).
