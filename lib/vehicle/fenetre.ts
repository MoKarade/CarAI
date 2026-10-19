// lib/vehicle/fenetre.ts — LA fenêtre de temps d'un écran. PURE, testée.
//
// Marc, 13/08 : « je veux pouvoir sélectionner la date, ou la range, ou le global ».
//
// Trois façons de dire QUAND, une seule fonction qui les normalise :
//   • un RACCOURCI  (`?periode=7j`)               — le geste le plus fréquent ;
//   • une PLAGE     (`?du=2026-08-01&au=2026-08-13`) — dont un JOUR précis est le cas où
//     les deux bornes coïncident ; c'est pour ça qu'il n'y a pas de troisième mode ;
//   • TOUT          (`?periode=tout`).
//
// ══ LE FUSEAU N'EST PAS UN DÉTAIL ═══════════════════════════════════════════════════
//
// ⚠️ Une date saisie « 2026-08-13 » veut dire le 13 août CHEZ MARC, pas en UTC. Vercel
// tourne en UTC et Marc vit à UTC−4 : prendre la date telle quelle décalerait toute la
// journée de quatre heures — le trajet de 21 h tomberait le lendemain, et une sélection
// « aujourd'hui » manquerait sa soirée. C'est la leçon JobAI (« toute date que l'app écrit
// se calcule dans le fuseau de Marc »), appliquée ici à la LECTURE.
//
// On réutilise `debutDuJourLocal` plutôt que de recomposer un minuit local : deux façons
// de calculer la même frontière finissent toujours par diverger d'une heure, une fois par
// an, au changement d'heure — et personne ne le remarque avant des mois.

import { debutDuJourLocal } from "@/lib/vehicle/bilan";
import { PERIODES, type Periode } from "@/lib/vehicle/mesures";

export const FUSEAU_MARC = "America/Toronto";

export type ModeFenetre = "raccourci" | "jour" | "plage" | "tout";

/**
 * Les raccourcis possibles : ceux de `PERIODES` (glissants) PLUS « aujourd'hui », qui est
 * une frontière de CALENDRIER dans le fuseau de Marc.
 *
 * ⚠️ « aujourd'hui » n'est PAS « les dernières 24 h » : à 8 h du matin, elles ne racontent
 * pas la même journée. Activité en fait son défaut (choix de Marc), Tendances ne le propose
 * pas — d'où la liste passée par chaque écran plutôt qu'un menu unique.
 *
 * ⚠️ Et il ne s'appelle pas `jour` : `ModeFenetre` porte déjà ce mot pour « la plage dont
 * les deux bornes coïncident ». Deux sens sur un même mot dans le même objet, c'est la
 * confusion garantie le jour où quelqu'un teste `fenetre.mode === "jour"`.
 */
export const RACCOURCI_AUJOURDHUI = "aujourdhui";
export type RaccourciFenetre = Periode | typeof RACCOURCI_AUJOURDHUI;

/** Ce qu'un raccourci s'appelle à l'écran. Long pour le résumé, court pour le bouton. */
export const RACCOURCIS: Record<RaccourciFenetre, { long: string; court: string }> = {
  aujourdhui: { long: "Aujourd’hui", court: "Auj." },
  "24h": { long: "24 dernières heures", court: "24h" },
  "7j": { long: "7 derniers jours", court: "7j" },
  "30j": { long: "30 derniers jours", court: "30j" },
  tout: { long: "Tout l’historique", court: "Tout" },
};

/**
 * Le défaut de TENDANCES : 7 jours (CarAI#200). « Tout » relisait l'historique complet à
 * chaque ouverture alors que la limite mensuelle de transfert Neon était dépassée ; « tout »
 * reste un choix, un clic plus loin. Une seule définition : la page ET le bouton « Effacer »
 * du sélecteur s'y réfèrent, sinon l'un repartirait sur 7 j et l'autre sur autre chose.
 */
export const DEFAUT_TENDANCES: RaccourciFenetre = "7j";

/** Les raccourcis de Tendances : les périodes glissantes, sans « aujourd'hui ». */
export const RACCOURCIS_GLISSANTS = Object.keys(PERIODES) as readonly Periode[];

/** Ceux d'Activité : « aujourd'hui » d'abord, parce que c'est son défaut. */
export const RACCOURCIS_ACTIVITE: readonly RaccourciFenetre[] = [
  RACCOURCI_AUJOURDHUI,
  ...RACCOURCIS_GLISSANTS,
];

/**
 * Normalise un raccourci venu de l'URL vers une valeur PROPOSÉE par l'écran. PURE.
 *
 * Tout ce qui n'est pas dans la liste — valeur inconnue, signet périmé, nom de la chaîne
 * de prototypes comme `constructor` — retombe sur le défaut de CET écran. C'est pour ça
 * que le défaut est un paramètre : Tendances retombe sur « tout », Activité sur
 * « aujourd'hui », et un vieux lien `?periode=jour` atterrit donc au bon endroit sans
 * qu'on ait besoin d'un alias à maintenir.
 */
export function raccourciValide(
  brut: string | null | undefined,
  raccourcis: readonly RaccourciFenetre[],
  defaut: RaccourciFenetre,
): RaccourciFenetre {
  return brut && (raccourcis as readonly string[]).includes(brut)
    ? (brut as RaccourciFenetre)
    : defaut;
}

export interface Fenetre {
  /** Début INCLUS, ou `null` pour « depuis toujours ». */
  depuis: Date | null;
  /** Fin EXCLUE, ou `null` pour « jusqu'à maintenant ». */
  jusqu: Date | null;
  mode: ModeFenetre;
  /** Ce qu'on affiche au-dessus des graphiques — jamais un code d'URL. */
  libelle: string;
  /** Le raccourci retenu, pour que le sélecteur montre la bonne option. */
  periode: RaccourciFenetre;
  /** Les deux dates du formulaire, re-normalisées (`""` quand le mode n'en a pas). */
  du: string;
  au: string;
  /** Dit quand la saisie a été corrigée — une borne inversée, une date illisible. */
  avertissement: string | null;
}

const JOUR_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Minuit LOCAL du jour désigné par `AAAA-MM-JJ`, exprimé en UTC. PURE.
 *
 * Passe par midi UTC pour désigner le jour sans ambiguïté : à minuit UTC, un fuseau
 * occidental est encore la veille, et le calcul basculerait d'un jour.
 */
export function minuitLocal(jourIso: string, fuseau = FUSEAU_MARC): Date | null {
  if (!JOUR_ISO.test(jourIso)) return null;
  const midiUtc = new Date(`${jourIso}T12:00:00.000Z`);
  if (Number.isNaN(midiUtc.getTime())) return null;
  const minuit = debutDuJourLocal(midiUtc, fuseau);
  // Garde contre une date qui n'existe pas (31 février) : `Date` la décale silencieusement.
  const relu = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(minuit);
  return relu === jourIso ? minuit : null;
}

/** Le jour local d'un instant, en `AAAA-MM-JJ`. PURE. */
export function jourLocalIso(instant: Date, fuseau = FUSEAU_MARC): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/**
 * Normalise ce que l'URL raconte en une fenêtre exploitable. PURE, testée.
 *
 * Les dates l'emportent sur le raccourci : si Marc a saisi une plage, c'est qu'il veut la
 * plage. Une saisie incohérente n'est jamais refusée en bloc — elle est CORRIGÉE et
 * l'avertissement le dit, parce qu'un écran vide avec « paramètre invalide » ne rend
 * service à personne.
 */
export function analyserFenetre(
  params: { periode?: string | null; du?: string | null; au?: string | null },
  maintenant: Date,
  options: {
    fuseau?: string;
    /** Les raccourcis que CET écran propose. Défaut : les périodes glissantes. */
    raccourcis?: readonly RaccourciFenetre[];
    /** Sur quoi retomber quand l'URL ne dit rien de valide. */
    defaut?: RaccourciFenetre;
  } = {},
): Fenetre {
  const {
    fuseau = FUSEAU_MARC,
    raccourcis = RACCOURCIS_GLISSANTS,
    defaut = "tout",
  } = options;
  const duBrut = (params.du ?? "").trim();
  const auBrut = (params.au ?? "").trim();

  let debut = duBrut === "" ? null : minuitLocal(duBrut, fuseau);
  let fin = auBrut === "" ? null : minuitLocal(auBrut, fuseau);
  let avertissement: string | null = null;

  if (duBrut !== "" && debut === null) {
    avertissement = "Date de début illisible — elle a été ignorée.";
  }
  if (auBrut !== "" && fin === null) {
    avertissement = "Date de fin illisible — elle a été ignorée.";
  }

  // Bornes inversées : on les remet à l'endroit plutôt que de rendre une sélection vide.
  if (debut && fin && debut.getTime() > fin.getTime()) {
    [debut, fin] = [fin, debut];
    avertissement = "Les dates étaient à l’envers — elles ont été remises dans l’ordre.";
  }

  if (debut || fin) {
    // La borne de fin est EXCLUE et vaut minuit du LENDEMAIN : sélectionner le 13 doit
    // inclure toute la journée du 13, pas s'arrêter à 00 h 00.
    const finExclue = fin ? new Date(fin.getTime() + 86_400_000) : null;
    const memeJour = debut && fin && debut.getTime() === fin.getTime();
    const duIso = debut ? jourLocalIso(debut, fuseau) : "";
    const auIso = fin ? jourLocalIso(fin, fuseau) : "";
    return {
      depuis: debut,
      jusqu: finExclue,
      mode: memeJour ? "jour" : "plage",
      libelle: memeJour
        ? `Le ${duIso}`
        : debut && fin
          ? `Du ${duIso} au ${auIso}`
          : debut
            ? `Depuis le ${duIso}`
            : `Jusqu’au ${auIso}`,
      periode: "tout",
      du: duIso,
      au: auIso,
      avertissement,
    };
  }

  const periode = raccourciValide(params.periode, raccourcis, defaut);
  return {
    depuis: debutDuRaccourci(periode, maintenant, fuseau),
    jusqu: null,
    mode: periode === "tout" ? "tout" : "raccourci",
    libelle: RACCOURCIS[periode].long,
    periode,
    du: "",
    au: "",
    avertissement,
  };
}

/**
 * Le début d'un raccourci. PURE.
 *
 * ⚠️ « aujourd'hui » passe par `debutDuJourLocal` et non par une soustraction de 24 h :
 * c'est minuit CHEZ MARC, pas « il y a un jour ». Les deux ne coïncident qu'à minuit pile.
 */
function debutDuRaccourci(
  raccourci: RaccourciFenetre,
  maintenant: Date,
  fuseau: string,
): Date | null {
  if (raccourci === RACCOURCI_AUJOURDHUI) return debutDuJourLocal(maintenant, fuseau);
  const duree = PERIODES[raccourci];
  return duree === null ? null : new Date(maintenant.getTime() - duree);
}

/**
 * La fenêtre sérialisée en paramètres d'URL. PURE, testée.
 *
 * ⚠️ Elle existe pour que les liens INTERNES d'un écran (ouvrir un trajet, changer de
 * page) conservent la sélection. Sans elle, chaque lien recompose la query à la main et
 * n'en garde qu'une moitié : cliquer un trajet renverrait la période au défaut, ce qui
 * ressemble à un bug de filtre alors que c'est un lien qui a oublié de la porter.
 *
 * Rend une chaîne SANS « ? » ni « & » de tête — l'appelant décide de sa ponctuation.
 */
export function parametresFenetre(fenetre: Fenetre): string {
  if (fenetre.mode === "jour" || fenetre.mode === "plage") {
    const bouts: string[] = [];
    if (fenetre.du) bouts.push(`du=${encodeURIComponent(fenetre.du)}`);
    if (fenetre.au) bouts.push(`au=${encodeURIComponent(fenetre.au)}`);
    return bouts.join("&");
  }
  return `periode=${encodeURIComponent(fenetre.periode)}`;
}

/**
 * Restreint une série à la fenêtre. PURE.
 *
 * Le filtre par `depuis` se fait en SQL ; `jusqu` se fait ici, parce que les lectures
 * (`serieNumerique`, `historiqueOdometre`…) ne prennent qu'une borne basse. Filtrer les
 * deux au même endroit évite qu'une borne haute soit oubliée sur un seul des appelants.
 */
export function dansLaFenetre<T extends { t: Date }>(points: T[], fenetre: Fenetre): T[] {
  if (!fenetre.jusqu) return points;
  return points.filter((p) => instantDansLaFenetre(p.t, fenetre));
}

/**
 * Un instant tombe-t-il dans la fenêtre ? PURE, testée.
 *
 * ⚠️ Elle existe parce que tout ce qu'on filtre ne s'appelle pas `t` : une session de
 * recharge porte `debut`/`fin`, un trajet aussi. Sans ce prédicat, chaque appelant
 * réécrivait sa comparaison — et c'est toujours la borne HAUTE qui manquait dans la
 * copie, parce qu'elle n'existe que dans deux modes sur quatre.
 *
 * Début INCLUS, fin EXCLUE : `analyserFenetre` pose déjà `jusqu` à minuit du lendemain,
 * donc sélectionner le 13 inclut toute la journée du 13.
 */
export function instantDansLaFenetre(t: Date, fenetre: Fenetre): boolean {
  const ms = t.getTime();
  if (fenetre.depuis && ms < fenetre.depuis.getTime()) return false;
  if (fenetre.jusqu && ms >= fenetre.jusqu.getTime()) return false;
  return true;
}
