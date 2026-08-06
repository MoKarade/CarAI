// lib/vehicle/state.ts — état courant du véhicule, toutes sources confondues (Doc 4 §3.1).
//
// ══ LA RÈGLE QUI GOUVERNE CE FICHIER : NE JAMAIS FUSIONNER SILENCIEUSEMENT ═══════════
//
// Doc 4 §3.1, mot pour mot : « ne pas mélanger silencieusement les deux sources en cas de
// conflit (ex: si Smartcar dit 45 % et ha-toyota-na dit 47 % suite à des cycles de refresh
// différents) — retourner les deux avec leur source et horodatage respectifs plutôt que de
// choisir arbitrairement ».
//
// Ce n'est pas une préférence de présentation. Les deux sources lisent le véhicule à des
// moments différents, par des chemins différents ; « 45 » et « 47 » sont tous les deux
// vrais, à des instants différents. Une moyenne (46) serait un nombre que le véhicule n'a
// jamais affiché, et choisir la plus récente masquerait qu'une source décroche.
//
// L'état est donc une LISTE de mesures qualifiées, pas un objet plat de valeurs.

import { dernieresValeurs } from "@/lib/smartcar/ingest";
import { interpreterPourcentage } from "@/lib/smartcar/signals";

export interface MesureQualifiee {
  metricType: string;
  source: string;
  /** Instant de la MESURE côté véhicule — la seule fraîcheur qui veuille dire quelque chose. */
  recordedAt: Date;
  receivedAt: Date;
  valueNumeric: number | null;
  valueText: string | null;
  valueJson: unknown;
  unit: string | null;
  locationType: string | null;
  signalCode: string | null;
  /** Âge de la mesure en minutes, à l'instant de la lecture. */
  ageMinutes: number;
  /**
   * `false` quand la valeur est exploitable mais que son UNITÉ ne permet pas de
   * l'interpréter sans risque (voir `interpreterPourcentage`). L'affichage doit alors
   * montrer la valeur brute, jamais un pourcentage inventé.
   */
  interpretationFiable: boolean;
}

export interface EtatVehicule {
  mesures: MesureQualifiee[];
  /** Mesure la plus récente, toutes métriques confondues. Alimente `dataAsOf` du hub. */
  fraicheurMax: Date | null;
  sources: string[];
  /** Vrai si aucune donnée n'est jamais arrivée — état honnête « en construction ». */
  vide: boolean;
}

/**
 * Métriques dont la valeur est un POURCENTAGE, et pour lesquelles l'ambiguïté
 * fraction/pourcent doit être tranchée par l'unité (jamais par la valeur).
 */
const METRIQUES_POURCENTAGE = new Set(["battery_soc", "charge_limit"]);

export async function lireEtatVehicule(maintenant = new Date()): Promise<EtatVehicule> {
  const lignes = await dernieresValeurs();

  const mesures: MesureQualifiee[] = lignes.map((l) => {
    const recordedAt = l.recordedAt instanceof Date ? l.recordedAt : new Date(l.recordedAt);
    const receivedAt = l.receivedAt instanceof Date ? l.receivedAt : new Date(l.receivedAt);

    const fiable = METRIQUES_POURCENTAGE.has(l.metricType)
      ? interpreterPourcentage(l.valueNumeric, l.unit).fiable
      : true;

    return {
      metricType: l.metricType,
      source: l.source,
      recordedAt,
      receivedAt,
      valueNumeric: l.valueNumeric,
      valueText: l.valueText,
      valueJson: l.valueJson,
      unit: l.unit,
      locationType: l.locationType,
      signalCode: l.signalCode,
      ageMinutes: (maintenant.getTime() - recordedAt.getTime()) / 60_000,
      interpretationFiable: fiable,
    };
  });

  const fraicheurMax = mesures.reduce<Date | null>(
    (max, m) => (max === null || m.recordedAt > max ? m.recordedAt : max),
    null,
  );

  return {
    mesures,
    fraicheurMax,
    sources: [...new Set(mesures.map((m) => m.source))].sort(),
    vide: mesures.length === 0,
  };
}

/**
 * Toutes les mesures d'une métrique — une par source.
 *
 * Renvoie un TABLEAU même quand il n'y a qu'une source. C'est ce qui empêche un appelant
 * de prendre l'habitude d'une valeur unique et d'écraser la seconde le jour où Toyota
 * s'ajoute : le type lui-même rappelle que le conflit est possible.
 */
export function mesuresPour(etat: EtatVehicule, metricType: string): MesureQualifiee[] {
  return etat.mesures
    .filter((m) => m.metricType === metricType)
    .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
}

/** Deux sources se contredisent-elles au-delà d'une tolérance ? Sert à le DIRE, pas à trancher. */
export function sourcesEnDesaccord(
  mesures: MesureQualifiee[],
  tolerance = 0,
): boolean {
  const numeriques = mesures
    .map((m) => m.valueNumeric)
    .filter((v): v is number => v !== null);
  if (numeriques.length < 2) return false;
  return Math.max(...numeriques) - Math.min(...numeriques) > tolerance;
}

/** Libellés français des métriques. Un seul endroit, pour que l'UI et le MCP disent pareil. */
export const LIBELLES: Readonly<Record<string, string>> = {
  battery_soc: "Charge de la batterie",
  battery_range: "Autonomie",
  battery_capacity: "Capacité de la batterie",
  charging_status: "Statut de charge",
  charge_limit: "Limite de charge",
  charge_plugged_in: "Câble branché",
  charge_time_remaining: "Temps de charge restant",
  charge_connector_type: "Type de connecteur",
  odometer: "Odomètre",
  location: "Position",
  lock_status: "Verrouillage",
  door_status: "Portières",
  window_status: "Fenêtres",
  trunk_status: "Coffre",
  charge_port_status: "Trappe de charge",
  tire_pressure: "Pression des pneus",
  speed: "Vitesse",
  key_fob_battery: "Pile de la clé",
  low_voltage_battery: "Batterie 12 V",
  connectivity_online: "Véhicule en ligne",
  vehicle_asleep: "Véhicule en veille",
  digital_key_paired: "Clé numérique appairée",
  firmware_version: "Version du logiciel",
  vehicle_nickname: "Surnom du véhicule",
  account_permissions: "Permissions du compte",
  account_role: "Rôle sur le véhicule",
  charging_status_detail: "Détail de la charge",
  charge_timers: "Minuteries de charge",
  frunk_status: "Coffre avant",
  sunroof_status: "Toit ouvrant",
  vin: "NIV (numéro de série)",
  battery_capacity_nominal: "Capacité nominale",
  // Souscription élargie du 06/08/2026 — libellés des nouvelles métriques.
  outside_temperature: "Température extérieure",
  inside_temperature: "Température intérieure",
  charge_amperage: "Ampérage de charge",
  charge_amperage_max: "Ampérage max",
  charge_amperage_requested: "Ampérage demandé",
  charge_voltage: "Tension de charge",
  charge_wattage: "Puissance de charge",
  charge_rate: "Vitesse de charge",
  charge_energy_added: "Énergie ajoutée",
  charge_limits: "Limites de charge",
  charge_port_color: "Voyant du port de charge",
  charge_records: "Historique de charges",
  charger_phases: "Phases du chargeur",
  fast_charger_type: "Type de chargeur rapide",
  charge_cable_latched: "Câble verrouillé",
  fast_charger_present: "Chargeur rapide branché",
  hvac_target_temperature: "Température demandée (clim)",
  hvac_active: "Climatisation active",
  defroster_front: "Dégivrage avant",
  defroster_rear: "Dégivrage arrière",
  steering_heater: "Volant chauffant",
  at_home: "À la maison",
  low_voltage_battery_status: "État batterie 12 V",
  drive_mode: "Mode de conduite",
  gear_state: "Position de la boîte",
  in_service: "En entretien",
  surveillance_enabled: "Mode surveillance",
  battery_heater: "Chauffe-batterie",
  max_range_charge_counter: "Charges à 100 %",
  front_trunk_status: "Coffre avant (fronttrunk)",
  tailgate_status: "Hayon",
};

export function libelle(metricType: string): string {
  return LIBELLES[metricType] ?? metricType;
}

/** Noms des sources tels qu'affichés. La provenance est TOUJOURS montrée (Doc 3 §6.1). */
export const NOMS_SOURCES: Readonly<Record<string, string>> = {
  smartcar: "Smartcar",
  toyota_na: "Toyota (non officiel)",
  manual: "Saisie manuelle",
};

export function nomSource(source: string): string {
  return NOMS_SOURCES[source] ?? source;
}

/**
 * Âge d'une mesure, en clair. Vit ICI et pas dans une page : deux écrans qui formatent
 * l'âge chacun dans leur coin finissent par le dire différemment (leçon JobAI sur les
 * gardes dupliquées — la copie la plus grossière finit par gagner).
 */
export function formaterAge(minutes: number): string {
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${Math.round(minutes)} min`;
  const heures = minutes / 60;
  if (heures < 24) return `il y a ${Math.round(heures)} h`;
  return `il y a ${Math.round(heures / 24)} j`;
}

/** Formate une valeur pour l'affichage, en refusant d'inventer quand l'unité est douteuse. */
export function formaterValeur(mesure: MesureQualifiee): string {
  if (mesure.valueNumeric !== null) {
    if (METRIQUES_POURCENTAGE.has(mesure.metricType)) {
      const { pourcent, fiable } = interpreterPourcentage(mesure.valueNumeric, mesure.unit);
      if (!fiable) {
        // On montre la valeur telle quelle et on dit qu'on ne sait pas l'interpréter,
        // plutôt que d'afficher « 30 % » pour une batterie à 0,3 % (ou l'inverse).
        return `${mesure.valueNumeric} (unité non déclarée)`;
      }
      return `${Math.round(pourcent!)} %`;
    }
    const unite = mesure.unit ? ` ${mesure.unit}` : "";
    return `${Math.round(mesure.valueNumeric * 10) / 10}${unite}`;
  }

  if (mesure.valueText !== null) return mesure.valueText;
  if (mesure.valueJson !== null && mesure.valueJson !== undefined) return "détail disponible";
  // Smartcar a répondu sans valeur valide (statut `UNKNOWN`, Doc 2 §5.3). C'est une
  // information — la voiture gère la donnée mais ne l'a pas fournie cette fois-ci.
  return "non communiqué";
}
