// lib/db/index.ts — connexion Neon (driver HTTP serverless, compatible Vercel).
//
// Initialisation PARESSEUSE : le module s'importe au build (analyse Next) sans
// DATABASE_URL ; l'erreur honnête ne part qu'à la PREMIÈRE requête réelle. Sans ça, un
// build échouerait avec un message trompeur alors que rien n'a encore tenté de lire la base.
//
// Les tests n'importent PAS ce module : ils bâtissent leur propre Drizzle sur PGlite
// (`tests/db.test.ts`). C'est ce qui permet d'éprouver le schéma pour de vrai — index
// uniques compris — sans base distante et sans mock.

import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let instance: NeonHttpDatabase<typeof schema> | null = null;

function connect(): NeonHttpDatabase<typeof schema> {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL manquant : configure la base Neon (voir .env.example).",
    );
  }
  instance = drizzle(neon(url), { schema });
  return instance;
}

/** true si la base est configurée. Pour DÉCIDER d'afficher un état honnête, pas pour cacher une panne. */
export function baseConfiguree(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.DATABASE_URL?.trim());
}

/** Proxy paresseux : `db.select()…` s'utilise partout, la connexion se fait au 1ᵉʳ usage. */
export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(connect(), prop, receiver);
  },
});

export { schema };
