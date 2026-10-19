// lib/itineraire.ts — préparer les relevés GPS d'un trajet pour le mode `directions`
// de l'Embed API Google. PUR, testé (tests/itineraire.test.ts).
//
// ══ POURQUOI CE MODULE EXISTE — le bug de la boucle (Marc, 17/08) ════════════════════
// « marche pas, je vois que la destination pas le trajet » : un trajet qui REVIENT à son
// point de départ donnait origine ≈ destination à Google, qui calcule alors un itinéraire
// de zéro mètre — UNE épingle, aucun tracé. Et comme la bZ ne publie sa position qu'à
// l'arrêt, une boucle n'a parfois AUCUN relevé intermédiaire : il n'y a alors rien
// d'autre à montrer que l'endroit, et il faut le DIRE plutôt qu'afficher une épingle
// muette qui ressemble à un bug.
//
// Trois décisions, chacune verrouillée par un test :
//   1. DÉDOUBLONNER — les relevés d'un même arrêt se répètent au même endroit ; des
//      étapes identiques gaspillent le plafond d'étapes de l'Embed sans rien tracer.
//   2. FORCER L'APEX quand on échantillonne — le relevé le plus LOIN de l'origine est ce
//      qui donne sa forme à une boucle. Un échantillonnage par position kilométrique qui
//      le raterait ferait retracer l'aller-retour le plus court, pas le trajet.
//   3. REPLI HONNÊTE — une boucle sans relevé éloigné n'a PAS d'itinéraire à tracer.
//      On montre l'endroit (mode `place`) avec l'explication, jamais une épingle nue.

import { distanceM } from "@/lib/vehicle/tarifsBornes";

export interface PointGps {
  lat: number;
  lng: number;
}

/** Deux relevés plus proches que ça décrivent le même arrêt : le second n'apporte rien. */
export const RAYON_DOUBLON_M = 120;

/**
 * Plus près que ça de l'origine ou de la destination, une étape ne trace rien de plus.
 * Et une destination à moins de ça de l'origine fait du trajet une BOUCLE.
 */
export const RAYON_ANCRE_M = 150;

/** L'Embed accepte ~10 étapes, et l'URL d'un iframe a une limite de longueur. */
export const MAX_ETAPES = 9;

export type PlanItineraire =
  | { mode: "itineraire"; origine: PointGps; destination: PointGps; etapes: PointGps[] }
  /** Rien à tracer (boucle sans relevé éloigné) : montrer l'ENDROIT, et le dire. */
  | { mode: "sur-place"; centre: PointGps };

/** `null` seulement quand il n'y a AUCUN point — l'appelant n'affiche alors pas de carte. */
export function planifierItineraire(points: ReadonlyArray<PointGps>): PlanItineraire | null {
  if (points.length === 0) return null;
  const origine = points[0]!;
  const destination = points[points.length - 1]!;
  if (points.length === 1) return { mode: "sur-place", centre: origine };

  const boucle = distanceM(origine, destination) < RAYON_ANCRE_M;

  // Les étapes candidates : les relevés intermédiaires UTILES — loin des deux ancres,
  // et dédoublonnés contre le candidat précédent (les relevés d'arrêt se répètent).
  const candidats: PointGps[] = [];
  for (const p of points.slice(1, -1)) {
    if (distanceM(p, origine) < RAYON_ANCRE_M) continue;
    if (distanceM(p, destination) < RAYON_ANCRE_M) continue;
    const precedent = candidats[candidats.length - 1];
    if (precedent && distanceM(p, precedent) < RAYON_DOUBLON_M) continue;
    candidats.push(p);
  }

  if (candidats.length === 0) {
    // Une boucle sans étape se réduirait chez Google à une épingle sans explication.
    if (boucle) return { mode: "sur-place", centre: destination };
    return { mode: "itineraire", origine, destination, etapes: [] };
  }

  const etapes =
    candidats.length <= MAX_ETAPES
      ? [...candidats]
      : echantillonnerEtapes(candidats, origine, MAX_ETAPES);
  return { mode: "itineraire", origine, destination, etapes };
}

/**
 * `max` étapes RÉPARTIES le long du parcours — par position kilométrique, jamais par
 * index : dix relevés collés dans un bouchon ne pèsent pas dix relevés espacés — en
 * FORÇANT l'apex (le relevé le plus loin de l'origine, sans lequel une boucle
 * échantillonnée se referme au plus court). PURE.
 */
function echantillonnerEtapes(
  candidats: ReadonlyArray<PointGps>,
  origine: PointGps,
  max: number,
): PointGps[] {
  // Position kilométrique de chaque candidat le long du chemin réel.
  const cumul: number[] = [];
  let parcouru = 0;
  let precedent = origine;
  for (const c of candidats) {
    parcouru += distanceM(precedent, c);
    cumul.push(parcouru);
    precedent = c;
  }

  let apex = 0;
  for (let i = 1; i < candidats.length; i++) {
    if (distanceM(candidats[i]!, origine) > distanceM(candidats[apex]!, origine)) apex = i;
  }

  const retenus = new Set<number>([apex]);
  for (let k = 1; k <= max && retenus.size < max; k++) {
    const cible = (parcouru * k) / (max + 1);
    let meilleur = -1;
    for (let i = 0; i < cumul.length; i++) {
      if (retenus.has(i)) continue;
      if (meilleur === -1 || Math.abs(cumul[i]! - cible) < Math.abs(cumul[meilleur]! - cible)) {
        meilleur = i;
      }
    }
    if (meilleur !== -1) retenus.add(meilleur);
  }

  // Dans l'ordre du parcours — Google visite les étapes dans l'ordre où on les donne.
  return [...retenus].sort((a, b) => a - b).map((i) => candidats[i]!);
}
