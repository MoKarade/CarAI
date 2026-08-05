// drizzle.config.ts — configuration de drizzle-kit (GÉNÉRATION du SQL uniquement).
//
// ⚠️ Ce fichier ne sert QU'AU DÉVELOPPEMENT (`npm run db:generate`). L'APPLICATION des
// migrations se fait au démarrage de l'app (`lib/migrations.ts`) : personne ne lance
// `drizzle-kit migrate` à la main, ni en local ni sur Vercel.
//
// Leçon JobAI, verrouillée là-bas par `tests/outillage.test.ts` : `drizzle-kit migrate`
// choisit le pilote `@neondatabase/serverless` dès qu'il est installé, et ce pilote exige
// un websocket qu'il faut configurer soi-même en Node. Sans ça il sort avec le code 0,
// sans erreur, SANS avoir créé une seule table. On ne s'en sert donc pas pour appliquer.

import type { Config } from "drizzle-kit";

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
} satisfies Config;
