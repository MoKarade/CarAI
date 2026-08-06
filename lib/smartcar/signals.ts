// lib/smartcar/signals.ts — traduction des signaux Smartcar V3 en snapshots CarAI.
// FONCTIONS PURES, aucune I/O : c'est ce qui rend cette couche testable sans réseau.
//
// ══ POURQUOI CE FICHIER EST DÉFENSIF, ET POURQUOI C'EST DÉLIBÉRÉ ═════════════════════
//
// Le Doc 2 §4.2 est explicite : la table de correspondance qu'il propose est une HYPOTHÈSE
// construite depuis la doc générale, et il demande d'aller vérifier chaque groupe sur
// `smartcar.com/docs/api-reference/signals/{groupe}` avant de coder le mapping.
//
// Cette vérification n'a PAS pu être faite : la politique d'egress de la session bloque
// `smartcar.com` (403 confirmé côté proxy, pas un incident réseau). Deux codes seulement
// sont confirmés par des sources tierces — `tractionbattery-stateofcharge` (en pourcent) et
// `odometer-traveleddistance` (en km). Tout le reste ci-dessous est une hypothèse.
//
// La réponse n'est pas de deviner mieux, c'est de rendre l'erreur INOFFENSIVE. Trois
// niveaux, du plus précis au plus grossier, et AUCUN qui jette la donnée :
//
//   1. Correspondance EXACTE du code    → métrique précise (le cas nominal).
//   2. À défaut, correspondance par GROUPE (`closure-*`, `wheel-*`) → métrique de groupe.
//      Un nom de signal mal deviné tombe ici et reste correctement classé, parce que le
//      GROUPE, lui, vient de la liste officielle des groupes V3.
//   3. À défaut, le code brut devient le `metric_type`, en clair.
//
// Une donnée jetée est perdue pour toujours ; une donnée rangée sous un nom imparfait se
// renomme d'une requête SQL. `signal_code` conserve toujours le code d'origine, donc le
// jour où la doc est lisible, on corrige la table SANS avoir perdu un seul octet
// d'historique. C'est la seule conception qui reste honnête sous incertitude.

import type { LocationType, MetricType, NouveauSnapshot } from "@/lib/db/schema";

/** Signal V3 tel qu'il arrive, tolérant sur la forme exacte de l'enveloppe (voir plus bas). */
export interface SignalBrut {
  code?: unknown;
  attributes?: unknown;
  attribute?: unknown;
  meta?: unknown;
  metadata?: unknown;
  [k: string]: unknown;
}

export interface SignalNormalise {
  code: string;
  groupe: string;
  nom: string;
  valeur: unknown;
  unite: string | null;
  /** Instant où le VÉHICULE a produit la mesure, si la source le dit. */
  oemUpdatedAt: Date | null;
  /** Instant où Smartcar a récupéré la donnée chez l'OEM. */
  retrievedAt: Date | null;
  /** `SUCCESS`, ou le motif pour lequel l'OEM n'a pas fourni la valeur. */
  statut: string | null;
}

/**
 * Correspondances EXACTES code → métrique CarAI.
 *
 * ── CE QU'UNE LIVRAISON RÉELLE A APPRIS (06/08/2026) ─────────────────────────────────
 * Le motif est `{groupe}-{nom en minuscules}`, et les booléens sont nommés `is…` :
 * `closure-islocked` et NON `closure-lockstatus`. Plusieurs hypothèses du Doc 2 §4.2
 * étaient donc fausses — sans conséquence, le repli par GROUPE les ayant toutes rattrapées.
 * C'est précisément ce que cette conception à trois niveaux devait absorber.
 *
 * Les entrées marquées ✓ viennent d'une livraison observée. Les autres restent des
 * hypothèses : elles seront confirmées ou corrigées à mesure que les signaux arrivent, et
 * `signal_code` conserve toujours le code d'origine pour reclasser sans rien perdre.
 */
export const CORRESPONDANCE_EXACTE: Readonly<Record<string, MetricType>> = {
  // ✓ Observés dans une livraison réelle
  "tractionbattery-stateofcharge": "battery_soc",
  "odometer-traveleddistance": "odometer",
  "closure-islocked": "lock_status",
  "connectivitystatus-isonline": "connectivity_online",
  "connectivitystatus-isasleep": "vehicle_asleep",
  "connectivitystatus-isdigitalkeypaired": "digital_key_paired",
  "connectivitysoftware-currentfirmwareversion": "firmware_version",
  "vehicleidentification-nickname": "vehicle_nickname",
  "vehicleuseraccount-permissions": "account_permissions",
  "vehicleuseraccount-role": "account_role",

  // — Hypothèses (Doc 2 §4.2), à confirmer à l'arrivée —
  "tractionbattery-range": "battery_range",
  "tractionbattery-capacity": "battery_capacity",
  "tractionbattery-nominalcapacity": "battery_capacity",
  "charge-status": "charging_status",
  "charge-chargingstatus": "charging_status",
  "charge-ischarging": "charging_status",
  "charge-ispluggedin": "charge_plugged_in",
  "charge-chargelimit": "charge_limit",
  "charge-timetocomplete": "charge_time_remaining",
  "location-preciselocation": "location",
  "closure-doorstatus": "door_status",
  "closure-windowstatus": "window_status",
  "closure-trunkstatus": "trunk_status",
  "closure-chargeportstatus": "charge_port_status",
  "wheel-tirepressure": "tire_pressure",
  "motion-speed": "speed",
  "lowvoltagebattery-stateofcharge": "low_voltage_battery",
};

/**
 * Repli par GROUPE. Les noms de groupes viennent de la liste officielle V3 (Doc 2 §4.1) —
 * c'est ce qui rend ce filet solide même quand le nom du signal est mal deviné.
 */
export const CORRESPONDANCE_GROUPE: Readonly<Record<string, MetricType>> = {
  tractionbattery: "battery_soc",
  charge: "charging_status",
  odometer: "odometer",
  location: "location",
  closure: "lock_status",
  wheel: "tire_pressure",
  motion: "speed",
  lowvoltagebattery: "low_voltage_battery",
  connectivitystatus: "connectivity_online",
  connectivitysoftware: "firmware_version",
  vehicleidentification: "vehicle_nickname",
  vehicleuseraccount: "account_role",
};

/**
 * Groupes SANS objet pour un véhicule électrique (Doc 2 §4.1). Ils ne sont jamais demandés,
 * et s'ils arrivaient quand même ils seraient stockés en brut plutôt que mal rangés.
 */
export const GROUPES_HORS_SUJET = new Set(["internalcombustionengine", "transmission"]);

function objet(valeur: unknown): Record<string, unknown> | null {
  return valeur && typeof valeur === "object" && !Array.isArray(valeur)
    ? (valeur as Record<string, unknown>)
    : null;
}

function chaine(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() ? valeur.trim() : null;
}

/**
 * Lit un horodatage, qu'il soit une chaîne ISO-8601 ou un NOMBRE.
 *
 * ⚠️ Smartcar envoie des timestamps NUMÉRIQUES en millisecondes (`oemUpdatedAt:
 * 1786018966898`), pas des chaînes ISO — confirmé par une livraison réelle le 06/08/2026.
 * La première version n'acceptait que des chaînes : tous les horodatages tombaient à
 * `null`, `recordedAt` retombait sur l'instant de réception, et la déduplication du schéma
 * — qui repose ENTIÈREMENT sur `recorded_at` — cessait de fonctionner. Chaque livraison
 * aurait dupliqué une donnée inchangée, et la fraîcheur affichée aurait été fausse.
 *
 * Renvoie `null` plutôt qu'une date bidon : une fraîcheur inventée est pire que pas de
 * fraîcheur du tout.
 */
export function dateOuNull(valeur: unknown): Date | null {
  if (typeof valeur === "number" && Number.isFinite(valeur) && valeur > 0) {
    // Secondes ou millisecondes ? 1e11 SECONDES vaut l'an 5138 : au-delà, c'est forcément
    // des millisecondes. En dessous de 1e9 (soit avant 2001) on refuse, plutôt que de
    // dater une mesure de véhicule des années 1970.
    if (valeur >= 1e11) return new Date(valeur);
    if (valeur >= 1e9) return new Date(valeur * 1000);
    return null;
  }

  const texte = chaine(valeur);
  if (!texte) return null;

  // Une chaîne peut aussi porter un timestamp numérique (« 1786018966898 »).
  if (/^\d{10,16}$/.test(texte)) return dateOuNull(Number(texte));

  const d = new Date(texte);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Aplatit un signal V3 quelle que soit la forme exacte de son enveloppe.
 *
 * Pourquoi tolérer plusieurs formes : la structure connue est
 * `{ code, attributes: { name, group, body: { unit, value } }, meta: { oemUpdatedTime, … } }`,
 * mais elle n'a pas pu être vérifiée champ par champ (proxy). Accepter `attribute`/`meta`/
 * `metadata` et une valeur posée directement sur le signal coûte quinze lignes ; se tromper
 * coûterait un pipeline qui écrit des `null` sans rien signaler.
 */
export function normaliserSignal(brut: SignalBrut): SignalNormalise | null {
  const code = chaine(brut.code);
  if (!code) return null;

  // Forme RÉELLE, confirmée par une livraison du 06/08/2026 : `name`, `group`, `body`,
  // `status` et `meta` sont à la RACINE du signal, pas sous `attributes`. La lecture par
  // `attributes` reste en repli — elle ne coûte rien et survivrait à un changement.
  const attrs = objet(brut.attributes) ?? objet(brut.attribute) ?? {};
  const meta = objet(brut.meta) ?? objet(brut.metadata) ?? {};
  const body = objet(brut.body) ?? objet(attrs.body) ?? {};
  const statut = objet(brut.status) ?? {};

  const codeMinuscule = code.toLowerCase();
  const groupe = (
    chaine(brut.group) ??
    chaine(attrs.group) ??
    codeMinuscule.split("-")[0] ??
    ""
  ).toLowerCase();
  const nom =
    chaine(brut.name) ?? chaine(attrs.name) ?? codeMinuscule.split("-").slice(1).join("-");

  // `body.values` au PLURIEL pour les signaux à valeurs multiples (permissions du compte,
  // par exemple). L'ignorer écrirait une ligne vide là où une liste existe.
  const valeur =
    "value" in body
      ? body.value
      : "values" in body
        ? body.values
        : "value" in brut
          ? brut.value
          : (attrs.value ?? null);

  return {
    code: codeMinuscule,
    groupe,
    nom,
    valeur,
    unite: chaine(body.unit) ?? chaine(attrs.unit),
    // `SUCCESS` quand le véhicule a répondu. Autre chose signale une donnée que l'OEM n'a
    // pas pu fournir cette fois-ci — à distinguer d'une absence pure.
    statut: chaine(statut.value) ?? chaine(brut.status),
    oemUpdatedAt: dateOuNull(meta.oemUpdatedAt ?? meta.oemUpdatedTime),
    retrievedAt: dateOuNull(meta.retrievedAt ?? meta.retrievedTime ?? meta.ingestedTime),
  };
}

/** Applique les trois niveaux de correspondance. Ne renvoie JAMAIS null : rien n'est jeté. */
export function metriquePourSignal(code: string, groupe: string): MetricType {
  const exact = CORRESPONDANCE_EXACTE[code];
  if (exact) return exact;

  const parGroupe = CORRESPONDANCE_GROUPE[groupe];
  if (parGroupe && !GROUPES_HORS_SUJET.has(groupe)) return parGroupe;

  // Dernier recours : le code brut EST la métrique. Illisible mais présent, donc
  // récupérable. C'est le seul comportement qui ne perd pas de donnée.
  return code;
}

/**
 * true si la valeur est un nombre exploitable. `NaN` et `Infinity` sont exclus : une valeur
 * non finie ne doit jamais devenir un défaut numérique (règle no-fake-data de l'écosystème).
 */
function estNombreFini(valeur: unknown): valeur is number {
  return typeof valeur === "number" && Number.isFinite(valeur);
}

export interface OptionsConversion {
  source: "smartcar" | "toyota_na";
  /** Instant de réception, injecté pour que la conversion reste PURE et testable. */
  recuLe: Date;
  locationType?: LocationType;
}

/**
 * Convertit un signal normalisé en ligne de `vehicle_snapshots`.
 *
 * ── LE CHOIX DE `recordedAt` EST LE POINT CRITIQUE ──────────────────────────────────
 * Priorité : horodatage OEM (quand le véhicule a mesuré) > horodatage de récupération
 * Smartcar > instant de réception. C'est ce que le Doc 2 §5.6 impose, et c'est aussi ce qui
 * fait fonctionner la déduplication du schéma : deux livraisons portant la même mesure
 * portent le même `recordedAt` et ne créent qu'une ligne.
 *
 * Retomber sur `recuLe` n'est donc pas anodin — ça DÉSACTIVE de fait la déduplication pour
 * ce signal. C'est assumé et documenté (en-tête de `lib/db/schema.ts`) : mieux vaut des
 * doublons visibles qu'une fraîcheur inventée.
 */
export function signalVersSnapshot(
  signal: SignalNormalise,
  options: OptionsConversion,
): NouveauSnapshot {
  const metricType = metriquePourSignal(signal.code, signal.groupe);
  const recordedAt = signal.oemUpdatedAt ?? signal.retrievedAt ?? options.recuLe;

  const base: NouveauSnapshot = {
    recordedAt,
    receivedAt: options.recuLe,
    source: options.source,
    metricType,
    signalCode: signal.code,
    unit: signal.unite,
    valueNumeric: null,
    valueText: null,
    valueJson: null,
    locationType: options.locationType ?? null,
  };

  if (estNombreFini(signal.valeur)) {
    return { ...base, valueNumeric: signal.valeur };
  }
  if (typeof signal.valeur === "string") {
    return { ...base, valueText: signal.valeur };
  }
  if (typeof signal.valeur === "boolean") {
    // Stocké dans les DEUX colonnes : le texte reste lisible à l'œil dans la base, le
    // numérique rend le signal traçable sur un graphique (branché / débranché).
    return { ...base, valueText: String(signal.valeur), valueNumeric: signal.valeur ? 1 : 0 };
  }
  if (signal.valeur !== null && signal.valeur !== undefined) {
    // Objet ou tableau : position GPS, pressions des quatre pneus, statut par portière.
    return { ...base, valueJson: signal.valeur as NouveauSnapshot["valueJson"] };
  }

  // Valeur absente. On écrit quand même la ligne : « Smartcar a répondu, sans valeur » est
  // une information — c'est le statut `UNKNOWN` que le Doc 2 §5.3 documente pour un
  // véhicule qui gère la donnée mais n'en a pas fourni de valide cette fois-ci.
  return base;
}

/** Traduit une charge utile de signaux en lignes prêtes à insérer. Tolère un tableau ou un objet indexé. */
export function signauxVersSnapshots(
  signaux: unknown,
  options: OptionsConversion,
): NouveauSnapshot[] {
  const liste: SignalBrut[] = Array.isArray(signaux)
    ? (signaux as SignalBrut[])
    : signaux && typeof signaux === "object"
      ? Object.entries(signaux as Record<string, unknown>).map(([code, valeur]) => {
          const o = objet(valeur);
          return o ? ({ code, ...o } as SignalBrut) : ({ code, value: valeur } as SignalBrut);
        })
      : [];

  const sorties: NouveauSnapshot[] = [];
  for (const brut of liste) {
    const normalise = normaliserSignal(brut);
    if (!normalise) continue;
    sorties.push(signalVersSnapshot(normalise, options));
  }
  return sorties;
}

/**
 * Interprète un pourcentage SANS deviner.
 *
 * Le Doc 2 §5.1 signale que l'API V2 renvoyait une FRACTION (`0.3` pour 30 %) et que le
 * format V3 n'a pas pu être confirmé. La tentation serait d'écrire « si la valeur est ≤ 1,
 * c'est une fraction » : ce serait un bug silencieux et grave, parce qu'un état de charge de
 * 1 % est parfaitement légitime — la voiture serait affichée à 100 % au moment précis où
 * elle est vide.
 *
 * On se fie donc à l'UNITÉ déclarée, et quand elle ne tranche pas, on le DIT (`fiable:
 * false`) pour que l'affichage montre la valeur brute plutôt qu'un pourcentage inventé.
 */
export function interpreterPourcentage(
  valeur: number | null,
  unite: string | null,
): { pourcent: number | null; fiable: boolean } {
  if (valeur === null || !Number.isFinite(valeur)) return { pourcent: null, fiable: false };

  const u = (unite ?? "").trim().toLowerCase();
  if (u === "percent" || u === "percentage" || u === "%") {
    return { pourcent: valeur, fiable: true };
  }
  if (u === "ratio" || u === "fraction" || u === "unitless") {
    return { pourcent: valeur * 100, fiable: true };
  }
  // Unité absente ou inconnue : hors de question de trancher entre 0,3 % et 30 %.
  return { pourcent: valeur, fiable: false };
}
