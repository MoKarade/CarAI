# CLAUDE.md — app-template

Squelette d'app hub perso. Sa seule responsabilité générique : exposer
`GET /hub/summary` conforme à [`@mokarade/hub-contract`](https://github.com/MoKarade/hub-contract).
Tout le reste (l'interface, le moteur métier) se construit après le fork.

## Principes non négociables

- **Contrat d'abord.** Le endpoint `/hub/summary` respecte le contrat ; toute réponse
  passe par le schéma du contrat (ici `buildingSummary` le garantit ; au fork,
  `HubSummarySchema.parse(...)` sur un vrai summary).
- **No fake data.** Par défaut `status: "building"`, aucune métrique inventée. On ne
  publie de vrais chiffres que quand le moteur les produit réellement.
- **Auth échec fermé.** `x-hub-token` obligatoire (401 sinon), `HUB_TOKEN` obligatoire
  côté serveur (503 sinon — hub désactivé, la convention de BatchChef, DriveAI et
  JobAI). Comparaison en temps constant. Jamais de secret en dur.
- **no-store systématique** sur les réponses du endpoint (un summary est un instantané).

## Au fork — checklist

1. Personnaliser `APP` (id/name/url/color) dans `app/hub/summary/route.ts`.
2. Remplacer `buildingSummary(...)` par un vrai summary quand le moteur est prêt.
3. Générer + configurer `HUB_TOKEN`.
4. Déclarer l'app dans `lib/sources.ts` du hub + `HUB_TOKEN_<ID>`.

## Vérifications avant commit

```bash
npm run typecheck && npm run lint && npm run test && npm run build
```

*(`lint` = ESLint CLI : `next lint` est déprécié et retiré dans Next 16. Le bloc
`ignores` de `eslint.config.mjs` est indispensable — l'ESLint CLI n'ignore pas
`node_modules`/`.next` implicitement, contrairement à `next lint`.)*

La **CI** (`.github/workflows/ci.yml`) rejoue ce gate et part avec le fork — c'est
voulu : les quatre apps nées de ce template ont démarré sans aucune vérification
automatisée, et l'une a laissé vivre une injection SQL en production faute de quoi que
ce soit qui se déclenche. Un job `audit` séparé (`npm audit --omit=dev`, aussi en
hebdomadaire) complète le gate : un avis de sécurité paraît sans qu'une ligne n'ait
changé, et mêlé au gate il peindrait un dépôt sain en rouge sans rapport avec le code.

## Style (hérité du CLAUDE.md global de Marc)

- Réponses, commits et docs **en français** (`feat:`, `fix:`, `docs:`, …).
- TypeScript strict, pas de `any` silencieux. Erreurs honnêtes, jamais avalées.
- Ne pas imposer le dark mode : `prefers-color-scheme` décide.
