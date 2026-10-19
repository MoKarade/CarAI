// lib/hubSummary.ts — construction du summary publié au hub perso. FONCTION PURE.
//
// Prend un instantané de l'état de CarAI et rend un `HubSummary` conforme au contrat. Pure
// pour être testable sans base : c'est ce qui permet de vérifier « aucune donnée ⇒ status
// building » sans monter un Postgres.
//
// ── LES DEUX RÈGLES DU HUB QUI SE PAIENT COMPTANT ────────────────────────────────────
//
// 1. `dataAsOf` ≠ `generatedAt`. `generatedAt` c'est « quand j'ai fabriqué cette réponse »
//    (toujours maintenant) ; `dataAsOf` c'est « quand la DONNÉE a été rafraîchie ». Sans le
//    second, le hub ne peut pas distinguer un véhicule à jour d'un véhicule dont les
//    données sont figées depuis trois jours — et pour CarAI, dont la source se rafraîchit
//    aux 30-60 min et peut se taire sans bruit, c'est précisément l'information critique.
//
// 2. Pas de bloc `usage`. CarAI n'a AUCUN coût mesuré : le plan Smartcar est gratuit
//    (1 véhicule), il n'y a pas d'appel LLM. Publier `amount: 0` affirmerait un suivi de
//    coût qui n'existe pas ; omettre le bloc fait afficher « non suivi », ce qui est vrai.

import {
  CONTRACT_VERSION,
  validateSummary,
  type HubAlert,
  type HubDetailItem,
  type HubDetailSection,
  type HubMetric,
  type HubSummary,
} from "@mokarade/hub-contract";
import type { EtatBail } from "./vehicle/lease";
import { avanceSurLeBail, resumerBail } from "./vehicle/lease";
import { FRAICHEUR_STATUT_MINUTES, type StatutCharge } from "./vehicle/charges";
import { interpreterPourcentage } from "./smartcar/signals";
import { FENETRE_KM_JOURS, type KmSurFenetre } from "./vehicle/bilan";
import type { PaiementsBail } from "./vehicle/paiementsBail";
import { messageBail } from "./vehicle/messageBail";
import type { LectureBail } from "./financeai/bail";

export const APP: HubSummary["app"] = {
  // ⚠️ Doit rester IDENTIQUE à l'entrée `id` de `lib/sources.ts` côté Hubperso.
  id: "carai",
  name: "CarAI",
  url: "https://carai.hubperso.com",
  /**
   * Rose profond — teinte 333°, choisie pour être DISTINGUABLE des quatre autres cartes du
   * hub, qui s'affichent côte à côte dans la même grille.
   *
   * Teintes déjà occupées : BatchChef 17° (orange brûlé), JobAI 38° (ambre), FinanceAI 175°
   * (sarcelle), DriveAI 217° (bleu clair). Deux zones restaient libres — les verts et les
   * magentas. Le VERT a été écarté après mesure : le précédent `#2f9e6e` tombait à 21° du
   * sarcelle de FinanceAI. Or sur une carte du hub la couleur ne se voit quasiment que dans
   * la barre d'accent de 3 px en haut — deux barres à 21° d'écart s'y confondent, surtout en
   * thème sombre.
   *
   * Ce rose est à 44° de sa plus proche voisine, et son contraste est ÉQUILIBRÉ entre les
   * deux thèmes : 4,22 sur le fond clair, 4,17 sur le sombre. L'équilibre compte parce que
   * le hub suit `prefers-color-scheme` et que son thème PAR DÉFAUT est le clair — là où
   * l'ancien vert ne donnait que 3,09.
   */
  color: "#db2777",
};

export interface InstantaneCarAI {
  /** Dernière mesure de charge, avec son unité déclarée (jamais devinée). */
  batterieSoc: { valeur: number; unite: string | null } | null;
  autonomieKm: number | null;
  odometreKm: number | null;
  /**
   * Le statut de charge INTERPRÉTÉ (`lib/vehicle/charges.ts`), plus la chaîne brute.
   *
   * ⚠️ C'était `string | null`, rempli avec `charge?.valueText` — donc littéralement
   * `"true"` ou `"false"`. Le hub affichait « Charge en cours — true », en anglais et en
   * jargon de capteur, sur une carte qui n'a que cinq lignes. Marc demandait « voir si en
   * train de charger » : il l'avait, sous une forme illisible.
   *
   * `statutDeCharge` existe depuis le 20/08 et sait déjà distinguer les cinq états qui
   * comptent — dont « branchée mais pas en charge », qui est NORMAL chez Marc (il a trois
   * minuteries) et qu'il ne faut surtout pas confondre avec « débranchée ».
   */
  statutCharge: StatutCharge | null;
  /** Mesure la plus récente, toutes métriques confondues. */
  fraicheur: Date | null;
  bail: EtatBail | null;
  /**
   * Kilomètres parcourus sur la fenêtre glissante de `FENETRE_KM_JOURS`, AVEC la durée
   * réellement couverte (`lib/vehicle/bilan.ts`). Demande de Marc, 15/09 : « le nombre de
   * km 7 jours ».
   *
   * ⚠️ Ce n'est PAS l'odomètre. L'odomètre cumulé ne décide de rien — il monte, c'est tout.
   * Ce chiffre-là répond à « est-ce que je roule trop », la seule question que le bail pose.
   * Il remplace donc « Odomètre » sur la carte (six métriques, pas sept) ; le cumulé reste
   * dans la vue détaillée, section « Bail », avec son allocation.
   */
  kmRecents: KmSurFenetre | null;
  /**
   * Ce qui a été versé au bail, calculé par `paiementsBail` à partir des termes (CarAI) et
   * des dollars (FinanceAI). `null` dès qu'un terme manque — jamais 0, qui se lirait
   * « rien n'a été payé ».
   */
  paiements: PaiementsBail | null;
  /**
   * L'ISSUE de la lecture chez FinanceAI, gardée TELLE QUELLE.
   *
   * ⚠️ Sept états, et chacun appelle un geste différent de Marc (poser deux variables,
   * corriger un jeton, nommer la bonne dette, enregistrer la dette). Les réduire à
   * « pas de montant » lui dirait que quelque chose ne va pas sans jamais dire quoi —
   * c'est `messageBail` qui les traduit, et il est déjà écrit et testé.
   */
  lectureBail: LectureBail | null;
  /** Heures depuis la dernière livraison de webhook, `null` si aucune n'est jamais arrivée. */
  silenceWebhookHeures: number | null;
  toyotaDesactive: boolean;
  /** Base injoignable ou schéma absent — une PANNE, pas un état « en construction ». */
  panne: string | null;
  generatedAt: Date;
}

/** Seuil de silence au-delà duquel on soupçonne un webhook désactivé (Doc 2 §6.4). */
export const SEUIL_SILENCE_HEURES = 6;

/**
 * Les cinq modes de `statutDeCharge`, en français, pour la carte du hub.
 *
 * « Branchée, en attente » et « Débranchée » sont VOLONTAIREMENT distincts, et
 * « Pas en charge » existe à côté des deux : la voiture peut dire qu'elle ne charge pas
 * sans dire si le câble est branché, et affirmer « débranchée » dans ce cas serait
 * inventer un fait qu'aucun relevé ne porte.
 */
const LIBELLE_MODE_CHARGE: Readonly<Record<StatutCharge["mode"], string>> = {
  "en-charge": "En charge",
  "branchee-en-attente": "Branchée, en attente",
  debranchee: "Débranchée",
  "pas-en-charge": "Pas en charge",
  inconnu: "Non communiqué",
};

/**
 * L'âge maximal NORMAL de la donnée de CarAI, publié au hub (`expectedMaxAgeSec`,
 * contrat v1.3).
 *
 * ⚠️ DÉRIVÉ de `FRAICHEUR_STATUT_MINUTES`, jamais écrit en double. Ce seuil existe depuis
 * le 20/08 avec sa justification — « la bZ publie aux 30-60 min » — et c'est déjà lui qui
 * décide, dans l'app, si un statut s'énonce au présent ou au passé. Publier un SECOND
 * nombre ici créerait deux vérités sur la même question, et elles divergeraient au premier
 * réglage.
 *
 * Ce que ça change côté hub : il cesse de DEVINER. Jusqu'ici il voyait `dataAsOf` sans
 * savoir si sa valeur était bonne — 40 min est sain pour ce véhicule et catastrophique
 * pour un moteur qui passe aux 5 min. Désormais CarAI le dit, et le hub compare.
 *
 * ⚠️ Conséquence assumée : le poll GitHub Actions étant mesuré à ~3× plus lent que
 * déclaré (trou de 6 h 53 le 14/09), le hub affichera « donnée figée » plus souvent qu'on
 * ne l'aimerait. C'est le but. Relever ce seuil pour faire taire le signal reviendrait à
 * masquer la panne au lieu de la réparer.
 */
export const FRAICHEUR_ATTENDUE_SEC = FRAICHEUR_STATUT_MINUTES * 60;

function arrondi(valeur: number, decimales = 0): number {
  const f = 10 ** decimales;
  return Math.round(valeur * f) / f;
}

/**
 * Bornes de couverture au-delà desquelles « Km (7 jours) » ne s'affiche PLUS sur la carte.
 *
 * ⚠️ POURQUOI DEUX BORNES, ET POURQUOI ELLES NE SONT PAS SYMÉTRIQUES. Un odomètre ne se
 * mesure qu'entre deux relevés existants, et ceux-ci ne tombent jamais pile sur les bords
 * de la fenêtre. Les deux écarts mentent, mais pas dans le même sens :
 *
 *  • un relevé de DÉPART trop vieux fait compter des jours EN TROP → le chiffre SUR-estime.
 *    C'est le mensonge dangereux : il gonfle la seule métrique à partir de laquelle Marc
 *    décide de rouler moins. Borne serrée (1,15 : 15 % d'excès au pire).
 *  • un silence de la source fait couvrir MOINS que la fenêtre → le chiffre SOUS-estime.
 *    Moins grave — ça ressemble à « la voiture n'a pas bougé », ce qui est faux mais
 *    visible. Borne plus lâche (0,7), et la couverture réelle est dite dans le détail.
 *
 * La carte du hub ne porte AUCUN `hint` (le contrat n'en prévoit pas sur une métrique) :
 * hors de ces bornes, le chiffre serait donc nu sous une étiquette « 7 jours » qu'il ne
 * respecte pas. On l'omet, et la vue détaillée DIT pourquoi — une absence expliquée vaut
 * mieux qu'un nombre crédible et faux.
 */
export const COUVERTURE_KM_MIN = 0.7;
export const COUVERTURE_KM_MAX = 1.15;

/** La mesure mérite-t-elle l'étiquette « Km (N jours) » ? PURE. */
export function kmPubliable(
  mesure: KmSurFenetre | null,
  fenetreJours = FENETRE_KM_JOURS,
): boolean {
  if (!mesure) return false;
  const part = mesure.couvertureJours / fenetreJours;
  return part >= COUVERTURE_KM_MIN && part <= COUVERTURE_KM_MAX;
}

/** Le libellé de la métrique ET de la ligne de détail — composé, jamais écrit deux fois. */
export const LIBELLE_KM = `Km (${FENETRE_KM_JOURS} jours)`;

function jours(n: number): string {
  const arrondie = arrondi(n, 1);
  return `${arrondie.toLocaleString("fr-CA")} ${arrondie < 2 ? "jour" : "jours"}`;
}

/**
 * Les sections de la vue DÉTAILLÉE (`details`, contrat v1.3) — PURE.
 *
 * ── CE QU'ELLE N'EST PAS ────────────────────────────────────────────────────────────
 *
 * Pas une deuxième carte. Le plafond de six métriques protège la LISIBILITÉ de la carte,
 * et il reste : ces lignes ne s'affichent que quand on demande les détails. Ce qui va ici
 * est donc ce qui EXPLIQUE un chiffre de la carte, jamais un chiffre de plus à survoler.
 *
 * Deux sections, et elles répondent chacune à une question que la carte laisse ouverte :
 *   • « Bail consommé : 41,2 % » ne dit pas si c'est grave. Le détail donne les termes —
 *     km parcourus sur alloués, jours restants, rythme observé contre rythme encore
 *     permis, et la projection.
 *   • « En charge » ne dit pas jusqu'à quand. Le détail donne la fin annoncée.
 *
 * ⚠️ Les libellés sont UNIQUES dans leur section : le hub retrouve la série historique
 * d'une ligne par le couple (titre de section, libellé), et deux homonymes donneraient une
 * courbe qui saute d'une grandeur à l'autre. Le contrat les rejette, ce qui fait de cette
 * contrainte un test plutôt qu'une vigilance.
 *
 * ⚠️ Une section n'est émise que si elle a au moins une ligne — le contrat refuse une
 * section vide, et il a raison : un titre au-dessus de rien ressemble à une donnée qui
 * n'a pas chargé.
 */
export function sectionsDetail(instantane: InstantaneCarAI): HubDetailSection[] {
  const sections: HubDetailSection[] = [];

  const bail = instantane.bail;
  if (bail) {
    const lignes: HubDetailItem[] = [];

    if (bail.kilometrageActuel !== null) {
      lignes.push({
        label: "Kilométrage",
        value: Math.round(bail.kilometrageActuel),
        format: "number",
        hint: `sur ${bail.allocationTotale.toLocaleString("fr-CA")} km autorisés`,
      });
    }
    lignes.push({
      label: "Jours restants",
      value: bail.joursRestants,
      format: "number",
      hint: `${bail.joursEcoules} jours écoulés`,
    });
    if (bail.rythmeKmParJour !== null) {
      lignes.push({
        label: "Rythme observé",
        value: arrondi(bail.rythmeKmParJour, 1),
        format: "number",
        // La couverture EST l'information : un rythme mesuré sur six jours de vacances ne
        // décrit pas l'année. L'afficher nu laisserait croire à une mesure sur tout le bail.
        hint:
          bail.couvertureRythmeJours !== null
            ? `km/jour, mesuré sur ${bail.couvertureRythmeJours} jours`
            : "km/jour",
      });
    }
    if (bail.rythmeRestantAutoriseKmParJour !== null) {
      lignes.push({
        label: "Rythme encore permis",
        value: arrondi(bail.rythmeRestantAutoriseKmParJour, 1),
        format: "number",
        // Et pas `rythmeAutoriseKmParJour`, la moyenne du contrat : elle ignore l'avance ou
        // le retard déjà accumulés et ne répond donc plus à la question passé le premier mois.
        hint: "km/jour à partir de maintenant, sans pénalité",
      });
    }
    if (bail.depassementProjete !== null) {
      const depasse = bail.depassementProjete > 0;
      lignes.push({
        label: depasse ? "Dépassement projeté" : "Marge projetée",
        value: Math.round(Math.abs(bail.depassementProjete)),
        format: "number",
        severity: depasse ? "warn" : "ok",
        hint: "km en fin de bail, au rythme observé",
      });
    }
    // Ce qui MANQUE au calcul se dit, plutôt que de laisser croire le résultat complet.
    if (bail.limites.length > 0) {
      lignes.push({
        label: "Réserve sur le calcul",
        value: bail.limites.join(" · "),
        format: "text",
      });
    }

    if (lignes.length > 0) {
      sections.push({ title: "Bail", items: lignes.slice(0, 8) });
    }
  }

  const statut = instantane.statutCharge;
  if (statut) {
    const lignes: HubDetailItem[] = [
      {
        label: "État",
        value: LIBELLE_MODE_CHARGE[statut.mode],
        format: "text",
        ...(statut.ageMinutes !== null
          ? {
              hint: statut.perime
                ? `dernier relevé il y a ${statut.ageMinutes} min — énoncé au passé`
                : `relevé il y a ${statut.ageMinutes} min`,
            }
          : {}),
      },
    ];

    if (statut.detail !== null) {
      lignes.push({
        label: "Mot de la voiture",
        value: statut.detail,
        format: "text",
        // Le terme brut de Smartcar est gardé TEL QUEL et étiqueté comme tel : c'est ce
        // qu'on cite quand on ouvre un billet chez eux, et le traduire le rendrait
        // introuvable.
        hint: "code brut Smartcar, non traduit",
      });
    }

    if (statut.finAnnoncee !== null) {
      lignes.push({
        label: "Fin annoncée",
        value: statut.finAnnoncee.minutesRestantes,
        format: "number",
        // ⚠️ « annoncé par la voiture » n'est pas une formule de politesse :
        // `charge_time_remaining` arrive SANS unité, et sa lecture en minutes est établie
        // par l'arithmétique (cf. `charges.ts`), pas par une déclaration de Smartcar.
        hint: "minutes restantes, annoncées par la voiture",
      });
    }

    sections.push({ title: "Charge", items: lignes.slice(0, 8) });
  }

  // ── ROUTE ──────────────────────────────────────────────────────────────────────────
  // La carte porte « Km (7 jours) » sans pouvoir rien préciser (une métrique n'a pas de
  // `hint` dans le contrat). C'est ici que la mesure s'explique — ou que son ABSENCE
  // s'explique, ce qui est le cas le plus utile : un chiffre manquant sans raison se lit
  // comme un bug de l'app.
  const km = instantane.kmRecents;
  const lignesRoute: HubDetailItem[] = [];
  if (km) {
    lignesRoute.push({
      label: LIBELLE_KM,
      value: Math.round(km.km),
      format: "number",
      // La couverture EST l'information. Même règle que « Rythme observé » juste au-dessus :
      // affichée nue, la mesure laisserait croire qu'elle couvre exactement la fenêtre.
      hint: `mesuré sur ${jours(km.couvertureJours)} de relevés`,
    });
    if (!kmPubliable(km)) {
      const part = km.couvertureJours / FENETRE_KM_JOURS;
      lignesRoute.push({
        label: "Réserve sur les kilomètres",
        value:
          part > COUVERTURE_KM_MAX
            ? `Le relevé de départ précède la fenêtre : la mesure couvre ${jours(km.couvertureJours)} ` +
              `au lieu de ${FENETRE_KM_JOURS}, elle SUR-estime donc. Retirée de la carte.`
            : `Les relevés ne couvrent que ${jours(km.couvertureJours)} sur ${FENETRE_KM_JOURS} : ` +
              `la mesure SOUS-estime. Retirée de la carte.`,
        format: "text",
        severity: "warn",
      });
    }
  } else if (instantane.odometreKm !== null) {
    // Un odomètre connu mais pas de mesure sur la fenêtre : il manque un relevé AVANT le
    // bord, ou aucun n'est arrivé depuis. Le dire vaut mieux qu'une section absente.
    lignesRoute.push({
      label: "Réserve sur les kilomètres",
      value:
        `Pas de relevé d'odomètre encadrant les ${FENETRE_KM_JOURS} derniers jours : ` +
        "les kilomètres parcourus ne sont pas mesurables.",
      format: "text",
      severity: "warn",
    });
  }
  if (lignesRoute.length > 0) {
    sections.push({ title: "Route", items: lignesRoute.slice(0, 8) });
  }

  // ── COÛT DU VÉHICULE ───────────────────────────────────────────────────────────────
  const paiements = instantane.paiements;
  const lignesCout: HubDetailItem[] = [];
  if (paiements) {
    lignesCout.push({
      label: "Versé au bail",
      value: arrondi(paiements.payeContrat),
      format: "currency",
      hint: `${paiements.versementsFaits} versements sur ${paiements.versementsTotal}, à ${arrondi(paiements.mensualite)} $/mois`,
    });
    lignesCout.push({
      label: "Total du contrat",
      value: arrondi(paiements.totalContrat),
      format: "currency",
      // ⚠️ `mensualité × durée`, JAMAIS le montant financé : les deux ne coïncident qu'à
      // taux nul (cf. `paiementsBail.ts`).
      hint: "somme des versements, à la fin du bail",
    });
    // ⚠️ CE QUE LE TOTAL NE CONTIENT PAS, dit explicitement. Marc a demandé « le prix total
    // depuis le début » : lui montrer un montant sans nommer ce qui en est absent, c'est le
    // laisser croire qu'il est complet.
    lignesCout.push({
      label: "Recharges",
      value:
        "Non comptées ici : une partie des prix est estimée, et la couverture des sessions " +
        "observées est partielle. Le détail est dans l'écran Activité de CarAI.",
      format: "text",
    });
    if (paiements.reserves.length > 0) {
      lignesCout.push({
        label: "Réserve sur le calcul",
        // Un écart entre ce que CarAI sait des termes et ce que FinanceAI publie n'est
        // JAMAIS corrigé en silence : il veut dire qu'une des deux saisies est fausse, et
        // Marc est le seul à pouvoir trancher.
        value: paiements.reserves.join(" · "),
        format: "text",
        severity: "warn",
      });
    }
  } else if (instantane.lectureBail) {
    // Pas de montant : on NOMME le geste qui manque. `messageBail` distingue déjà les sept
    // issues — les fondre en « pas de montant » enverrait chercher au mauvais endroit.
    const message = messageBail(instantane.lectureBail, false);
    if (message) {
      lignesCout.push({
        label: "Montants du bail",
        value: message.texte,
        format: "text",
        ...(message.aConfigurer ? { severity: "warn" as const } : {}),
      });
    }
  }
  if (lignesCout.length > 0) {
    sections.push({ title: "Coût du véhicule", items: lignesCout.slice(0, 8) });
  }

  return sections.slice(0, 6);
}

/**
 * Construit le summary. Toujours valide au regard du contrat — `validateSummary` lève sinon,
 * ce qui vaut mieux qu'un widget « invalide » côté hub sans qu'on sache pourquoi.
 */
export function construireSummary(instantane: InstantaneCarAI): HubSummary {
  const metrics: HubMetric[] = [];
  const alerts: HubAlert[] = [];

  // ── PANNE : elle prime sur tout le reste ───────────────────────────────────────────
  // Un `status: "error"` avec zéro métrique est honnête ; afficher les dernières valeurs
  // connues comme si de rien n'était laisserait croire que tout va bien.
  if (instantane.panne) {
    return validateSummary({
      contractVersion: CONTRACT_VERSION,
      app: APP,
      generatedAt: instantane.generatedAt.toISOString(),
      status: "error",
      metrics: [],
      alerts: [{ label: `CarAI : ${instantane.panne}`.slice(0, 80), severity: "alert" }],
      actions: [{ label: "Ouvrir CarAI", kind: "link", href: APP.url }],
    });
  }

  // ── ÉTAT DE CHARGE ─────────────────────────────────────────────────────────────────
  if (instantane.batterieSoc) {
    const { pourcent, fiable } = interpreterPourcentage(
      instantane.batterieSoc.valeur,
      instantane.batterieSoc.unite,
    );
    if (fiable && pourcent !== null) {
      metrics.push({
        label: "Charge",
        value: arrondi(pourcent),
        format: "percent",
        severity: pourcent <= 15 ? "alert" : pourcent <= 30 ? "warn" : "ok",
        // LE chiffre de CarAI (`primary`, contrat v1.3) : c'est celui que Marc a nommé en
        // premier, et le seul qui décide s'il peut partir maintenant. Sans ce drapeau le
        // hub retombait sur la première métrique du tableau — ce qui donnait le bon
        // résultat par CHANCE, l'ordre de ce fichier n'étant garanti par rien.
        //
        // ⚠️ Il ne va PAS sur la branche « unité inconnue » ci-dessous : une valeur qu'on
        // ne sait pas interpréter ne mérite pas la grande tuile, elle mérite d'être lue
        // avec sa réserve.
        primary: true,
      });
    } else {
      // Unité non déclarée : impossible de trancher entre 0,3 % et 30 %. On publie la
      // valeur brute en texte plutôt qu'un pourcentage qui pourrait être faux d'un
      // facteur 100 — sur une jauge de batterie, ce serait la pire des erreurs.
      metrics.push({
        label: "Charge (unité inconnue)",
        value: String(instantane.batterieSoc.valeur),
        format: "text",
      });
    }
  }

  if (instantane.autonomieKm !== null) {
    metrics.push({
      label: "Autonomie",
      value: `${arrondi(instantane.autonomieKm)} km`,
      format: "text",
    });
  }

  if (instantane.statutCharge) {
    const statut = instantane.statutCharge;
    metrics.push({
      // ⚠️ PAS « Charge » : ce libellé est déjà pris par le pourcentage ci-dessus, et le
      // hub retrouve la série historique d'une métrique PAR SON LIBELLÉ. Deux métriques
      // homonymes donneraient une courbe qui saute d'un pourcentage à un mot.
      label: statut.perime ? "État de la charge (dernier connu)" : "État de la charge",
      value: LIBELLE_MODE_CHARGE[statut.mode],
      format: "text",
      // `ok` uniquement EN CHARGE : c'est le seul état qu'on veut voir d'un coup d'œil
      // depuis le hub. « Branchée en attente » n'est ni bon ni mauvais chez Marc — ses
      // minuteries le produisent tous les jours — et le peindre en vert ou en orange
      // apprendrait à ignorer la couleur.
      ...(statut.mode === "en-charge" ? { severity: "ok" as const } : {}),
    });
  }

  // ── KILOMÈTRES RÉCENTS ─────────────────────────────────────────────────────────────
  // Remplace « Odomètre » sur la carte. Le cumulé ne décide de rien : il monte, et il
  // monterait pareil si Marc roulait deux fois trop. Il reste dans la vue détaillée
  // (section « Bail »), où son allocation lui donne un sens.
  //
  // ⚠️ Publié SEULEMENT si la mesure mérite son étiquette — voir `kmPubliable`. Sinon la
  // vue détaillée dit pourquoi, et la carte n'affiche rien plutôt qu'un nombre qui
  // annonce sept jours en en mesurant vingt.
  if (kmPubliable(instantane.kmRecents)) {
    metrics.push({
      label: LIBELLE_KM,
      value: Math.round(instantane.kmRecents!.km),
      format: "number",
    });
  }

  // ── BAIL ───────────────────────────────────────────────────────────────────────────
  const bail = instantane.bail;
  // Le point de comparaison n'est pas 100 % mais le temps ÉCOULÉ — la règle vit dans
  // `avanceSurLeBail` (`lib/vehicle/lease.ts`), avec l'accueil pour second consommateur.
  // Elle était écrite en dur ici, donc l'accueil ne pouvait pas en hériter.
  const avance = bail ? avanceSurLeBail(bail) : null;
  if (avance) {
    metrics.push({
      label: "Bail consommé",
      value: arrondi(avance.consommePourcent, 1),
      format: "percent",
      severity:
        avance.gravite === "alerte" ? "alert" : avance.gravite === "attention" ? "warn" : "ok",
    });
  }

  // ── CE QUI A ÉTÉ VERSÉ AU BAIL ─────────────────────────────────────────────────────
  //
  // ⚠️ LE LIBELLÉ DIT « BAIL », PAS « PRIX TOTAL », et c'est délibéré. Marc a demandé « le
  // prix total depuis le début (avec prêt) » ; ce chiffre est la part que CarAI et FinanceAI
  // savent EXACTEMENT — les versements du contrat. Le coût des recharges n'y est pas :
  //   • une partie est ESTIMÉE (tarif typique, jamais facturé), et `lib/vehicle/montants.ts`
  //     a déjà tranché que le mesuré et l'estimé ne s'additionnent pas pour porter une tuile ;
  //   • et la couverture des recharges observées était mesurée à 0,25 le 15/09 — un quart.
  // Un total qui les mêlerait serait crédible et faux. Il est dans l'écran Activité de
  // CarAI, avec ses réserves ; la vue détaillée du hub DIT qu'il n'est pas compté ici.
  if (instantane.paiements) {
    metrics.push({
      label: "Versé au bail",
      value: arrondi(instantane.paiements.payeContrat),
      format: "currency",
      // Aucune `severity` : payer son bail n'est ni bon ni mauvais, c'est un fait. Le
      // peindre apprendrait à ignorer la couleur là où elle signale une vraie anomalie.
    });
  }

  if (bail && bail.depassementProjete !== null && bail.depassementProjete > 0) {
    alerts.push({
      label: resumerBail(bail).slice(0, 80),
      severity: bail.depassementProjete > bail.allocationTotale * 0.1 ? "alert" : "warn",
    });
  }

  // ── SILENCE DU WEBHOOK ─────────────────────────────────────────────────────────────
  // C'est l'alerte la plus importante de ce summary : elle signale la panne QUI NE FAIT
  // PAS DE BRUIT. Smartcar désactive un webhook après six échecs de livraison ; sans cette
  // ligne, le tableau de bord continuerait d'afficher fièrement des valeurs figées.
  if (
    instantane.silenceWebhookHeures !== null &&
    instantane.silenceWebhookHeures >= SEUIL_SILENCE_HEURES
  ) {
    alerts.push({
      label: `Aucune donnée Smartcar depuis ${Math.floor(instantane.silenceWebhookHeures)} h — webhook peut-être désactivé.`.slice(
        0,
        80,
      ),
      severity: instantane.silenceWebhookHeures >= 24 ? "alert" : "warn",
    });
  }

  if (instantane.toyotaDesactive) {
    alerts.push({
      label: "Source Toyota non officielle désactivée. Smartcar continue normalement.",
      severity: "info",
    });
  }

  // ── STATUT GLOBAL ──────────────────────────────────────────────────────────────────
  // Aucune donnée ⇒ `building`, jamais `ok` avec des métriques vides : le hub afficherait
  // un widget qui a l'air branché alors que rien n'est encore arrivé.
  const aucuneDonnee = metrics.length === 0;
  const degrade =
    instantane.silenceWebhookHeures !== null &&
    instantane.silenceWebhookHeures >= SEUIL_SILENCE_HEURES;

  const status: HubSummary["status"] = aucuneDonnee
    ? "building"
    : degrade
      ? "degraded"
      : "ok";

  if (aucuneDonnee && alerts.length === 0) {
    alerts.push({
      label: "CarAI en place — en attente des premières données du véhicule.",
      severity: "info",
    });
  }

  const details = sectionsDetail(instantane);

  return validateSummary({
    contractVersion: CONTRACT_VERSION,
    app: APP,
    generatedAt: instantane.generatedAt.toISOString(),
    // Omis quand aucune donnée n'est arrivée : un `dataAsOf` égal à `generatedAt`
    // annoncerait une fraîcheur à la seconde alors qu'il n'y a rien.
    //
    // ⚠️ `expectedMaxAgeSec` est lié au MÊME conditionnel, et pas par commodité : le
    // contrat REJETTE un âge attendu sans horodatage à comparer. Il aurait raison de le
    // faire même s'il ne le faisait pas — annoncer un plafond de fraîcheur sans rien à
    // mesurer donnerait au hub l'air de surveiller quelque chose qu'il ne surveille pas.
    ...(instantane.fraicheur
      ? {
          dataAsOf: instantane.fraicheur.toISOString(),
          expectedMaxAgeSec: FRAICHEUR_ATTENDUE_SEC,
        }
      : {}),
    status,
    metrics: metrics.slice(0, 6),
    alerts: alerts.slice(0, 10),
    actions: [{ label: "Ouvrir CarAI", kind: "link", href: APP.url }],
    // Omis quand il n'y a rien à détailler — un `details: []` passerait le contrat mais
    // ferait afficher au hub une vue détaillée vide, ce qui ressemble à un chargement raté.
    ...(details.length > 0 ? { details } : {}),
    // Pas de bloc `usage` : voir l'en-tête de fichier.
  });
}
