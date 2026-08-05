// lib/vehicle/lease.ts — suivi du kilométrage vs allocation du bail (Doc 4 §3.4).
// FONCTIONS PURES : l'instant et les données sont des PARAMÈTRES, jamais lus ici. C'est la
// seule façon de tester une projection sans attendre quatre ans.
//
// Contexte du cadrage : bail signé le 14 juillet 2026, 112 000 km sur 48 mois, kilométrage
// projeté réel autour de 165 000 km. L'écart est le sujet — ce calcul existe pour le rendre
// visible tôt, pas pour le confirmer à la restitution.
//
// ── CE QUE CE MODULE REFUSE DE FAIRE ─────────────────────────────────────────────────
// Chiffrer un coût de dépassement tant que le tarif au kilomètre excédentaire n'est pas
// connu. Le cadrage note que cette donnée n'a pas été fournie (Doc 4 §3.4). Un montant
// plausible mais inventé sur un sujet où Marc va décider (racheter ? renégocier ? rouler
// moins ?) serait exactement le genre de fausse donnée que l'écosystème s'interdit.

export interface TermesBail {
  /** AAAA-MM-JJ. */
  debut: string;
  dureeMois: number;
  kilometrageAutorise: number;
  coutParKmExcedentaire: number | null;
  devise: string;
}

export interface PointOdometre {
  km: number;
  mesureLe: Date;
}

export interface EtatBail {
  kilometrageActuel: number | null;
  kilometrageMesureLe: Date | null;
  allocationTotale: number;
  /** Part de l'allocation consommée, en pourcent (peut dépasser 100). */
  consommePourcent: number | null;
  /** Part du bail écoulée, en pourcent. Le point de comparaison du précédent. */
  ecoulePourcent: number;
  debutBail: Date;
  finBail: Date;
  joursEcoules: number;
  joursRestants: number;
  /** Rythme observé, km/jour. `null` si l'historique ne permet pas de le mesurer. */
  rythmeKmParJour: number | null;
  /** Rythme qu'autorise le bail, km/jour. */
  rythmeAutoriseKmParJour: number;
  /** Kilométrage projeté en fin de bail au rythme observé. */
  projectionFinBail: number | null;
  /** Dépassement projeté (positif) ou marge (négatif). `null` si non projetable. */
  depassementProjete: number | null;
  /** Coût du dépassement, UNIQUEMENT si le tarif est connu. */
  coutDepassementProjete: number | null;
  devise: string;
  /** Ce qui manque pour que le calcul soit complet. Vide = résultat pleinement exploitable. */
  limites: string[];
}

const MS_PAR_JOUR = 86_400_000;

/** Ajoute des mois à une date en gérant les fins de mois (31 janvier + 1 mois = 28/29 février). */
export function ajouterMois(date: Date, mois: number): Date {
  const resultat = new Date(date.getTime());
  const jour = resultat.getUTCDate();
  resultat.setUTCDate(1);
  resultat.setUTCMonth(resultat.getUTCMonth() + mois);
  const dernierJour = new Date(
    Date.UTC(resultat.getUTCFullYear(), resultat.getUTCMonth() + 1, 0),
  ).getUTCDate();
  resultat.setUTCDate(Math.min(jour, dernierJour));
  return resultat;
}

/**
 * Rythme kilométrique par régression linéaire sur l'historique d'odomètre (Doc 4 §3.4).
 *
 * Pourquoi une régression plutôt que (dernier − premier) / durée : un odomètre est bruité
 * par la fréquence de relevé, et deux points isolés font dépendre tout le résultat de la
 * chance d'échantillonnage. La régression au moindre carré utilise l'ENSEMBLE des mesures.
 *
 * `null` s'il y a moins de deux points, ou si toutes les mesures tombent au même instant —
 * une pente n'existe pas sur une durée nulle, et renvoyer 0 laisserait croire que la voiture
 * ne roule pas.
 */
export function rythmeKmParJour(points: PointOdometre[]): number | null {
  const valides = points
    .filter((p) => Number.isFinite(p.km) && !Number.isNaN(p.mesureLe.getTime()))
    .sort((a, b) => a.mesureLe.getTime() - b.mesureLe.getTime());

  if (valides.length < 2) return null;

  const t0 = valides[0]!.mesureLe.getTime();
  const xs = valides.map((p) => (p.mesureLe.getTime() - t0) / MS_PAR_JOUR);
  const ys = valides.map((p) => p.km);

  const n = xs.length;
  const moyX = xs.reduce((s, x) => s + x, 0) / n;
  const moyY = ys.reduce((s, y) => s + y, 0) / n;

  let numerateur = 0;
  let denominateur = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - moyX;
    numerateur += dx * (ys[i]! - moyY);
    denominateur += dx * dx;
  }

  if (denominateur === 0) return null;

  const pente = numerateur / denominateur;
  // Un odomètre ne décroît pas. Une pente négative signale des données douteuses (relevés
  // désordonnés, unités mélangées) — mieux vaut avouer qu'on ne sait pas.
  return pente >= 0 ? pente : null;
}

/**
 * État complet du bail.
 *
 * Tout ce qui n'est pas mesurable reste `null` et la raison est NOMMÉE dans `limites`.
 * C'est la différence entre un tableau de bord utile et un tableau de bord rassurant : un
 * `0 km` crédible masquerait qu'aucun odomètre n'est encore arrivé.
 */
export function calculerEtatBail(params: {
  bail: TermesBail;
  historiqueOdometre: PointOdometre[];
  maintenant: Date;
}): EtatBail {
  const { bail, historiqueOdometre, maintenant } = params;
  const limites: string[] = [];

  const debutBail = new Date(`${bail.debut}T00:00:00.000Z`);
  const finBail = ajouterMois(debutBail, bail.dureeMois);

  const dureeTotaleJours = (finBail.getTime() - debutBail.getTime()) / MS_PAR_JOUR;
  const joursEcoules = Math.max(
    0,
    (maintenant.getTime() - debutBail.getTime()) / MS_PAR_JOUR,
  );
  const joursRestants = Math.max(0, dureeTotaleJours - joursEcoules);

  const points = [...historiqueOdometre].sort(
    (a, b) => a.mesureLe.getTime() - b.mesureLe.getTime(),
  );
  const dernier = points.at(-1) ?? null;

  if (!dernier) limites.push("Aucun relevé d'odomètre : le kilométrage reste inconnu.");
  if (points.length === 1) {
    limites.push(
      "Un seul relevé d'odomètre : le rythme ne peut pas encore être mesuré (il en faut au moins deux, espacés).",
    );
  }

  const rythme = rythmeKmParJour(points);
  const rythmeAutorise = bail.kilometrageAutorise / dureeTotaleJours;

  const projection =
    rythme !== null && dernier !== null
      ? dernier.km + rythme * joursRestants
      : null;

  const depassement =
    projection !== null ? projection - bail.kilometrageAutorise : null;

  let coutDepassement: number | null = null;
  if (depassement !== null && depassement > 0) {
    if (bail.coutParKmExcedentaire !== null) {
      coutDepassement = depassement * bail.coutParKmExcedentaire;
    } else {
      limites.push(
        "Tarif au kilomètre excédentaire inconnu : le dépassement est chiffré en kilomètres, pas en dollars. Renseigne-le dans la config du bail pour obtenir un montant.",
      );
    }
  }

  return {
    kilometrageActuel: dernier?.km ?? null,
    kilometrageMesureLe: dernier?.mesureLe ?? null,
    allocationTotale: bail.kilometrageAutorise,
    consommePourcent:
      dernier !== null ? (dernier.km / bail.kilometrageAutorise) * 100 : null,
    ecoulePourcent: (joursEcoules / dureeTotaleJours) * 100,
    debutBail,
    finBail,
    joursEcoules: Math.floor(joursEcoules),
    joursRestants: Math.ceil(joursRestants),
    rythmeKmParJour: rythme,
    rythmeAutoriseKmParJour: rythmeAutorise,
    projectionFinBail: projection,
    depassementProjete: depassement,
    coutDepassementProjete: coutDepassement,
    devise: bail.devise,
    limites,
  };
}

/**
 * Phrase courte résumant la situation. Sert au widget hub et au MCP — un seul endroit où
 * la formulation est décidée, pour que les deux disent exactement la même chose.
 */
export function resumerBail(etat: EtatBail): string {
  if (etat.kilometrageActuel === null) {
    return "Kilométrage inconnu — aucun relevé d'odomètre reçu.";
  }
  const km = Math.round(etat.kilometrageActuel).toLocaleString("fr-CA");
  const total = etat.allocationTotale.toLocaleString("fr-CA");

  if (etat.depassementProjete === null) {
    return `${km} km sur ${total} autorisés. Rythme pas encore mesurable.`;
  }
  if (etat.depassementProjete > 0) {
    const ecart = Math.round(etat.depassementProjete).toLocaleString("fr-CA");
    return `${km} km sur ${total} autorisés — dépassement projeté de ${ecart} km à ce rythme.`;
  }
  const marge = Math.round(-etat.depassementProjete).toLocaleString("fr-CA");
  return `${km} km sur ${total} autorisés — marge projetée de ${marge} km à ce rythme.`;
}
