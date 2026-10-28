// lib/vehicle/charges.ts — reconstitution des SESSIONS DE RECHARGE.
//
// ══ CE QU'ON A, ET CE QU'ON N'A PAS ══════════════════════════════════════════════════
//
// La bZ refuse `charge-energyadded`, `charge-wattage`, `charge-amperage` et
// `charge-voltage` — tous en `ERROR (COMPATIBILITY)`. Aucune mesure directe d'énergie ne
// nous parviendra donc jamais. Ce qu'on a :
//   • `battery_soc` — l'état de charge, en pourcent ;
//   • `battery_capacity` (`tractionbattery-nominalcapacity`) — la capacité, en kWh ;
//   • `charging_status` (`charge-ischarging`) — booléen… quand il arrive, voir ci-dessous.
//
// ══ POURQUOI L'ÉCRAN ÉTAIT VIDE (Marc, 12/08 : « la recharge je vois rien du tout ») ══
//
// Ce module ne savait reconstituer une session QUE depuis `charging_status`. Or le poll du
// 12/08 a mesuré ce signal en `ERROR (UPSTREAM)` : Toyota ne le sert pas de façon fiable.
// Sans lui, `etatsCharge` arrivait VIDE — donc zéro session, donc un écran vide, alors que
// la voiture chargeait bel et bien et que le SOC le montrait.
//
// C'est la même erreur que pour les trajets : bâtir sur le signal qu'on VOUDRAIT plutôt que
// sur celui qu'on A. La reconstitution part donc désormais du SOC — une recharge, c'est un
// état de charge qui MONTE alors que la voiture ne roule pas. Le statut déclaré, quand il
// arrive, reste utilisé : il donne des bornes exactes là où le SOC ne donne qu'une fenêtre.
//
// ⚠️ Ce qui distingue une recharge d'une récupération au freinage, c'est l'ODOMÈTRE : une
// voiture qui roule ne se recharge pas au net. Sans cette garde, une longue descente
// passerait pour une charge.
//
// L'énergie ajoutée est DÉDUITE : ΔSOC × capacité. C'est une ESTIMATION, et le mot compte —
// elle ignore les pertes de charge (chaleur, électronique), réelles et de l'ordre de 10 %.
// `energieEstimee` est donc toujours vrai tant que la bZ ne publie pas `energyadded`.
//
// ⚠️ Le coût suit la même règle que le dépassement du bail : il n'apparaît QUE si le tarif
// est renseigné. Le prix du kWh d'Hydro-Québec est public, mais il dépend du palier, de
// l'abonnement et de la date — l'écrire en dur produirait un montant faux qui aurait
// l'air juste. `tarifKwh` reste donc nullable, et l'absence est DITE.
//
// ══ LE TYPE DE BORNE (Marc, 13/08) ═══════════════════════════════════════════════════
//
// « Récupère plus d'info pour des graphs, sinon regarde la durée et le % pour savoir quel
// type de borne c'est. » Il n'y a rien de plus à récupérer : `charge-wattage`/`-amperage`/
// `-voltage` sont refusés en `ERROR (COMPATIBILITY)`, mesuré, définitif — la bZ ne les
// fournira jamais via Smartcar. `estimerBorne` déduit donc la puissance implicite de ce
// qu'on a déjà (kWh ÷ heures) et la classe par bande d'usage (Niveau 1/2/rapide). Voir son
// commentaire pour le détail — et pourquoi c'est toujours un MINORANT sur une session
// `bornesEstimees`.

import { odometreALinstant } from "@/lib/vehicle/trajets";
import type { PointOdometre } from "@/lib/vehicle/lease";

export interface PointCharge {
  t: Date;
  /** `true` si la voiture chargeait à cet instant. */
  enCharge: boolean;
}

export interface PointSoc {
  t: Date;
  /** État de charge, en pourcent (0-100). */
  pourcent: number;
}

export interface SessionCharge {
  debut: Date;
  fin: Date;
  dureeMinutes: number;
  socDebut: number | null;
  socFin: number | null;
  /** Points de pourcentage gagnés. `null` si le SOC n'encadre pas la session. */
  deltaSocPoints: number | null;
  /** Énergie estimée, en kWh. `null` sans SOC ou sans capacité connue. */
  energieKwh: number | null;
  /** Toujours `true` aujourd'hui : la bZ ne publie pas l'énergie réellement livrée. */
  energieEstimee: boolean;
  /** Coût, UNIQUEMENT si le tarif est connu. */
  coût: number | null;
  /**
   * D'où vient la session.
   *
   * `"statut"` — la voiture a DÉCLARÉ charger (`charge-ischarging`). Bornes exactes.
   * `"soc"` — déduite d'une remontée de l'état de charge. C'est le cas courant, Toyota ne
   * servant pas le statut de façon fiable. Les bornes sont alors une FENÊTRE : la charge a
   * commencé quelque part entre les deux relevés, on ne sait pas quand exactement.
   */
  source: "statut" | "soc";
  /** `true` quand début et fin sont une fenêtre entre relevés, pas des instants observés. */
  bornesEstimees: boolean;
}

const MS_PAR_MINUTE = 60_000;

/**
 * Durée maximale d'interruption tolérée à l'intérieur d'une même session.
 *
 * 75 minutes = 2,5 × la cadence du poll (30 min), et la marge est le sujet : à 45 minutes,
 * UN SEUL poll manqué — une instance froide, un blip réseau — scindait une charge de nuit
 * en deux sessions. Trouvé en écrivant les tests, pas en production. Deux vraies sessions,
 * elles, sont séparées de plusieurs heures (on débranche, on roule, on rebranche le soir) :
 * la marge ne risque donc pas de les fusionner.
 */
export const TROU_MINUTES = 75;

/**
 * Durée minimale pour qu'une plage compte comme une session.
 *
 * ⚠️ LIMITE ASSUMÉE : il faut DEUX relevés « en charge » pour qu'une durée existe. Une
 * charge plus courte que l'intervalle de poll peut donc n'être vue qu'une fois, et passer
 * inaperçue. C'est une limite du sondage, pas un bug — et il vaut mieux la dire que
 * d'inventer une durée à partir d'un point unique.
 */
export const DUREE_MIN_MINUTES = 5;

/**
 * SOC le plus proche d'un instant, dans une tolérance. PURE.
 *
 * Hors tolérance ⇒ `null`, et l'énergie n'est pas estimée. Apparier le SOC d'hier au début
 * d'une charge d'aujourd'hui fabriquerait une quantité d'énergie sans rapport.
 */
export function socProche(
  socs: PointSoc[],
  instant: Date,
  toleranceMinutes = 40,
): number | null {
  let meilleur: { ecart: number; pourcent: number } | null = null;
  for (const p of socs) {
    const ecart = Math.abs(p.t.getTime() - instant.getTime()) / MS_PAR_MINUTE;
    if (ecart > toleranceMinutes) continue;
    if (!meilleur || ecart < meilleur.ecart) meilleur = { ecart, pourcent: p.pourcent };
  }
  return meilleur?.pourcent ?? null;
}

/**
 * Hausse minimale d'état de charge pour qu'une remontée compte comme une recharge.
 *
 * En points de pourcentage. En dessous, c'est l'arrondi du capteur ou de la récupération
 * au freinage — pas un branchement. 3 points valent ~2 kWh sur la batterie de la bZ : assez
 * pour être une vraie charge, assez haut pour que le bruit ne l'atteigne jamais.
 */
export const HAUSSE_MIN_POINTS = 3;

/**
 * Kilomètres au-delà desquels la voiture ROULAIT, donc ne se rechargeait pas.
 *
 * ⚠️ La garde qui empêche de prendre une descente en récupération pour une recharge. Au net,
 * une voiture qui roule consomme ; mais sans cette borne, un long segment de route en pente
 * pourrait afficher un gain de SOC et fabriquer une session qui n'a jamais eu lieu.
 */
export const KM_MAX_PENDANT_CHARGE = 0.5;

/**
 * Sessions de recharge DÉDUITES de la seule courbe d'état de charge. PURE, testée.
 *
 * Une recharge, c'est un SOC qui MONTE alors que la voiture ne roule pas. C'est tout ce dont
 * on a besoin — et c'est la seule méthode qui fonctionne aujourd'hui, `charge-ischarging`
 * étant en erreur côté Toyota.
 *
 * ⚠️ Les bornes sont des FENÊTRES. Le dernier relevé avant la montée peut dater de plusieurs
 * heures : la charge a commencé quelque part après lui. La durée rendue est donc un MAJORANT,
 * et c'est `bornesEstimees` qui le porte jusqu'à l'écran.
 *
 * ⚠️ UN PALIER N'EST PAS UNE FIN DE CHARGE (Marc, 17/09 : « pas assez précis »). Jusqu'ici
 * cette boucle clôturait la session dès qu'un relevé ne montait PAS — donc une seule nuit
 * branchée ressortait en trois recharges. Forme observée sur une vraie nuit (valeurs fictives ici) : 40→45,
 * 45→48, 48→52, bornes jointives au point près, alors que le câble n'avait pas bougé. Le
 * SOC stagne pour des raisons ordinaires — arrondi du capteur, palier de fin de charge,
 * équilibrage — et `TROU_MINUTES` existait déjà pour ça… mais n'était appliqué QUE sur le
 * chemin `etatsCharge`, qui est mort (la bZ ne sert pas `charge-ischarging`). Une tolérance
 * écrite pour un chemin que rien n'emprunte ne protège rien.
 *
 * ⚠️ Un palier est TRAVERSÉ, jamais ACCUMULÉ : la fin de session reste le dernier relevé où
 * le SOC a réellement monté. Sinon une voiture laissée branchée à 100 % pendant huit heures
 * fabriquerait une charge de huit heures — et sur une borne facturée à l'heure, ça devient
 * un montant.
 */
export function chargesDepuisSoc(params: {
  socs: PointSoc[];
  historiqueOdometre?: PointOdometre[];
  hausseMinPoints?: number;
  kmMaxPendantCharge?: number;
  trouMinutes?: number;
}): Array<{ debut: Date; fin: Date; socDebut: number; socFin: number }> {
  const {
    socs,
    historiqueOdometre = [],
    hausseMinPoints = HAUSSE_MIN_POINTS,
    kmMaxPendantCharge = KM_MAX_PENDANT_CHARGE,
    trouMinutes = TROU_MINUTES,
  } = params;

  const ordonnes = [...socs].sort((a, b) => a.t.getTime() - b.t.getTime());
  const sessions: Array<{ debut: Date; fin: Date; socDebut: number; socFin: number }> = [];

  let depart: PointSoc | null = null;
  let dernier: PointSoc | null = null;

  const cloturer = () => {
    if (depart && dernier && dernier.pourcent - depart.pourcent >= hausseMinPoints) {
      sessions.push({
        debut: depart.t,
        fin: dernier.t,
        socDebut: depart.pourcent,
        socFin: dernier.pourcent,
      });
    }
    depart = null;
    dernier = null;
  };

  for (let i = 1; i < ordonnes.length; i += 1) {
    const a = ordonnes[i - 1]!;
    const b = ordonnes[i]!;

    // Le compteur a-t-il avancé entre les deux relevés ? Si oui la voiture roulait, et un
    // gain de charge y est de la récupération, pas un branchement.
    const odoA = odometreALinstant(historiqueOdometre, a.t);
    const odoB = odometreALinstant(historiqueOdometre, b.t);
    const aRoule = odoA !== null && odoB !== null && odoB - odoA > kmMaxPendantCharge;

    // La voiture a roulé : quoi qu'en dise le SOC, le branchement est terminé.
    if (aRoule) {
      cloturer();
      continue;
    }

    if (b.pourcent > a.pourcent) {
      if (!depart) depart = a;
      dernier = b;
      continue;
    }

    // PALIER — le SOC ne monte plus, mais rien ne dit que le câble a été retiré. Tant que
    // l'attente reste sous la tolérance, on TRAVERSE : `dernier` ne bouge pas, donc la fin
    // de session reste la dernière montée réelle.
    if (depart && dernier && b.pourcent === a.pourcent) {
      const attenteMinutes = (b.t.getTime() - dernier.t.getTime()) / MS_PAR_MINUTE;
      if (attenteMinutes <= trouMinutes) continue;
    }

    cloturer();
  }
  cloturer();

  return sessions;
}

/** Deux intervalles se chevauchent-ils ? PURE. */
function seChevauchent(
  a: { debut: Date; fin: Date },
  b: { debut: Date; fin: Date },
): boolean {
  return a.debut.getTime() <= b.fin.getTime() && b.debut.getTime() <= a.fin.getTime();
}

/**
 * Reconstitue les sessions de recharge. PURE, testée.
 *
 * Deux sources, dans cet ordre de confiance :
 *   1. `etatsCharge` — la voiture a déclaré charger. Bornes exactes. Rare aujourd'hui.
 *   2. le SOC qui monte — déduit. C'est ce qui fait vivre l'écran.
 *
 * Une session déduite qui CHEVAUCHE une session déclarée est écartée : ce sont les deux
 * visages du même branchement, et les additionner doublerait l'énergie.
 *
 * `capaciteKwh` et `tarifKwh` sont optionnels et leur absence se voit dans le résultat
 * (`energieKwh: null`, `coût: null`) plutôt que de produire un zéro trompeur.
 */
export function reconstituerCharges(params: {
  etatsCharge: PointCharge[];
  socs?: PointSoc[];
  historiqueOdometre?: PointOdometre[];
  capaciteKwh?: number | null;
  tarifKwh?: number | null;
  trouMinutes?: number;
  dureeMinMinutes?: number;
  hausseMinPoints?: number;
}): SessionCharge[] {
  const {
    etatsCharge,
    socs = [],
    historiqueOdometre = [],
    capaciteKwh = null,
    tarifKwh = null,
    trouMinutes = TROU_MINUTES,
    dureeMinMinutes = DUREE_MIN_MINUTES,
    hausseMinPoints = HAUSSE_MIN_POINTS,
  } = params;

  const ordonnes = [...etatsCharge].sort((a, b) => a.t.getTime() - b.t.getTime());

  // Plages de relevés CONSÉCUTIFS en charge, tolérant les trous courts.
  const plages: PointCharge[][] = [];
  let courante: PointCharge[] | null = null;
  let dernierEnCharge: Date | null = null;

  for (const point of ordonnes) {
    if (!point.enCharge) {
      // Un relevé « pas en charge » ferme la plage : c'est la fin franche d'une session.
      courante = null;
      dernierEnCharge = null;
      continue;
    }
    const trop =
      dernierEnCharge !== null &&
      (point.t.getTime() - dernierEnCharge.getTime()) / MS_PAR_MINUTE > trouMinutes;
    if (!courante || trop) {
      courante = [];
      plages.push(courante);
    }
    courante.push(point);
    dernierEnCharge = point.t;
  }

  const sessions: SessionCharge[] = [];
  for (const plage of plages) {
    const debut = plage[0]!.t;
    const fin = plage[plage.length - 1]!.t;
    const dureeMinutes = (fin.getTime() - debut.getTime()) / MS_PAR_MINUTE;
    if (dureeMinutes < dureeMinMinutes) continue;

    const socDebut = socProche(socs, debut);
    const socFin = socProche(socs, fin);
    // Un SOC qui BAISSE pendant une charge signale un appariement douteux, pas une charge
    // négative — on préfère ne rien affirmer.
    const delta =
      socDebut !== null && socFin !== null && socFin >= socDebut ? socFin - socDebut : null;

    const energie =
      delta !== null && capaciteKwh !== null && capaciteKwh > 0
        ? (delta / 100) * capaciteKwh
        : null;

    sessions.push({
      debut,
      fin,
      dureeMinutes,
      socDebut,
      socFin,
      deltaSocPoints: delta,
      energieKwh: energie,
      // Toujours estimée : la bZ refuse `charge-energyadded`, on DÉDUIT depuis le SOC.
      // Ce champ existe pour que l'écran ne puisse pas présenter un calcul comme une mesure.
      energieEstimee: true,
      coût: energie !== null && tarifKwh !== null ? energie * tarifKwh : null,
      source: "statut",
      bornesEstimees: false,
    });
  }

  // Ce que le SOC montre et que le statut n'a pas dit. Aujourd'hui, c'est TOUT.
  for (const brute of chargesDepuisSoc({
    socs,
    historiqueOdometre,
    hausseMinPoints,
    trouMinutes,
  })) {
    // Deux visages du même branchement : la version déclarée l'emporte, ses bornes sont
    // exactes. Les additionner doublerait l'énergie.
    if (sessions.some((existante) => seChevauchent(existante, brute))) continue;

    const dureeMinutes = (brute.fin.getTime() - brute.debut.getTime()) / MS_PAR_MINUTE;
    const delta = brute.socFin - brute.socDebut;
    const energie =
      capaciteKwh !== null && capaciteKwh > 0 ? (delta / 100) * capaciteKwh : null;

    sessions.push({
      debut: brute.debut,
      fin: brute.fin,
      dureeMinutes,
      socDebut: brute.socDebut,
      socFin: brute.socFin,
      deltaSocPoints: delta,
      energieKwh: energie,
      energieEstimee: true,
      coût: energie !== null && tarifKwh !== null ? energie * tarifKwh : null,
      source: "soc",
      // La charge a commencé quelque part APRÈS le relevé de départ : la durée est un
      // majorant, jamais un temps de branchement mesuré.
      bornesEstimees: true,
    });
  }

  return sessions.sort((a, b) => b.debut.getTime() - a.debut.getTime());
}

export type TypeBorne = "niveau1" | "niveau2" | "rapide";

/**
 * Puissance implicite d'une session, et ce qu'elle permet de dire sur la BORNE.
 *
 * ══ POURQUOI ESTIMER LA BORNE PLUTÔT QUE D'ATTENDRE UN SIGNAL ═══════════════════════
 *
 * Marc, 13/08 : « regarde la durée et le pourcentage de charge pour savoir quel type de
 * borne c'est ». `charge-wattage`/`charge-amperage`/`charge-voltage` sont refusés en
 * `ERROR (COMPATIBILITY)` — mesuré, définitif, la bZ ne les fournira jamais via Smartcar.
 * La seule piste qui reste est de DÉDUIRE la puissance de ce qu'on a déjà : l'énergie
 * (kWh) sur la durée (h) donne des kW, et les bandes de puissance des trois familles de
 * bornes sont un fait de l'industrie, pas une invention :
 *   • Niveau 1 (prise domestique 120 V)  : ~1–2 kW
 *   • Niveau 2 (240 V, domicile/public)  : ~3–19 kW
 *   • Recharge rapide (DC)               : 20 kW et plus
 *
 * ⚠️ Quand `bornesEstimees` est vrai, la durée est un MAJORANT (§ plus haut) — donc la
 * puissance calculée est un MINORANT : la vraie borne ne peut être que plus rapide que ce
 * qui est affiché, jamais plus lente. `minimale` porte cette distinction jusqu'à l'écran.
 */
export interface EstimationBorne {
  type: TypeBorne;
  /** Puissance implicite, en kW. Un MINORANT si `minimale` est vrai. */
  puissanceKw: number;
  /** `true` si la fenêtre de temps est elle-même estimée — la puissance réelle est ≥ celle-ci. */
  minimale: boolean;
}

/** Sous ce seuil, une prise domestique standard ; au-delà, du 240 V. */
const SEUIL_NIVEAU2_KW = 2.5;
/** Au-delà, la puissance dépasse ce qu'une installation résidentielle délivre. */
const SEUIL_RAPIDE_KW = 20;

/**
 * Aucun chargeur commercial ne dépasse cet ordre de grandeur. Au-delà, la fenêtre est trop
 * courte pour que le calcul veuille dire quelque chose — mieux vaut ne rien classer qu'un
 * nombre qui a l'air d'une mesure. PURE, testée.
 */
const PUISSANCE_MAX_PLAUSIBLE_KW = 400;

export function estimerBorne(
  session: Pick<SessionCharge, "energieKwh" | "dureeMinutes" | "bornesEstimees">,
): EstimationBorne | null {
  if (session.energieKwh === null || session.dureeMinutes <= 0) return null;

  const puissanceKw = session.energieKwh / (session.dureeMinutes / 60);
  if (puissanceKw > PUISSANCE_MAX_PLAUSIBLE_KW) return null;

  const type: TypeBorne =
    puissanceKw < SEUIL_NIVEAU2_KW
      ? "niveau1"
      : puissanceKw < SEUIL_RAPIDE_KW
        ? "niveau2"
        : "rapide";

  return { type, puissanceKw, minimale: session.bornesEstimees };
}

const LIBELLES_BORNE: Record<TypeBorne, string> = {
  niveau1: "Niveau 1",
  niveau2: "Niveau 2",
  rapide: "Rapide (DC)",
};

/** Résumé court d'une borne — pour une cellule de tableau, pas une phrase. PURE, testée. */
export function libelleEstimationBorne(
  session: Pick<SessionCharge, "energieKwh" | "dureeMinutes" | "bornesEstimees">,
): string {
  const estimation = estimerBorne(session);
  if (!estimation) return "—";
  const prefixe = estimation.minimale ? "≥ " : "";
  return `${prefixe}${LIBELLES_BORNE[estimation.type]} (~${estimation.puissanceKw.toFixed(1)} kW)`;
}

export interface ResumeCharges {
  nbSessions: number;
  energieTotaleKwh: number | null;
  coutTotal: number | null;
  /** Jours écoulés entre la première et la dernière session. */
  fenetreJours: number | null;
  /** Nombre de recharges par semaine, sur la fenêtre observée. */
  parSemaine: number | null;
}

/**
 * Agrégat des sessions. PURE.
 *
 * ⚠️ Les totaux n'additionnent QUE ce qui est connu et le disent : si trois sessions sur
 * dix n'ont pas d'énergie estimable, un total qui les ignore SILENCIEUSEMENT sous-estimerait
 * la consommation en ayant l'air complet. `energieTotaleKwh` vaut donc `null` dès qu'une
 * session manque à l'appel, plutôt que d'annoncer une somme partielle.
 */
export function resumerCharges(sessions: SessionCharge[]): ResumeCharges {
  if (sessions.length === 0) {
    return {
      nbSessions: 0,
      energieTotaleKwh: null,
      coutTotal: null,
      fenetreJours: null,
      parSemaine: null,
    };
  }

  const toutesChiffrees = sessions.every((s) => s.energieKwh !== null);
  const energie = toutesChiffrees
    ? sessions.reduce((total, s) => total + (s.energieKwh ?? 0), 0)
    : null;

  const toutesCoutees = sessions.every((s) => s.coût !== null);
  const cout = toutesCoutees ? sessions.reduce((total, s) => total + (s.coût ?? 0), 0) : null;

  const instants = sessions.map((s) => s.debut.getTime());
  const fenetreJours = (Math.max(...instants) - Math.min(...instants)) / 86_400_000;

  return {
    nbSessions: sessions.length,
    energieTotaleKwh: energie,
    coutTotal: cout,
    fenetreJours,
    // Sous une journée d'observation, une fréquence hebdomadaire serait extrapolée d'un
    // point unique — « 7 recharges par semaine » à partir d'une seule charge d'hier.
    parSemaine: fenetreJours >= 1 ? (sessions.length / fenetreJours) * 7 : null,
  };
}

// ══ ESTIMATION DU TEMPS RESTANT ═════════════════════════════════════════════════════
// Marc, 14/08/2026 : « pour la recharge je veux plus de détail je veux un estimé de temps ».
//
// ⚠️⚠️ **CE BLOC A AFFIRMÉ LE CONTRAIRE JUSQU'AU 18/09/2026, ET ÇA A COÛTÉ UN TICKET.**
// Il disait : « la bZ ne publie NI `charge-ischarging` NI `charge-timetocomplete` (elle ne
// sert que 15 signaux), il n'existe donc aucun temps restant DONNÉ par le véhicule à
// afficher ». Mesuré sur la base réelle : `charge-ischarging` porte **762 valeurs** et
// `charge-timetocomplete` **603**. Les deux sont dans `SIGNAUX_CONFIRMES_BZ` et livrent
// encore aujourd'hui.
//
// Pire : le temps donné par la voiture ÉTAIT DÉJÀ LU ET AFFICHÉ — `statutDeCharge()`
// rend `finAnnoncee` depuis le 20/08, l'accueil la montre et le hub la publie. Un ticket
// (`[CHARGE-TEMPS-REEL]`) a été ouvert le 18/09 sur la foi de CE commentaire, pour un
// défaut qui n'existait pas. **Un ticket écrit d'après un commentaire décrit le PASSÉ du
// commentaire, pas le code.**
//
// Ce qui reste vrai, et c'est la raison d'être de ce bloc : le temps annoncé par la voiture
// n'arrive que PENDANT une charge, et seulement quand elle daigne le publier. L'estimation
// ci-dessous est le REPLI — les deux s'affichent côte à côte, et si elles divergent, Marc
// voit les deux plutôt qu'un seul chiffre faussement sûr (cf. `PLAFOND_RESTANT_MINUTES`).
//
// Extrapoler du RYTHME OBSERVÉ sur les relevés de SOC est légitime — à condition de le
// DIRE, parce que deux choses le rendent approximatif :
//
//   1. La charge RALENTIT en approchant du plein (palier thermique et de tension). Une
//      extrapolation linéaire sous-estime donc toujours le temps au-dessus de ~80 %.
//   2. Les relevés arrivent aux 30-60 min. Un rythme calculé sur deux points espacés d'une
//      heure est une moyenne grossière, pas une puissance instantanée.
//
// D'où `fiabilite` : l'écran affiche la réserve avec le chiffre, jamais après coup.

export type FiabiliteEstimation = "correcte" | "grossiere" | "optimiste";

export interface EstimationFinCharge {
  /** Rythme observé, en points de pourcentage par heure. Toujours > 0. */
  rythmePointsParHeure: number;
  /** Minutes restantes jusqu'à la cible, au rythme observé. */
  minutesRestantes: number;
  /** Instant estimé d'atteinte de la cible. */
  finEstimee: Date;
  /** Cible retenue (limite de charge si connue, sinon 100). */
  ciblePourcent: number;
  socCourant: number;
  fiabilite: FiabiliteEstimation;
  /** Ce que l'estimation ne sait pas — À AFFICHER, pas à garder pour soi. */
  reserves: string[];
}

/** Durée minimale entre deux relevés pour qu'un rythme veuille dire quelque chose. */
export const ECART_MIN_ESTIMATION_MIN = 8;

/**
 * Estime quand la charge atteindra sa cible, à partir des relevés de SOC. PURE.
 *
 * Rend `null` — et c'est le cas le plus fréquent, assumé — dès que la donnée ne porte pas
 * la réponse : moins de deux relevés, écart trop court, SOC qui n'augmente pas, cible déjà
 * atteinte. Un « ~2 h » affiché dans ces cas serait une invention.
 */
export function estimerFinCharge(params: {
  soc: PointSoc[];
  ciblePourcent?: number | null;
  maintenant: Date;
  /** Au-delà, on considère que les relevés ne décrivent plus la charge en cours. */
  fraicheurMaxMinutes?: number;
}): EstimationFinCharge | null {
  const { soc, maintenant, fraicheurMaxMinutes = 90 } = params;
  const cible = params.ciblePourcent ?? 100;

  const points = soc
    .filter((p) => Number.isFinite(p.pourcent) && Number.isFinite(p.t.getTime()))
    .sort((a, b) => a.t.getTime() - b.t.getTime());
  if (points.length < 2) return null;

  const dernier = points[points.length - 1]!;
  // Un relevé vieux de trois heures ne décrit pas la charge en cours : extrapoler dessus
  // annoncerait une fin calculée sur un rythme qui n'existe peut-être plus.
  const ageMin = (maintenant.getTime() - dernier.t.getTime()) / 60_000;
  if (ageMin > fraicheurMaxMinutes) return null;
  if (dernier.pourcent >= cible) return null;

  // Le rythme se mesure sur la MONTÉE la plus récente : on remonte tant que le SOC croît
  // STRICTEMENT. Repartir du tout premier point mêlerait un palier de stationnement à la
  // charge — mesuré : avec `<=`, dix heures garé à 30 % avant une montée de 20 points en
  // une heure donnaient 2 pts/h au lieu de 20, donc une fin annoncée dix fois trop tard.
  //
  // Le risque inverse (deux relevés ÉGAUX en pleine charge coupent la fenêtre trop tôt)
  // est le bon sens de l'erreur : il raccourcit la mesure, ce que la réserve « écart trop
  // court » dit déjà à l'écran, au lieu de fabriquer un rythme qui n'a jamais existé.
  let debut = points.length - 1;
  while (debut > 0 && points[debut - 1]!.pourcent < points[debut]!.pourcent) debut -= 1;
  const premier = points[debut]!;

  const ecartMin = (dernier.t.getTime() - premier.t.getTime()) / 60_000;
  const gain = dernier.pourcent - premier.pourcent;
  if (ecartMin < ECART_MIN_ESTIMATION_MIN || gain <= 0) return null;

  const rythme = (gain / ecartMin) * 60;
  const minutesRestantes = ((cible - dernier.pourcent) / rythme) * 60;
  if (!Number.isFinite(minutesRestantes) || minutesRestantes <= 0) return null;

  const reserves: string[] = [];
  let fiabilite: FiabiliteEstimation = "correcte";

  // Le palier haut : c'est la réserve qui compte le plus, et elle va toujours dans le même
  // sens — la vraie fin arrivera PLUS TARD que l'estimation, jamais plus tôt.
  if (cible > 80 && dernier.pourcent < cible) {
    fiabilite = "optimiste";
    reserves.push(
      "La charge ralentit au-dessus de 80 % : la fin réelle sera plus tardive que l’estimation, pas plus tôt.",
    );
  }
  if (ecartMin < 25) {
    if (fiabilite === "correcte") fiabilite = "grossiere";
    reserves.push(
      `Rythme calculé sur ${Math.round(ecartMin)} min d’écart seulement — c’est une moyenne grossière, pas une puissance instantanée.`,
    );
  }
  if (ageMin > 45) {
    if (fiabilite === "correcte") fiabilite = "grossiere";
    reserves.push(
      `Dernier relevé il y a ${Math.round(ageMin)} min : la voiture a pu débrancher depuis.`,
    );
  }
  reserves.push(
    "Estimation déduite des relevés d’état de charge — la bZ ne publie pas de temps restant.",
  );

  return {
    rythmePointsParHeure: rythme,
    minutesRestantes,
    finEstimee: new Date(maintenant.getTime() + minutesRestantes * 60_000),
    ciblePourcent: cible,
    socCourant: dernier.pourcent,
    fiabilite,
    reserves,
  };
}

export type EtatBandeauCharge =
  | { mode: "estimation"; estimation: EstimationFinCharge }
  /** Le SOC monte mais l'estimation refuse (écart trop court, etc.) : on DIT la charge. */
  | { mode: "en-charge"; socCourant: number; gainPoints: number; depuis: Date; dernierReleve: Date }
  /** La montée s'est terminée AU niveau de la cible : la charge est faite. */
  | { mode: "limite"; socCourant: number; ciblePourcent: number; dernierReleve: Date };

/**
 * Ce que le bandeau « charge » de l'accueil a le droit d'affirmer. PURE, testée.
 *
 * ⚠️ POURQUOI CE N'EST PAS SEULEMENT `estimerFinCharge` (Marc, 18/08 : « je suis en
 * charge depuis des heures, ça affiche pas ») : l'estimation refuse honnêtement dès que
 * le SOC ne monte plus — donc une charge ARRIVÉE À SA LIMITE depuis des heures, ou une
 * montée trop courte pour mesurer un rythme, n'affichait RIEN. Le bandeau doit pouvoir
 * dire « en charge » et « chargée à la limite » SANS inventer d'heure de fin.
 *
 * Ce qui reste refusé : affirmer quoi que ce soit sur des relevés périmés
 * (`fraicheurMaxMinutes`) — un badge de fraîcheur séparé dit déjà que les données datent.
 */
export function etatBandeauCharge(params: {
  soc: PointSoc[];
  ciblePourcent?: number | null;
  maintenant: Date;
  fraicheurMaxMinutes?: number;
}): EtatBandeauCharge | null {
  const { soc, maintenant, fraicheurMaxMinutes = 90 } = params;

  const estimation = estimerFinCharge(params);
  if (estimation) return { mode: "estimation", estimation };

  const points = soc
    .filter((p) => Number.isFinite(p.pourcent) && Number.isFinite(p.t.getTime()))
    .sort((a, b) => a.t.getTime() - b.t.getTime());
  if (points.length < 2) return null;

  const dernier = points[points.length - 1]!;
  const ageMin = (maintenant.getTime() - dernier.t.getTime()) / 60_000;
  if (ageMin > fraicheurMaxMinutes) return null;

  // « À la limite » n'exige PAS de montée récente : une charge finie il y a des heures
  // laisse un SOC STABLE au niveau de la limite, et c'est exactement le cas qui restait
  // muet. On n'affirme que deux mesures (SOC ≥ limite CONFIGURÉE) — jamais « branchée »,
  // que la voiture ne publie pas. Sans limite mesurée, ce mode n'existe pas (un 100 %
  // stable se lit déjà sur la jauge).
  const cible = params.ciblePourcent ?? null;
  if (cible !== null && dernier.pourcent >= cible) {
    return {
      mode: "limite",
      socCourant: dernier.pourcent,
      ciblePourcent: cible,
      dernierReleve: dernier.t,
    };
  }

  // La montée la plus récente, même courte — la même fenêtre qu'`estimerFinCharge`.
  let debut = points.length - 1;
  while (debut > 0 && points[debut - 1]!.pourcent < points[debut]!.pourcent) debut -= 1;
  const gain = dernier.pourcent - points[debut]!.pourcent;
  if (gain <= 0) return null;

  return {
    mode: "en-charge",
    socCourant: dernier.pourcent,
    gainPoints: gain,
    depuis: points[debut]!.t,
    dernierReleve: dernier.t,
  };
}

// ══ LE STATUT DE CHARGE, LU DIRECTEMENT ═══════════════════════════════════════════════
//
// Marc, 20/08 : « dans accueil je veux voir si le véhicule est en charge ou non ».
//
// ⚠️ Ce n'est PAS ce que fait `etatBandeauCharge` : celui-là DÉDUIT la charge du SOC qui
// monte, et il se tait dès que rien ne monte — donc quand la voiture ne charge pas, quand
// elle est au palier, ou quand deux relevés manquent. « Ça n'affiche rien » ne répond pas
// à « est-ce qu'elle charge ». La bZ publie pourtant le fait DIRECTEMENT :
//   • `charging_status`        — booléen, la charge est-elle en cours ;
//   • `charging_status_detail` — le mot de la voiture (`CHARGING`, …) ;
//   • `charge_plugged_in`      — le câble est-il branché.
//
// Le troisième change tout pour Marc : il a des MINUTERIES de charge (relevées le 20/08 :
// 08:00→00:00, 13:00→17:00, 18:15→06:40). « Branchée mais pas en charge » est donc un état
// NORMAL et fréquent chez lui, à ne surtout pas confondre avec « débranchée ».

export type ModeStatutCharge =
  /** La voiture le dit : la charge est en cours. */
  | "en-charge"
  /** Câble branché, charge à l'arrêt — typiquement une minuterie qui n'a pas ouvert. */
  | "branchee-en-attente"
  /** Pas en charge, câble débranché : les DEUX signaux sont là et concordent. */
  | "debranchee"
  /**
   * Pas en charge, et on ne sait pas si le câble est branché. ⚠️ Ce mode existe pour ne
   * PAS dire « débranchée » quand on l'ignore : ce serait affirmer un fait qu'aucun relevé
   * ne porte, dans une app dont la règle est de ne rien inventer.
   */
  | "pas-en-charge"
  /** La voiture ne publie pas le signal. On ne devine pas. */
  | "inconnu";

export interface StatutCharge {
  mode: ModeStatutCharge;
  /** Le mot brut de la voiture (`CHARGING`…), quand elle en donne un. */
  detail: string | null;
  /** Âge du relevé qui fonde le statut. `null` en `inconnu` sans aucun relevé. */
  ageMinutes: number | null;
  /**
   * `true` quand le relevé est plus vieux que la fenêtre : on rend quand même le dernier
   * état CONNU, mais l'appelant doit le formuler au passé. Se taire serait pire — « rien
   * à l'écran » est précisément ce que Marc signale.
   */
  perime: boolean;
  /**
   * La fin de charge ANNONCÉE PAR LA VOITURE (`charge_time_remaining`). `null` hors charge
   * — cette valeur ne veut alors rien dire (cf. `METRIQUES_DE_SESSION_DE_CHARGE`).
   */
  finAnnoncee: FinAnnoncee | null;
}

export interface FinAnnoncee {
  /** Instant de fin, calculé depuis le RELEVÉ — surtout pas depuis « maintenant ». */
  instant: Date;
  minutesRestantes: number;
  /** Âge du relevé qui porte le compte à rebours. */
  ageMinutes: number;
}

/**
 * ⚠️ `charge_time_remaining` arrive SANS UNITÉ (`unit: null`), et ce projet s'interdit de
 * deviner une unité. Elle est ici tranchée par l'ARITHMÉTIQUE, sur des mesures réelles du
 * 20/08 : batterie à 70 % d'une capacité de 57,7 kWh, valeur annoncée 250. Il reste donc
 * ~17 kWh à mettre ; sur une borne domestique de ~3,7 kW cela prend ~4,7 h. 250 MINUTES
 * font 4 h 10 — l'ordre de grandeur colle. 250 secondes feraient 4 minutes (impossible)
 * et 250 heures, dix jours (absurde). La lecture en minutes est donc la seule tenable.
 *
 * Le doute résiduel est ASSUMÉ ET DIT à l'écran (« annoncé par la voiture »), et le rythme
 * mesuré depuis le niveau de charge reste affiché à côté : si les deux divergent, Marc voit
 * les deux plutôt qu'un seul chiffre faussement sûr.
 */
const PLAFOND_RESTANT_MINUTES = 48 * 60;

/** Au-delà, un statut ne s'affirme plus au présent. La bZ publie aux 30-60 min. */
export const FRAICHEUR_STATUT_MINUTES = 90;

interface MesureStatut {
  metricType: string;
  valueNumeric: number | null;
  valueText: string | null;
  ageMinutes: number;
  /** Instant de la mesure. Sans lui, aucune fin ne peut être annoncée (on ne la déduit
      JAMAIS de « maintenant » : un relevé d'il y a une heure décalerait la fin d'autant). */
  recordedAt?: Date;
}

/** `true` / `false` / `null` selon ce que porte la mesure. PURE. */
function booleenDe(m: MesureStatut | undefined): boolean | null {
  if (!m) return null;
  if (m.valueNumeric !== null) return m.valueNumeric !== 0;
  if (m.valueText !== null) {
    const t = m.valueText.trim().toLowerCase();
    if (t === "true" || t === "false") return t === "true";
  }
  return null;
}

/**
 * Le statut de charge de la voiture, tel qu'ELLE le déclare. PURE, testée.
 *
 * Ne déduit rien du SOC : c'est le rôle d'`etatBandeauCharge`, qui reste le DÉTAIL
 * (rythme, fin estimée) affiché par-dessus. Deux sources, deux responsabilités — et si
 * elles se contredisent, l'écran montre les deux plutôt que d'en cacher une.
 */
export function statutDeCharge(
  mesures: ReadonlyArray<MesureStatut>,
  fraicheurMaxMinutes = FRAICHEUR_STATUT_MINUTES,
): StatutCharge {
  const plusRecente = (type: string) =>
    mesures
      .filter((m) => m.metricType === type)
      .sort((a, b) => a.ageMinutes - b.ageMinutes)[0];

  const statut = plusRecente("charging_status");
  const branche = plusRecente("charge_plugged_in");
  const enCours = booleenDe(statut);
  const estBranche = booleenDe(branche);

  const detailBrut = plusRecente("charging_status_detail")?.valueText?.trim() ?? null;
  const detail = detailBrut && detailBrut.length > 0 ? detailBrut : null;

  // L'âge qui compte est celui de la mesure qui FONDE le mode annoncé — pas le plus
  // frais des deux : afficher « il y a 7 min » sous un statut vieux d'une heure mentirait.
  // Aucun `charging_status` exploitable : le câble seul ne dit PAS si ça charge.
  if (enCours === null || statut === undefined) {
    return {
      mode: "inconnu",
      detail,
      ageMinutes: statut?.ageMinutes ?? null,
      perime: false,
      finAnnoncee: null,
    };
  }

  const rendre = (mode: ModeStatutCharge, ageMinutes: number): StatutCharge => ({
    mode,
    detail,
    ageMinutes,
    perime: ageMinutes > fraicheurMaxMinutes,
    // Hors charge, le compte à rebours de la voiture est un reste figé de la session
    // précédente : il n'est JAMAIS publié en dehors de la branche « en charge ».
    finAnnoncee: null,
  });

  if (enCours) {
    const base = rendre("en-charge", statut.ageMinutes);
    return { ...base, finAnnoncee: finDeCharge(plusRecente("charge_time_remaining")) };
  }

  // Pas en charge. L'âge annoncé couvre les DEUX relevés qui fondent la conclusion — le
  // plus vieux des deux, sinon on afficherait une fraîcheur que le raisonnement n'a pas.
  if (estBranche !== null && branche !== undefined) {
    const age = Math.max(statut.ageMinutes, branche.ageMinutes);
    return rendre(estBranche ? "branchee-en-attente" : "debranchee", age);
  }
  return rendre("pas-en-charge", statut.ageMinutes);
}

/**
 * La fin annoncée par la voiture, à partir de son compte à rebours. PURE.
 *
 * Refuse tout ce qui ne peut pas être vrai : pas de relevé, pas d'instant de mesure, valeur
 * non finie, ≤ 0 (une charge finie ne « reste » pas), ou au-delà de deux jours (aucune
 * charge domestique ne dure ça — au-delà, c'est une valeur qu'on ne sait pas lire).
 */
function finDeCharge(m: MesureStatut | undefined): FinAnnoncee | null {
  if (!m || m.recordedAt === undefined) return null;
  const minutes = m.valueNumeric;
  if (minutes === null || !Number.isFinite(minutes)) return null;
  if (minutes <= 0 || minutes > PLAFOND_RESTANT_MINUTES) return null;
  return {
    // Depuis le RELEVÉ : « il reste 250 min » a été dit à ce moment-là, pas maintenant.
    instant: new Date(m.recordedAt.getTime() + minutes * 60_000),
    minutesRestantes: minutes,
    ageMinutes: m.ageMinutes,
  };
}
