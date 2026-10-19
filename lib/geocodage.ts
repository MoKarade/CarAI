// lib/geocodage.ts — adresses lisibles pour les trajets (géocodage inverse Google).
//
// Choix de Marc (cadrage 17/08, salve A) : « Maison → Boulevard Exemple O » plutôt que des
// coordonnées. Il a créé la 2ᵉ clé en connaissance de cause — la clé EMBED est verrouillée
// au référent du navigateur et ne marche PAS depuis le serveur ; celle-ci
// (`GOOGLE_GEOCODING_KEY`) est server-side, restreinte à la Geocoding API dans la console.
//
// ══ LES TROIS GARDES ═════════════════════════════════════════════════════════════════
// 1. LIEU D'ABORD : un point qui tombe dans un lieu nommé par Marc (« Maison », « Boulot »)
//    prend ce nom — on ne géocode jamais ce qu'il a déjà nommé, et son domicile ne part
//    pas vers Google en requête de géocodage.
// 2. CACHE À VIE : la clé arrondit à 4 décimales (~11 m) ; une intersection ne se géocode
//    qu'une fois. Le quota gratuit (10 000/mois) ne fond pas sur des ré-affichages.
// 3. BORNÉ PAR PAGE : l'appelant ne demande que les extrémités des trajets AFFICHÉS,
//    plafonnées (`MAX_LOOKUPS_PAGE`). Un historique long ne déclenche jamais une rafale.
//
// ⚠️ Une PANNE de Google n'est JAMAIS mise en cache : l'échec rend `null` (l'écran affiche
// les coordonnées) et le prochain affichage réessaie. Seuls les succès s'écrivent.

import { db } from "@/lib/db";
import { geocodeCache } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import type { Lieu } from "@/lib/config";
import { lieuDeLaPosition } from "@/lib/vehicle/tarifsBornes";

/** Lookups Google au maximum par AFFICHAGE de page — le cache absorbe le reste. */
export const MAX_LOOKUPS_PAGE = 20;

/** `null` si la clé n'est pas configurée — l'écran garde les coordonnées, rien ne casse. */
export function cleGeocodage(env: Record<string, string | undefined> = process.env): string | null {
  const cle = env.GOOGLE_GEOCODING_KEY?.trim();
  return cle || null;
}

/** Clé de cache : lat,lng arrondis à 4 décimales (~11 m). PURE, testée. */
export function cleGeo(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

/**
 * Extrait un libellé COURT d'une réponse Geocoding. PURE, testée.
 *
 * On prend la voie et la municipalité (« Boulevard Exemple O, Ville-Exemple ») — jamais le
 * numéro civique : l'adresse exacte d'un stationnement public n'apporte rien, et celle
 * d'un tiers n'a pas à vivre dans la base.
 */
export function libelleCourt(reponse: unknown): string | null {
  if (!reponse || typeof reponse !== "object") return null;
  const resultats = (reponse as { results?: unknown }).results;
  if (!Array.isArray(resultats)) return null;

  for (const r of resultats) {
    if (!r || typeof r !== "object") continue;
    const composants = (r as { address_components?: unknown }).address_components;
    if (!Array.isArray(composants)) continue;

    let voie: string | null = null;
    let ville: string | null = null;
    for (const c of composants) {
      if (!c || typeof c !== "object") continue;
      const types: unknown = (c as { types?: unknown }).types;
      const nom: unknown = (c as { short_name?: unknown }).short_name;
      if (!Array.isArray(types) || typeof nom !== "string" || !nom.trim()) continue;
      if (types.includes("route") && !voie) voie = nom;
      if (types.includes("locality") && !ville) ville = nom;
    }
    if (voie) return ville ? `${voie}, ${ville}` : voie;
  }
  return null;
}

export interface PointANommer {
  lat: number;
  lng: number;
}

/**
 * Nomme une liste de points : lieu de Marc d'abord, cache ensuite, Google en dernier.
 *
 * Rend une Map clé (`cleGeo`) → libellé. Les points sans réponse n'y figurent pas —
 * l'appelant affiche alors les coordonnées, jamais un libellé inventé.
 */
export async function nommerPoints(params: {
  points: PointANommer[];
  lieux: Lieu[];
  cle: string | null;
  fetchImpl?: typeof fetch;
}): Promise<Map<string, string>> {
  const { points, lieux, cle, fetchImpl = fetch } = params;
  const sortie = new Map<string, string>();
  if (points.length === 0) return sortie;

  // ── 1. Les lieux nommés par Marc — sans réseau, et sans envoyer son domicile à Google.
  const restants: PointANommer[] = [];
  for (const p of points) {
    const k = cleGeo(p.lat, p.lng);
    if (sortie.has(k)) continue;
    const lieu = lieuDeLaPosition({ lat: p.lat, lng: p.lng }, lieux);
    if (lieu) sortie.set(k, lieu.nom);
    else restants.push(p);
  }

  // ── 2. Le cache en base.
  const clesRestantes = [...new Set(restants.map((p) => cleGeo(p.lat, p.lng)))];
  if (clesRestantes.length > 0) {
    const lignes = await db
      .select({ cle: geocodeCache.cle, libelle: geocodeCache.libelle })
      .from(geocodeCache)
      .where(inArray(geocodeCache.cle, clesRestantes));
    for (const l of lignes) sortie.set(l.cle, l.libelle);
  }

  // ── 3. Google, pour les manquants — borné, succès seuls en cache.
  if (!cle) return sortie;
  const aDemander = restants
    .filter((p) => !sortie.has(cleGeo(p.lat, p.lng)))
    .slice(0, MAX_LOOKUPS_PAGE);

  for (const p of aDemander) {
    const k = cleGeo(p.lat, p.lng);
    if (sortie.has(k)) continue;
    try {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?latlng=${p.lat.toFixed(6)},${p.lng.toFixed(6)}` +
        `&key=${encodeURIComponent(cle)}&language=fr&result_type=street_address|route`;
      const reponse = await fetchImpl(url);
      if (!reponse.ok) continue;
      const libelle = libelleCourt(await reponse.json());
      if (!libelle) continue;
      sortie.set(k, libelle);
      await db
        .insert(geocodeCache)
        .values({ cle: k, libelle })
        .onConflictDoNothing({ target: geocodeCache.cle });
    } catch (err) {
      // Une panne réseau laisse le point sans nom — coordonnées à l'écran, retenté au
      // prochain affichage. Dit dans les logs, jamais avalé en silence total.
      console.error("[geocodage] échec", k, err);
    }
  }

  return sortie;
}

// ══ GÉOCODAGE DIRECT : d'une adresse vers un point ═══════════════════════════════════
//
// Marc, 21/08 : « je veux pouvoir […] choisir une adresse ». Jusqu'ici ce module ne savait
// que l'inverse (point → nom de rue), pour les trajets. Poser un lieu de recharge demande
// l'aller : on tape « 1 rue Exemple », on obtient le point.
//
// ⚠️ PAS DE CACHE ICI, et c'est voulu. Le cache inverse marche parce que sa clé est une
// coordonnée arrondie : deux affichages du même trajet posent la même question. Une adresse
// tapée à la main ne se répète pas — « 1 rue Exemple », « 1 r. Exemple », « 1
// rue exemple ville » sont trois clés pour un seul lieu. Un cache y serait du poids sans gain,
// et le geste est RARE (on enregistre un lieu, on ne le refait pas).

/** Ce que le géocodage direct peut répondre — chaque échec dit LEQUEL, jamais `null` nu. */
export type ResultatAdresse =
  | { ok: true; lat: number; lng: number; libelle: string }
  | { ok: false; raison: "sans-cle" | "introuvable" | "panne" };

/** Le premier résultat exploitable d'une réponse Geocoding. PURE, testée. */
export function premierPoint(
  reponse: unknown,
): { lat: number; lng: number; libelle: string } | null {
  if (!reponse || typeof reponse !== "object") return null;
  const resultats = (reponse as { results?: unknown }).results;
  if (!Array.isArray(resultats) || resultats.length === 0) return null;

  for (const r of resultats) {
    if (!r || typeof r !== "object") continue;
    const geo = (r as { geometry?: { location?: { lat?: unknown; lng?: unknown } } }).geometry;
    const lat = geo?.location?.lat;
    const lng = geo?.location?.lng;
    // ⚠️ On vérifie le TYPE avant de convertir : `Number(null)` vaut 0, et 0,0 est un point
    // parfaitement valide au large de l'Afrique — c'est exactement le genre de coordonnée
    // fantôme que ce dépôt a déjà dû purger de sa base.
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const libelle = (r as { formatted_address?: unknown }).formatted_address;
    return { lat, lng, libelle: typeof libelle === "string" ? libelle : "" };
  }
  return null;
}

/**
 * Cherche le point d'une adresse. `region=ca` et la langue française orientent les
 * ambiguïtés vers le Québec sans les y enfermer — une adresse hors Canada reste trouvable.
 */
export async function pointDeLAdresse(
  adresse: string,
  options: { cle?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<ResultatAdresse> {
  const cle = options.cle === undefined ? cleGeocodage() : options.cle;
  if (!cle) return { ok: false, raison: "sans-cle" };

  const question = adresse.trim();
  if (question.length === 0) return { ok: false, raison: "introuvable" };

  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(question)}` +
      `&key=${encodeURIComponent(cle)}&language=fr&region=ca`;
    const reponse = await fetchImpl(url);
    if (!reponse.ok) return { ok: false, raison: "panne" };
    const point = premierPoint(await reponse.json());
    return point ? { ok: true, ...point } : { ok: false, raison: "introuvable" };
  } catch (err) {
    // ⚠️ Une panne réseau n'est pas une adresse introuvable : les deux appellent des gestes
    // OPPOSÉS (réessayer / corriger sa saisie). Les confondre enverrait Marc récrire une
    // adresse parfaitement bonne.
    console.error("[geocodage] adresse", err);
    return { ok: false, raison: "panne" };
  }
}
