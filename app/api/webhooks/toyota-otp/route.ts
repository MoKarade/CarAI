// app/api/webhooks/toyota-otp/route.ts — réception du code de vérification Toyota (Doc 3 §4.3).
//
// ⚠️ Route HORS du middleware d'authentification utilisateur (voir `lib/authGuard.ts`).
// Elle est appelée par un service de courriel entrant (Resend Inbound ou équivalent), qui
// n'aura jamais de session Google.
//
// ── POURQUOI CETTE ROUTE PLUTÔT QU'AWS ───────────────────────────────────────────────
// Le tutoriel de référence pour ce pipeline utilise SES + S3 + Lambda. Marc n'a pas de
// compte AWS (Doc 3 §4.2), et ça ajouterait un fournisseur cloud déconnecté du reste de
// l'écosystème. Un service de courriel entrant qui pousse un webhook JSON supprime
// entièrement la brique S3+Lambda : le courriel arrive ici directement.
//
// ── CE QUI PROTÈGE CETTE ROUTE ───────────────────────────────────────────────────────
// Un secret partagé, comparé en TEMPS CONSTANT. C'est nécessaire : cette route alimente la
// file de codes que l'authentification Toyota va consommer. Sans garde, n'importe qui
// pourrait y injecter des codes et bloquer les connexions en occupant la file.
//
// ⚠️ Le code OTP est un SECRET de courte durée. Il n'est jamais journalisé, jamais renvoyé
// dans la réponse, et purgé après consommation.

import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { baseConfiguree } from "@/lib/db";
import { otpCodes } from "@/lib/db/schema";
import { assurerMigrations } from "@/lib/migrations";
import { expediteurToyota, extraireCodeOtp } from "@/lib/toyota/otp";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Comparaison en temps constant via digests de longueur fixe (même patron que `hubToken`). */
function secretValide(fourni: string | null, attendu: string): boolean {
  if (!fourni) return false;
  const a = createHash("sha256").update(fourni).digest();
  const b = createHash("sha256").update(attendu).digest();
  return timingSafeEqual(a, b);
}

function champ(objet: Record<string, unknown>, ...cles: string[]): string {
  for (const cle of cles) {
    const valeur = objet[cle];
    if (typeof valeur === "string" && valeur.trim()) return valeur;
  }
  return "";
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.TOYOTA_OTP_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return Response.json(
      { error: "webhook OTP désactivé : TOYOTA_OTP_WEBHOOK_SECRET non configuré." },
      { status: 503, headers: NO_STORE },
    );
  }

  // Le secret peut arriver en en-tête dédié ou en Bearer, selon le fournisseur choisi.
  const entete =
    request.headers.get("x-otp-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null;

  if (!secretValide(entete, secret)) {
    return Response.json({ error: "secret invalide" }, { status: 401, headers: NO_STORE });
  }

  let charge: Record<string, unknown>;
  try {
    const brut = await request.json();
    charge = brut && typeof brut === "object" ? (brut as Record<string, unknown>) : {};
  } catch {
    return Response.json({ error: "corps illisible" }, { status: 400, headers: NO_STORE });
  }

  // Les fournisseurs de courriel entrant emboîtent souvent la donnée sous `data`.
  const donnees =
    charge.data && typeof charge.data === "object"
      ? (charge.data as Record<string, unknown>)
      : charge;

  const expediteur = champ(donnees, "from", "sender", "From");
  if (!expediteurToyota(expediteur)) {
    // 200 volontaire : le courriel a bien été reçu, il ne nous concerne simplement pas.
    // Répondre en erreur ferait retenter le fournisseur pour rien.
    return Response.json({ ok: true, ignore: "expéditeur hors Toyota" }, { headers: NO_STORE });
  }

  const corps =
    champ(donnees, "text", "plain", "TextBody") ||
    champ(donnees, "html", "HtmlBody") ||
    champ(donnees, "subject", "Subject");

  const { code, methode } = extraireCodeOtp(corps);
  if (!code) {
    // Le motif d'échec est journalisé, JAMAIS le corps du courriel (il contient le code).
    console.warn(`[otp] aucun code exploitable extrait (méthode : ${methode}).`);
    return Response.json(
      { ok: true, extrait: false, methode },
      { headers: NO_STORE },
    );
  }

  if (!baseConfiguree()) {
    console.error("[otp] code reçu mais DATABASE_URL absent.");
    return Response.json({ ok: true, stocke: false }, { headers: NO_STORE });
  }

  try {
    await assurerMigrations();
    await db.insert(otpCodes).values({ code, receivedAt: new Date() });
  } catch (err) {
    console.error("[otp] stockage impossible", err);
    return Response.json({ error: "stockage impossible" }, { status: 500, headers: NO_STORE });
  }

  // La réponse ne contient PAS le code — seulement la confirmation qu'il a été capté.
  return Response.json({ ok: true, extrait: true, methode }, { headers: NO_STORE });
}
