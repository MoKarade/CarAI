// lib/vehicle/lease.ts — suivi du kilométrage vs allocation du bail (Doc 4 §3.4).
// FONCTIONS PURES : l'instant et les données sont des PARAMÈTRES, jamais lus ici. C'est la
// seule façon de tester une projection sans attendre quatre ans.
//
// Contexte du cadrage : l'usage projeté dépasse l'allocation du bail. L'écart est le sujet —
// ce calcul existe pour le rendre visible tôt, pas pour le confirmer à la restitution. Les
// termes du bail (dates, kilométrage, durée) vivent en base, saisis dans Réglages : aucun
// n'est écrit dans le code (aucune donnée perso dans un fichier versionné).
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
  /** Odomètre à la signature, s'il est connu. Voir `SchemaBail` dans `lib/config.ts`. */
  kilometrageInitial?: number | null;
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
  /**
   * Nombre de jours que couvre RÉELLEMENT la mesure du rythme, du premier au dernier point
   * retenu. À comparer à `joursEcoules` : c'est le seul moyen de savoir si la projection
   * parle de tout le bail ou d'une semaine de vacances. `null` si non mesurable.
   */
  couvertureRythmeJours: number | null;
  /** Le rythme est-il ancré sur l'odomètre de signature (exact) ou sur la seule fenêtre observée ? */
  rythmeAncreSurSignature: boolean;
  /** Rythme qu'autorise le bail EN MOYENNE sur toute sa durée, km/jour. */
  rythmeAutoriseKmParJour: number;
  /**
   * ⚠️ LE CHIFFRE ACTIONNABLE — ce qu'il reste à dépenser par jour, compte tenu de ce qui
   * est DÉJÀ consommé : `(allocation − odomètre) / jours restants`.
   *
   * La moyenne du contrat (`rythmeAutoriseKmParJour`) ne sert plus à rien passé le premier
   * mois : elle ignore l'avance ou le retard accumulés. Celui-ci répond à la seule question
   * que Marc se pose vraiment — « je peux rouler combien par jour à partir de maintenant
   * sans payer de pénalité ? ». Il vaut 0 quand l'allocation est déjà épuisée : à ce
   * stade, chaque kilomètre est facturé, et l'annoncer négatif n'aiderait pas.
   * `null` si le kilométrage est inconnu ou le bail échu.
   */
  rythmeRestantAutoriseKmParJour: number | null;
  /**
   * Écart entre le rythme observé et ce qu'il reste d'autorisé, km/jour. Positif = tu
   * dépasses de tant par jour. C'est la phrase d'accueil de l'app.
   */
  ecartKmParJour: number | null;
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

  // ── LE POINT D'ANCRAGE : ce que l'historique ne peut PAS savoir ────────────────────
  //
  // CarAI a commencé à enregistrer APRÈS la signature. Régresser sur les
  // seuls points observés mesure donc le rythme d'une fenêtre récente et le projette sur
  // quatre ans comme s'il valait depuis le début — ce qui a produit une projection
  // de dépassement très inférieure à celle du kilométrage depuis la signature. L'écart n'était pas une erreur de calcul : c'était une fenêtre trop
  // courte, présentée sans le dire.
  //
  // Quand l'odomètre de signature est connu, on ajoute ce point RÉEL (date de signature,
  // km du contrat) à la régression : elle porte alors sur tout le bail écoulé. Quand il ne
  // l'est pas, on ne l'invente pas — on nomme la limite plus bas.
  const ancre: PointOdometre | null =
    bail.kilometrageInitial !== null && bail.kilometrageInitial !== undefined
      ? { km: bail.kilometrageInitial, mesureLe: debutBail }
      : null;
  const pointsRythme = ancre ? [ancre, ...points] : points;

  const rythme = rythmeKmParJour(pointsRythme);
  const rythmeAutorise = bail.kilometrageAutorise / dureeTotaleJours;

  const premierRetenu = pointsRythme[0] ?? null;
  const couvertureRythmeJours =
    rythme !== null && premierRetenu !== null && dernier !== null
      ? (dernier.mesureLe.getTime() - premierRetenu.mesureLe.getTime()) / MS_PAR_JOUR
      : null;

  // La fenêtre couvre-t-elle l'essentiel du bail écoulé ? Sous 80 %, la projection repose
  // sur un échantillon partiel et le dire fait partie du résultat. Le seuil est un filet,
  // pas une politique : au-delà, l'écart devient négligeable devant le bruit de mesure.
  if (
    !ancre &&
    couvertureRythmeJours !== null &&
    joursEcoules > 0 &&
    couvertureRythmeJours < joursEcoules * 0.8
  ) {
    limites.push(
      `Rythme mesuré sur ${Math.round(couvertureRythmeJours)} jour(s) d'historique alors que ` +
        `${Math.round(joursEcoules)} jour(s) de bail sont écoulés : la projection ne connaît pas ` +
        `le kilométrage parcouru avant le premier relevé. Renseigne l'odomètre de signature ` +
        `(kilometrageInitial) pour qu'elle porte sur tout le bail.`,
    );
  }

  // Ce qu'il RESTE à dépenser par jour, compte tenu du kilométrage déjà consommé. Plancher
  // à 0 : passé l'allocation, chaque kilomètre est facturé et un budget négatif
  // n'aiderait personne à décider. `null` quand le bail est échu — diviser par zéro jour
  // restant donnerait l'infini, ce qui se lirait comme « roule tant que tu veux ».
  const rythmeRestant =
    dernier !== null && joursRestants > 0
      ? Math.max(0, (bail.kilometrageAutorise - dernier.km) / joursRestants)
      : null;

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
    couvertureRythmeJours,
    rythmeAncreSurSignature: ancre !== null,
    rythmeAutoriseKmParJour: rythmeAutorise,
    rythmeRestantAutoriseKmParJour: rythmeRestant,
    ecartKmParJour:
      rythme !== null && rythmeRestant !== null ? rythme - rythmeRestant : null,
    projectionFinBail: projection,
    depassementProjete: depassement,
    coutDepassementProjete: coutDepassement,
    devise: bail.devise,
    limites,
  };
}

/** Ce que disent les écrans et le MCP quand aucun terme du bail n'est en base (Réglages). */
export const MESSAGE_BAIL_NON_RENSEIGNE = "Bail non renseigné — saisis les termes dans Réglages.";

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

// ══ L'AVANCE SUR LE FORFAIT ══════════════════════════════════════════════════════════
//
// `consommePourcent` seul ne dit RIEN. « 6,8 % du forfait » est excellent au bout d'un an
// et catastrophique au bout d'un mois : son point de comparaison n'est pas 100 %, c'est le
// temps ÉCOULÉ. Consommer 40 % de son allocation après 40 % du bail est parfaitement sain,
// et le peindre en alerte apprendrait à ignorer l'indicateur.
//
// ⚠️ Cette règle vivait ÉCRITE EN DUR dans `lib/hubSummary.ts`, seul endroit qui lisait
// `consommePourcent`. L'accueil, lui, re-calculait la fraction à la main
// (`kilometrageActuel / allocationTotale`) sans jamais la comparer au temps. Deux lectures
// du même fait, dont une amputée : c'est ici, une fois, pour les deux.

/** Au-delà de cet écart en POINTS entre consommé et écoulé, l'avance mérite un signal. */
export const AVANCE_ATTENTION_POINTS = 5;
/** Et au-delà de celui-ci, une alerte : à ce rythme l'allocation ne tiendra pas. */
export const AVANCE_ALERTE_POINTS = 15;

export type GraviteAvance = "ok" | "attention" | "alerte";

export interface AvanceBail {
  /** Part de l'allocation consommée, en pourcent. */
  consommePourcent: number;
  /** Part du bail écoulée, en pourcent — le point de comparaison. */
  ecoulePourcent: number;
  /** Consommé moins écoulé, en POINTS. Positif = en avance sur le forfait. */
  ecartPoints: number;
  gravite: GraviteAvance;
}

/**
 * L'avance (ou la marge) sur le forfait kilométrique. PURE, testée.
 *
 * `null` quand aucun relevé d'odomètre n'est arrivé : l'écran affiche alors un tiret, jamais
 * un « 0 % » qui affirmerait que la voiture n'a pas roulé.
 */
export function avanceSurLeBail(etat: EtatBail): AvanceBail | null {
  if (etat.consommePourcent === null) return null;
  const ecartPoints = etat.consommePourcent - etat.ecoulePourcent;
  return {
    consommePourcent: etat.consommePourcent,
    ecoulePourcent: etat.ecoulePourcent,
    ecartPoints,
    gravite:
      ecartPoints > AVANCE_ALERTE_POINTS
        ? "alerte"
        : ecartPoints > AVANCE_ATTENTION_POINTS
          ? "attention"
          : "ok",
  };
}
