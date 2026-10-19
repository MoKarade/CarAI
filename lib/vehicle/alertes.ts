// lib/vehicle/alertes.ts — « ce qui cloche », et RIEN d'autre.
//
// ══ LA RÈGLE DE CE MODULE : SE TAIRE QUAND TOUT VA BIEN ══════════════════════════════
//
// Un écran qui affiche en permanence « pneus OK · portières OK · verrouillé » entraîne à
// ne plus le lire, et le jour où une ligne change personne ne la voit. Ce module ne produit
// donc une alerte que lorsqu'il y a quelque chose à faire. Zéro alerte est la réponse
// normale, et elle se dit en une ligne.
//
// ══ POURQUOI AUCUN SEUIL CONSTRUCTEUR N'EST ÉCRIT ICI ════════════════════════════════
//
// La pression recommandée d'une bZ n'est écrite nulle part dans les données, et je ne l'ai
// pas mesurée. Poser « alerte sous 220 kPa » serait un chiffre inventé sur une pièce de
// sécurité — exactement ce que l'écosystème s'interdit. On détecte donc par COMPARAISON,
// ce que les données permettent réellement :
//   • une roue nettement sous les AUTRES roues (le véhicule est son propre témoin) ;
//   • une roue nettement sous SA PROPRE valeur habituelle (elle se dégonfle).
// Les deux sont vraies quelle que soit la pression nominale, et une crevaison lente
// déclenche la seconde avant que la première ne soit visible.

import { rouesDuJson } from "@/lib/vehicle/analyse";
import type { MesureQualifiee } from "@/lib/vehicle/state";

export type Gravite = "alerte" | "avertissement";

export interface Alerte {
  /** Clé stable — sert de `key` React et évite les doublons. */
  cle: string;
  gravite: Gravite;
  titre: string;
  /** Ce qu'on a mesuré, en clair. Une alerte sans son chiffre ne se vérifie pas. */
  detail: string;
}

/**
 * Écart de pression au-delà duquel une roue est signalée par rapport aux autres.
 *
 * 20 kPa ≈ 3 psi : au-dessous, c'est la dispersion normale entre quatre pneus (température,
 * ensoleillement d'un côté, capteur). Au-dessus, il se passe quelque chose.
 */
export const ECART_PNEU_KPA = 20;

/** Baisse d'une roue par rapport à sa propre valeur de référence. */
export const BAISSE_PNEU_KPA = 25;

/** Sous ce niveau de charge, et sans être branchée, la voiture mérite d'être signalée. */
export const CHARGE_BASSE_POURCENT = 20;

/**
 * Une valeur booléenne telle que la source l'écrit. PURE.
 *
 * Les booléens arrivent en TEXTE (`"true"`/`"false"`) parce que la colonne qui les porte est
 * textuelle. Comparer à `true` sans convertir rendrait toutes les alertes muettes — et une
 * alerte muette ne se distingue pas d'une absence de problème.
 */
export function estVrai(valeur: string | null | undefined): boolean {
  return valeur?.trim().toLowerCase() === "true";
}

export function estFaux(valeur: string | null | undefined): boolean {
  return valeur?.trim().toLowerCase() === "false";
}

/**
 * Alerte de pneu par comparaison ENTRE roues. PURE, testée.
 *
 * On compare chaque roue à la MÉDIANE des autres plutôt qu'à leur moyenne : avec quatre
 * valeurs, une roue très basse tire la moyenne vers le bas et masque son propre écart.
 */
export function alertesPneusEntreRoues(
  roues: Array<{ libelle: string; pression: number }>,
  seuil = ECART_PNEU_KPA,
): Alerte[] {
  if (roues.length < 3) return [];

  const alertes: Alerte[] = [];
  for (const roue of roues) {
    const autres = roues.filter((r) => r.libelle !== roue.libelle).map((r) => r.pression);
    const reference = mediane(autres);
    const ecart = reference - roue.pression;
    if (ecart >= seuil) {
      alertes.push({
        cle: `pneu-ecart-${roue.libelle}`,
        gravite: "alerte",
        titre: `Pneu ${roue.libelle} sous-gonflé`,
        detail: `${Math.round(roue.pression)} kPa contre ${Math.round(reference)} kPa pour les autres roues (${Math.round(ecart)} kPa d’écart).`,
      });
    }
  }
  return alertes;
}

/**
 * Alerte de pneu par comparaison à SA PROPRE référence passée. PURE, testée.
 *
 * C'est ce qui attrape une crevaison lente sur laquelle les quatre roues descendraient
 * ensemble (froid, temps) — la comparaison entre roues, elle, ne verrait rien.
 */
export function alertesPneusDerive(
  actuelles: Array<{ libelle: string; pression: number }>,
  references: Map<string, number>,
  seuil = BAISSE_PNEU_KPA,
): Alerte[] {
  const alertes: Alerte[] = [];
  for (const roue of actuelles) {
    const reference = references.get(roue.libelle);
    if (reference === undefined) continue;
    const baisse = reference - roue.pression;
    if (baisse >= seuil) {
      alertes.push({
        cle: `pneu-baisse-${roue.libelle}`,
        gravite: "alerte",
        titre: `Pneu ${roue.libelle} perd de la pression`,
        detail: `${Math.round(roue.pression)} kPa aujourd’hui contre ${Math.round(reference)} kPa habituellement (${Math.round(baisse)} kPa de moins).`,
      });
    }
  }
  return alertes;
}

/**
 * Référence de pression par roue, tirée de l'historique. PURE, testée.
 *
 * ⚠️ On EXCLUT les mesures récentes (24 h par défaut) du calcul de la référence. Sans cette
 * exclusion, un pneu qui se dégonfle depuis ce matin abaisserait sa propre référence et
 * l'alerte ne se déclencherait jamais — le défaut se masquerait lui-même, silencieusement.
 *
 * Médiane et non moyenne : une seule lecture aberrante (capteur qui bafouille au démarrage)
 * ne doit pas déplacer la référence de tous les jours suivants.
 */
export function referencesDepuisSeries(
  series: Array<{ libelle: string; points: Array<{ t: Date; valeur: number }> }>,
  avant: Date,
  minimumPoints = 3,
): Map<string, number> {
  const references = new Map<string, number>();
  for (const serie of series) {
    const anciens = serie.points.filter((p) => p.t < avant).map((p) => p.valeur);
    // Sous le minimum, aucune référence n'est fiable — et une référence bancale produit
    // une alerte fausse, qui coûte plus cher que l'absence d'alerte.
    if (anciens.length < minimumPoints) continue;
    references.set(serie.libelle, mediane(anciens));
  }
  return references;
}

/** Médiane d'une liste non vide. PURE. */
export function mediane(valeurs: number[]): number {
  const tri = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(tri.length / 2);
  return tri.length % 2 === 0 ? (tri[milieu - 1]! + tri[milieu]!) / 2 : tri[milieu]!;
}

/** Compte les ouvrants ouverts dans un corps JSON (portières, vitres). PURE. */
export function ouvrantsOuverts(valueJson: unknown): string[] {
  const ouverts: string[] = [];
  const parcourir = (valeur: unknown, chemin: string, profondeur: number): void => {
    if (profondeur > 4 || valeur === null || valeur === undefined) return;
    if (Array.isArray(valeur)) {
      valeur.forEach((v, i) => parcourir(v, chemin ? `${chemin}.${i}` : String(i), profondeur + 1));
      return;
    }
    if (typeof valeur === "object") {
      for (const [cle, sous] of Object.entries(valeur as Record<string, unknown>)) {
        // La source nomme l'état `isOpen` ; sa VALEUR dit si c'est ouvert, et son PARENT
        // dit lequel. Sans le parent, on afficherait « isOpen » sans savoir de quoi.
        if (/^is_?open$/i.test(cle) && sous === true) {
          ouverts.push(chemin || cle);
          continue;
        }
        parcourir(sous, chemin ? `${chemin}.${cle}` : cle, profondeur + 1);
      }
    }
  };
  parcourir(valueJson, "", 0);
  return ouverts;
}

/**
 * Toutes les alertes, à partir de l'état courant du véhicule. PURE.
 *
 * `referencesPneus` vient d'un historique (médiane des jours précédents) et reste
 * optionnel : sans lui, seules les comparaisons entre roues s'appliquent — ce qui vaut
 * mieux que de ne rien dire.
 */
export function construireAlertes(params: {
  mesures: MesureQualifiee[];
  referencesPneus?: Map<string, number>;
  /** Âge au-delà duquel une voiture déverrouillée mérite d'être signalée, en minutes. */
  minutesDeverrouillee?: number;
}): Alerte[] {
  const { mesures, referencesPneus, minutesDeverrouillee = 30 } = params;
  const alertes: Alerte[] = [];

  const parMetrique = new Map<string, MesureQualifiee>();
  for (const m of mesures) {
    // Une seule mesure par métrique : la plus fraîche. `mesures` vient déjà de
    // `dernieresValeurs`, mais deux SOURCES peuvent porter la même métrique.
    const connue = parMetrique.get(m.metricType);
    if (!connue || m.recordedAt > connue.recordedAt) parMetrique.set(m.metricType, m);
  }

  // ── PNEUS ────────────────────────────────────────────────────────────────────────
  const pneus = parMetrique.get("tire_pressure");
  if (pneus) {
    const roues = rouesDuJson(pneus.valueJson);
    alertes.push(...alertesPneusEntreRoues(roues));
    if (referencesPneus) alertes.push(...alertesPneusDerive(roues, referencesPneus));
  }

  // ── VERROUILLAGE ─────────────────────────────────────────────────────────────────
  const verrou = parMetrique.get("lock_status");
  if (verrou && estFaux(verrou.valueText) && verrou.ageMinutes >= minutesDeverrouillee) {
    alertes.push({
      cle: "deverrouillee",
      gravite: "alerte",
      titre: "Voiture déverrouillée",
      detail: `Déverrouillée au dernier relevé, il y a ${Math.round(verrou.ageMinutes)} min.`,
    });
  }

  // ── OUVRANTS ─────────────────────────────────────────────────────────────────────
  for (const [metrique, nom] of [
    ["door_status", "Portière"],
    ["window_status", "Vitre"],
  ] as const) {
    const mesure = parMetrique.get(metrique);
    if (!mesure) continue;
    const ouverts = ouvrantsOuverts(mesure.valueJson);
    if (ouverts.length > 0) {
      alertes.push({
        cle: `ouvrant-${metrique}`,
        gravite: "avertissement",
        titre: `${nom}${ouverts.length > 1 ? "s" : ""} ouverte${ouverts.length > 1 ? "s" : ""}`,
        detail: `${ouverts.join(", ")} — relevé il y a ${Math.round(mesure.ageMinutes)} min.`,
      });
    }
  }

  // ── CHARGE ───────────────────────────────────────────────────────────────────────
  const soc = parMetrique.get("battery_soc");
  const branchee = parMetrique.get("charge_plugged_in");
  const enCharge = parMetrique.get("charging_status");
  if (
    soc?.valueNumeric != null &&
    soc.interpretationFiable &&
    soc.valueNumeric <= CHARGE_BASSE_POURCENT &&
    !estVrai(enCharge?.valueText) &&
    !estVrai(branchee?.valueText)
  ) {
    alertes.push({
      cle: "charge-basse",
      gravite: "avertissement",
      titre: "Charge basse et non branchée",
      detail: `${Math.round(soc.valueNumeric)} % au dernier relevé, câble non connecté.`,
    });
  }

  return alertes;
}
