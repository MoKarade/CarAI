// lib/mcp/outils.ts — ce que Claude peut DEMANDER à CarAI. Le catalogue et les réponses.
//
// Demande de Marc (19/08/2026) : « je veux un connecteur MCP à l'app pour que Claude ait
// toutes les infos de ma voiture ».
//
// ══ TROIS RÈGLES QUI GOUVERNENT CE FICHIER ═══════════════════════════════════════════
//
// 1. LECTURE SEULE. Aucun outil ne pilote la voiture. Verrouiller, démarrer une charge,
//    changer une limite : ces gestes existent dans l'app, derrière l'appui maintenu et
//    `autoriserCommande`. Les exposer ici ajouterait une surface d'action à distance —
//    c'est une décision à prendre séparément, pas un effet de bord de « donner les infos ».
//    Verrouillé par `tests/mcp.test.ts`.
//
// 2. AUCUN CALCUL NEUF. Chaque réponse vient des fonctions PURES qui alimentent déjà les
//    écrans (`decouperTrajets`, `reconstituerCharges`, `calculerEtatBail`…). Deux
//    implémentations de la même vérité divergent toujours, et c'est la plus pauvre qui
//    finit par gagner — ici, Claude dirait autre chose que l'écran de Marc.
//
// 3. LA POSITION EXACTE NE SORT PAS. Le domicile et le lieu de travail de Marc ne partent
//    pas vers un service tiers sous forme de coordonnées : `nommerEndroit` rend le NOM du
//    lieu quand il est connu (« Maison », « Travail ») et, sinon, des coordonnées
//    ARRONDIES à ~1 km. C'est assez pour raisonner sur un trajet, pas assez pour désigner
//    une porte d'entrée. Même esprit que la règle des lieux côté écran.

import { lireBail, lireLieux, type Lieu } from "@/lib/config";
import {
  MESSAGE_BAIL_NON_RENSEIGNE,
  calculerEtatBail,
  libelleDepassementProjete,
  resumerBail,
} from "@/lib/vehicle/lease";
import { historiqueOdometre } from "@/lib/vehicle/history";
import { historiquePositions } from "@/lib/vehicle/position";
import { decouperTrajets, trajetsDansLaFenetre, type Trajet } from "@/lib/vehicle/trajets";
import { LIMITE_HISTORIQUE_COMPLET, serieEtat, serieNumerique } from "@/lib/vehicle/analyse";


import { estVrai } from "@/lib/vehicle/alertes";
import {
  estimerBorne,
  reconstituerCharges,
  type PointCharge,
  type PointSoc,
  type SessionCharge,
} from "@/lib/vehicle/charges";
import {
  lieuDeLaPosition,
  positionPendant,
  prixSession,
  totaliserPrix,
} from "@/lib/vehicle/tarifsBornes";
import { lireEtatVehicule, libelle } from "@/lib/vehicle/state";
import { depuisPourPeriode } from "@/lib/vehicle/mesures";
import { derniereLivraison } from "@/lib/smartcar/ingest";
import { passagesRecents } from "@/lib/vehicle/pollJournal";
import { analyserCadence, consequenceCadence, graviteCadence } from "@/lib/vehicle/cadence";
import { capaciteBatterieKwh } from "@/lib/vehicle/capacite";
import { inventaireMesures } from "@/lib/vehicle/inventaire";

/** Marge de lecture des positions : l'ancre d'un trajet du matin est la veille au soir. */
const MARGE_ANCRAGE_JOURS = 2;

/** Périodes acceptées par les outils. Mêmes clés que les écrans — un seul vocabulaire. */
export const PERIODES_MCP = ["24h", "7j", "30j", "tout"] as const;

/**
 * Nomme un endroit sans livrer son adresse. PURE.
 *
 * ⚠️ Le NOM d'abord (« Maison »), et sinon des coordonnées arrondies à 2 décimales —
 * ~1 km. Un trajet reste lisible (« Maison → Québec »), mais aucune coordonnée précise
 * du domicile de Marc ne part vers un service tiers. Ne pas « améliorer » la précision
 * ici sans reprendre cette décision : c'est le garde-fou, pas un détail d'affichage.
 */
export function nommerEndroit(point: { lat: number; lng: number }, lieux: Lieu[]): string {
  const lieu = lieuDeLaPosition(point, lieux);
  if (lieu) return lieu.nom;
  return `~${point.lat.toFixed(2)}, ${point.lng.toFixed(2)}`;
}

/**
 * Le nom d'un endroit quand la position peut MANQUER. PURE.
 *
 * ⚠️ Pourquoi ça existe, plutôt qu'un repli au site d'appel : les recharges annonçaient
 * « ~0.00, 0.00 » — le point nul au large du golfe de Guinée — parce que l'appelant
 * remplaçait une position absente par `{ lat: 0, lng: 0 }`. Deux sessions sur quinze en
 * portaient la marque le 17/09. Une coordonnée fabriquée n'est pas seulement illisible :
 * elle ENTRE dans `lieuDeLaPosition`, donc un lieu enregistré près de (0, 0) se verrait
 * attribuer des sessions qui n'y ont jamais eu lieu.
 *
 * ⚠️ Deux lignes du même fichier traitaient déjà ce `null` de deux façons : le PRIX le
 * passait tel quel et répondait honnêtement « ni lieu connu », le NOM fabriquait un point.
 * D'où le symptôme, qui se lisait comme une contradiction — un lieu affiché à côté d'un
 * prix qui disait ne pas en connaître.
 */
export function nommerEndroitSiConnu(
  point: { lat: number; lng: number } | null,
  lieux: Lieu[],
): string | null {
  return point ? nommerEndroit(point, lieux) : null;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** L'état courant, tel que l'écran d'accueil le lit. */
async function etatVehicule(): Promise<unknown> {
  const etat = await lireEtatVehicule();
  if (etat.vide) {
    return {
      statut: "aucune_donnee",
      explication:
        "Aucune mesure du véhicule en base. Ce n'est pas une panne de CarAI : le véhicule n'a rien publié, ou il n'est pas connecté à Smartcar.",
    };
  }
  return {
    statut: "ok",
    fraicheur: {
      derniereMesure: iso(etat.fraicheurMax),
      explication:
        "Instant de la MESURE côté véhicule, jamais de sa réception. La bZ se rafraîchit aux 30-60 min : un âge de cet ordre est normal.",
    },
    sources: etat.sources,
    /** Métriques auxquelles CarAI est abonné mais que la voiture ne fournit pas. */
    metriquesSansValeur: etat.mesures.filter(
      (m) => m.valueNumeric === null && m.valueText === null && m.valueJson == null,
    ).length,
    mesures: etat.mesures
      // ⚠️ Une mesure sans AUCUNE valeur n'apprend rien : la voiture a répondu « je ne
      // fournis pas ça ». En publier soixante noyait les vingt qui parlent vraiment, et un
      // lecteur pouvait conclure « la voiture ne dit rien » de ce qui n'est qu'un abonnement
      // trop large (décision de Marc, 19/08). Le nombre d'omissions est publié juste
      // au-dessus : une omission qu'on ne compte pas est un mensonge par soustraction.
      .filter((m) => m.valueNumeric !== null || m.valueText !== null || m.valueJson != null)
      .map((m) => ({
      metrique: m.metricType,
      libelle: libelle(m.metricType),
      source: m.source,
      mesureLe: iso(m.recordedAt),
      ageMinutes: Math.round(m.ageMinutes),
      valeurNumerique: m.valueNumeric,
      valeurTexte: m.valueText,
      unite: m.unit,
      // ⚠️ Une position ne sort JAMAIS en clair, même ici : c'est le point d'entrée le
      // plus direct vers l'adresse du domicile.
      valeurStructuree: m.metricType === "location" ? "position (non communiquée)" : m.valueJson,
      interpretationFiable: m.interpretationFiable,
      // ⚠️ La RAISON compte autant que le drapeau : un lecteur qui voit `false` sans savoir
      // pourquoi choisit au hasard entre « ignorer » et « afficher quand même ». C'est ce
      // champ qui empêche un assistant d'annoncer « il reste 250 de charge » sur une
      // voiture débranchée (constaté le 19/08 au premier usage réel du connecteur).
      raisonInterpretation: m.raisonInterpretation,
    })),
  };
}

/** Les trajets d'une période, avec leurs endroits NOMMÉS. */
async function trajets(periode: string): Promise<unknown> {
  const maintenant = new Date();
  const depuis = depuisPourPeriode(periode, maintenant);
  const depuisLecture = depuis
    ? new Date(depuis.getTime() - MARGE_ANCRAGE_JOURS * 86_400_000)
    : null;

  const [positions, odo, lieux] = await Promise.all([
    historiquePositions({ depuis: depuisLecture }),
    historiqueOdometre({ granularite: "brut" }),
    lireLieux(),
  ]);

  const liste = trajetsDansLaFenetre(
    decouperTrajets(positions, { historiqueOdometre: odo }),
    depuis,
  );

  return {
    periode,
    nbTrajets: liste.length,
    kmTotal: Math.round(liste.reduce((s, t) => s + t.distanceKm, 0)),
    trajets: liste.map((t: Trajet) => ({
      debut: iso(t.debut),
      fin: iso(t.fin),
      depart: nommerEndroit(t.depart, lieux),
      arrivee: nommerEndroit(t.arrivee, lieux),
      km: Math.round(t.distanceKm * 10) / 10,
      // Une distance ESTIMÉE vient des relevés GPS en ligne droite : c'est un MINORANT.
      kmEstime: t.distanceEstimee,
      dureeMinutes: Math.round(t.dureeMinutes),
      // ⚠️ Une durée « fenêtre » englobe le temps garé : ce n'est PAS un temps de conduite.
      dureeEstFenetre: t.dureeEstFenetre,
      nbReleves: t.points.length,
    })),
    limites: [
      "Une distance marquée estimée vient des relevés GPS reliés en ligne droite : la vraie est plus grande.",
      "Une durée marquée « fenêtre » englobe le temps stationné, ce n'est pas un temps de conduite.",
      "Les endroits sont nommés quand ils correspondent à un lieu enregistré ; sinon les coordonnées sont arrondies à environ 1 km, volontairement.",
    ],
  };
}

/** Les recharges d'une période, avec leurs coûts — la MÊME chaîne que l'écran Activité. */
async function recharges(periode: string): Promise<unknown> {
  const maintenant = new Date();
  const depuis = depuisPourPeriode(periode, maintenant);
  const depuisLecture = depuis ? new Date(depuis.getTime() - 86_400_000) : null;

  const [etatsSerie, socSerie, odo, positions, lieux, termes, etat] = await Promise.all([
    serieEtat("charging_status", { depuis: depuisLecture }),
    // ⚠️ Sans date de départ, on lit tout l'historique — la borne est IMPORTÉE, pas
    // recopiée : Claude et l'écran doivent répondre le même cumul à la même question
    // (`CLAUDE.md` §9 : « aucun calcul neuf, sinon Claude et l'écran diraient deux choses
    // différentes »).
    serieNumerique("battery_soc", {
      depuis: depuisLecture,
      limite: depuisLecture === null ? LIMITE_HISTORIQUE_COMPLET : undefined,
    }),
    historiqueOdometre({ granularite: "brut" }),
    historiquePositions({ depuis: depuisLecture }),
    lireLieux(),
    lireBail(),
    lireEtatVehicule(),
  ]);

  // ⚠️ JAMAIS `?.valueNumeric` : la bZ publie sa capacité en JSON, pas en numérique.
  const capacite = capaciteBatterieKwh(etat);

  const etatsCharge: PointCharge[] = etatsSerie.changements.map((c) => ({
    t: c.t,
    enCharge: estVrai(c.valeur),
  }));
  const socs: PointSoc[] = socSerie.points.map((p) => ({ t: p.t, pourcent: p.valeur }));

  const toutes = reconstituerCharges({
    etatsCharge,
    socs,
    historiqueOdometre: odo,
    capaciteKwh: capacite,
    tarifKwh: termes?.tarifKwh ?? null,
  });
  const dansLaFenetre = depuis
    ? toutes.filter((s) => s.debut.getTime() >= depuis.getTime())
    : toutes;

  const prix = dansLaFenetre.map((s: SessionCharge) =>
    prixSession({
      dureeMinutes: s.dureeMinutes,
      energieKwh: s.energieKwh,
      lieu: lieuDeLaPosition(positionPendant(s, positions), lieux),
      tarifKwh: termes?.tarifKwh ?? null,
      // ⚠️ Le MÊME calcul que les écrans, jamais un second : le connecteur MCP réutilise
      // les fonctions pures de l'app, sinon Claude et l'écran diraient deux prix.
      puissanceKw: estimerBorne(s)?.puissanceKw ?? null,
      // Une borne horaire multiplie ce temps : si les bornes sont des fenêtres de
      // sondage, le montant est un PLAFOND et le dit.
      bornesEstimees: s.bornesEstimees,
    }),
  );
  const totaux = totaliserPrix(prix);

  return {
    periode,
    nbSessions: dansLaFenetre.length,
    // ⚠️ Mesuré et estimé ne s'additionnent JAMAIS : un tarif relevé et un tarif de table
    // ne valent pas la même chose, et un total unique effacerait la différence.
    coutMesureCad: Math.round(totaux.mesure * 100) / 100,
    coutEstimeCad: Math.round(totaux.estime * 100) / 100,
    nbSansPrix: totaux.nbInconnus,
    sessions: dansLaFenetre.map((s, i) => ({
      debut: iso(s.debut),
      fin: iso(s.fin),
      dureeMinutes: Math.round(s.dureeMinutes),
      socDebut: s.socDebut,
      socFin: s.socFin,
      // Toujours estimée : la bZ ne publie pas l'énergie réellement livrée.
      energieKwhEstimee: s.energieKwh === null ? null : Math.round(s.energieKwh * 10) / 10,
      // `null` quand aucune position n'encadre la session — jamais un point fabriqué.
      lieu: nommerEndroitSiConnu(positionPendant(s, positions), lieux),
      coutCad: prix[i]!.montant,
      qualitePrix: prix[i]!.qualite,
      explicationPrix: prix[i]!.explication,
    })),
    limites: [
      "L'énergie est toujours DÉDUITE de l'état de charge : la bZ ne publie pas les kWh livrés.",
      "Les coûts mesurés et estimés sont donnés séparément et ne doivent pas être additionnés.",
    ],
  };
}

/** Le bail : où en est le kilométrage, et ce que la projection sait vraiment dire. */
async function bail(): Promise<unknown> {
  const [termes, odo] = await Promise.all([
    lireBail(),
    historiqueOdometre(),
  ]);
  // Aucun terme en base (ils ne sont plus dans le code) : on le dit, on ne chiffre rien.
  if (!termes) return { resume: MESSAGE_BAIL_NON_RENSEIGNE, renseigne: false };
  const etat = calculerEtatBail({ bail: termes, historiqueOdometre: odo, maintenant: new Date() });
  return {
    resume: resumerBail(etat),
    kilometrageActuel: etat.kilometrageActuel,
    mesureLe: iso(etat.kilometrageMesureLe),
    allocationTotale: etat.allocationTotale,
    debut: iso(etat.debutBail),
    fin: iso(etat.finBail),
    // En dollars seulement si le tarif est renseigné et qu'un dépassement est projeté : c'est
    // une ESTIMATION (elle découle d'une projection), le libellé le dit.
    ...(libelleDepassementProjete(etat) !== null && {
      depassementProjeteKm: etat.depassementProjete,
      coutDepassementProjete: etat.coutDepassementProjete,
      devise: etat.devise,
      coutDepassement: libelleDepassementProjete(etat),
    }),
    // ⚠️ Les LIMITES disent ce que ce calcul ne sait pas. Les ignorer donnerait une
    // projection qui a l'air sûre alors qu'elle repose sur une fenêtre trop courte.
    limites: etat.limites,
  };
}

/** La santé du canal de données — « pourquoi l'écran ne bouge plus » se répond ici. */
async function sante(): Promise<unknown> {
  const [livraison, passages] = await Promise.all([derniereLivraison(), passagesRecents(24)]);
  const cadence = analyserCadence({ passages, maintenant: new Date() });
  return {
    derniereLivraisonWebhook: iso(livraison),
    poll: {
      gravite: graviteCadence(cadence),
      consequence: consequenceCadence(cadence),
      aucunHistorique: cadence.aucunHistorique,
    },
    explication:
      "Le webhook ne se déclenche qu'au CHANGEMENT : son silence est normal quand la voiture ne bouge pas. C'est le poll qui garantit un rafraîchissement régulier — ses passages sautés font disparaître trajets et recharges.",
  };
}

export interface OutilMcp {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  executer: (args: Record<string, unknown>) => Promise<unknown>;
}

const schemaPeriode = {
  type: "object" as const,
  properties: {
    periode: {
      type: "string",
      enum: [...PERIODES_MCP],
      description: "Fenêtre de temps. Défaut : 7j.",
    },
  },
};

const periodeDe = (args: Record<string, unknown>): string =>
  typeof args.periode === "string" && (PERIODES_MCP as readonly string[]).includes(args.periode)
    ? args.periode
    : "7j";

/**
 * Le catalogue. ⚠️ LECTURE SEULE — aucune entrée ne doit piloter le véhicule.
 * `tests/mcp.test.ts` refuse tout nom qui ressemble à une commande.
 */
/**
 * Combien de mesures par métrique, et combien portent une VALEUR.
 *
 * ⚠️ POURQUOI CET OUTIL EXISTE (Marc, 19/08 : « vérifie si ces data fonctionnent ou pas »).
 * `etat_vehicule` ne montre que la DERNIÈRE valeur de chaque métrique. Une métrique qui
 * répond « rien » aujourd'hui peut avoir livré des chiffres pendant des semaines, et
 * l'inverse est vrai aussi : une ligne existe à chaque livraison même quand la voiture
 * n'a rien à dire. Conclure « ça ne marche pas » d'un instantané, c'est exactement le
 * raccourci que ce projet s'interdit — d'où le COMPTE, qui tranche.
 *
 * `nbValeurs` est le chiffre à lire : il compte les lignes portant un nombre, un texte ou
 * un JSON. `nbMesures - nbValeurs` = ce que la voiture a refusé de dire.
 */
async function inventaire() {
  const lignes = await inventaireMesures();
  return {
    explication:
      "nbValeurs = lignes portant une valeur exploitable. nbMesures = lignes reçues, valeur ou pas. Une métrique à nbValeurs 0 n'a JAMAIS rien livré, même si elle apparaît partout.",
    metriques: lignes
      .map((l) => ({
        metrique: l.metricType,
        libelle: libelle(l.metricType),
        source: l.source,
        signal: l.signalCode,
        nbMesures: l.nbMesures,
        nbValeurs: l.nbValeurs,
        premiere: l.premiere.toISOString(),
        derniere: l.derniere.toISOString(),
      }))
      // Les muettes d'abord : ce sont elles qu'on cherche quand on pose la question.
      .sort((a, b) => a.nbValeurs - b.nbValeurs || a.metrique.localeCompare(b.metrique)),
  };
}

export const OUTILS: OutilMcp[] = [
  {
    name: "etat_vehicule",
    description:
      "État courant de la Toyota bZ de Marc : charge, autonomie, odomètre, verrouillage, ouvrants, pneus, avec la fraîcheur de chaque mesure. La position n'est pas communiquée.",
    inputSchema: { type: "object", properties: {} },
    executer: () => etatVehicule(),
  },
  {
    name: "trajets",
    description:
      "Trajets reconstitués sur une période : départ, arrivée, distance, durée. Les endroits sont nommés quand ils correspondent à un lieu enregistré, sinon arrondis à ~1 km.",
    inputSchema: schemaPeriode,
    executer: (args) => trajets(periodeDe(args)),
  },
  {
    name: "recharges",
    description:
      "Sessions de recharge sur une période, avec l'énergie déduite de l'état de charge et les coûts (mesurés et estimés séparément).",
    inputSchema: schemaPeriode,
    executer: (args) => recharges(periodeDe(args)),
  },
  {
    name: "bail",
    description:
      "État du bail : kilométrage actuel, allocation, dates, les limites de la projection et, si le tarif du km excédentaire est renseigné et qu'un dépassement est projeté, son coût estimé en dollars.",
    inputSchema: { type: "object", properties: {} },
    executer: () => bail(),
  },
  {
    name: "inventaire_donnees",
    description:
      "Compte, par métrique, combien de mesures la base contient et combien portent réellement une valeur. À utiliser pour savoir si un signal FONCTIONNE — l'état courant ne montre que la dernière valeur, qui peut être vide sans que le signal soit mort.",
    inputSchema: { type: "object", properties: {} },
    executer: () => inventaire(),
  },
  {
    name: "sante_donnees",
    description:
      "Santé du canal de données (webhook Smartcar et poll périodique) — à consulter quand les chiffres semblent figés.",
    inputSchema: { type: "object", properties: {} },
    executer: () => sante(),
  },
];

export function outilParNom(nom: string): OutilMcp | null {
  return OUTILS.find((o) => o.name === nom) ?? null;
}
