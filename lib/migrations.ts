// lib/migrations.ts — appliquer les migrations sans jamais taper une commande.
//
// Exigence de Marc, reprise du Doc 1 §4.1 : il ne doit JAMAIS avoir à lancer une commande
// sur son PC. Deux approches existaient dans l'écosystème ; CarAI prend celle de JobAI —
// migrations au DÉMARRAGE — parce que CarAI a des tâches de fond (webhooks Smartcar, poll
// Toyota) qui doivent pouvoir réparer le schéma sans attendre un redéploiement.
//
// POURQUOI C'EST SÛR DE L'APPELER À CHAQUE DÉMARRAGE
// Drizzle tient lui-même `__drizzle_migrations` : chaque fichier SQL n'est appliqué qu'une
// fois, et il sait lesquels. Rejouer cette fonction n'a aucun effet quand tout est à jour.
//
// UNE SEULE FOIS PAR PROCESSUS
// La promesse est mémorisée : dix requêtes simultanées sur une instance froide ne
// déclenchent qu'une application. Entre INSTANCES, c'est Drizzle qui arbitre.
//
// UN ÉCHEC NE DOIT PAS ÉTEINDRE L'APP
// Si les migrations échouent, les pages s'affichent avec ce que la base a déjà, et une
// table manquante donne un écran honnête plutôt qu'une page blanche. L'erreur est
// journalisée et LISIBLE via `etatMigrations()` — jamais avalée en silence.
//
// ⚠️ REVU LE 29/09/2026 — MARTÈLEMENT MESURÉ EN PRODUCTION. Panne Neon (quota HTTP 402,
// donc PAS transitoire) : chaque page (`assurerMigrations` est appelé par quasi tout
// `app/`) retentait la migration COMPLÈTE à CHAQUE requête, faute de délai entre deux
// tentatives après un échec. ~1 240 requêtes/24 h mesurées en production pendant la
// panne (`/activite` 785, `/api/mcp` 310, webhooks et crons compris) : autant de
// tentatives de migration qui ont continué à frapper une base déjà à quota, au lieu de la
// laisser respirer. `COOLDOWN_ECHEC_MS` borne ça SANS renoncer à « réparer sans
// redéploiement » (exigence de Marc, voir plus haut) : une instance retente encore après
// un échec, juste pas à CHAQUE requête suivante.

import { migrate } from "drizzle-orm/neon-http/migrator";
import { resolve } from "node:path";
import { db, baseConfiguree } from "./db";

/** Après un échec, aucune nouvelle tentative avant ce délai — voir la note du 29/09 ci-dessus. */
export const COOLDOWN_ECHEC_MS = 60_000;

/** Pure — testée sans base : sommes-nous encore dans la fenêtre suivant un échec ? */
export function dansCooldown(
  dernierEchecMs: number | null,
  maintenantMs: number,
  cooldownMs: number = COOLDOWN_ECHEC_MS,
): boolean {
  return dernierEchecMs !== null && maintenantMs - dernierEchecMs < cooldownMs;
}

let enCours: Promise<void> | null = null;
let derniereErreur: string | null = null;
let dernierEchecMs: number | null = null;

/** Ce que la dernière tentative a donné — pour le diagnostic, jamais pour décider. */
export function etatMigrations(): { tentee: boolean; erreur: string | null } {
  return { tentee: enCours !== null, erreur: derniereErreur };
}

/** Oublie la mémorisation ET le cooldown. Utilisé par les tests, et après un échec (voir plus bas). */
export function reinitialiserMigrations(): void {
  enCours = null;
  derniereErreur = null;
  dernierEchecMs = null;
}

/**
 * Applique les migrations en attente. Sans effet si tout est à jour.
 *
 * N'échoue JAMAIS vers l'appelant : l'affichage prime sur la mise à niveau. Un appelant qui
 * devrait gérer cette erreur finirait par l'avaler pour ne pas casser sa page — autant le
 * faire ici, une fois, en le disant.
 *
 * `maintenantMs` est injectable pour les tests — jamais fourni en production, où `Date.now()`
 * fait foi.
 */
export async function assurerMigrations(maintenantMs: number = Date.now()): Promise<void> {
  if (!baseConfiguree()) return;
  if (enCours) return enCours;
  // Cooldown après un échec : voir la note du 29/09 en tête de fichier. Silencieux, comme
  // un échec de migration ordinaire — l'appelant ne voit jamais la différence.
  if (dansCooldown(dernierEchecMs, maintenantMs)) return;

  enCours = (async () => {
    try {
      // Dossier résolu depuis la racine du projet : `process.cwd()` est stable sur Vercel
      // comme en local, contrairement à un chemin relatif au module compilé.
      await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
      derniereErreur = null;
      dernierEchecMs = null;
    } catch (err) {
      derniereErreur = err instanceof Error ? err.message : String(err);
      console.error("[migrations] application impossible", err);
      // On ne relance pas : la page doit s'afficher, et une table réellement manquante se
      // verra à l'écran plutôt que de passer inaperçue.
      //
      // ⚠️ Mais on OUBLIE la mémorisation. Sans cette ligne, une promesse ÉCHOUÉE resterait
      // en cache pour toute la vie du processus : le premier échec (un blip réseau au
      // démarrage à froid) condamnerait l'instance à ne plus jamais retenter, et l'app
      // servirait « schéma absent » indéfiniment alors qu'un simple nouvel essai
      // suffirait. Mémoriser un SUCCÈS est une optimisation ; mémoriser un ÉCHEC SANS
      // COOLDOWN est un marteau — c'est le cooldown ci-dessus, pas la mémorisation
      // elle-même, qui empêche la prochaine requête de retenter immédiatement.
      enCours = null;
      dernierEchecMs = maintenantMs;
    }
  })();

  return enCours;
}
