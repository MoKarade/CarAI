// lib/vehicle/capacite.ts — la capacité de la batterie, lue au SEUL endroit qui la connaît.
//
// ══ POURQUOI CE FICHIER EXISTE (bug trouvé le 19/08/2026) ════════════════════════════
//
// Trois écrans lisaient la capacité chacun dans son coin, tous de la même façon :
//
//     etat.mesures.find((m) => m.metricType === "battery_capacity_nominal")?.valueNumeric
//
// Et tous les trois obtenaient `null`. La bZ ne publie PAS sa capacité dans la colonne
// numérique : elle l'envoie en JSON, parce que la réponse porte aussi le choix de version
// et la liste des variantes possibles :
//
//     { "source": "USER_SELECTED", "capacity": 57.7,
//       "availableCapacities": [ { "capacity": 57.7, "description": "BEV:XLE" },
//                                { "capacity": 74.7, "description": "BEV:XLE" } ] }
//
// CONSÉQUENCE, mesurée sur les vraies données : `capaciteKwh` valait `null` partout, donc
// `energieKwh` valait `null` pour CHAQUE session de recharge, donc toute recharge facturée
// AU kWh restait sans prix — à commencer par celles de la maison. Sur 30 jours : 8 sessions
// sur 14 sans montant, dont toutes celles du domicile. Le coût affiché ne comptait que les
// bornes facturées à l'HEURE, qui n'ont pas besoin de l'énergie.
//
// Rien n'était en erreur : chaque écran disait honnêtement « — » faute de capacité. C'est
// le pire cas de figure, celui où l'absence a l'air d'un choix.
//
// ⚠️ Une valeur lue à trois endroits finit par diverger, et c'est le plus grossier des
// trois qui gagne (leçon JobAI sur les colonnes recopiées). Une seule fonction, désormais.

import type { EtatVehicule } from "./state";

/** Ce que la bZ envoie dans `value_json` pour `battery_capacity_nominal`. */
interface CapaciteJson {
  capacity?: unknown;
  source?: unknown;
}

/**
 * La capacité utilisable, en kWh, ou `null` si le véhicule ne l'a pas dite.
 *
 * L'ordre des sources n'est pas indifférent :
 *   1. `battery_capacity_nominal` — la capacité de la VERSION choisie, celle qui convertit
 *      un gain d'état de charge en kWh ;
 *   2. `battery_capacity` — repli pour un véhicule qui publierait celle-ci à la place.
 * Dans chacune, la colonne numérique d'abord, puis le champ `capacity` du JSON.
 *
 * ⚠️ On lit `capacity`, JAMAIS `availableCapacities`. Cette liste énumère les variantes du
 * modèle (57,7 et 74,7 kWh pour la bZ) : en choisir une soi-même reviendrait à deviner la
 * voiture de Marc, et une erreur de version fausserait toute l'énergie de 30 %.
 */
export function capaciteBatterieKwh(etat: Pick<EtatVehicule, "mesures">): number | null {
  for (const metrique of ["battery_capacity_nominal", "battery_capacity"]) {
    const candidates = etat.mesures
      .filter((m) => m.metricType === metrique)
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());

    for (const m of candidates) {
      if (typeof m.valueNumeric === "number" && m.valueNumeric > 0) return m.valueNumeric;

      const json = m.valueJson as CapaciteJson | null | undefined;
      const brut = json?.capacity;
      if (typeof brut === "number" && brut > 0) return brut;
      // Une capacité rendue en chaîne existe chez d'autres constructeurs — la refuser
      // silencieusement reproduirait exactement le bug qu'on corrige.
      if (typeof brut === "string") {
        const n = Number(brut);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return null;
}
