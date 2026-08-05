// app/api/connect/route.ts — démarrage du flow Smartcar Connect (Doc 2 §3.4).
//
// Marc clique une fois, autorise son véhicule chez Smartcar, et CarAI reçoit un `userId`
// à conserver. Cette route reste DERRIÈRE le middleware d'authentification : elle est
// déclenchée par un humain connecté, pas par une machine.

import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { clientIdConnect, credentialsSmartcar } from "@/lib/smartcar/auth";
import { construireUrlConnect } from "@/lib/smartcar/connect";
import { requireSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export const COOKIE_STATE = "carai_connect_state";

export async function GET(request: Request): Promise<Response> {
  await requireSession();

  const credentials = credentialsSmartcar();
  if (!credentials) {
    return Response.json(
      {
        error:
          "Smartcar non configuré : pose SMARTCAR_CLIENT_ID et SMARTCAR_CLIENT_SECRET dans l'environnement.",
      },
      { status: 503 },
    );
  }

  // ⚠️ Le Connect n'utilise PAS forcément le même identifiant que les appels API — voir
  // `clientIdConnect` dans lib/smartcar/auth.ts. Confondre les deux produit un
  // « 400: Invalid parameter client_id » côté Smartcar, vécu le 05/08/2026.
  const clientId = clientIdConnect();
  if (!clientId) {
    return Response.json(
      { error: "Aucun identifiant Smartcar configuré pour le Connect." },
      { status: 503 },
    );
  }

  const origine = new URL(request.url).origin;
  const redirectUri =
    process.env.SMARTCAR_REDIRECT_URI?.trim() || `${origine}/api/connect/callback`;

  // `state` anti-CSRF : sans lui, un tiers pourrait amener Marc à rattacher un AUTRE
  // véhicule à son CarAI. Déposé en cookie httpOnly et revérifié au retour.
  const state = randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set(COOKIE_STATE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 900,
  });

  redirect(
    construireUrlConnect({
      clientId,
      redirectUri,
      state,
      mode: process.env.SMARTCAR_MODE === "test" ? "test" : "live",
    }),
  );
}
