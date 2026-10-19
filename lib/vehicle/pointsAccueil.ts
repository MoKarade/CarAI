// lib/vehicle/pointsAccueil.ts — CE QUE chaque point de la voiture affiche. PUR, testé.
//
// `pointsVoiture.ts` dit OÙ ça se pose ; ce fichier dit CE QUE ça dit. Séparés parce qu'ils
// changent pour des raisons différentes : l'un bouge quand le dessin change, l'autre quand
// la voiture publie une donnée de plus.
//
// ⚠️ RÈGLE D'HONNÊTETÉ, la même que partout : une mesure absente affiche « — » avec le ton
// `inconnu`, JAMAIS un zéro ni un vert. Sur une carrosserie, une pastille verte se lit
// « tout va bien » — c'est exactement le mensonge qu'on s'interdit. Chaque cas d'absence
// est couvert par un test.

import type { EtatSchema } from "@/lib/vehicle/etatSchema";
import { libellePosition, type Position } from "@/lib/vehicle/schemaVehicule";
import type { IdPoint, PointVoiture, TonPoint } from "@/lib/vehicle/pointsVoiture";

/** Au-delà, la dernière synchro est jugée vieille. Toyota rafraîchit aux 30–60 min. */
export const SYNCHRO_VIEILLE_MS = 3 * 3_600_000;

/** L'autonomie de référence qui sert d'échelle — une référence choisie, pas une mesure. */
export const AUTONOMIE_REFERENCE_KM = 400;

const POSITION_PAR_POINT: Record<string, Position> = {
  "pneu-avant-gauche": "avant-gauche",
  "pneu-avant-droite": "avant-droite",
  "pneu-arriere-gauche": "arriere-gauche",
  "pneu-arriere-droite": "arriere-droite",
};

/** Le ton de la charge : sous 20 % c'est un problème, sous 40 % ça se surveille. */
function tonCharge(soc: number | null): TonPoint {
  if (soc === null) return "inconnu";
  if (soc < 20) return "danger";
  if (soc < 40) return "attention";
  return "ok";
}

function nombre(valeur: number | null, decimales = 0): string {
  if (valeur === null || !Number.isFinite(valeur)) return "—";
  return new Intl.NumberFormat("fr-CA", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(valeur);
}

export interface EntreesPoints {
  schema: EtatSchema;
  soc: number | null;
  autonomieKm: number | null;
  odometreKm: number | null;
  derniereSynchro: Date | null;
  /** Passé en paramètre, jamais lu de l'horloge : c'est ce qui rend l'âge testable. */
  maintenant: Date;
  /**
   * La fin de charge annoncée par la voiture, quand une charge est en cours. `null` sinon —
   * hors charge, ce compte à rebours ne veut rien dire (la bZ rediffuse la valeur de la
   * session précédente).
   *
   * L'heure arrive DÉJÀ FORMATÉE : le fuseau est une décision de la page, et la dupliquer
   * ici donnerait deux vérités qui divergeraient au premier changement.
   */
  finCharge?: { heure: string; duree: string } | null;
  /**
   * Ce que le BANDEAU de charge disait, et qu'aucune autre surface ne porte : le rythme
   * MESURÉ depuis les relevés de batterie, et la fin qu'il laisse prévoir.
   *
   * ⚠️ Ce n'est pas un doublon de `finCharge`. Celle-là vient de la VOITURE (elle annonce
   * un compte à rebours) ; celle-ci est DÉDUITE de la montée du niveau. Les garder toutes
   * les deux est le seul moyen de voir qu'elles divergent — et une divergence est la seule
   * chose qui puisse révéler que la voiture se trompe.
   */
  rythmeCharge?: string | null;
}

/**
 * Tout ce qui se pose sur la carrosserie, dans l'ordre où on le lit. PURE.
 *
 * ⚠️ L'ordre compte : `SchemaInteractif` rend les points de LECTURE avant les boutons de
 * COMMANDE, mais entre pastilles c'est cet ordre-ci qui décide laquelle passe au-dessus si
 * deux bulles s'ouvrent près l'une de l'autre.
 */
export function construirePointsVoiture(e: EntreesPoints): PointVoiture[] {
  const points: PointVoiture[] = [];

  // ── AUTONOMIE, au capot ────────────────────────────────────────────────────────────
  points.push({
    id: "autonomie",
    valeur: nombre(e.autonomieKm),
    unite: e.autonomieKm === null ? undefined : "km",
    libelle: "Autonomie annoncée",
    ton: e.autonomieKm === null ? "inconnu" : "neutre",
    vedette: true,
    detail:
      e.autonomieKm === null
        ? ["La voiture n’a pas publié d’autonomie."]
        : [
            `${nombre(e.autonomieKm)} km annoncés par la voiture — c’est SON estimation, pas un calcul de l’app.`,
            `Repère d’échelle : ${nombre(AUTONOMIE_REFERENCE_KM)} km, une référence choisie et non une capacité constatée.`,
          ],
  });

  // ── CHARGE, à la trappe — avec sa fin annoncée quand elle charge ───────────────────
  //
  // Marc, 20/08 : « je veux que ce soit sur le véhicule aussi ». L'heure de fin vivait
  // seulement dans le bandeau ; elle est maintenant SUR la trappe, là où on regarde quand
  // on se demande « c'est prêt quand ? ».
  const detailCharge =
    e.soc === null
      ? ["La voiture n’a pas publié son niveau de charge."]
      : [`Batterie à ${nombre(e.soc)} % au dernier relevé.`];
  if (e.finCharge) {
    detailCharge.push(
      `Fin prévue à ${e.finCharge.heure} — ${e.finCharge.duree} annoncées par la voiture AU RELEVÉ, pas depuis maintenant.`,
    );
  }
  if (e.rythmeCharge) detailCharge.push(e.rythmeCharge);
  points.push({
    id: "charge",
    valeur: e.soc === null ? "—" : nombre(e.soc),
    // ⚠️ L'heure de fin se colle à l'unité plutôt que d'occuper un point à elle : un
    // onzième point sur une carrosserie déjà dense n'aurait pas trouvé sa place, et
    // surtout « 84 % » et « prêt à 15 h 35 » répondent à la MÊME question.
    unite: e.soc === null ? undefined : e.finCharge ? `% · ${e.finCharge.heure}` : "%",
    libelle: "Charge",
    ton: tonCharge(e.soc),
    vedette: true,
    commande: "charge",
    detail: detailCharge,
  });

  // ── VERROU, au toit ────────────────────────────────────────────────────────────────
  points.push({
    id: "verrou",
    valeur: e.schema.verrouillee === null ? "—" : e.schema.verrouillee ? "Fermée" : "OUVERTE",
    libelle: "Verrouillage",
    ton:
      e.schema.verrouillee === null ? "inconnu" : e.schema.verrouillee ? "ok" : "danger",
    commande: "verrou",
    detail:
      e.schema.verrouillee === null
        ? ["La voiture n’a pas publié l’état du verrou."]
        : e.schema.verrouillee
          ? ["Les portières sont verrouillées."]
          : ["Les portières sont DÉVERROUILLÉES. Tape pour agir."],
  });

  // ── OUVRANTS ───────────────────────────────────────────────────────────────────────
  const nbOuverts =
    e.schema.portieresOuvertes.length +
    e.schema.vitresOuvertes.length +
    e.schema.ouvrantsSansPosition;
  points.push({
    id: "ouvrants",
    valeur: nbOuverts === 0 ? "Fermé" : String(nbOuverts),
    libelle: "Ouvrants",
    ton: nbOuverts > 0 ? "danger" : "ok",
    detail:
      nbOuverts === 0
        ? ["Portières, vitres, coffre : tout est fermé."]
        : [
            `${nbOuverts} ouvrant${nbOuverts > 1 ? "s" : ""} (portière, vitre ou coffre) ouvert${nbOuverts > 1 ? "s" : ""}.`,
            ...(e.schema.ouvrantsSansPosition > 0
              ? [
                  `Dont ${e.schema.ouvrantsSansPosition} que la voiture ne situe pas — compté${e.schema.ouvrantsSansPosition > 1 ? "s" : ""} sans être placé${e.schema.ouvrantsSansPosition > 1 ? "s" : ""}.`,
                ]
              : []),
          ],
  });

  // ── ODOMÈTRE, au hayon ─────────────────────────────────────────────────────────────
  points.push({
    id: "odometre",
    valeur: nombre(e.odometreKm),
    unite: e.odometreKm === null ? undefined : "km",
    libelle: "Odomètre",
    ton: e.odometreKm === null ? "inconnu" : "neutre",
    detail:
      e.odometreKm === null
        ? ["La voiture n’a pas publié son compteur."]
        : [`${nombre(e.odometreKm)} km au compteur, dernier relevé.`],
  });

  // ── SYNCHRO ────────────────────────────────────────────────────────────────────────
  const ecartMs =
    e.derniereSynchro === null ? null : e.maintenant.getTime() - e.derniereSynchro.getTime();
  points.push({
    id: "synchro",
    valeur: ecartMs === null ? "—" : formaterEcart(ecartMs),
    libelle: "Dernier relevé",
    ton:
      ecartMs === null ? "inconnu" : ecartMs > SYNCHRO_VIEILLE_MS ? "attention" : "ok",
    detail:
      ecartMs === null
        ? ["Aucune donnée reçue pour l’instant."]
        : [
            "Toyota rafraîchit les données aux 30–60 min : un écart de cet ordre est normal.",
            ...(ecartMs > SYNCHRO_VIEILLE_MS
              ? ["Au-delà de trois heures, ça vaut la peine de regarder l’onglet Données."]
              : []),
          ],
  });

  // ── LES QUATRE PNEUS, chacun SUR sa roue ───────────────────────────────────────────
  const parPosition = new Map<Position, EtatSchema["pneus"][number]>();
  for (const p of e.schema.pneus) if (p.position) parPosition.set(p.position, p);

  for (const id of Object.keys(POSITION_PAR_POINT) as IdPoint[]) {
    const position = POSITION_PAR_POINT[id]!;
    const pneu = parPosition.get(position);
    points.push({
      id,
      valeur: pneu ? nombre(Math.round(pneu.pressionKpa)) : "—",
      // ⚠️ PAS d'unité sur la pastille d'un pneu : les quatre partagent la même, la
      // répéter quatre fois double la largeur de chaque étiquette pour ne rien apprendre —
      // et c'est la largeur qui décide si deux pastilles se recouvrent. L'unité est dans
      // le détail, où elle a la place.
      libelle: `Pneu ${libellePosition(position)}`,
      // ⚠️ Pas de mesure ⇒ `inconnu`, jamais `ok`.
      ton: pneu ? (pneu.etat as TonPoint) : "inconnu",
      detail: pneu
        ? [
            `${nombre(Math.round(pneu.pressionKpa))} kPa (${nombre(Math.round(pneu.psi))} psi).`,
            ...(pneu.raison ? [pneu.raison] : []),
          ]
        : ["Aucune pression publiée pour cette roue."],
    });
  }

  return points;
}

/** Un écart en texte court, taillé pour tenir dans une pastille. PURE. */
function formaterEcart(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 48) return `${heures} h`;
  return `${Math.round(heures / 24)} j`;
}
