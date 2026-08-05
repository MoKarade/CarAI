// app/api/cron/toyota-poll/route.ts — cycle de poll Toyota planifié (Doc 3 §5.3).
//
// ⚠️ Route HORS du middleware d'authentification utilisateur (voir `lib/authGuard.ts`) :
// le planificateur Vercel n'a pas de session Google. Elle porte son propre garde, le
// secret `CRON_SECRET`.
//
// Aucune intervention manuelle n'est requise en fonctionnement normal — même contrainte que
// pour les migrations (Doc 1 §4.1). La planification vit dans `vercel.json`.
//
// ── SUR L'ÉCHEC : IL EST RAPPORTÉ, PAS PROPAGÉ ───────────────────────────────────────
// `executerCycleToyota` ne lève jamais. Cette route répond donc 200 même quand le cycle
// échoue, avec le détail dans le corps. C'est délibéré : un 500 récurrent sur un cron
// finirait par ressembler à une panne de CarAI, alors que la seule chose en cause serait
// une source non officielle dont l'indisponibilité est PRÉVUE par l'architecture.

import { createHash, timingSafeEqual } from "node:crypto";
import { baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { executerCycleToyota } from "@/lib/toyota/cycle";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function secretValide(fourni: string | null, attendu: string): boolean {
  if (!fourni) return false;
  const a = createHash("sha256").update(fourni).digest();
  const b = createHash("sha256").update(attendu).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json(
      { error: "cron désactivé : CRON_SECRET non configuré." },
      { status: 503, headers: NO_STORE },
    );
  }

  const fourni =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret");

  if (!secretValide(fourni, secret)) {
    return Response.json({ error: "non autorisé" }, { status: 401, headers: NO_STORE });
  }

  if (!baseConfiguree()) {
    return Response.json(
      { ok: false, raison: "DATABASE_URL absent." },
      { headers: NO_STORE },
    );
  }

  await assurerMigrations();
  const resultat = await executerCycleToyota();

  return Response.json(
    {
      ok: true,
      execute: resultat.execute,
      raison: resultat.raison,
      snapshotsEcrits: resultat.snapshotsEcrits,
      reveilForce: resultat.decision?.reveilForce ?? false,
      erreur: resultat.erreur,
      moduleDesactive: resultat.moduleDesactive,
    },
    { headers: NO_STORE },
  );
}
