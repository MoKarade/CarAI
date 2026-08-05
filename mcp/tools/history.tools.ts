// mcp/tools/history.tools.ts — historique, entretien et suivi du bail (Doc 4 §3.2-3.4).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { baseConfiguree } from "@/lib/db";
import { lireBail } from "@/lib/config";
import { historiqueOdometre, lireSerie, type Granularite } from "@/lib/vehicle/history";
import { calculerEtatBail, resumerBail } from "@/lib/vehicle/lease";
import { lireEntretiens, noteCompletude } from "@/lib/vehicle/service";
import { EntreeHistory, EntreeLease, EntreeServiceHistory } from "../schemas/history.schema";

function enJson(valeur: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(valeur, null, 2) }] };
}

function dateOuUndefined(texte?: string): Date | undefined {
  if (!texte) return undefined;
  const d = new Date(texte);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function historique(args: {
  metrique: string;
  depuis?: string;
  jusqua?: string;
  granularite?: Granularite;
  source?: string;
}) {
  if (!baseConfiguree()) {
    return { erreur: "Base de données non configurée (DATABASE_URL)." };
  }

  const serie = await lireSerie({
    metricType: args.metrique,
    debut: dateOuUndefined(args.depuis),
    fin: dateOuUndefined(args.jusqua),
    granularite: args.granularite ?? "brut",
    source: args.source,
  });

  return {
    metrique: serie.metricType,
    unite: serie.unite,
    granularite: serie.granularite,
    points: serie.points.map((p) => ({
      instant: p.instant.toISOString(),
      valeur: p.valeur,
      source: p.source,
      echantillons: p.echantillons,
    })),
    vide: serie.vide,
    ...(args.metrique === "odometer" && serie.granularite !== "brut"
      ? {
          noteAgregation:
            "Odomètre agrégé par MAXIMUM et non par moyenne : un odomètre ne fait que croître, sa moyenne ne correspondrait à aucun kilométrage réel.",
        }
      : {}),
  };
}

export async function entretiens(args: { depuis?: string; jusqua?: string }) {
  if (!baseConfiguree()) {
    return { erreur: "Base de données non configurée (DATABASE_URL)." };
  }

  const lignes = await lireEntretiens({
    debut: dateOuUndefined(args.depuis),
    fin: dateOuUndefined(args.jusqua),
  });

  return {
    entretiens: lignes.map((e) => ({
      date: e.serviceDate.toISOString(),
      odometre: e.odometerAtService,
      odometreUnite: e.odometerUnit,
      taches: e.tasks,
      type: e.serviceType,
      cout: e.totalCost,
      devise: e.currency,
      source: e.source,
    })),
    total: lignes.length,
    ...(noteCompletude(lignes) ? { note: noteCompletude(lignes) } : {}),
  };
}

export async function etatBail() {
  if (!baseConfiguree()) {
    return { erreur: "Base de données non configurée (DATABASE_URL)." };
  }

  const maintenant = new Date();
  const [termes, points] = await Promise.all([lireBail(), historiqueOdometre()]);
  const etat = calculerEtatBail({ bail: termes, historiqueOdometre: points, maintenant });

  return {
    kilometrageActuel: etat.kilometrageActuel,
    mesureLe: etat.kilometrageMesureLe?.toISOString() ?? null,
    allocationTotale: etat.allocationTotale,
    consommePourcent: etat.consommePourcent,
    ecoulePourcent: etat.ecoulePourcent,
    debutBail: etat.debutBail.toISOString(),
    finBail: etat.finBail.toISOString(),
    joursRestants: etat.joursRestants,
    rythmeKmParJour: etat.rythmeKmParJour,
    rythmeAutoriseKmParJour: etat.rythmeAutoriseKmParJour,
    projectionFinBail: etat.projectionFinBail,
    depassementProjete: etat.depassementProjete,
    coutDepassementProjete: etat.coutDepassementProjete,
    devise: etat.devise,
    resume: resumerBail(etat),
    limites: etat.limites,
  };
}

export function registerHistory(server: McpServer): void {
  server.tool(
    "get_vehicle_history",
    "Série temporelle d'une métrique du véhicule, pour tracer un graphique ou dégager une tendance. " +
      "La rétention est illimitée : préférer une granularité (heure/jour/semaine) sur les longues fenêtres.",
    EntreeHistory,
    async (args) => enJson(await historique(args as Parameters<typeof historique>[0])),
  );

  server.tool(
    "get_service_history",
    "Historique d'entretien du véhicule : dates, kilométrage, tâches, coûts. " +
      "Les champs absents le RESTENT (la richesse dépend de ce que la marque fournit) — un coût manquant n'est jamais 0.",
    EntreeServiceHistory,
    async (args) => enJson(await entretiens(args)),
  );

  server.tool(
    "get_lease_mileage_status",
    "Suivi du kilométrage face à l'allocation du bail : consommation, rythme observé par régression sur " +
      "l'historique d'odomètre, projection de fin de bail et dépassement éventuel. " +
      "Le coût du dépassement n'est chiffré QUE si le tarif au kilomètre excédentaire est configuré — " +
      "sinon le dépassement est donné en kilomètres et la limite est nommée dans `limites`.",
    EntreeLease,
    async () => enJson(await etatBail()),
  );
}
