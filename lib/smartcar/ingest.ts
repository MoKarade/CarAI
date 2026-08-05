// lib/smartcar/ingest.ts — écriture en base des données Smartcar.
//
// Sépare volontairement la TRADUCTION (pure, dans `signals.ts`) de l'ÉCRITURE (ici). C'est
// ce qui permet de tester tout le mapping sans base ni réseau, et de tester l'écriture sur
// PGlite sans mock.

import { and, desc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
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
  recuLe?: Date;
}): Promise<{ ecrits: number; dejaTraite: boolean }> {
  const { eventId, eventType, signaux, raw, recuLe = new Date() } = params;

  if (eventId) {
    const deja = await db
      .select({ eventId: webhookDeliveries.eventId })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.eventId, eventId))
      .limit(1);
    if (deja.length > 0) return { ecrits: 0, dejaTraite: true };
  }

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

  return { ecrits, dejaTraite: false };
}

function empreinte(texte: string): string {
  return createHash("sha256").update(texte).digest("hex").slice(0, 40);
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
