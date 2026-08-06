// lib/smartcar/ingest.ts — écriture en base des données Smartcar.
//
// Sépare volontairement la TRADUCTION (pure, dans `signals.ts`) de l'ÉCRITURE (ici). C'est
// ce qui permet de tester tout le mapping sans base ni réseau, et de tester l'écriture sur
// PGlite sans mock.

import { and, desc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { CLE_SMARTCAR_VEHICLE, ecrireConfig, lireConfigTexte } from "@/lib/config";
import {
  serviceHistory,
  vehicleSnapshots,
  webhookDeliveries,
  type NouveauServiceRecord,
  type NouveauSnapshot,
} from "@/lib/db/schema";
import { signauxVersSnapshots } from "./signals";

/**
 * Insère des snapshots en ignorant les doublons.
 *
 * `onConflictDoNothing` s'appuie sur l'index unique (source, metric_type, recorded_at) —
 * voir l'en-tête de `lib/db/schema.ts`. C'est ce qui rend l'ingestion IDEMPOTENTE sans
 * qu'on ait à faire confiance à un identifiant de livraison : Smartcar peut retenter une
 * livraison, ou pousser douze fois le même état de charge inchangé, rien ne se duplique.
 *
 * Renvoie le nombre de lignes RÉELLEMENT écrites. Un zéro n'est pas une anomalie : c'est le
 * cas normal quand la voiture n'a pas bougé depuis la dernière livraison. Cette distinction
 * compte — elle empêche de lire « 0 écrit » comme une panne.
 */
export async function insererSnapshots(lignes: NouveauSnapshot[]): Promise<number> {
  if (lignes.length === 0) return 0;
  const inserees = await db
    .insert(vehicleSnapshots)
    .values(lignes)
    .onConflictDoNothing()
    .returning({ id: vehicleSnapshots.id });
  return inserees.length;
}

/**
 * Traite une livraison de webhook déjà authentifiée et lue.
 *
 * L'ordre des écritures est délibéré : les SNAPSHOTS d'abord, la trace de livraison
 * ENSUITE. Une coupure entre les deux fait rejouer la livraison au prochain envoi de
 * Smartcar, et la déduplication absorbe le rejeu sans créer de doublon. L'ordre inverse
 * perdrait les données en croyant les avoir traitées — c'est la règle « l'inscription
 * "c'est fini" se pose en dernier » que DriveAI a apprise à ses dépens.
 */
export async function ingererLivraison(params: {
  eventId: string | null;
  eventType: string;
  signaux: unknown;
  raw: unknown;
  /**
   * Identifiant du véhicule porté par la livraison. Sert à APPRENDRE cet identifiant
   * plutôt qu'à aller le demander — voir `apprendreVehicleId`.
   */
  vehicleId?: string | null;
  /**
   * Livraison de TEST (données simulées par Smartcar). Elle est TRACÉE, mais aucun
   * snapshot n'est écrit — voir le bloc dédié plus bas.
   */
  simulee?: boolean;
  recuLe?: Date;
}): Promise<{ ecrits: number; dejaTraite: boolean; ignoree: boolean }> {
  const {
    eventId,
    eventType,
    signaux,
    raw,
    vehicleId,
    simulee = false,
    recuLe = new Date(),
  } = params;

  if (eventId) {
    const deja = await db
      .select({ eventId: webhookDeliveries.eventId })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.eventId, eventId))
      .limit(1);
    if (deja.length > 0) return { ecrits: 0, dejaTraite: true, ignoree: false };
  }

  // ══ LIVRAISON SIMULÉE : ON TRACE, ON N'ENREGISTRE RIEN ═════════════════════════════
  //
  // Une livraison de test porte les données d'un véhicule FICTIF — la première reçue
  // décrivait une Tesla Model 3 de 2020 à 78 432 km, avec 65 % de CARBURANT. Ces
  // kilomètres entreraient dans l'historique d'odomètre, donc dans la régression du bail,
  // et CarAI annoncerait un dépassement de dizaines de milliers de kilomètres fondé sur
  // une voiture qui n'est pas la sienne. C'est de la fausse donnée à conséquence
  // financière, pas un désagrément d'affichage.
  //
  // La TRACE est conservée : elle prouve que le pipeline fonctionne de bout en bout et
  // alimente la surveillance du silence, sans qu'un seul chiffre inventé n'atteigne les
  // données. On n'apprend pas non plus l'identifiant d'un véhicule fictif.
  if (simulee) {
    console.warn(
      `[smartcar] livraison de TEST reçue (${eventType}) — tracée, aucun snapshot enregistré.`,
    );
    await db
      .insert(webhookDeliveries)
      .values({
        eventId: eventId ?? empreinte(JSON.stringify(raw ?? {})),
        eventType: `${eventType}_TEST`,
        receivedAt: recuLe,
        snapshotsWritten: 0,
        raw: raw as object,
      })
      .onConflictDoNothing();
    return { ecrits: 0, dejaTraite: false, ignoree: true };
  }

  // Avant toute écriture de données : si la livraison nous apprend l'identifiant du
  // véhicule et qu'on ne l'a pas encore, on le retient. Voir `apprendreVehicleId`.
  if (vehicleId) await apprendreVehicleId(vehicleId);

  const lignes = signauxVersSnapshots(signaux, { source: "smartcar", recuLe });
  const ecrits = await insererSnapshots(lignes);

  await db
    .insert(webhookDeliveries)
    .values({
      // Sans identifiant fourni, on en fabrique un stable à partir du contenu : deux
      // livraisons identiques ne créeront qu'une trace, et le journal reste exploitable
      // pour détecter le silence d'un webhook désactivé.
      eventId: eventId ?? empreinte(JSON.stringify(raw ?? {})),
      eventType,
      receivedAt: recuLe,
      snapshotsWritten: ecrits,
      raw: raw as object,
    })
    .onConflictDoNothing();

  // Purge OPPORTUNISTE du raw hors fenêtre : une requête bornée par index, au rythme des
  // livraisons (quelques-unes par heure). Jamais bloquante — les données de CETTE livraison
  // sont déjà écrites, un échec de ménage ne doit pas les faire rejouer par un 500.
  try {
    const purgees = await purgerRawWebhooks({ maintenant: recuLe });
    if (purgees > 0) {
      console.log(
        `[smartcar] ménage : payload brut vidé sur ${purgees} livraison(s) hors fenêtre de rétention (lignes conservées).`,
      );
    }
  } catch (err) {
    console.error("[smartcar] purge du raw impossible — réessaiera à la prochaine livraison", err);
  }

  return { ecrits, dejaTraite: false, ignoree: false };
}

function empreinte(texte: string): string {
  return createHash("sha256").update(texte).digest("hex").slice(0, 40);
}

/** Rétention par défaut du payload BRUT des livraisons, en jours. Voir `purgerRawWebhooks`. */
export const RETENTION_RAW_JOURS_DEFAUT = 90;

/**
 * Fenêtre de rétention du `raw` des livraisons, lue de `WEBHOOK_RAW_RETENTION_JOURS`.
 * `0` = conserver pour toujours. Valeur absente, non numérique ou négative → défaut :
 * une variable mal tapée ne doit pas déclencher une purge inattendue ni l'annuler en silence.
 */
export function retentionRawJours(
  env: Record<string, string | undefined> = process.env,
): number {
  const brut = env.WEBHOOK_RAW_RETENTION_JOURS?.trim();
  if (!brut) return RETENTION_RAW_JOURS_DEFAUT;
  const n = Number(brut);
  if (!Number.isFinite(n) || n < 0) return RETENTION_RAW_JOURS_DEFAUT;
  return Math.floor(n);
}

/**
 * Vide le payload BRUT (`raw`) des livraisons plus vieilles que la fenêtre de rétention.
 *
 * ══ CE QUE ÇA SUPPRIME, ET CE QUE ÇA NE SUPPRIME JAMAIS ══════════════════════════════
 * Le `raw` est un artefact de DIAGNOSTIC, redondant par construction : depuis le correctif
 * de collision (#10), CHAQUE signal d'une livraison — connu ou inconnu — devient son propre
 * snapshot dans `vehicle_snapshots`, où il est conservé À VIE. Les MESURES ne sont donc
 * jamais touchées ici ; seule la copie brute du JSON de transport disparaît, et la LIGNE de
 * livraison reste (idempotence + surveillance du silence intactes).
 *
 * Pourquoi purger : à ~5 Ko par livraison et une livraison par heure ou plus, le `raw`
 * accumule des dizaines de Mo PAR AN de JSON répété — sur le demi-Go du plan Neon gratuit,
 * c'est LUI qui menace l'objectif « stocker plusieurs années », pas les mesures. Et il
 * contient la position GPS en double : en garder moins est aussi une décision de vie privée.
 *
 * `WEBHOOK_RAW_RETENTION_JOURS=0` désactive la purge (tout garder).
 */
export async function purgerRawWebhooks(
  options: {
    maintenant?: Date;
    retentionJours?: number;
    dbx?: Pick<typeof db, "execute">;
  } = {},
): Promise<number> {
  const {
    maintenant = new Date(),
    retentionJours = retentionRawJours(),
    dbx = db,
  } = options;
  if (retentionJours <= 0) return 0;

  const limite = new Date(maintenant.getTime() - retentionJours * 86_400_000);
  // `RETURNING` pour compter les lignes touchées : la forme du résultat d'un UPDATE nu
  // diffère entre pilotes (neon-http vs PGlite des tests), celle des lignes non.
  const resultat = await dbx.execute(sql`
    UPDATE webhook_deliveries
    SET raw = NULL
    WHERE received_at < ${limite.toISOString()} AND raw IS NOT NULL
    RETURNING event_id
  `);
  const lignes =
    (resultat as { rows?: unknown[] }).rows ??
    (Array.isArray(resultat) ? (resultat as unknown[]) : []);
  return lignes.length;
}

/**
 * Retient l'identifiant du véhicule appris d'une livraison de webhook.
 *
 * ══ POURQUOI APPRENDRE PLUTÔT QUE DEMANDER (incident du 05/08/2026) ══════════════════
 * Au retour du Connect, CarAI appelait Smartcar pour lister les véhicules et en tirer
 * l'identifiant. Cet appel a répondu 404 : le chemin avait été DEVINÉ, la doc Smartcar
 * étant inaccessible depuis les sessions qui ont écrit ce code. Résultat, l'autorisation
 * réussissait mais CarAI restait à moitié branché — aucune commande possible.
 *
 * Or chaque livraison de webhook porte DÉJÀ cet identifiant. Le prendre là où il arrive
 * tout seul ne dépend d'aucun chemin d'API deviné : c'est structurellement plus solide
 * que n'importe quelle correction de l'appel d'origine.
 *
 * ⚠️ On n'écrase JAMAIS une valeur existante. Si un jour deux véhicules émettaient vers
 * le même CarAI, le dernier arrivé ne doit pas déloger silencieusement celui que Marc a
 * connecté — une commande partirait alors vers la mauvaise voiture. Changer de véhicule
 * doit rester un geste explicite.
 */
export async function apprendreVehicleId(vehicleId: string): Promise<void> {
  const propre = vehicleId.trim();
  if (!propre) return;

  try {
    const connu = await lireConfigTexte(CLE_SMARTCAR_VEHICLE);
    if (connu) return;
    await ecrireConfig(CLE_SMARTCAR_VEHICLE, propre);
    console.warn(`[smartcar] identifiant de véhicule appris d'une livraison : ${propre}`);
  } catch (err) {
    // Ne doit jamais faire échouer l'ingestion : les DONNÉES du véhicule comptent plus
    // que la mémorisation de son identifiant, et la prochaine livraison réessaiera.
    console.error("[smartcar] mémorisation de l'identifiant impossible", err);
  }
}

/** Date de la dernière livraison reçue, ou `null`. Sert à détecter un webhook désactivé. */
export async function derniereLivraison(): Promise<Date | null> {
  const lignes = await db
    .select({ receivedAt: webhookDeliveries.receivedAt })
    .from(webhookDeliveries)
    .orderBy(desc(webhookDeliveries.receivedAt))
    .limit(1);
  return lignes[0]?.receivedAt ?? null;
}

/**
 * Empreinte stable d'un enregistrement d'entretien.
 *
 * L'historique d'entretien est re-téléchargé en entier à chaque synchronisation (Doc 2
 * §6.5 : la donnée n'est pas poussée par webhook, on va la chercher). Sans clé stable,
 * chaque passage dupliquerait tout l'historique. On préfère l'identifiant de la source
 * quand il existe ; sinon on dérive de ce qui identifie réellement un entretien.
 */
export function cleEntretien(entree: Record<string, unknown>): string {
  const id = entree.id ?? entree.serviceId ?? entree.externalId;
  if (typeof id === "string" && id.trim()) return id.trim();

  const parts = [
    String(entree.serviceDate ?? entree.date ?? ""),
    String(entree.odometer ?? entree.odometerDistance ?? ""),
    JSON.stringify(entree.tasks ?? entree.serviceTasks ?? []),
  ];
  return empreinte(parts.join("|"));
}

function nombreOuNull(valeur: unknown): number | null {
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : null;
}

function texteOuNull(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur.trim() ? valeur.trim() : null;
}

/**
 * Traduit une entrée d'historique d'entretien. Tous les champs sauf la date sont
 * optionnels : Smartcar documente que leur présence dépend de ce que la marque fournit
 * (Doc 2 §5.4). Un coût absent RESTE absent — un `0` affirmerait un entretien gratuit.
 */
export function entreeVersService(
  entree: Record<string, unknown>,
): NouveauServiceRecord | null {
  const dateBrute = entree.serviceDate ?? entree.date ?? entree.completedDate;
  const date = typeof dateBrute === "string" ? new Date(dateBrute) : null;
  if (!date || Number.isNaN(date.getTime())) return null;

  const cout =
    entree.totalCost && typeof entree.totalCost === "object"
      ? (entree.totalCost as Record<string, unknown>)
      : null;

  return {
    source: "smartcar",
    serviceDate: date,
    odometerAtService: nombreOuNull(
      entree.odometer ??
        (entree.odometerDistance && typeof entree.odometerDistance === "object"
          ? (entree.odometerDistance as Record<string, unknown>).value
          : undefined),
    ),
    odometerUnit: texteOuNull(
      entree.odometerUnit ??
        (entree.odometerDistance && typeof entree.odometerDistance === "object"
          ? (entree.odometerDistance as Record<string, unknown>).unit
          : undefined),
    ),
    tasks: (entree.tasks ?? entree.serviceTasks ?? null) as object | null,
    serviceType: texteOuNull(entree.type ?? entree.serviceType),
    totalCost: nombreOuNull(cout ? cout.amount : entree.cost),
    currency: texteOuNull(cout ? cout.currency : entree.currency),
    raw: entree as object,
    dedupeKey: cleEntretien(entree),
  };
}

/** Enregistre un lot d'entretiens, sans doublon. Renvoie le nombre de NOUVELLES entrées. */
export async function insererEntretiens(
  entrees: Record<string, unknown>[],
): Promise<number> {
  const lignes = entrees
    .map(entreeVersService)
    .filter((l): l is NouveauServiceRecord => l !== null);
  if (lignes.length === 0) return 0;

  const inserees = await db
    .insert(serviceHistory)
    .values(lignes)
    .onConflictDoNothing()
    .returning({ id: serviceHistory.id });
  return inserees.length;
}

/**
 * Dernière valeur connue de chaque métrique, toutes sources confondues.
 *
 * `DISTINCT ON` (spécifique à Postgres) prend la première ligne de chaque groupe selon le
 * tri — ici la plus récente par (métrique, source). C'est une seule requête là où une
 * lecture naïve en ferait une par métrique, ce qui compte sur une table conçue pour croître
 * pendant des années sans purge.
 *
 * Deux sources qui contredisent une même métrique sont renvoyées TOUTES LES DEUX (Doc 4
 * §3.1) : « Smartcar dit 45 %, Toyota dit 47 % » est une information, en choisir une au
 * hasard serait une invention.
 */
export async function dernieresValeurs(): Promise<
  Array<{
    metricType: string;
    source: string;
    recordedAt: Date;
    receivedAt: Date;
    valueNumeric: number | null;
    valueText: string | null;
    valueJson: unknown;
    unit: string | null;
    locationType: string | null;
    signalCode: string | null;
  }>
> {
  const lignes = await db.execute(sql`
    SELECT DISTINCT ON (metric_type, source)
      metric_type   AS "metricType",
      source,
      recorded_at   AS "recordedAt",
      received_at   AS "receivedAt",
      value_numeric AS "valueNumeric",
      value_text    AS "valueText",
      value_json    AS "valueJson",
      unit,
      location_type AS "locationType",
      signal_code   AS "signalCode"
    FROM vehicle_snapshots
    ORDER BY metric_type, source, recorded_at DESC
  `);

  return (lignes.rows ?? lignes) as Awaited<ReturnType<typeof dernieresValeurs>>;
}

/** Dernière valeur numérique d'une métrique donnée (odomètre, état de charge…). */
export async function derniereValeurNumerique(
  metricType: string,
): Promise<{ valeur: number; recordedAt: Date; source: string } | null> {
  const lignes = await db
    .select({
      valeur: vehicleSnapshots.valueNumeric,
      recordedAt: vehicleSnapshots.recordedAt,
      source: vehicleSnapshots.source,
    })
    .from(vehicleSnapshots)
    .where(
      and(
        eq(vehicleSnapshots.metricType, metricType),
        sql`${vehicleSnapshots.valueNumeric} IS NOT NULL`,
      ),
    )
    .orderBy(desc(vehicleSnapshots.recordedAt))
    .limit(1);

  const ligne = lignes[0];
  if (!ligne || ligne.valeur === null) return null;
  return { valeur: ligne.valeur, recordedAt: ligne.recordedAt, source: ligne.source };
}
