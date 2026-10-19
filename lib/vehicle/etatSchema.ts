// lib/vehicle/etatSchema.ts — l'état courant du véhicule tel que le schéma le peint.
//
// ══ POURQUOI CE FICHIER EXISTE ═══════════════════════════════════════════════════════
//
// Cette construction vivait INLINE dans `app/analyse/page.tsx`. Marc a demandé le 13/08 de
// voir « tout ce qui concerne le véhicule » aussi sur l'accueil : la recopier aurait donné
// deux définitions du même état, qui divergent toujours par un bout (la fenêtre de
// référence des pneus, le repli du verrouillage, la fraîcheur retenue). C'est la leçon
// JobAI, mot pour mot : quand on écrit une page qui ressemble à une page existante, on va
// CHERCHER ses gardes au lieu de les réécrire — et si elles sont inline, on les extrait
// d'abord.
//
// Deux couches, volontairement séparées :
//   • `construireEtatSchema` — PURE, testable sans base ;
//   • `chargerEtatSchema` — la lecture qui va avec, pour qu'une page n'ait pas à savoir
//     quelle fenêtre interroger.

import { rouesDuJson, seriesPneus, type PointSerie } from "@/lib/vehicle/analyse";
import { referencesDepuisSeries } from "@/lib/vehicle/alertes";
import {
  diagnostiquerPneus,
  ouvrantsDuJson,
  resumerOuvrants,
  type PneuDiagnostique,
  type Position,
} from "@/lib/vehicle/schemaVehicule";
import type { EtatVehicule } from "@/lib/vehicle/state";

/**
 * Ce que le schéma dessine. Rien de plus que des mesures et leur absence.
 *
 * ⚠️ Chaque champ sait dire « je ne sais pas » : `null` pour le verrouillage, tableau vide
 * pour les pneus. Une absence ne devient jamais une valeur rassurante.
 */
export interface EtatSchema {
  pneus: PneuDiagnostique[];
  /** Unité telle que la source la publie — jamais supposée. */
  unitePression: string | null;
  portieresOuvertes: Position[];
  vitresOuvertes: Position[];
  /** Ouvrants ouverts que la source ne situe pas : comptés, jamais placés. */
  ouvrantsSansPosition: number;
  verrouillee: boolean | null;
  mesureLe: Date | null;
}

/**
 * Fenêtre de la RÉFÉRENCE de pression, par roue.
 *
 * ⚠️ Fixe, et surtout INDÉPENDANTE de la période choisie à l'écran. C'est le bug corrigé le
 * 13/08 (PR #41) : les références se lisaient sur la fenêtre sélectionnée, donc choisir
 * « 24 h » vidait la référence de chaque roue et le schéma perdait sa détection de dérive
 * au moment précis où on zoomait dessus.
 */
export const FENETRE_REFERENCE_JOURS = 30;

/**
 * Les dernières 24 h sont EXCLUES de la référence.
 *
 * Sans cette exclusion, un pneu qui se dégonfle depuis ce matin abaisse sa propre référence
 * et l'écart ne se voit jamais — le capteur mesurerait sa propre dérive comme normale.
 */
export const EXCLUSION_RECENTE_HEURES = 24;

const VRAI = new Set(["true", "locked", "1", "yes", "oui"]);
const FAUX = new Set(["false", "unlocked", "0", "no", "non"]);

/** Texte de verrouillage → booléen, ou `null` si la source ne tranche pas. PURE. */
export function lireVerrouillage(texte: string | null | undefined): boolean | null {
  if (texte === null || texte === undefined) return null;
  const t = texte.trim().toLowerCase();
  if (VRAI.has(t)) return true;
  if (FAUX.has(t)) return false;
  return null;
}

/**
 * Assemble l'état du schéma à partir du dernier état connu. PURE, testée.
 *
 * `etat.mesures` porte la DERNIÈRE mesure de chaque métrique, sans fenêtre : c'est ce qui
 * fait que la pression affichée est toujours « la dernière disponible » (Marc, 13/08), même
 * si elle date de plusieurs jours. Son ÂGE se lit à côté, il ne se devine pas.
 */
export function construireEtatSchema(params: {
  etat: EtatVehicule;
  /** Séries par roue sur la fenêtre de référence — sert UNIQUEMENT à situer la dérive. */
  seriesRoues: Array<{ libelle: string; points: PointSerie[] }>;
  uniteRoues: string | null;
  maintenant: Date;
}): EtatSchema {
  const { etat, seriesRoues, uniteRoues, maintenant } = params;
  const derniere = (metrique: string) => etat.mesures.find((m) => m.metricType === metrique);

  const mesurePneus = derniere("tire_pressure");
  const avant = new Date(maintenant.getTime() - EXCLUSION_RECENTE_HEURES * 3_600_000);
  const pneus = mesurePneus
    ? diagnostiquerPneus(
        rouesDuJson(mesurePneus.valueJson),
        referencesDepuisSeries(seriesRoues, avant),
      )
    : [];

  const portieres = resumerOuvrants(ouvrantsDuJson(derniere("door_status")?.valueJson));
  const vitres = resumerOuvrants(ouvrantsDuJson(derniere("window_status")?.valueJson));

  return {
    pneus,
    unitePression: mesurePneus?.unit ?? uniteRoues,
    portieresOuvertes: portieres.ouvertes,
    vitresOuvertes: vitres.ouvertes,
    ouvrantsSansPosition: portieres.nbOuvertsSansPosition + vitres.nbOuvertsSansPosition,
    verrouillee: lireVerrouillage(derniere("lock_status")?.valueText),
    // La fraîcheur du SCHÉMA est celle des pneus quand ils existent : c'est la mesure la
    // plus lourde qu'il porte. À défaut, la fraîcheur générale du véhicule.
    mesureLe: mesurePneus?.recordedAt ?? etat.fraicheurMax ?? null,
  };
}

/** La lecture qui va avec — une page n'a pas à connaître la fenêtre de référence. */
export async function chargerEtatSchema(
  etat: EtatVehicule,
  maintenant: Date,
): Promise<EtatSchema> {
  const roues = await seriesPneus({
    depuis: new Date(maintenant.getTime() - FENETRE_REFERENCE_JOURS * 86_400_000),
  });
  return construireEtatSchema({
    etat,
    seriesRoues: roues.series,
    uniteRoues: roues.unite,
    maintenant,
  });
}
