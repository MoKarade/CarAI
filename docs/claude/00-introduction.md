<!-- Extrait de l'ancien CLAUDE.md (CLAUDE.md, introduction (contexte, stack, destination)), texte inchangé. -->

# CLAUDE.md — CarAI

Suivi complet du véhicule électrique de Marc (Toyota bZ XLE AWD 2026). Collecte les données du véhicule dans le temps, les rend en graphiques,
les publie au hub perso et les expose à Claude via un serveur MCP.

> Ce fichier se charge à **chaque session** — il reste court. Le détail vit dans
> `HANDOVER.md` (état courant, à lire en premier) et `BACKLOG.md`.

**Stack** : Next.js 15 (App Router, Server Components) · Neon + Drizzle · Auth.js v5
(`providers: []` — la session vient du hub) · Zod · Vitest · `@modelcontextprotocol/sdk`.
**Destination** : `carai.hubperso.com`.

> 📐 Structure de ce fichier et de `docs/` : [convention commune aux huit dépôts](https://github.com/MoKarade/claude-config/blob/main/conventions/STRUCTURE-DEPOT.md).
