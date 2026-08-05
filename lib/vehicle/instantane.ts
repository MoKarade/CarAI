// lib/vehicle/instantane.ts — collecte l'état de CarAI pour le hub et le tableau de bord.
//
// C'est la seule couche qui touche la base parmi celles qui alimentent l'affichage. Elle
// existe pour que `hubSummary.ts` reste PUR et testable sans Postgres.
//
// ⚠️ Une PANNE (base injoignable, schéma absent) n'est jamais transformée en « pas de
// données ». Les deux se ressemblent à l'écran — un widget vide — mais l'un veut dire
// « la voiture n'a rien envoyé » et l'autre « CarAI est cassé ». Confondre les deux, c'est
// se garantir de ne pas voir la panne.

import { baseConfiguree } from "@/lib/db";
import { lireBail, lireSanteToyota } from "@/lib/config";
import { assurerMigrations } from "@/lib/migrations";
import { derniereLivraison } from "@/lib/smartcar/ingest";
import { calculerEtatBail } from "./lease";
import { historiqueOdometre } from "./history";
import { lireEtatVehicule, mesuresPour, type EtatVehicule } from "./state";
import type { InstantaneCarAI } from "@/lib/hubSummary";

/** Mesure la plus fraîche d'une métrique, toutes sources confondues. */
function plusFraiche(etat: EtatVehicule, metricType: string) {
  return mesuresPour(etat, metricType)[0] ?? null;
}

export async function collecterInstantane(
  maintenant = new Date(),
): Promise<InstantaneCarAI> {
  const vide: InstantaneCarAI = {
    batterieSoc: null,
    autonomieKm: null,
    odometreKm: null,
    statutCharge: null,
    fraicheur: null,
    bail: null,
    silenceWebhookHeures: null,
    toyotaDesactive: false,
    panne: null,
    generatedAt: maintenant,
  };

  if (!baseConfiguree()) {
    // Configuration absente : c'est une PANNE de déploiement, pas un véhicule silencieux.
    return { ...vide, panne: "base de données non configurée (DATABASE_URL)" };
  }

  try {
    await assurerMigrations();

    const [etat, bailTermes, sante, derniere] = await Promise.all([
      lireEtatVehicule(maintenant),
      lireBail(),
      lireSanteToyota(),
      derniereLivraison(),
    ]);

    const odometre = plusFraiche(etat, "odometer");
    const soc = plusFraiche(etat, "battery_soc");
    const autonomie = plusFraiche(etat, "battery_range");
    const charge = plusFraiche(etat, "charging_status");

    const points = await historiqueOdometre();
    const bail = calculerEtatBail({
      bail: bailTermes,
      historiqueOdometre: points,
      maintenant,
    });

    return {
      batterieSoc:
        soc?.valueNumeric !== null && soc?.valueNumeric !== undefined
          ? { valeur: soc.valueNumeric, unite: soc.unit }
          : null,
      autonomieKm: autonomie?.valueNumeric ?? null,
      odometreKm: odometre?.valueNumeric ?? null,
      statutCharge: charge?.valueText ?? null,
      fraicheur: etat.fraicheurMax,
      bail,
      silenceWebhookHeures: derniere
        ? (maintenant.getTime() - derniere.getTime()) / 3_600_000
        : null,
      toyotaDesactive: Boolean(sante.desactiveLe),
      panne: null,
      generatedAt: maintenant,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[instantané] lecture impossible", err);
    // Message tronqué : il finit dans un label d'alerte borné à 80 caractères côté contrat.
    return { ...vide, panne: message.slice(0, 60) };
  }
}
