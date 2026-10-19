// lib/vehicle/purgeSimulee.ts — retirer DÉFINITIVEMENT les relevés du véhicule de test.
//
// ══ POURQUOI CE FICHIER EST ÉCRIT COMME ÇA ═══════════════════════════════════════════
//
// Une suppression en base est IRRÉVERSIBLE. Le reste de l'app peut se tromper et se
// corriger au déploiement suivant ; ici, une erreur de critère efface des mesures que rien
// ne recréera. Trois décisions en découlent :
//
// 1. DEUX TEMPS OBLIGATOIRES. `inventaireSimulees` établit la liste et la MONTRE ; la
//    suppression prend en entrée les IDENTIFIANTS de cette liste, pas un critère. Ce qui
//    est supprimé est donc exactement ce qui a été affiché — pas « ce que le prédicat
//    trouvera au moment du clic », qui pourrait avoir changé entre-temps.
//
// 2. CHAQUE MOTIF EST PROUVABLE, jamais une ressemblance. On ne supprime pas ce qui
//    « a l'air » d'un test : on supprime ce qui est IMPOSSIBLE pour la bZ de Marc.
//
// 3. LE MOTIF VOYAGE AVEC LA LIGNE. Une purge qui rend « 42 lignes supprimées » ne se
//    vérifie pas. Chaque candidate porte la raison de sa présence dans la liste, et c'est
//    ce que l'écran affiche.
//
// ⚠️ On ne peut PAS rejouer la garde d'origine (`mode === "TEST"`, lib/smartcar/webhook.ts) :
// aucune colonne ne relie un snapshot à sa livraison, et le `raw` des livraisons est purgé
// après sa fenêtre de rétention. L'identification par le contenu est donc la seule voie —
// raison de plus pour n'accepter que des motifs démontrables.

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { vehicleSnapshots } from "@/lib/db/schema";
import { coordonneesDuJson } from "./position";
import { pressionImpossible, PRESSION_PLANCHER_KPA, rouesDuJson } from "./analyse";

type Dbx = Pick<typeof db, "select" | "delete" | "execute">;

/** Position du véhicule SIMULÉ de Smartcar : Londres, The Mall (documenté par Smartcar). */
export const LONDRES = { lat: 51.5014, lng: -0.1419 };

/**
 * Rayon autour de Londres au-delà duquel on ne conclut plus. 100 km : assez large pour
 * couvrir les variantes de la position simulée, assez étroit pour qu'aucun point du Québec
 * ne puisse tomber dedans — les deux continents sont à 5 000 km l'un de l'autre, il n'y a
 * aucune zone grise à arbitrer.
 */
export const RAYON_LONDRES_KM = 100;

/** Distance approximative en km (équirectangulaire — largement assez pour un test à 5 000 km). */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (a.lat - b.lat) * 111;
  const dLng = (a.lng - b.lng) * 111 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLng);
}

export { pressionImpossible, PRESSION_PLANCHER_KPA };

export type MotifPurge =
  | "position-nulle"
  | "position-londres"
  | "odometre-impossible"
  | "carburant-sur-electrique"
  | "pression-impossible";

export const LIBELLES_MOTIFS: Readonly<Record<MotifPurge, string>> = {
  "position-nulle": "Position à 0°, 0° — aucun véhicule ne s’y trouve",
  "position-londres": "Position à Londres — la voiture n’a jamais quitté le Québec",
  "odometre-impossible": "Odomètre supérieur au compteur actuel — un odomètre ne recule pas",
  "carburant-sur-electrique": "Niveau de carburant sur un véhicule électrique",
  "pression-impossible": "Les QUATRE pneus sous 50 kPa — la voiture ne roulerait pas",
};



/**
 * Une position est-elle IMPOSSIBLE pour la bZ ? PURE, testée.
 *
 * `null` = rien à conclure. On ne renvoie un motif que sur une certitude géographique.
 */
export function motifPosition(coord: { lat: number; lng: number } | null): MotifPurge | null {
  if (!coord) return null;
  // 0°,0° est en plein golfe de Guinée. C'est la valeur qu'un système écrit quand il n'a
  // pas de position, jamais un endroit où une voiture se gare.
  if (Math.abs(coord.lat) < 0.001 && Math.abs(coord.lng) < 0.001) return "position-nulle";
  if (distanceKm(coord, LONDRES) <= RAYON_LONDRES_KM) return "position-londres";
  return null;
}

/** Une ligne candidate à la suppression, avec de quoi la juger à l'œil. */
export interface CandidatePurge {
  id: number;
  metricType: string;
  recordedAt: Date;
  motif: MotifPurge;
  /** Ce que la ligne contient, en clair — c'est ce que Marc lit avant de confirmer. */
  apercu: string;
}

export interface InventairePurge {
  candidates: CandidatePurge[];
  /** Compte par motif, pour lire l'ampleur d'un coup d'œil. */
  parMotif: Array<{ motif: MotifPurge; nb: number }>;
  /** Compteur actuel, celui qui sert de borne haute aux odomètres. `null` si inconnu. */
  odometreActuelKm: number | null;
}

/**
 * Établit la liste des lignes IMPOSSIBLES. Ne supprime rien.
 *
 * La borne des odomètres est le relevé le PLUS RÉCENT : un odomètre ne recule jamais, donc
 * toute valeur passée au-dessus du compteur d'aujourd'hui est impossible. Si ce relevé
 * manque, on ne juge AUCUN odomètre — mieux vaut ne rien proposer que proposer au hasard.
 */
export async function inventaireSimulees(dbx: Dbx = db): Promise<InventairePurge> {
  const candidates: CandidatePurge[] = [];

  // ── Positions ──────────────────────────────────────────────────────────────────────
  const positions = await dbx
    .select({
      id: vehicleSnapshots.id,
      recordedAt: vehicleSnapshots.recordedAt,
      valueJson: vehicleSnapshots.valueJson,
    })
    .from(vehicleSnapshots)
    .where(and(eq(vehicleSnapshots.metricType, "location"), isNotNull(vehicleSnapshots.valueJson)));

  for (const p of positions) {
    const coord = coordonneesDuJson(p.valueJson);
    const motif = motifPosition(coord);
    if (!motif || !coord) continue;
    candidates.push({
      id: p.id,
      metricType: "location",
      recordedAt: p.recordedAt instanceof Date ? p.recordedAt : new Date(p.recordedAt),
      motif,
      apercu: `${coord.lat.toFixed(4)}, ${coord.lng.toFixed(4)}`,
    });
  }

  // ── Odomètres au-dessus du compteur actuel ────────────────────────────────────────
  const odos = await dbx
    .select({
      id: vehicleSnapshots.id,
      recordedAt: vehicleSnapshots.recordedAt,
      valueNumeric: vehicleSnapshots.valueNumeric,
    })
    .from(vehicleSnapshots)
    .where(and(eq(vehicleSnapshots.metricType, "odometer"), isNotNull(vehicleSnapshots.valueNumeric)));

  const parDate = [...odos].sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
  );
  const odometreActuelKm = parDate[0]?.valueNumeric ?? null;

  if (odometreActuelKm !== null) {
    for (const o of odos) {
      if (o.valueNumeric === null || o.valueNumeric <= odometreActuelKm) continue;
      candidates.push({
        id: o.id,
        metricType: "odometer",
        recordedAt: o.recordedAt instanceof Date ? o.recordedAt : new Date(o.recordedAt),
        motif: "odometre-impossible",
        apercu: `${Math.round(o.valueNumeric)} km (compteur actuel : ${Math.round(odometreActuelKm)} km)`,
      });
    }
  }

  // ── Carburant sur un électrique ───────────────────────────────────────────────────
  // Les lignes de ces métriques existent légitimement à VIDE (la bZ répond « non
  // applicable »). Seule une VALEUR est impossible — d'où le filtre sur les deux colonnes.
  const carburant = await dbx
    .select({
      id: vehicleSnapshots.id,
      recordedAt: vehicleSnapshots.recordedAt,
      metricType: vehicleSnapshots.metricType,
      valueNumeric: vehicleSnapshots.valueNumeric,
      valueText: vehicleSnapshots.valueText,
    })
    .from(vehicleSnapshots)
    .where(
      and(
        sql`${vehicleSnapshots.metricType} LIKE 'internalcombustionengine-%'`,
        sql`(${vehicleSnapshots.valueNumeric} IS NOT NULL OR ${vehicleSnapshots.valueText} IS NOT NULL)`,
      ),
    );

  for (const c of carburant) {
    candidates.push({
      id: c.id,
      metricType: c.metricType,
      recordedAt: c.recordedAt instanceof Date ? c.recordedAt : new Date(c.recordedAt),
      motif: "carburant-sur-electrique",
      apercu: c.valueNumeric !== null ? String(c.valueNumeric) : String(c.valueText),
    });
  }

  // ── Pressions impossibles ─────────────────────────────────────────────────────────
  const pressions = await dbx
    .select({
      id: vehicleSnapshots.id,
      recordedAt: vehicleSnapshots.recordedAt,
      valueJson: vehicleSnapshots.valueJson,
    })
    .from(vehicleSnapshots)
    .where(
      and(eq(vehicleSnapshots.metricType, "tire_pressure"), isNotNull(vehicleSnapshots.valueJson)),
    );

  for (const pr of pressions) {
    if (!pressionImpossible(pr.valueJson)) continue;
    const roues = rouesDuJson(pr.valueJson);
    candidates.push({
      id: pr.id,
      metricType: "tire_pressure",
      recordedAt: pr.recordedAt instanceof Date ? pr.recordedAt : new Date(pr.recordedAt),
      motif: "pression-impossible",
      apercu: roues.map((r) => Math.round(r.pression)).join(" / ") + " kPa",
    });
  }

  candidates.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

  const compte = new Map<MotifPurge, number>();
  for (const c of candidates) compte.set(c.motif, (compte.get(c.motif) ?? 0) + 1);

  return {
    candidates,
    parMotif: [...compte.entries()].map(([motif, nb]) => ({ motif, nb })),
    odometreActuelKm,
  };
}

/**
 * Supprime EXACTEMENT les identifiants fournis. Rend le nombre réellement retiré.
 *
 * Prend des IDs et non un critère : c'est ce qui garantit que la suppression porte sur ce
 * qui a été affiché, et pas sur ce qu'un prédicat retrouverait au moment du clic.
 */
export async function purgerParIds(ids: number[], dbx: Dbx = db): Promise<number> {
  if (ids.length === 0) return 0;
  const supprimes = await dbx
    .delete(vehicleSnapshots)
    .where(inArray(vehicleSnapshots.id, ids))
    .returning({ id: vehicleSnapshots.id });
  return supprimes.length;
}

/** Ce que Marc lit quand la suppression échoue : une phrase claire, jamais l’erreur brute. */
export const MESSAGE_ECHEC_SUPPRESSION = "La suppression n’a pas abouti, réessaie.";

/**
 * Ce que Marc lit quand l'inventaire ne se charge pas. ⚠️ Jamais « aucune mesure à purger » :
 * une lecture en panne qui se lirait comme une base propre serait un faux « tout va bien ».
 */
export const MESSAGE_ECHEC_INVENTAIRE = "L’inventaire n’a pas pu être lu, réessaie.";
