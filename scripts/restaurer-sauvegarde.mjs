// scripts/restaurer-sauvegarde.mjs — relit des lots d'export CarAI dans une base (CarAI#13).
//
// Usage : EXPORT_KEY=<clé base64> RESTAURATION_DATABASE_URL=<base d'ESSAI> \
//           node scripts/restaurer-sauvegarde.mjs <dossier-ou-fichiers.carai…> [--forcer-non-vide]
//
// ⚠️ La cible se donne par `RESTAURATION_DATABASE_URL`, JAMAIS `DATABASE_URL` : une variable de
// la production, laissée dans l'environnement, ne doit pas pouvoir recevoir une restauration
// par accident. La base cible doit déjà être MIGRÉE (les tables existent, voir `drizzle/`).
// Elle doit être VIDE de mesures : sinon le script refuse, sauf `--forcer-non-vide`.
//
// Tout est déchiffré et vérifié AVANT la première écriture : un fichier altéré ou une mauvaise
// clé n'écrit rien. Rejouable sans doublon. N'imprime que des COMPTES, jamais une valeur ni la clé.
// Les fichiers se lisent dans l'ordre de leur nom (il commence par l'horodatage du lot).
//
// Charge `lib/export/sauvegarde.ts` directement : Node 22.18+ retire les types à l'import.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";
import { cleDepuisEnv, lireFichier, restaurerLots } from "../lib/export/sauvegarde.ts";

const arguments_ = process.argv.slice(2);
const forcer = arguments_.includes("--forcer-non-vide");
const chemins = arguments_.filter((a) => !a.startsWith("--"));

function arreter(message, code = 2) {
  console.error(`restaurer-sauvegarde : ${message}`);
  process.exit(code);
}

if (chemins.length === 0) arreter("indique un dossier ou des fichiers .carai à relire.");

const cle = cleDepuisEnv(process.env.EXPORT_KEY);
if (!cle) arreter("EXPORT_KEY absente ou invalide (32 octets en base64).");

const fichiers = chemins
  .flatMap((c) => (statSync(c).isDirectory() ? readdirSync(c).filter((f) => f.endsWith(".carai")).sort().map((f) => join(c, f)) : [c]))
  .sort((a, b) => a.split("/").pop().localeCompare(b.split("/").pop()));
if (fichiers.length === 0) arreter("aucun fichier .carai trouvé.");

// 1. Tout déchiffrer d'abord : rien ne s'écrit si un seul fichier est mauvais.
const clairs = [];
for (const f of fichiers) {
  try {
    clairs.push(lireFichier(readFileSync(f), cle));
  } catch (e) {
    arreter(`${f} : ${e.message}`, 1);
  }
}
console.log(`${fichiers.length} fichier(s) déchiffré(s) et vérifié(s).`);

const url = process.env.RESTAURATION_DATABASE_URL?.trim();
if (!url) arreter("RESTAURATION_DATABASE_URL absente : donne la base d'ESSAI à remplir.");

const sql = neon(url);
const executer = async (texte, params) => sql.query(texte, params);

// 2. Une base qui a déjà des mesures n'est pas une base d'essai vide.
const [{ n }] = await executer("SELECT count(*)::int AS n FROM vehicle_snapshots", []);
if (n > 0 && !forcer) {
  arreter(`la base cible contient déjà ${n} mesure(s). Pas une base d'essai vide : rien n'a été écrit (--forcer-non-vide pour continuer).`, 1);
}

const bilan = await restaurerLots(executer, clairs);
for (const [table, lues] of Object.entries(bilan.lues)) {
  console.log(`${table} : ${lues} rangée(s) lue(s), ${bilan.inserees[table] ?? 0} insérée(s)`);
}
console.log("Restauration terminée.");
