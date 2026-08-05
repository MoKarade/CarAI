// lib/session.ts — revérification de session côté serveur (défense en profondeur).
//
// Le middleware garde déjà tout ce qui n'est pas explicitement public. Revérifier ICI n'est
// pas redondant : c'est le patron de toutes les apps privées de l'écosystème, parce qu'une
// erreur de matcher — un caractère dans une expression régulière — suffirait à exposer une
// route sans que rien ne le signale. Deux gardes indépendantes, une seule à se tromper.

import { auth } from "@/auth";
import { isAuthConfigured } from "@/lib/authConfigured";
import { isAuthorizedEmail } from "@/lib/authorized";

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

  const session = await auth();
  const email = session?.user?.email ?? null;

  if (!isAuthorizedEmail(email, process.env.AUTHORIZED_EMAIL)) {
    throw new NonAutorise();
  }

  return { email: email as string };
}
