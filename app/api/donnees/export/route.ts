// app/api/donnees/export/route.ts — export CSV de TOUTES les mesures.
//
// C'est le chemin « récupérer toutes les données » : le tableau de /donnees affiche une
// page à la fois, l'export livre l'HISTORIQUE COMPLET de la sélection — y compris les
// coordonnées GPS et le contenu des détails JSON, que l'écran ne montre pas. Un fichier
// téléchargé derrière l'authentification n'est pas une page ouverte sur un coin de bureau.
//
// Route DERRIÈRE le middleware d'auth (elle n'est pas dans ses exclusions) + session
// revérifiée ici même — le patron de l'écosystème, en double garde.
//
// STREAMING par pages : la table est conçue pour croître des années sans purge. Tout
// charger en mémoire finirait par tuer la fonction serverless précisément le jour où
// l'export a le plus de valeur. Chaque page est requêtée, formatée, poussée, oubliée.

import { NextResponse } from "next/server";
import { documentCsv, ligneCsv } from "@/lib/csv";
import { assurerMigrations } from "@/lib/migrations";
import { baseConfiguree } from "@/lib/db";
import {
  depuisPourPeriode,
  listerMesures,
  type FiltresMesures,
} from "@/lib/vehicle/mesures";
import { NonAutorise, requireSession } from "@/lib/session";
import type { VehicleSnapshot } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const TAILLE_PAGE_EXPORT = 2_000;

const ENTETES = [
  "id",
  "mesure_le",
  "recu_le",
  "source",
  "metrique",
  "code_signal",
  "statut_signal",
  "valeur_numerique",
  "valeur_texte",
  "valeur_json",
  "unite",
  "type_position",
];

function versLigne(m: VehicleSnapshot): Array<string | number | null> {
  return [
    m.id,
    m.recordedAt.toISOString(),
    m.receivedAt.toISOString(),
    m.source,
    m.metricType,
    m.signalCode,
    m.signalStatus,
    m.valueNumeric,
    m.valueText,
    m.valueJson === null || m.valueJson === undefined ? null : JSON.stringify(m.valueJson),
    m.unit,
    m.locationType,
  ];
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof NonAutorise) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw err;
  }

  if (!baseConfiguree()) {
    return NextResponse.json(
      { error: "base non configurée (DATABASE_URL absent)" },
      { status: 503 },
    );
  }

  // Les MÊMES filtres que le tableau : l'export livre ce que l'écran annonce. Sans
  // paramètre, il livre TOUT l'historique.
  const params = new URL(request.url).searchParams;
  const maintenant = new Date();
  const filtres: FiltresMesures = {
    metricType: params.get("metrique") || null,
    source: params.get("source") || null,
    depuis: depuisPourPeriode(params.get("periode") ?? "tout", maintenant),
  };

  await assurerMigrations();

  const encodeur = new TextEncoder();
  const flux = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Pagination par CURSEUR, jamais par offset : la table reçoit des lignes en
        // continu, et un offset qui se décale entre deux pages DUPLIQUE des lignes en
        // silence (leçon DriveAI sur les files mouvantes). Le curseur fige la position.
        let curseur: { recordedAt: Date; id: number } | null = null;
        let premierePage = true;

        for (;;) {
          const { lignes } = await listerMesures({
            filtres,
            limite: TAILLE_PAGE_EXPORT,
            curseur,
          });

          if (premierePage) {
            // Première page AVEC l'en-tête (et le BOM qu'il transporte).
            controller.enqueue(
              encodeur.encode(documentCsv(ENTETES, lignes.map(versLigne))),
            );
            premierePage = false;
          } else if (lignes.length > 0) {
            const bloc = lignes.map((l) => ligneCsv(versLigne(l))).join("\r\n");
            controller.enqueue(encodeur.encode(`${bloc}\r\n`));
          }

          if (lignes.length < TAILLE_PAGE_EXPORT) break;
          const derniere = lignes[lignes.length - 1]!;
          curseur = { recordedAt: derniere.recordedAt, id: derniere.id };
        }
        controller.close();
      } catch (err) {
        // Un flux coupé se VOIT (téléchargement en erreur) — c'est le comportement
        // honnête. L'avaler produirait un CSV tronqué que rien ne distingue d'un complet.
        console.error("[export] flux interrompu", err);
        controller.error(err);
      }
    },
  });

  const dateFichier = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
  }).format(maintenant);

  return new Response(flux, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="carai-mesures-${dateFichier}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
