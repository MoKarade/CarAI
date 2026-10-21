// lib/vehicle/nommerLieu.ts — nommer après coup le lieu d'une recharge inconnue (CarAI#8).
//
// Marc, 19/10/2026 : pour nommer une borne qu'Activité affiche « lieu inconnu », il fallait
// aller dans Réglages et recréer le lieu à la main. Désormais le geste part de la ligne de la
// recharge, avec la POSITION de cette recharge ; ce module décide si le lieu peut s'ajouter.
//
// PURE : elle reçoit les lieux existants et rend la liste à écrire, ou la raison du refus.
// L'écriture en base (et la session) vivent dans `app/activite/actions.ts`.
//
// ══ CE QUE ÇA REFUSE ET CE QUE ÇA LAISSE PASSER ══════════════════════════════════════
//
// • Un nom déjà pris : « Retirer » désigne un lieu par son NOM, deux lieux de même nom ne
//   se retireraient plus séparément.
// • Un tarif sans mode, ou l'inverse : un lieu à moitié tarifé apparierait des recharges au
//   mauvais prix (le schéma le refuse aussi).
// • PAS un lieu voisin : une borne publique en face du travail est un cas légitime, et
//   `lieuDeLaPosition` départage déjà par la distance. On le DIT dans la réponse, on ne
//   bloque pas.
//
// ⚠️ Sans tarif, le lieu NOMME ses recharges mais ne les chiffre pas : leur coût reste une
// estimation (`prixSession`). Avec un tarif, il passe de « estimation » à « mesure » — sauf
// une borne horaire dont la durée n'est qu'une fenêtre entre deux relevés, qui reste un
// plafond et le dit, comme pour tous les lieux horaires.

import { SchemaLieux, type Lieu } from "@/lib/config";
import { distanceM } from "@/lib/vehicle/tarifsBornes";

/** Rayon d'appariement d'un lieu nommé d'un geste : celui de Réglages par défaut. */
export const RAYON_NOMME_M = 120;

export interface CandidatLieuNomme {
  nom: string;
  lat: number;
  lng: number;
  /** Absent ou vide : pas de tarif, le lieu ne fait que nommer. */
  mode?: string | null;
  tarif?: number | null;
}

export type ResultatNommage =
  | { ok: true; lieux: Lieu[]; message: string }
  | { ok: false; erreur: string };

/** Ajoute le lieu nommé à la liste des lieux, ou dit pourquoi pas. PURE, testée. */
export function ajouterLieuNomme(
  existants: readonly Lieu[],
  candidat: CandidatLieuNomme,
): ResultatNommage {
  const nom = candidat.nom.trim();
  if (nom === "") return { ok: false, erreur: "Donne un nom à ce lieu." };

  if (!Number.isFinite(candidat.lat) || !Number.isFinite(candidat.lng)) {
    return { ok: false, erreur: "La position de cette recharge n’est pas connue : le lieu ne peut pas être placé." };
  }

  if (existants.some((l) => l.nom.toLowerCase() === nom.toLowerCase())) {
    return {
      ok: false,
      erreur: `Un lieu s’appelle déjà « ${nom} » : choisis un autre nom, ou ajuste celui-là dans Réglages.`,
    };
  }

  const tarif = candidat.tarif ?? null;
  const mode = candidat.mode ? candidat.mode : null;
  if (tarif !== null && !Number.isFinite(tarif)) {
    return { ok: false, erreur: "Le tarif n’est pas un nombre." };
  }
  if (tarif !== null && mode === null) {
    return { ok: false, erreur: "Dis si ce tarif est à l’heure ou au kWh." };
  }

  const nouveau = {
    nom,
    lat: candidat.lat,
    lng: candidat.lng,
    rayonM: RAYON_NOMME_M,
    ...(tarif !== null && mode !== null ? { mode, tarif } : {}),
  };
  const valide = SchemaLieux.safeParse([...existants, nouveau]);
  if (!valide.success) {
    const premier = valide.error.issues[0];
    return { ok: false, erreur: premier ? `Refusé : ${premier.message}` : "Saisie refusée." };
  }

  const voisin = existants
    .map((l) => ({ l, d: distanceM(candidat, l) }))
    .filter(({ l, d }) => d <= l.rayonM + RAYON_NOMME_M)
    .sort((a, b) => a.d - b.d)[0];

  const suite =
    tarif === null
      ? " Le nom s’affiche ; le coût reste une estimation tant qu’aucun tarif n’est saisi."
      : " Son tarif sert à chiffrer ces recharges.";
  const voisinage = voisin
    ? ` « ${voisin.l.nom} » est tout près (${Math.round(voisin.d)} m) : la recharge va au lieu le plus proche.`
    : "";

  return { ok: true, lieux: valide.data, message: `« ${nom} » enregistré.${suite}${voisinage}` };
}
