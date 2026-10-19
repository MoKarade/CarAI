// lib/vehicle/position.ts — les positions du véhicule : lecture, projection, trajet.
//
// ══ POURQUOI CE MODULE EXISTE, ET CE QUI A CHANGÉ ════════════════════════════════════
//
// Les coordonnées étaient enregistrées mais JAMAIS affichées : le tableau écrivait
// « position (voir export CSV) » et la découverte de métriques les écartait. C'était un
// choix de prudence — ne pas étaler une position sur un écran resté ouvert.
//
// Marc a tranché le 12/08/2026 : c'est SA voiture, dans SON app privée, derrière SON
// login mono-adresse. Refuser de lui montrer sa propre position ne le protégeait de
// personne — ça lui cachait une donnée qu'il paye et qu'il possède.
//
// Ce qui reste vrai malgré tout, et ne bouge pas :
//   • Les coordonnées ne sortent JAMAIS vers le hub ni vers un tiers. Le contrat
//     `hub-contract` ne porte aucune position et n'en portera pas.
//   • Le tracé est rendu CÔTÉ SERVEUR, en SVG pur, sans fond de carte : aucune requête
//     vers un service de cartographie, donc aucune position transmise à qui que ce soit.
//     Un lien vers Google Maps existe, mais c'est un CLIC de Marc, jamais un appel
//     automatique de la page.
//   • Rien n'est deviné : une ligne dont on ne sait pas lire les coordonnées est écartée,
//     jamais posée à (0, 0) — le golfe de Guinée est la fausse position classique.

import { and, desc, eq, gte, isNotNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { vehicleSnapshots } from "@/lib/db/schema";

type Dbx = Pick<typeof db, "select">;

export interface PointPosition {
  t: Date;
  lat: number;
  lng: number;
  /** `LAST_PARKED`, `REAL_TIME`… tel que la source le déclare. `null` si non précisé. */
  type: string | null;
}

/**
 * Extrait des coordonnées d'un corps JSON. PURE, testée.
 *
 * Deux graphies vues dans le catalogue réel : `latitude`/`longitude` et `lat`/`lng`. La
 * lecture est insensible à la casse parce que la source n'est pas sous notre contrôle.
 *
 * Rend `null` — jamais un couple partiel, jamais (0, 0) — dès qu'une des deux manque ou
 * sort des bornes terrestres. Une position à demi lue n'est pas une position.
 */
export function coordonneesDuJson(valueJson: unknown): { lat: number; lng: number } | null {
  if (!valueJson || typeof valueJson !== "object") return null;

  const brut = valueJson as Record<string, unknown>;
  // Certaines livraisons imbriquent le couple sous `value`.
  const source =
    "latitude" in brut || "lat" in brut
      ? brut
      : ((brut.value ?? brut.values) as Record<string, unknown> | undefined) ?? brut;

  const parCle = new Map(
    Object.entries(source).map(([cle, valeur]) => [cle.toLowerCase(), valeur]),
  );

  const lire = (...cles: string[]): number | null => {
    for (const cle of cles) {
      const brute = parCle.get(cle);
      const n = typeof brute === "string" ? Number(brute) : brute;
      if (typeof n === "number" && Number.isFinite(n)) return n;
    }
    return null;
  };

  const lat = lire("latitude", "lat");
  const lng = lire("longitude", "lng", "lon", "long");
  if (lat === null || lng === null) return null;
  // Hors bornes terrestres = donnée corrompue, pas une position sur laquelle bâtir.
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

  return { lat, lng };
}

/**
 * Positions enregistrées, de la plus ancienne à la plus récente.
 *
 * Comme les autres séries, la fenêtre est ancrée du côté RÉCENT : une borne en ordre
 * croissant figerait le trajet sur le passé le jour où l'historique dépasse la limite.
 */
export async function historiquePositions(
  options: { depuis?: Date | null; limite?: number; dbx?: Dbx } = {},
): Promise<PointPosition[]> {
  const { depuis = null, limite = 3_000, dbx = db } = options;

  // On accepte les deux portes d'entrée : la métrique `location` normalisée, et toute
  // ligne qui porte un `location_type` (une source future pourrait publier sous un autre
  // code — c'est exactement ce que le garde d'affichage surveillait).
  const clauses = [
    or(eq(vehicleSnapshots.metricType, "location"), isNotNull(vehicleSnapshots.locationType)),
    isNotNull(vehicleSnapshots.valueJson),
  ];
  if (depuis) clauses.push(gte(vehicleSnapshots.recordedAt, depuis));

  const lignes = await dbx
    .select({
      recordedAt: vehicleSnapshots.recordedAt,
      valueJson: vehicleSnapshots.valueJson,
      locationType: vehicleSnapshots.locationType,
    })
    .from(vehicleSnapshots)
    .where(and(...clauses))
    .orderBy(desc(vehicleSnapshots.recordedAt), desc(vehicleSnapshots.id))
    .limit(limite);
  lignes.reverse();

  const points: PointPosition[] = [];
  for (const ligne of lignes) {
    const coord = coordonneesDuJson(ligne.valueJson);
    if (!coord) continue;
    points.push({
      t: ligne.recordedAt instanceof Date ? ligne.recordedAt : new Date(ligne.recordedAt),
      lat: coord.lat,
      lng: coord.lng,
      type: ligne.locationType ?? null,
    });
  }
  return points;
}

export interface TraceTrajet {
  /** Polyligne du trajet dans la viewBox. */
  chemin: string;
  /** Position la plus récente, projetée — pour la marquer distinctement. */
  derniere: { x: number; y: number };
  largeur: number;
  hauteur: number;
  /** Bornes réelles, pour dire au lecteur quelle étendue il regarde. */
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
  /** Étendue approximative de la zone couverte, en km (diagonale). */
  etendueKm: number;
  nbPoints: number;
}

const RAYON_TERRE_KM = 6371;

/** Distance approximative entre deux points, en km (formule de haversine). PURE. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAYON_TERRE_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Projette une suite de positions dans une viewBox. PURE, testée.
 *
 * ⚠️ L'ÉCHELLE DES DEUX AXES N'EST PAS LA MÊME EN DEGRÉS. À la latitude de Québec (46,8°),
 * un degré de longitude vaut ~76 km contre ~111 km pour un degré de latitude : projeter
 * les degrés tels quels étirerait le trajet d'un tiers en largeur, et un aller-retour
 * nord-sud ressemblerait à un détour. On corrige donc la longitude par `cos(latitude)` —
 * c'est ce qui rend le dessin fidèle à la forme du trajet.
 *
 * Le tracé garde son RATIO : plutôt que de remplir la viewBox (ce qui déformerait), on
 * centre le trajet dans le cadre. Une carte étirée est une carte fausse.
 */
export function traceTrajet(
  points: PointPosition[],
  options: { largeur?: number; hauteur?: number; marge?: number } = {},
): TraceTrajet | null {
  const { largeur = 600, hauteur = 320, marge = 12 } = options;
  if (points.length === 0) return null;

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const latMin = Math.min(...lats);
  const latMax = Math.max(...lats);
  const lngMin = Math.min(...lngs);
  const lngMax = Math.max(...lngs);

  const latMoyenne = (latMin + latMax) / 2;
  const compression = Math.cos((latMoyenne * Math.PI) / 180);

  // Étendue en unités COMPARABLES (degrés de latitude équivalents).
  const etendueX = Math.max((lngMax - lngMin) * compression, 1e-9);
  const etendueY = Math.max(latMax - latMin, 1e-9);

  const utileX = largeur - 2 * marge;
  const utileY = hauteur - 2 * marge;
  // Une seule échelle pour les deux axes : c'est elle qui préserve la forme.
  const echelle = Math.min(utileX / etendueX, utileY / etendueY);

  // Centrage du trajet dans le cadre.
  const decalageX = (largeur - etendueX * echelle) / 2;
  const decalageY = (hauteur - etendueY * echelle) / 2;

  const projeter = (p: PointPosition) => ({
    x: decalageX + (p.lng - lngMin) * compression * echelle,
    // Y inversé : en SVG l'origine est en haut, alors que le nord est en haut d'une carte.
    y: decalageY + (latMax - p.lat) * echelle,
  });

  const arrondir = (n: number) => Math.round(n * 10) / 10;
  const chemin = points
    .map((p) => {
      const { x, y } = projeter(p);
      return `${arrondir(x)},${arrondir(y)}`;
    })
    .join(" ");

  const dernier = projeter(points[points.length - 1]!);

  return {
    chemin,
    derniere: { x: arrondir(dernier.x), y: arrondir(dernier.y) },
    largeur,
    hauteur,
    latMin,
    latMax,
    lngMin,
    lngMax,
    etendueKm: distanceKm({ lat: latMin, lng: lngMin }, { lat: latMax, lng: lngMax }),
    nbPoints: points.length,
  };
}

/**
 * Lien vers une carte externe pour une position.
 *
 * C'est un `href`, donc un CLIC de Marc — jamais une requête que la page émettrait toute
 * seule. La distinction n'est pas cosmétique : une page qui charge un fond de carte
 * transmet la position au fournisseur à chaque affichage, y compris quand personne ne
 * regarde. Ici, rien ne part tant qu'il ne l'a pas décidé.
 */
export function lienCarte(p: { lat: number; lng: number }): string {
  return `https://www.google.com/maps?q=${p.lat},${p.lng}`;
}

/** Coordonnée formatée pour l'affichage : assez de décimales pour situer, pas plus. */
export function formaterCoordonnee(n: number): string {
  return n.toFixed(5);
}
