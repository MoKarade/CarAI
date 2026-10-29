// app/api/sante/route.ts — santé publique, pour la vigie de l'Atelier (#204).
//
// ⚠️ Route HORS du middleware d'authentification, SANS auth du tout — délibérément. Elle ne
// rend jamais de donnée du véhicule ni un message d'erreur brut, seulement {"ok": true|false} et le commit servi (7 caractères).
// Le piège que ça évite : derrière le garde de session, la vigie recevrait une redirection
// HTML au lieu du JSON attendu et ne verrait JAMAIS une panne de base — exactement le défaut
// de `/hub/summary` (voir l'en-tête de lib/authGuard.ts), revécu avec un autre appelant.
//
// ── POURQUOI CETTE ROUTE EXISTE ──────────────────────────────────────────────────────
// Incident du 29/09/2026 : Neon a dépassé son quota, la base refusait tout, et rien ne
// s'affichait — mais la page d'accueil répondait quand même 307 (redirection vers /login),
// donc une sonde qui ne regarde que le code HTTP de l'accueil ne voit AUCUNE panne.
//
// ── RESPECTE LE COOLDOWN DES MIGRATIONS ──────────────────────────────────────────────
// `assurerMigrations()` (lib/migrations.ts, 29/09/2026) porte son propre cooldown de 60 s
// après un échec : un appel horaire de la vigie ne martèle jamais une base déjà en panne.
// Et la route étant publique, le verdict est gardé 45 s par instance (lib/sante.ts) : un
// inconnu qui la martèle ne touche Neon qu'une fois par fenêtre.

import { sql } from "drizzle-orm";
import { db, baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { commitServi, creerCacheSante } from "@/lib/sante";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/**
 * Sonde réelle : migrations (avec leur propre cooldown) puis SELECT 1. true = base joignable.
 * Le motif détaillé d'une panne est journalisé, JAMAIS renvoyé : la vigie n'a besoin que de
 * « ok/pas ok », et un message d'erreur brut pourrait porter des détails de connexion.
 */
async function sonderBase(): Promise<boolean> {
  await assurerMigrations();
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch (err) {
    console.error("[sante] base injoignable", err);
    return false;
  }
}

// Mémoire par instance (lib/sante.ts) : la route est PUBLIQUE, au plus une sonde par
// fenêtre de 45 s touche Neon, quel que soit le nombre d'appels.
const santeBase = creerCacheSante(sonderBase);

export async function GET(): Promise<Response> {
  // Le commit servi, dans les deux verdicts : c'est justement quand la sonde est rouge
  // qu'on veut savoir quel déploiement répond. Champ absent hors Vercel.
  const commit = commitServi(process.env.VERCEL_GIT_COMMIT_SHA);
  const servi = commit ? { commit } : {};

  if (!baseConfiguree()) {
    return Response.json({ ok: false, cause: "base", ...servi }, { status: 503, headers: NO_STORE });
  }

  if (await santeBase()) return Response.json({ ok: true, ...servi }, { headers: NO_STORE });
  return Response.json({ ok: false, cause: "base", ...servi }, { status: 503, headers: NO_STORE });
}
