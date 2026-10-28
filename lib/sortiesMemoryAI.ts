import { and, desc, eq, gte, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { vehicleSnapshots, type Source } from "@/lib/db/schema";
import { historiquePositions } from "@/lib/vehicle/position";
import { filtrerOdometreMonotone } from "@/lib/vehicle/history";
import { decouperTrajets, libelleDuree } from "@/lib/vehicle/trajets";
import { chargesDepuisSoc } from "@/lib/vehicle/charges";
import { interpreterPourcentage } from "@/lib/smartcar/signals";

export interface EvenementSortie {
  type: "trajet" | "recharge" | "etat_vehicule";
  date: string;
  titre: string;
  resume?: string;
  ref: string;
  niveau: 2;
}

interface MesureDeclencheuse {
  id: number;
  source: string;
  metricType: string;
  recordedAt: Date;
  valueNumeric: number | null;
  valueText: string | null;
  valueJson: unknown;
  unit: string | null;
}

const DELAI_MS = 1_500;
const FENETRE_JOURS = 400;
const FENETRE_RECONSTITUTION_JOURS = 3;
const LIMITE_RECONSTITUTION = 5_000;
const METRIQUES_ETAT = new Set([
  "battery_soc",
  "charging_status",
  "charge_plugged_in",
  "lock_status",
  "door_status",
  "window_status",
  "trunk_status",
  "charge_port_status",
  "vehicle_asleep",
]);

function nomSource(source: string): string {
  if (source === "toyota_na") return "Toyota NA";
  if (source === "smartcar") return "Smartcar";
  return "source inconnue";
}

function refMesure(id: number, type: EvenementSortie["type"]): string {
  return `carai-snapshot-${id}-${type}`;
}

function dateDansContrat(date: Date, maintenant: Date): boolean {
  return (
    Number.isFinite(date.getTime()) &&
    date.getTime() >= maintenant.getTime() - FENETRE_JOURS * 86_400_000 &&
    date.getTime() <= maintenant.getTime() + 86_400_000
  );
}

async function lireOdometres(depuis: Date): Promise<Array<{ km: number; mesureLe: Date }>> {
  const lignes = await db
    .select({
      km: vehicleSnapshots.valueNumeric,
      mesureLe: vehicleSnapshots.recordedAt,
    })
    .from(vehicleSnapshots)
    .where(
      and(
        eq(vehicleSnapshots.metricType, "odometer"),
        isNotNull(vehicleSnapshots.valueNumeric),
        gte(vehicleSnapshots.recordedAt, depuis),
      ),
    )
    .orderBy(desc(vehicleSnapshots.recordedAt))
    .limit(LIMITE_RECONSTITUTION);
  lignes.reverse();
  return filtrerOdometreMonotone(
    lignes.map((l) => ({
      km: l.km!,
      mesureLe: l.mesureLe instanceof Date ? l.mesureLe : new Date(l.mesureLe),
    })),
  );
}

export function creerEvenementTrajet(
  trajet: {
    debut: Date;
    fin: Date;
    dureeMinutes: number;
    dureeEstFenetre: boolean;
    distanceKm: number;
    distanceEstimee: boolean;
  },
  mesure: Pick<MesureDeclencheuse, "id" | "source" | "recordedAt">,
): EvenementSortie | null {
  if (
    !Number.isFinite(trajet.distanceKm) ||
    trajet.distanceKm <= 0 ||
    !Number.isFinite(trajet.dureeMinutes) ||
    trajet.dureeMinutes < 0
  ) {
    return null;
  }
  const date = mesure.recordedAt;
  const distance = Math.round(trajet.distanceKm * 10) / 10;
  return {
    type: "trajet",
    date: date.toISOString(),
    titre: `Trajet terminé · ${distance} km`,
    resume: `${libelleDuree(trajet.dureeMinutes)}${trajet.dureeEstFenetre ? " (fenêtre estimée)" : ""} · ${
      trajet.distanceEstimee ? "distance estimée" : "odomètre"
    } · ${nomSource(mesure.source)}.`,
    ref: refMesure(mesure.id, "trajet"),
    niveau: 2,
  };
}

export function creerEvenementRecharge(
  session: { debut: Date; fin: Date; socDebut: number; socFin: number },
  mesure: Pick<MesureDeclencheuse, "id" | "source" | "recordedAt">,
): EvenementSortie | null {
  const dureeMinutes = (session.fin.getTime() - session.debut.getTime()) / 60_000;
  if (
    !Number.isFinite(dureeMinutes) ||
    dureeMinutes < 0 ||
    !Number.isFinite(session.socDebut) ||
    !Number.isFinite(session.socFin)
  ) {
    return null;
  }
  return {
    type: "recharge",
    date: mesure.recordedAt.toISOString(),
    titre: `Recharge terminée · ${Math.round(session.socDebut)} à ${Math.round(session.socFin)} %`,
    resume: `${Math.round(dureeMinutes)} min · ${nomSource(mesure.source)}.`,
    ref: refMesure(mesure.id, "recharge"),
    niveau: 2,
  };
}

export function creerEvenementEtat(
  mesure: Pick<MesureDeclencheuse, "id" | "source" | "metricType" | "recordedAt">,
): EvenementSortie {
  const details =
    mesure.metricType === "battery_soc" ? "Charge de la batterie modifiée." : "État modifié.";
  return {
    type: "etat_vehicule",
    date: mesure.recordedAt.toISOString(),
    titre: "État du véhicule modifié",
    resume: `${details} ${nomSource(mesure.source)}.`,
    ref: refMesure(mesure.id, "etat_vehicule"),
    niveau: 2,
  };
}

function valeurEtat(mesure: {
  valueNumeric: number | null;
  valueText: string | null;
  valueJson: unknown;
}): string | number | null {
  if (mesure.valueNumeric !== null) return mesure.valueNumeric;
  if (mesure.valueText !== null) return mesure.valueText;
  if (mesure.valueJson === null || typeof mesure.valueJson !== "object") return null;
  return JSON.stringify(mesure.valueJson);
}

function changementNotable(
  mesure: MesureDeclencheuse,
  precedente: { valueNumeric: number | null; valueText: string | null; valueJson: unknown } | null,
): boolean {
  if (!precedente) return false;
  if (mesure.metricType === "battery_soc") {
    if (mesure.valueNumeric === null || precedente.valueNumeric === null) return false;
    const courant = interpreterPourcentage(mesure.valueNumeric, mesure.unit);
    const avant = interpreterPourcentage(precedente.valueNumeric, mesure.unit);
    return (
      courant.fiable &&
      avant.fiable &&
      Math.abs(courant.pourcent! - avant.pourcent!) >= 5
    );
  }
  return valeurEtat(mesure) !== valeurEtat(precedente);
}

async function evenementsEtat(mesures: MesureDeclencheuse[]): Promise<EvenementSortie[]> {
  const evenements: EvenementSortie[] = [];
  for (const mesure of mesures) {
    if (!METRIQUES_ETAT.has(mesure.metricType)) continue;
    const precedentes = await db
      .select({
        valueNumeric: vehicleSnapshots.valueNumeric,
        valueText: vehicleSnapshots.valueText,
        valueJson: vehicleSnapshots.valueJson,
      })
      .from(vehicleSnapshots)
      .where(
        and(
          eq(vehicleSnapshots.source, mesure.source as Source),
          eq(vehicleSnapshots.metricType, mesure.metricType),
          lt(vehicleSnapshots.recordedAt, mesure.recordedAt),
        ),
      )
      .orderBy(desc(vehicleSnapshots.recordedAt))
      .limit(1);
    if (changementNotable(mesure, precedentes[0] ?? null)) {
      evenements.push(creerEvenementEtat(mesure));
    }
  }
  return evenements;
}

async function evenementsTrajets(mesures: MesureDeclencheuse[]): Promise<EvenementSortie[]> {
  const declencheurs = mesures.filter((m) => m.metricType === "location");
  if (declencheurs.length === 0) return [];
  const depuis = new Date(Date.now() - FENETRE_RECONSTITUTION_JOURS * 86_400_000);
  const [positions, historique] = await Promise.all([
    historiquePositions({ depuis, limite: LIMITE_RECONSTITUTION }),
    lireOdometres(depuis),
  ]);
  const trajets = decouperTrajets(positions, { historiqueOdometre: historique });
  return declencheurs.flatMap((mesure) => {
    const trajet = trajets.find((t) => t.points.at(-1)?.t.getTime() === mesure.recordedAt.getTime());
    const evenement = trajet ? creerEvenementTrajet(trajet, mesure) : null;
    return evenement ? [evenement] : [];
  });
}

async function evenementsRecharges(mesures: MesureDeclencheuse[]): Promise<EvenementSortie[]> {
  const declencheurs = mesures.filter((m) => m.metricType === "battery_soc");
  if (declencheurs.length === 0) return [];
  const depuis = new Date(Date.now() - FENETRE_RECONSTITUTION_JOURS * 86_400_000);
  const [lignes, odometres] = await Promise.all([
    db
      .select({
        id: vehicleSnapshots.id,
        source: vehicleSnapshots.source,
        recordedAt: vehicleSnapshots.recordedAt,
        valueNumeric: vehicleSnapshots.valueNumeric,
        unit: vehicleSnapshots.unit,
      })
      .from(vehicleSnapshots)
      .where(
        and(
          eq(vehicleSnapshots.metricType, "battery_soc"),
          gte(vehicleSnapshots.recordedAt, depuis),
        ),
      )
      .orderBy(desc(vehicleSnapshots.recordedAt))
      .limit(LIMITE_RECONSTITUTION),
    lireOdometres(depuis),
  ]);
  lignes.reverse();
  const evenements: EvenementSortie[] = [];
  for (const source of [...new Set(declencheurs.map((m) => m.source))]) {
    const socs = lignes
      .filter((l) => l.source === source && l.valueNumeric !== null)
      .map((l) => ({
        t: l.recordedAt instanceof Date ? l.recordedAt : new Date(l.recordedAt),
        pourcent: interpreterPourcentage(l.valueNumeric, l.unit).pourcent,
        id: l.id,
      }))
      .filter((p): p is typeof p & { pourcent: number } => p.pourcent !== null);
    const sessions = chargesDepuisSoc({
      socs: socs.map(({ t, pourcent }) => ({ t, pourcent })),
      historiqueOdometre: odometres,
    });
    for (const session of sessions) {
      const terminee =
        session.fin.getTime() === socs.find((p) => p.t.getTime() === session.fin.getTime())?.t.getTime() &&
        declencheurs.some(
          (m) => m.source === source && m.recordedAt.getTime() > session.fin.getTime(),
        );
      if (!terminee) continue;
      const finMesure = socs.find((p) => p.t.getTime() === session.fin.getTime());
      if (!finMesure) continue;
      const evenement = creerEvenementRecharge(session, {
        id: finMesure.id,
        source,
        recordedAt: session.fin,
      });
      if (evenement) evenements.push(evenement);
    }
  }
  return evenements;
}

export async function posterLotSorties(
  evenements: EvenementSortie[],
  url: URL,
  options: {
    fetchImpl?: typeof fetch;
    journal?: (message: string) => void;
    delaiMs?: number;
  } = {},
): Promise<void> {
  try {
    const reponse = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "sorties", evenements }),
      cache: "no-store",
      signal: AbortSignal.timeout(options.delaiMs ?? DELAI_MS),
    });
    if (!reponse.ok) {
      const nom = evenements.length === 1 ? "événement" : "événements";
      options.journal?.(`[memoryai-sorties] échec HTTP ${reponse.status} (${evenements.length} ${nom})`);
    }
  } catch {
    const nom = evenements.length === 1 ? "événement" : "événements";
    options.journal?.(`[memoryai-sorties] échec réseau (${evenements.length} ${nom})`);
  }
}

export async function transmettreSorties(
  evenements: EvenementSortie[],
  options: {
    token?: string;
    url?: string;
    fetchImpl?: typeof fetch;
    maintenant?: Date;
    journal?: (message: string) => void;
  } = {},
): Promise<void> {
  const token = options.token ?? process.env.MEMORYAI_SORTIES_TOKEN;
  if (!token?.trim() || evenements.length === 0) return;
  const configuree = options.url ?? process.env.MEMORYAI_URL ?? "https://memoryai.hubperso.com";
  let url: URL;
  try {
    url = new URL(`${configuree.replace(/\/+$/, "")}/api/sorties`);
  } catch {
    options.journal?.("[memoryai-sorties] URL invalide (1 lot)");
    return;
  }
  if (url.protocol !== "https:") {
    options.journal?.("[memoryai-sorties] URL refusée (1 lot)");
    return;
  }
  const maintenant = options.maintenant ?? new Date();
  const valides = evenements.filter((e) => {
    const date = new Date(e.date);
    return (
      /^[a-z0-9_]{1,40}$/.test(e.type) &&
      e.titre.length > 0 &&
      e.titre.length <= 120 &&
      !/[\r\n]/.test(e.titre) &&
      (e.resume === undefined || e.resume.length <= 600) &&
      /^[\x21-\x7e]{1,80}$/.test(e.ref) &&
      dateDansContrat(date, maintenant)
    );
  });
  const fetchImpl = options.fetchImpl ?? fetch;
  for (let debut = 0; debut < valides.length; debut += 50) {
    const lot = valides.slice(debut, debut + 50);
    const fetchAuthentifie: typeof fetch = (input, init) =>
      fetchImpl(input, {
        ...init,
        headers: {
          ...init?.headers,
          Authorization: "Bearer " + token,
        },
      });
    await posterLotSorties(lot, url, {
      fetchImpl: fetchAuthentifie,
      journal: options.journal,
    });
  }
}

export async function publierSorties(mesures: MesureDeclencheuse[]): Promise<void> {
  try {
    if (!process.env.MEMORYAI_SORTIES_TOKEN?.trim()) return;
    const maintenant = new Date();
    const recentes = mesures.filter((m) => dateDansContrat(m.recordedAt, maintenant));
    if (recentes.length === 0) return;
    const evenements = await Promise.all([
      evenementsEtat(recentes),
      evenementsTrajets(recentes),
      evenementsRecharges(recentes),
    ]);
    await transmettreSorties(
      evenements.flat(),
      { journal: (message) => console.warn(message) },
    );
  } catch {
    console.warn("[memoryai-sorties] échec de préparation des événements");
  }
}
