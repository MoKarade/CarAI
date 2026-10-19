// lib/session.ts — revérification de session côté serveur (défense en profondeur).
//
// Le middleware garde déjà tout ce qui n'est pas explicitement public. Revérifier ICI n'est
// pas redondant : c'est le patron de toutes les apps privées de l'écosystème, parce qu'une
// erreur de matcher — un caractère dans une expression régulière — suffirait à exposer une
// route sans que rien ne le signale. Deux gardes indépendantes, une seule à se tromper.
//
// Phase 1 du plan `auth-asym-hubperso` : lit AUSSI le nouveau cookie signé (le nouveau en
// premier), en plus de l'ancien (Auth.js/JWE). Hubperso ne l'émet pas encore — additif, sans
// effet observable pour Marc tant que la phase 2 n'a pas eu lieu. Le middleware, lui, N'EST
// PAS encore touché (voir lib/authGuard.ts) : le passage de jose en runtime Edge est un
// risque distinct que le plan demande de vérifier en préversion avant la phase 3.

import { auth } from "@/auth";
import { cookies } from "next/headers";
import { isAuthConfigured } from "@/lib/authConfigured";
import { decideSessionEmail } from "@/lib/sessionDecision";
import { lireSessionAsymetrique, NOM_COOKIE_ASYMETRIQUE } from "@/lib/sessionAsymetrique";

export class NonAutorise extends Error {
  constructor(message = "Authentification requise.") {
    super(message);
    this.name = "NonAutorise";
  }
}

/**
 * Exige une session valide appartenant à l'adresse autorisée. Lève sinon.
 *
 * Échec fermé : sans configuration d'auth complète, on refuse — Auth.js seul se contente de
 * logguer `MissingSecret` et LAISSE PASSER (constaté en préproduction sur le hub).
 */
export async function requireSession(): Promise<{ email: string }> {
  if (!isAuthConfigured()) {
    throw new NonAutorise("Authentification non configurée. Accès refusé.");
  }

  const magasin = await cookies();
  const identiteNouvelle = await lireSessionAsymetrique(
    magasin.get(NOM_COOKIE_ASYMETRIQUE)?.value,
  );

  const session = await auth();
  const emailAncien = session?.user?.email ?? null;

  const email = decideSessionEmail(
    identiteNouvelle?.email ?? null,
    emailAncien,
    process.env.AUTHORIZED_EMAIL,
  );

  if (!email) throw new NonAutorise();

  return { email };
}
