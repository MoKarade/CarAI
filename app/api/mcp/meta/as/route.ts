// app/api/mcp/meta/as/route.ts — métadonnées de découverte OAuth.
//
// ⚠️ LE TYPE EST DANS LE CHEMIN, PAS DANS LA QUERY, et c'est un bug vécu : une réécriture
// Next vers `/api/mcp/meta?type=as` atteint bien le handler, mais `request.url` y porte
// encore le chemin D'ORIGINE (`/.well-known/...`) — la query de la destination est perdue,
// et le endpoint répondait 404 sur une réécriture pourtant correcte. Un segment de chemin,
// lui, passe par le routeur : il survit.
//
// Servi aussi à son chemin normalisé par les rewrites de next.config.mjs.

import { reponseMetadonnees } from "@/lib/mcp/metadonnees";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return reponseMetadonnees(request, "as");
}
