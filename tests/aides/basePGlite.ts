// tests/aides/basePGlite.ts — la base Postgres des tests d'intégration, posée UNE fois.
//
// ⚠️ EXTRAIT LE 18/09, POUR LA MÊME RAISON QUE `aides/css.ts` LE 14/09 : un SECOND fichier
// de garde (`entretiens.test.ts`) a eu besoin du même préambule que `rafraichissement.test.ts`
// — dix-huit lignes, mot pour mot. Recopier aurait suffi, et c'est exactement ainsi qu'on se
// retrouve avec deux façons de monter la même base dont une seule connaît le prochain
// réglage (un dossier de migrations déplacé, une table de plus à vider). Une règle tenue à
// deux endroits est une règle et demie.
//
// ⚠️ **Ce que ces tests exercent est le VRAI schéma.** PGlite est Postgres compilé en WASM,
// et `migrate` applique les migrations RÉELLES du dossier `drizzle/` — index uniques
// compris. C'est ce qui rend démontrable ce qu'aucun mock ne démontre : qu'un
// `ON CONFLICT … WHERE … RETURNING` arbitre bien une course entre deux appelants.
//
// ⚠️ **Le nettoyage se fait AVANT chaque cas, pas après.** Un `afterEach` laisse la base
// sale quand un cas lève, donc le cas suivant échoue pour une raison qui n'est pas la
// sienne — et c'est le second message d'erreur qu'on lit en premier.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { PgTable } from "drizzle-orm/pg-core";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";

/**
 * Monte une base PGlite migrée pour le fichier de test appelant, et enregistre ses hooks.
 *
 * À appeler au niveau MODULE d'un `*.test.ts` — c'est là que Vitest accepte encore
 * l'enregistrement de `beforeAll`/`beforeEach`/`afterAll`.
 *
 * `tablesAVider` prend les tables Drizzle elles-mêmes, jamais leur nom en chaîne : le
 * `DELETE` se compose alors depuis le schéma, et une table renommée casse le typecheck au
 * lieu de faire échouer un test au moment de l'exécution.
 */
export function baseDeTest(tablesAVider: readonly PgTable[] = []) {
  const client = new PGlite();
  const base = drizzle(client);

  beforeAll(async () => {
    await migrate(base, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  });

  if (tablesAVider.length > 0) {
    beforeEach(async () => {
      for (const table of tablesAVider) await base.delete(table);
    });
  }

  afterAll(async () => {
    await client.close();
  });

  return { client, base };
}
