# ÉTAT — CarAI

> Photographie courte de l'état du projet, pour qui arrive sans contexte. La référence
> complète reste `HANDOVER.md` (racine, journal chronologique) et `BACKLOG.md` — ce
> fichier n'en est qu'un résumé daté, pas une source concurrente.
>
> Rédigé le 29/09/2026, à partir de `BACKLOG.md`, `CLAUDE.md`, `docs/claude/`, et de ce qui
> a été mesuré ou vérifié en session le jour même (chantier `st-carai`, plan
> `auth-asym-hubperso`). `HANDOVER.md` porte une dernière mise à jour datée du 18/09/2026 —
> plus ancienne que les faits ci-dessous : ce fichier ne la corrige pas, il le signale.

## Fait (en production)

Collecte continue des signaux du véhicule (Smartcar, source principale), publication d'un
résumé au hub perso (`GET /hub/summary`), écrans Accueil / Données / Tendances / Analyse /
Trajets / Recharges / Commandes, connexion unique via le hub (Auth.js sans fournisseur),
app installable (PWA Android). Le module Toyota non officiel existe mais reste désactivé
par défaut (`TOYOTA_NA_ENABLED`).

## En cours, à la date de rédaction (29/09/2026)

- **Migration de la session vers une signature asymétrique** (plan `auth-asym-hubperso`,
  `C:\dev\_pc-local\agence\pages\plans\auth-asym-hubperso.md`). Phase 1 (lecture du
  nouveau cookie ET de l'ancien) faite côté CarAI, branche `agence/carai-38/auth-asym-phase1`,
  attestée par pole-securite, PR #156 ouverte (pas encore fusionnée). Additive : rien ne
  change encore pour Marc, Hubperso n'émet pas le nouveau cookie.
- **Mise au modèle commun de l'Atelier** (chantier `st-carai`,
  `C:\dev\_pc-local\agence\briefs\st-carai-modele-commun.md`) : kit auto-merge/CI et
  portes qualité posés (partie A et B), cette restructuration de la documentation en fait
  partie (partie C). Un point du kit est volontairement différé : la réécriture de
  `ci.yml` sur le gabarit réutilisable (`[ST-CARAI-CI]` au BACKLOG), après la fusion de la
  PR #156 pour ne pas casser ses contrôles requis en vol.
- Sept tests rouges préexistants sur `main` (CSS mobile sous Windows, cadence du filet
  GitHub Actions, décodeur Draco désynchronisé) corrigés le 29/09/2026, branche
  `agence/carai-38/tests-rouges`, déjà récupérée par les copies du chantier `st-carai`.

## Ce que le BACKLOG dit lui-même de sa frontière (recensé 18/09/2026)

`BACKLOG.md` classe ce qui reste en quatre familles, et le dit explicitement : sauf
`[QUAL-01]`, aucun item restant ne se débloque en codant plus — chacun attend un geste ou
un arbitrage de Marc, ou une donnée qui n'arrive jamais
(`tractionbattery-capacity`, jamais livrée par la bZ, mesuré). Détail des items et de leurs
identifiants : `BACKLOG.md`, section « Où passe la frontière ».
