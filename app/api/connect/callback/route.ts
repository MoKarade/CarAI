// app/api/connect/callback/route.ts — retour du flow Smartcar Connect (Doc 2 §3.4).
//
// Reçoit le résultat de l'autorisation et conserve le `userId` en base — pas en variable
// d'environnement, sinon Marc devrait recopier une valeur dans Vercel puis redéployer,
// c'est-à-dire exactement la manipulation manuelle qu'il refuse (Doc 1 §4.1).
//
// Route DERRIÈRE le middleware : c'est le navigateur de Marc, déjà connecté, qui revient.

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { CLE_SMARTCAR_USER, CLE_SMARTCAR_VEHICLE, ecrireConfig } from "@/lib/config";
import { baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { lireRetourConnect } from "@/lib/smartcar/connect";
import { contexteSmartcar, listerVehicules } from "@/lib/smartcar/client";
import { requireSession } from "@/lib/session";
import { COOKIE_STATE } from "../route";

export const dynamic = "force-dynamic";

function versAccueil(message: string, ok: boolean): never {
  redirect(`/?connect=${ok ? "ok" : "erreur"}&message=${encodeURIComponent(message)}`);
}

/** Cherche un identifiant de véhicule dans la réponse, sans supposer une forme exacte. */
function premierVehicleId(charge: unknown): string | null {
  if (!charge || typeof charge !== "object") return null;
  const objet = charge as Record<string, unknown>;
  const liste = Array.isArray(objet.vehicles)
    ? objet.vehicles
    : Array.isArray(objet.data)
      ? objet.data
      : null;
  if (!liste || liste.length === 0) return null;

  const premier = liste[0];
  if (typeof premier === "string") return premier;
  if (premier && typeof premier === "object") {
    const id = (premier as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  return null;
}

export async function GET(request: Request): Promise<Response> {
  await requireSession();

  const url = new URL(request.url);
  const retour = lireRetourConnect(url.searchParams);

  // Vérification anti-CSRF AVANT toute écriture : le cookie est consommé quoi qu'il arrive.
  const jar = await cookies();
  const attendu = jar.get(COOKIE_STATE)?.value ?? null;
  jar.delete(COOKIE_STATE);

  if (!attendu || retour.state !== attendu) {
    versAccueil(
      "Retour de connexion non vérifiable (state absent ou différent). Relance le Connect depuis CarAI.",
      false,
    );
  }

  if (!retour.ok) versAccueil(retour.message, false);

  if (!baseConfiguree()) {
    versAccueil("Véhicule autorisé, mais la base n'est pas configurée : rien n'a pu être enregistré.", false);
  }

  await assurerMigrations();

  // Le `userId` peut venir directement du retour ; sinon Smartcar l'a associé au code.
  const userId = retour.userId;
  if (!userId) {
    versAccueil(
      "Smartcar n'a pas renvoyé d'identifiant utilisateur. Vérifie la configuration du Connect dans le tableau de bord Smartcar.",
      false,
    );
  }

  await ecrireConfig(CLE_SMARTCAR_USER, userId);

  // Le véhicule est identifié dans la foulée : sans son `vehicleId`, aucune commande ni
  // lecture ciblée n'est possible, et attendre le premier webhook pour l'apprendre
  // laisserait CarAI à moitié branché sans que ce soit visible.
  try {
    const contexte = await contexteSmartcar(async () => userId);
    if (contexte) {
      const reponse = await listerVehicules(contexte);
      const vehicleId = premierVehicleId(reponse.data);
      if (vehicleId) await ecrireConfig(CLE_SMARTCAR_VEHICLE, vehicleId);
    }
  } catch (err) {
    // L'autorisation est acquise — c'est l'essentiel. L'identification du véhicule pourra
    // se refaire ; échouer ici ne doit pas annuler le Connect que Marc vient de réussir.
    console.error("[connect] identification du véhicule impossible", err);
  }

  versAccueil("Véhicule connecté à Smartcar.", true);
}
