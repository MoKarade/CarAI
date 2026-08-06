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
 * ── CE QUE LE VÉHICULE RÉEL A APPRIS (06/08/2026) ────────────────────────────────────
 * Le motif est `{groupe}-{nom en minuscules}`, et les booléens sont nommés `is…` :
 * `closure-islocked` et NON `closure-lockstatus`. Presque toutes les hypothèses du Doc 2
 * §4.2 étaient fausses.
 *
 * ⚠️ ET C'EST LÀ QUE LE REPLI PAR GROUPE EST DEVENU DANGEREUX. Sur la bZ, le groupe
 * `Charge` porte SIX signaux distincts et `Closure` en porte QUATRE — tous datés du même
 * instant. Les ranger sous une métrique commune les met en collision avec l'index unique
 * `(source, metric_type, recorded_at)` : le premier est écrit, les cinq autres sont
 * silencieusement écartés comme des doublons. Sur quinze signaux fonctionnels, on n'en
 * aurait enregistré que huit, sans la moindre erreur pour le signaler.
 *
 * Le repli par groupe est donc RETIRÉ du chemin d'écriture (voir `metriquePourSignal`).
 * Il ne sert plus qu'à l'AFFICHAGE d'un code inconnu, où une collision n'a aucun effet.
 *
 * Entrées ✓ : confirmées sur le véhicule de Marc.
 */
export const CORRESPONDANCE_EXACTE: Readonly<Record<string, MetricType>> = {
  // ✓ Confirmés en SUCCESS sur la bZ XLE AWD 2026
  "tractionbattery-stateofcharge": "battery_soc",
  "tractionbattery-range": "battery_range",
  "odometer-traveleddistance": "odometer",
  "location-preciselocation": "location",
  "wheel-tires": "tire_pressure",
  "closure-islocked": "lock_status",
  "closure-doors": "door_status",
  "closure-windows": "window_status",
  // Sur un électrique, l'« engine cover » est le coffre avant (frunk).
  "closure-enginecover": "frunk_status",
  "charge-ischarging": "charging_status",
  "charge-detailedchargingstatus": "charging_status_detail",
  "charge-ischargingcableconnected": "charge_plugged_in",
  "charge-ischargingportflapopen": "charge_port_status",
  "charge-timetocomplete": "charge_time_remaining",
  "charge-chargetimers": "charge_timers",

  // ✓ Confirmés mais REFUSÉS par la bZ (VEHICLE_NOT_CAPABLE) — conservés pour que la
  // donnée soit bien rangée si un autre véhicule les fournissait un jour.
  "connectivitystatus-isonline": "connectivity_online",
  "connectivitystatus-isasleep": "vehicle_asleep",
  "connectivitystatus-isdigitalkeypaired": "digital_key_paired",
  "connectivitysoftware-currentfirmwareversion": "firmware_version",
  "vehicleidentification-nickname": "vehicle_nickname",
  "vehicleuseraccount-permissions": "account_permissions",
  "vehicleuseraccount-role": "account_role",
  "closure-reartrunk": "trunk_status",
  "closure-sunroof": "sunroof_status",

  // ✓ Confirmés mais bloqués par une PERMISSION manquante côté Connect.
  "motion-currentspeed": "speed",
  "vehicleidentification-vin": "vin",

  // — Encore hypothétiques —
  // ⚠️ JAMAIS deux codes vers la MÊME métrique : s'ils arrivaient au même horodatage, le
  // second serait écarté par l'index unique comme un doublon — la collision exacte que le
  // correctif du 06/08 (#10) a retirée du repli par groupe. Deux capacités distinctes chez
  // la source restent deux métriques distinctes chez nous.
  "tractionbattery-capacity": "battery_capacity",
  "tractionbattery-nominalcapacity": "battery_capacity_nominal",
  "charge-chargelimit": "charge_limit",
  "lowvoltagebattery-stateofcharge": "low_voltage_battery",
};

/**
 * Les signaux que la bZ de Marc a CONFIRMÉS en `SUCCESS` (rapport du 06/08/2026).
 *
 * C'est la LISTE DE RÉFÉRENCE de la couverture : la page /donnees compare ce que la base
 * contient à cette liste, et nomme ce qui manque. Sans elle, « vérifier qu'on reçoit tout »
 * n'a pas de définition — on ne peut pas voir l'absence d'une donnée qu'on n'attend pas.
 *
 * ⚠️ Ne PAS y ajouter un code non confirmé : un signal jamais observé en SUCCESS afficherait
 * « manquant » en permanence, et l'indicateur perdrait son sens (même piège que la revue
 * saturée de DriveAI). Si un nouveau signal passe SUCCESS un jour (ex. `motion-currentspeed`
 * après un Connect élargi), l'ajouter ICI dans le même commit.
 */
export const SIGNAUX_CONFIRMES_BZ: readonly string[] = [
  "tractionbattery-stateofcharge",
  "tractionbattery-range",
  "odometer-traveleddistance",
  "location-preciselocation",
  "wheel-tires",
  "closure-islocked",
  "closure-doors",
  "closure-windows",
  "closure-enginecover",
  "charge-ischarging",
  "charge-detailedchargingstatus",
  "charge-ischargingcableconnected",
  "charge-ischargingportflapopen",
  "charge-timetocomplete",
  "charge-chargetimers",
] as const;

/**
 * Groupe → métrique. ⚠️ SERT UNIQUEMENT À L'AFFICHAGE d'un code inconnu, JAMAIS au
 * classement en base — voir l'avertissement de `CORRESPONDANCE_EXACTE` et
 * `metriquePourSignal`. Deux signaux d'un même groupe se ranger sous la même métrique
 * les met en collision avec l'index unique, et le second disparaît sans bruit.
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

/**
 * Métrique sous laquelle STOCKER un signal. Ne renvoie JAMAIS null : rien n'est jeté.
 *
 * ══ POURQUOI IL N'Y A PLUS DE REPLI PAR GROUPE ICI (correctif du 06/08/2026) ═════════
 *
 * La conception d'origine avait trois niveaux — code exact, puis groupe, puis code brut —
 * pensés pour qu'un nom de signal mal deviné reste bien classé. Ça a effectivement
 * rattrapé toutes les hypothèses fausses du Doc 2 §4.2.
 *
 * Mais le rapport de signaux de la bZ a montré le prix caché : le groupe `Charge` porte
 * SIX signaux qui fonctionnent, `Closure` en porte QUATRE, et tous partagent le même
 * horodatage. Les ranger sous une métrique commune les met en collision avec l'index
 * unique `(source, metric_type, recorded_at)` : le premier est écrit, les autres sont
 * écartés comme des doublons — silencieusement, puisque c'est exactement le comportement
 * voulu pour une vraie re-livraison. Sur quinze signaux fonctionnels, huit auraient
 * survécu, et rien n'aurait signalé la perte des sept autres.
 *
 * Le repli par groupe ne pouvait donc pas rester sur le chemin d'écriture. Un code inconnu
 * devient sa PROPRE métrique : moins lisible, mais unique par construction — donc jamais
 * perdu, et reclassable d'une requête SQL une fois qu'on sait ce qu'il est.
 *
 * `CORRESPONDANCE_GROUPE` survit pour l'AFFICHAGE (`libelle`), où deux signaux qui
 * partagent une étiquette n'ont aucune conséquence.
 */
export function metriquePourSignal(code: string, _groupe?: string): MetricType {
  return CORRESPONDANCE_EXACTE[code] ?? code;
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
    // Le statut fait partie de la MESURE : sans lui, une ligne sans valeur est ambiguë
    // pour toujours (« UNKNOWN » vs « refusé »), et le raw qui permettait de trancher est
    // purgé après sa fenêtre de rétention.
    signalStatus: signal.statut,
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

/**
 * Codes des signaux d'une charge utile, triés. Alimente le journal de livraison : sans les
 * NOMS, « 11 reçus » ne dit pas si les quatre absents sont ceux qu'on attendait — c'est
 * précisément la question « est-ce qu'on reçoit bien toutes les données ? ».
 */
export function codesDesSignaux(signaux: unknown): string[] {
  return listeDeSignaux(signaux)
    .map((brut) => normaliserSignal(brut)?.code)
    .filter((code): code is string => Boolean(code))
    .sort();
}

/**
 * Nombre de signaux d'une charge utile, TOUTES formes confondues (tableau ou objet
 * indexé) — la MÊME coercition que le chemin d'écriture. Compter `length` seulement sur
 * un tableau faisait afficher « 0 reçu » (le signal d'alarme par excellence) pour une
 * charge en objet pourtant écrite normalement, avec un delta « sans code lisible »
 * NÉGATIF en prime (revue adversariale du 06/08/2026).
 */
export function nombreDeSignaux(signaux: unknown): number {
  return listeDeSignaux(signaux).length;
}

/**
 * Coercition d'une charge utile en liste de signaux bruts — tableau ou objet indexé.
 * Partagée entre l'ÉCRITURE (`signauxVersSnapshots`) et le JOURNAL (`codesDesSignaux`) :
 * deux lectures séparées finiraient par diverger, et le journal mentirait sur ce qui
 * a réellement été écrit.
 */
function listeDeSignaux(signaux: unknown): SignalBrut[] {
  if (Array.isArray(signaux)) return signaux as SignalBrut[];
  if (signaux && typeof signaux === "object") {
    return Object.entries(signaux as Record<string, unknown>).map(([code, valeur]) => {
      const o = objet(valeur);
      return o ? ({ code, ...o } as SignalBrut) : ({ code, value: valeur } as SignalBrut);
    });
  }
  return [];
}

/** Traduit une charge utile de signaux en lignes prêtes à insérer. Tolère un tableau ou un objet indexé. */
export function signauxVersSnapshots(
  signaux: unknown,
  options: OptionsConversion,
): NouveauSnapshot[] {
  const sorties: NouveauSnapshot[] = [];
  for (const brut of listeDeSignaux(signaux)) {
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
