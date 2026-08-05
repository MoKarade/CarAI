// lib/db/schema.ts — schéma Drizzle de CarAI (Doc 1 §5).
//
// PRINCIPE : une seule table de FAITS HORODATÉS (`vehicle_snapshots`), alimentée par
// plusieurs sources, plutôt qu'une table par source. Les graphiques et l'historique
// combiné se lisent alors d'une seule requête.
//
// ── LA DÉDUPLICATION EST STRUCTURELLE, PAS UN DÉTAIL ─────────────────────────────────
// Smartcar livre par webhook **tous** les signaux souscrits à chaque événement, pas
// seulement ceux qui ont changé (Doc 2 §6.3). Le véhicule, lui, ne rafraîchit ses données
// que toutes les 30-60 min. Sans garde, une journée produirait des centaines de lignes
// identiques pour un état de charge qui n'a pas bougé.
//
// D'où l'index UNIQUE (source, metric_type, recorded_at) : une MESURE est identifiée par
// l'instant où le VÉHICULE l'a produite, pas par l'instant où on l'a reçue. Deux livraisons
// portant le même `oemUpdatedTime` sont la même mesure — la seconde est ignorée
// (ON CONFLICT DO NOTHING). C'est aussi ce qui rend le pipeline idempotent face aux
// retentatives de livraison de Smartcar, sans avoir à faire confiance à un identifiant
// d'événement.
//
// ⚠️ Corollaire : quand une source ne fournit AUCUN horodatage de mesure, `recorded_at`
// retombe sur `received_at` et la déduplication ne joue plus (chaque appel est un instant
// distinct). C'est honnête — on n'invente pas une fraîcheur qu'on ne connaît pas — mais ça
// veut dire que le volume de ces métriques suit la fréquence de poll, pas celle du véhicule.
//
// ── RÉTENTION ────────────────────────────────────────────────────────────────────────
// Tout est conservé indéfiniment (Doc 1 §4.2). Aucune purge. Les index portent donc sur
// les colonnes de date, pour que les requêtes tiennent à mesure que les années s'empilent.

import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Sources de données. `manual` est réservé aux saisies de Marc (hors scope initial). */
export const SOURCES = ["smartcar", "toyota_na", "manual"] as const;
export type Source = (typeof SOURCES)[number];

/**
 * Types de métriques. Enum OUVERT par conception : la colonne est un `text`, pas un enum
 * Postgres. Une source qui publie un signal qu'on n'a pas anticipé doit pouvoir être
 * stockée plutôt que jetée — voir `lib/smartcar/signals.ts`, qui conserve TOUT signal
 * reçu, y compris inconnu. Une donnée jetée est perdue pour toujours ; une donnée stockée
 * sous un nom imparfait se renomme plus tard.
 */
export const METRIC_TYPES = [
  "battery_soc",
  "battery_range",
  "battery_capacity",
  "charging_status",
  "charge_limit",
  "charge_plugged_in",
  "charge_time_remaining",
  "charge_connector_type",
  "odometer",
  "location",
  "lock_status",
  "door_status",
  "window_status",
  "trunk_status",
  "charge_port_status",
  "tire_pressure",
  "speed",
  "key_fob_battery",
  "low_voltage_battery",
] as const;
export type MetricType = (typeof METRIC_TYPES)[number] | (string & {});

/** Distinction propre à ha-toyota-na (Doc 3 §3) : Smartcar ne donne qu'une dernière position. */
export const LOCATION_TYPES = ["real_time", "last_parked"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const vehicleSnapshots = pgTable(
  "vehicle_snapshots",
  {
    id: serial("id").primaryKey(),

    /**
     * Instant de la MESURE côté véhicule. Vient de l'horodatage de la source quand elle en
     * fournit un (`SC-Data-Age` / `oemUpdatedTime` chez Smartcar, `occurrence_date` chez
     * Toyota). À défaut seulement, égale `received_at`. C'est cette colonne qui sert de
     * fraîcheur réelle et de clé de déduplication — jamais `received_at`.
     */
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),

    /** Instant de réception par CarAI. Sert à mesurer le retard d'une source, pas la fraîcheur. */
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),

    source: text("source").$type<Source>().notNull(),
    metricType: text("metric_type").$type<MetricType>().notNull(),

    /** Code brut du signal chez la source (ex. `tractionbattery-stateofcharge`). Traçabilité. */
    signalCode: text("signal_code"),

    valueNumeric: doublePrecision("value_numeric"),
    valueText: text("value_text"),
    valueJson: jsonb("value_json"),

    /** Unité de `value_numeric` telle que la source la déclare (%, km, kPa, kW…). */
    unit: text("unit"),

    /** Uniquement pour `metric_type = location` (Doc 3 §3). */
    locationType: text("location_type").$type<LocationType>(),
  },
  (t) => [
    // Une mesure = (source, type, instant de mesure). La 2ᵉ livraison de la même mesure
    // est ignorée. Voir l'en-tête de fichier — c'est le cœur de l'idempotence.
    uniqueIndex("vehicle_snapshots_mesure_unique").on(
      t.source,
      t.metricType,
      t.recordedAt,
    ),
    // Série temporelle d'une métrique : le tracé d'un graphique, la requête la plus fréquente.
    index("vehicle_snapshots_metric_date").on(t.metricType, t.recordedAt),
    // Balayage chronologique toutes métriques confondues (tableau de bord, dernier état).
    index("vehicle_snapshots_date").on(t.recordedAt),
  ],
);

export type VehicleSnapshot = typeof vehicleSnapshots.$inferSelect;
export type NouveauSnapshot = typeof vehicleSnapshots.$inferInsert;

/**
 * Historique d'entretien (Doc 1 §5.2). Table DÉDIÉE plutôt qu'un `metric_type` générique :
 * la donnée est riche et structurée (tâches, coût, kilométrage), elle ne rentre pas dans le
 * moule d'un snapshot sans être aplatie.
 *
 * Tous les champs sauf la date sont NULLABLE : Smartcar documente que la richesse dépend de
 * ce que la marque fournit réellement (Doc 2 §5.4). Un coût absent reste absent — on ne le
 * remplace pas par 0, qui affirmerait un entretien gratuit.
 */
export const serviceHistory = pgTable(
  "service_history",
  {
    id: serial("id").primaryKey(),
    source: text("source").$type<Source>().notNull(),
    serviceDate: timestamp("service_date", { withTimezone: true }).notNull(),
    odometerAtService: doublePrecision("odometer_at_service"),
    odometerUnit: text("odometer_unit"),
    /** Liste des tâches effectuées, telle que fournie par la source. */
    tasks: jsonb("tasks"),
    /** `dealership` | `manual` (déclaré par le propriétaire) — vocabulaire de la source. */
    serviceType: text("service_type"),
    totalCost: doublePrecision("total_cost"),
    currency: text("currency"),
    /** Charge utile brute, pour ne rien perdre de ce que la source a envoyé. */
    raw: jsonb("raw"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Empreinte stable de l'entrée (identifiant de la source si elle en fournit un, sinon
     * dérivée de date+odomètre+tâches). Un re-sync hebdomadaire renvoie tout l'historique à
     * chaque fois : sans cette clé, chaque passage dupliquerait tout.
     */
    dedupeKey: text("dedupe_key").notNull(),
  },
  (t) => [
    uniqueIndex("service_history_dedupe_unique").on(t.source, t.dedupeKey),
    index("service_history_date").on(t.serviceDate),
  ],
);

export type ServiceRecord = typeof serviceHistory.$inferSelect;
export type NouveauServiceRecord = typeof serviceHistory.$inferInsert;

export const COMMAND_STATUSES = ["pending", "success", "failed", "unknown"] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

/**
 * Journal de TOUTE commande envoyée au véhicule (Doc 1 §5.3, Doc 4 §4.5).
 *
 * Sa raison d'être : Smartcar documente qu'une commande peut réussir côté API sans que
 * l'effet se propage au véhicule (Doc 2 §5.2). Le seul moyen de comprendre a posteriori
 * « j'ai verrouillé et la voiture était ouverte » est d'avoir gardé la réponse brute.
 */
export const vehicleCommandsLog = pgTable(
  "vehicle_commands_log",
  {
    id: serial("id").primaryKey(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    commandType: text("command_type").notNull(),
    source: text("source").$type<Source>().notNull(),
    status: text("status").$type<CommandStatus>().notNull(),
    /** Qui a déclenché : `mcp`, `ui`, `system`. Utile quand une commande surprend. */
    issuedBy: text("issued_by"),
    /** Paramètres de la commande (ex. limite de charge demandée). */
    params: jsonb("params"),
    message: text("message"),
    rawResponse: jsonb("raw_response"),
  },
  (t) => [index("vehicle_commands_log_date").on(t.issuedAt)],
);

export type CommandLogEntry = typeof vehicleCommandsLog.$inferSelect;
export type NouvelleCommande = typeof vehicleCommandsLog.$inferInsert;

/**
 * Configuration persistée (clé → JSON). Ce qui doit survivre à un redéploiement sans être
 * un secret d'environnement : `userId` Smartcar issu du flow Connect, `vehicleId`, termes
 * du bail (Doc 4 §3.4 : « à stocker en config ou en base plutôt qu'en dur »), état de santé
 * du module Toyota, cache de compatibilité.
 *
 * ⚠️ AUCUN SECRET ICI. Les identifiants Smartcar et le mot de passe Toyota vivent dans les
 * variables d'environnement (chiffrées par l'hébergeur), jamais dans cette table.
 */
export const appConfig = pgTable("app_config", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConfigRow = typeof appConfig.$inferSelect;

/**
 * Journal des livraisons de webhook (Doc 2 §6.3 et §6.4).
 *
 * Deux usages, le second au moins aussi important que le premier :
 *  1. IDEMPOTENCE — un même `event_id` re-livré n'est pas retraité.
 *  2. SURVEILLANCE — Smartcar DÉSACTIVE automatiquement un webhook après 6 échecs de
 *     livraison consécutifs. Le flux s'arrête alors en silence : rien n'est rouge, l'app
 *     marche, et les données cessent simplement d'arriver. La date de la dernière livraison
 *     est le seul signal qui permet de voir ce silence — d'où sa persistance ici.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    /** Nombre de snapshots réellement écrits (0 = tout était déjà connu, c'est normal). */
    snapshotsWritten: integer("snapshots_written").notNull().default(0),
    raw: jsonb("raw"),
  },
  (t) => [index("webhook_deliveries_date").on(t.receivedAt)],
);

/**
 * Codes OTP reçus par courriel pour l'authentification Toyota (Doc 3 §4.3).
 *
 * ⚠️ Un code CONSOMMÉ ne doit jamais être réutilisé : sans `consumed_at`, une tentative de
 * connexion en échec rejouerait indéfiniment le même code périmé en croyant l'avoir reçu.
 * Le code est un secret de courte durée — il est purgé après usage (voir `lib/toyota/otp.ts`).
 */
export const otpCodes = pgTable(
  "otp_codes",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [index("otp_codes_date").on(t.receivedAt)],
);
