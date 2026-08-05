// mcp/tools/vehicle-status.tools.ts — état courant du véhicule (Doc 4 §3.1).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { baseConfiguree } from "@/lib/db";
import { lireSanteToyota } from "@/lib/config";
import { moduleActif } from "@/lib/toyota/health";
import {
  libelle,
  lireEtatVehicule,
  nomSource,
  sourcesEnDesaccord,
  type MesureQualifiee,
} from "@/lib/vehicle/state";
import {
  EntreeVehicleStatus,
  type SortieVehicleStatus as TypeSortie,
} from "../schemas/vehicle-status.schema";

function enJson(valeur: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(valeur, null, 2) }] };
}

function serialiser(m: MesureQualifiee) {
  return {
    metrique: m.metricType,
    libelle: libelle(m.metricType),
    valeur: m.valueNumeric ?? m.valueText ?? (m.valueJson as never) ?? null,
    unite: m.unit,
    source: m.source,
    sourceLibelle: nomSource(m.source),
    recordedAt: m.recordedAt.toISOString(),
    ageMinutes: Math.round(m.ageMinutes),
    interpretationFiable: m.interpretationFiable,
    ...(m.locationType ? { locationType: m.locationType } : {}),
  };
}

export async function etatVehicule(args: {
  metriques?: string[];
}): Promise<TypeSortie> {
  if (!baseConfiguree()) {
    return {
      mesures: [],
      desaccords: [],
      sourcesPresentes: [],
      sourcesIndisponibles: [],
      fraicheurMax: null,
      panne: "Base de données non configurée (DATABASE_URL).",
    };
  }

  const maintenant = new Date();
  const etat = await lireEtatVehicule(maintenant);

  const filtrees = args.metriques?.length
    ? etat.mesures.filter((m) => args.metriques!.includes(m.metricType))
    : etat.mesures;

  // Désaccords entre sources : SIGNALÉS, jamais arbitrés (Doc 4 §3.1). Les deux valeurs
  // restent présentes — c'est à Claude ou à Marc de juger laquelle est la plus fraîche.
  const parMetrique = new Map<string, MesureQualifiee[]>();
  for (const m of filtrees) {
    parMetrique.set(m.metricType, [...(parMetrique.get(m.metricType) ?? []), m]);
  }
  const desaccords = [...parMetrique.entries()]
    .filter(([, mesures]) => sourcesEnDesaccord(mesures))
    .map(([metrique]) => metrique);

  // Une source absente est DITE (Doc 4 §5), sans faire échouer l'appel entier.
  const sourcesIndisponibles: Array<{ source: string; raison: string }> = [];
  if (!etat.sources.includes("toyota_na")) {
    const sante = await lireSanteToyota();
    const { actif, raison } = moduleActif({ sante, maintenant });
    if (!actif) sourcesIndisponibles.push({ source: "toyota_na", raison });
  }
  if (!etat.sources.includes("smartcar")) {
    sourcesIndisponibles.push({
      source: "smartcar",
      raison: "Aucune donnée Smartcar enregistrée à ce jour.",
    });
  }

  return {
    mesures: filtrees.map(serialiser),
    desaccords,
    sourcesPresentes: etat.sources,
    sourcesIndisponibles,
    fraicheurMax: etat.fraicheurMax?.toISOString() ?? null,
    panne: null,
  };
}

export function registerVehicleStatus(server: McpServer): void {
  server.tool(
    "get_vehicle_status",
    "État courant du véhicule électrique, toutes sources confondues (Smartcar + Toyota si disponible). " +
      "Chaque mesure porte sa source et l'instant où le VÉHICULE l'a produite — pas l'instant de réception. " +
      "La fraîcheur Toyota via Smartcar est de 30 à 60 minutes : ce n'est jamais du temps réel strict. " +
      "Quand deux sources se contredisent, LES DEUX sont renvoyées avec leur horodatage plutôt qu'une valeur arbitrée.",
    EntreeVehicleStatus,
    async (args) => enJson(await etatVehicule(args)),
  );
}
