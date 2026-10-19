// tests/aides/fichiers.ts — la seule I/O des gardes qui recensent du JSX.
//
// Séparée des fonctions pures (`aides/controles.ts`) parce que c'est la règle du dépôt :
// ce qui DÉCIDE se teste sans disque. Ici, rien ne décide — on liste des chemins.

import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Tous les `.tsx` sous `racine`, récursivement. */
export function fichiersTsx(racine: string): string[] {
  return fichiersAvecExtensions(racine, [".tsx"]);
}

/**
 * Tout le source TypeScript sous `racine` — `.ts` ET `.tsx`.
 *
 * ⚠️ Une garde qui ne balaie que les `.tsx` ne voit pas la moitié du dépôt : un import
 * interdit posé dans un `lib/*.ts` lui échapperait, et « aucun offender » se lirait alors
 * comme une preuve.
 */
export function fichiersSource(racine: string): string[] {
  return fichiersAvecExtensions(racine, [".ts", ".tsx"]);
}

function fichiersAvecExtensions(racine: string, extensions: readonly string[]): string[] {
  return readdirSync(racine, { withFileTypes: true }).flatMap((e) => {
    // `join` rend le séparateur de la PLATEFORME (`\` sous Windows) ; tout le reste du
    // dépôt compare des chemins en `/` (littéraux, CI Linux). Sans cette normalisation,
    // ces gardes rougissent en local sous Windows tout en restant vertes en CI.
    const chemin = join(racine, e.name).replaceAll("\\", "/");
    if (e.isDirectory()) return fichiersAvecExtensions(chemin, extensions);
    return e.isFile() && extensions.some((x) => e.name.endsWith(x)) ? [chemin] : [];
  });
}
