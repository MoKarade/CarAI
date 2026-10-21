// app/api/export/sauvegarde/route.ts — sert la sauvegarde externe chiffrée (CarAI#13).
//
// ⚠️ Route HORS du middleware d'authentification utilisateur (`lib/authGuard.ts`) : DriveAI,
// qui vient la chercher, n'a pas de session Google de Marc. Elle porte son propre garde, le
// jeton `EXPORT_TOKEN` en en-tête `x-export-token`, comparé en temps constant. Sans
// `EXPORT_TOKEN` ou sans `EXPORT_KEY`, elle répond 503 : rien ne sort jamais en clair, et rien
// ne sort sans que Marc ait posé les deux secrets (.github#299).
//
// Un appel = un lot (fichier chiffré autonome). Le contrat complet, l'enchaînement des lots et
// le curseur : `docs/export-sauvegarde.md` et `lib/export/sauvegarde.ts`. Lecture SEULE.

import { neon } from "@neondatabase/serverless";
import { baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { decider, ENTETE_JETON } from "@/lib/export/acces";
import { lireLot, type Executeur } from "@/lib/export/sauvegarde";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request): Promise<Response> {
  const decision = decider({
    jeton: request.headers.get(ENTETE_JETON),
    apres: new URL(request.url).searchParams.get("apres"),
    env: process.env,
  });
  if (decision.type === "refus") {
    return Response.json({ error: decision.erreur }, { status: decision.statut, headers: NO_STORE });
  }

  if (!baseConfiguree()) {
    return Response.json({ error: "DATABASE_URL absent." }, { status: 503, headers: NO_STORE });
  }

  try {
    await assurerMigrations();
    const sql = neon(process.env.DATABASE_URL as string);
    const executer: Executeur = async (texte, params) =>
      (await sql.query(texte, params as unknown[])) as Array<Record<string, unknown>>;

    const lot = await lireLot({ executer, curseur: decision.curseur, cle: decision.cle });
    const horodatage = new Date().toISOString().replace(/[:.]/g, "-");

    return new Response(new Uint8Array(lot.fichier), {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="carai-${horodatage}-${lot.table}.carai"`,
        "X-Export-Curseur": lot.curseur,
        "X-Export-Termine": lot.termine ? "oui" : "non",
        "X-Export-Lignes": String(lot.lignes),
        "X-Export-Table": lot.table,
      },
    });
  } catch (err) {
    // Le détail va aux journaux, jamais au corps : une erreur de base peut citer la requête.
    console.error("[export] lecture impossible", err);
    return Response.json({ error: "lecture impossible" }, { status: 500, headers: NO_STORE });
  }
}
