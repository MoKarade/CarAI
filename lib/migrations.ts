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

import { migrate } from "drizzle-orm/neon-http/migrator";
import { resolve } from "node:path";
import { db, baseConfiguree } from "./db";

let enCours: Promise<void> | null = null;
let derniereErreur: string | null = null;

/** Ce que la dernière tentative a donné — pour le diagnostic, jamais pour décider. */
export function etatMigrations(): { tentee: boolean; erreur: string | null } {
  return { tentee: enCours !== null, erreur: derniereErreur };
}

/** Oublie la mémorisation. Utilisé par les tests, et après un échec (voir plus bas). */
export function reinitialiserMigrations(): void {
  enCours = null;
  derniereErreur = null;
}

/**
 * Applique les migrations en attente. Sans effet si tout est à jour.
 *
 * N'échoue JAMAIS vers l'appelant : l'affichage prime sur la mise à niveau. Un appelant qui
 * devrait gérer cette erreur finirait par l'avaler pour ne pas casser sa page — autant le
 * faire ici, une fois, en le disant.
 */
export async function assurerMigrations(): Promise<void> {
  if (!baseConfiguree()) return;
  if (enCours) return enCours;

  enCours = (async () => {
    try {
      // Dossier résolu depuis la racine du projet : `process.cwd()` est stable sur Vercel
      // comme en local, contrairement à un chemin relatif au module compilé.
      await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
      derniereErreur = null;
    } catch (err) {
      derniereErreur = err instanceof Error ? err.message : String(err);
      console.error("[migrations] application impossible", err);
      // On ne relance pas : la page doit s'afficher, et une table réellement manquante se
      // verra à l'écran plutôt que de passer inaperçue.
      //
      // ⚠️ Mais on OUBLIE la mémorisation. Sans cette ligne, une promesse ÉCHOUÉE reste
      // en cache pour toute la vie du processus : le premier échec (un blip réseau au
      // démarrage à froid) condamnerait l'instance à ne plus jamais retenter, et l'app
      // servirait « schéma absent » indéfiniment alors qu'un simple nouvel essai
      // suffirait. Mémoriser un SUCCÈS est une optimisation ; mémoriser un ÉCHEC est un
      // verrou définitif.
      enCours = null;
    }
  })();

  return enCours;
}
