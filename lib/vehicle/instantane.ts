// lib/vehicle/instantane.ts — collecte l'état de CarAI pour le hub et le tableau de bord.
//
// C'est la seule couche qui touche la base parmi celles qui alimentent l'affichage. Elle
// existe pour que `hubSummary.ts` reste PUR et testable sans Postgres.
//
// ══ DEUX RÈGLES APPRISES EN PRODUCTION, LE 05/08/2026 ════════════════════════════════
//
// 1. LES MIGRATIONS D'ABORD, JAMAIS EN PARALLÈLE DES LECTURES.
//    La page d'accueil lançait `collecterInstantane()` et `lireEtatVehicule()` dans un
//    même `Promise.all`. Le premier applique les migrations avant de lire ; le second
//    partait aussitôt interroger `vehicle_snapshots`. Sur une base vierge, la lecture
//    gagnait la course et l'app rendait un 500 « relation does not exist » au tout premier
//    chargement — précisément le moment où Marc découvrait l'app.
//    Depuis, TOUT passe par cette fonction : un seul point d'entrée, un seul ordre.
//
// 2. UNE PANNE N'EST JAMAIS UNE ABSENCE DE DONNÉES — ET LES PANNES NE SE VALENT PAS.
//    « Schéma pas encore créé » et « base injoignable » se ressemblent à l'écran et
//    appellent deux gestes opposés (attendre vs vérifier DATABASE_URL). La classification
//    vit dans `lib/panne.ts`, à un seul endroit.

import { baseConfiguree } from "@/lib/db";
import { lireBail, lireSanteToyota } from "@/lib/config";
import { assurerMigrations } from "@/lib/migrations";
import { classerPanne, resumePanne, type TypePanne } from "@/lib/panne";
import { derniereLivraison } from "@/lib/smartcar/ingest";
import { calculerEtatBail } from "./lease";
import { historiqueOdometre } from "./history";
import { lireEtatVehicule, mesuresPour, type EtatVehicule } from "./state";
import type { InstantaneCarAI } from "@/lib/hubSummary";

/** Mesure la plus fraîche d'une métrique, toutes sources confondues. */
function plusFraiche(etat: EtatVehicule, metricType: string) {
  return mesuresPour(etat, metricType)[0] ?? null;
}

const ETAT_VIDE: EtatVehicule = { mesures: [], fraicheurMax: null, sources: [], vide: true };

export interface Collecte {
  instantane: InstantaneCarAI;
  /** Détail des mesures pour le tableau de bord. Vide quand une panne empêche la lecture. */
  etat: EtatVehicule;
  typePanne: TypePanne | null;
  /** Message complet destiné à l'écran (le summary du hub en reçoit une version courte). */
  messagePanne: string | null;
}

/**
 * Lit tout ce dont l'affichage a besoin, en UN passage et dans le BON ordre.
 *
 * Ne lève jamais : une exception ici rendrait un 500 illisible là où un écran honnête
 * suffit. L'erreur n'est pas avalée pour autant — elle est classée, journalisée, et
 * remontée dans `typePanne` / `messagePanne`.
 */
export async function collecter(maintenant = new Date()): Promise<Collecte> {
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
    // Configuration absente : une PANNE de déploiement, pas un véhicule silencieux.
    return {
      instantane: { ...vide, panne: "base de données non configurée (DATABASE_URL)" },
      etat: ETAT_VIDE,
      typePanne: "base_injoignable",
      messagePanne:
        "DATABASE_URL est absent. Aucune donnée ne peut être lue ni enregistrée tant que la base Neon n'est pas branchée.",
    };
  }

  try {
    // ⚠️ SÉQUENTIEL, et c'est tout l'intérêt de cette ligne : rien ne lit la base avant
    // que les migrations n'aient eu leur tour. Voir la règle 1 en tête de fichier.
    await assurerMigrations();

    // Une fois le schéma garanti, la parallélisation est sans risque.
    const [etat, bailTermes, sante, derniere, points] = await Promise.all([
      lireEtatVehicule(maintenant),
      lireBail(),
      lireSanteToyota(),
      derniereLivraison(),
      historiqueOdometre(),
    ]);

    const odometre = plusFraiche(etat, "odometer");
    const soc = plusFraiche(etat, "battery_soc");
    const autonomie = plusFraiche(etat, "battery_range");
    const charge = plusFraiche(etat, "charging_status");

    const bail = calculerEtatBail({
      bail: bailTermes,
      historiqueOdometre: points,
      maintenant,
    });

    return {
      instantane: {
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
      },
      etat,
      typePanne: null,
      messagePanne: null,
    };
  } catch (err) {
    const type = classerPanne(err);
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[instantané] lecture impossible (${type})`, err);

    return {
      // Le label d'alerte du hub est borné à 80 caractères par le contrat : on y met le
      // résumé, pas le message complet destiné à l'écran.
      instantane: { ...vide, panne: resumePanne(type) },
      etat: ETAT_VIDE,
      typePanne: type,
      messagePanne: detail,
    };
  }
}

/** Raccourci pour les appelants qui n'ont besoin que du summary (le hub). */
export async function collecterInstantane(
  maintenant = new Date(),
): Promise<InstantaneCarAI> {
  return (await collecter(maintenant)).instantane;
}
