// lib/vehicle/cadence.ts — surveillance de la CADENCE du poll. PURE, testable sans base.
//
// ══ POURQUOI CE MODULE EXISTE ═══════════════════════════════════════════════════════
// Marc, 17/08 : « parfois les infos reçues sont en retard, parfois je les reçois pas du
// tout, comme quand je recharge le véhicule ou je fais un déplacement ».
//
// Mesure faite le jour même sur les 30 derniers passages programmés (22 h d'historique) :
//
//     cadence configurée .......  30 min
//     écart MÉDIAN réel ........  41 min
//     écart MAXIMAL ............ 101 min
//     écarts > 45 min ..........  13 sur 29
//
// Sur 22 h il aurait dû y avoir ~44 passages ; il y en a eu 30. UN TIERS DES POLLS N'A
// JAMAIS EU LIEU. La cause n'est pas dans CarAI : les `schedule` de GitHub Actions sont
// best-effort — mis en file sur une infrastructure partagée, retardés sous charge, et
// purement abandonnés quand elle sature.
//
// ══ POURQUOI ÇA FAIT DISPARAÎTRE DES RECHARGES ET DES TRAJETS ═══════════════════════
// Ni l'un ni l'autre n'est MESURÉ par la voiture — les deux sont DÉDUITS d'échantillons :
//   • une recharge se déduit de deux relevés d'état de charge qui l'encadrent (la bZ ne
//     sert pas `charge-ischarging`) ;
//   • un trajet se déduit de deux positions, publiées surtout à l'arrêt.
// Avec un trou de 101 min, une recharge de 45 min ne laisse AUCUNE trace : rien avant,
// rien après, rien qui la distingue. Ce n'est pas un bug d'affichage, c'est une mesure
// qui n'a jamais été prise.
//
// ══ CE QUE CE MODULE CHANGE ═════════════════════════════════════════════════════════
// Rien à la cadence elle-même — il la MESURE et la rend visible. Aujourd'hui un poll sauté
// est indistinguable de « rien n'a changé » : le poll Smartcar n'enregistrait nulle part
// qu'il avait tourné, et le seul seuil d'alerte (`SEUIL_SILENCE_HEURES = 6`) vise un
// webhook désactivé, pas un cron qui saute. Un trou de 101 min passait très en dessous.

/**
 * Cadence VISÉE du poll, en minutes — celle du déclencheur PRINCIPAL (service de cron
 * externe, cron-job.org, hors dépôt).
 *
 * ⚠️ Jusqu'au 28/09/2026, DEVAIT aussi correspondre au `cron` de
 * `.github/workflows/smartcar-poll.yml` — ce n'est plus le cas : ce workflow est un FILET
 * dont la cadence est désormais DÉCOUPLÉE (`CADENCE_FILET_GITHUB_MINUTES`, ci-dessous),
 * réduite pour préserver le quota GitHub Actions. `tests/cadence.test.ts` verrouille
 * chaque constante contre son propre fichier (YAML pour le filet, aucun test possible pour
 * le déclencheur principal, qui vit hors du dépôt — voir plus bas).
 *
 * ⚠️ 15 min depuis le 17/09, et ce n'est PAS une accélération du même mécanisme : c'est un
 * changement de déclencheur. GitHub Actions n'exécute plus les `schedule` de ce dépôt qu'à
 * ~6 passages par jour sur 48 demandés — mesuré sur les 60 derniers runs, écart médian
 * 237 min, JAMAIS moins de 120 min, et des minutes de déclenchement réparties sur tout le
 * cadran alors que le cron demandait :00 et :30. Autrement dit GitHub ne tente même pas à
 * l'heure voulue : il coalesce. Demander `*​/15` plutôt que `*​/30` n'y aurait rien changé,
 * c'est le NOMBRE de runs qui est plafonné, pas leur date.
 *
 * Le déclencheur principal est donc devenu un service de cron externe (cron-job.org), et
 * le workflow GitHub reste en FILET. La cible est 15 min parce que la bZ ne se rafraîchit
 * qu'aux 30-60 min : sonder deux fois par rafraîchissement garantit qu'aucun état ne
 * vieillit de plus d'un quart d'heure avant d'être vu, et sonder plus vite relirait la
 * même mesure.
 *
 * ⚠️ La configuration du déclencheur principal vit HORS du dépôt : aucun test ne peut la
 * vérifier. Ce qui la surveille, c'est la cadence OBSERVÉE — `analyserCadence`, la page
 * Données, et `expectedMaxAgeSec` publié au hub. Un déclencheur qu'on ne voit pas et une
 * cadence qu'on ne mesure pas donneraient exactement le silence d'aujourd'hui.
 */
export const CADENCE_POLL_MINUTES = 15;

/**
 * Cadence du FILET GitHub Actions (`.github/workflows/smartcar-poll.yml`), DÉCOUPLÉE de
 * `CADENCE_POLL_MINUTES` depuis le 28/09/2026 (commit « Poll Smartcar toutes les heures au
 * lieu de toutes les 15 min ») : le déclencheur PRINCIPAL reste le service de cron externe à
 * 15 min (inchangé, vit hors du dépôt — voir le commentaire de `CADENCE_POLL_MINUTES`) ; ce
 * filet est passé à 60 min pour réduire sa consommation du quota GitHub Actions (2 000
 * min/mois, dépôt privé, épuisé le 23/09/2026). Verrouillée par le même test que
 * `CADENCE_POLL_MINUTES` : `tests/cadence.test.ts`.
 */
export const CADENCE_FILET_GITHUB_MINUTES = 60;

/**
 * Retard au-delà duquel un écart compte comme un OUBLI plutôt qu'un simple retard.
 *
 * Dérivé de la cadence, jamais écrit en dur : à 30 min de cadence, un écart de 45 min est
 * du retard ordinaire (GitHub met en file), un écart de 60 min veut dire qu'un passage
 * entier a été sauté. Le facteur 2 est le point où « en retard » devient « manquant ».
 */
export const FACTEUR_OUBLI = 2;

export function seuilOubliMinutes(cadence = CADENCE_POLL_MINUTES): number {
  return cadence * FACTEUR_OUBLI;
}

export interface PassagePoll {
  /** Instant d'exécution. */
  t: Date;
  /** `false` quand le poll a tourné mais n'a pas pu lire (véhicule déconnecté, quota…). */
  ok: boolean;
}

export interface Trou {
  debut: Date;
  fin: Date;
  minutes: number;
  /** Nombre de passages qui auraient dû tomber dans ce trou. */
  passagesManques: number;
}

export interface Cadence {
  /** Passages réellement enregistrés dans la fenêtre. */
  nbPassages: number;
  /** Passages ATTENDUS sur la même fenêtre, à la cadence configurée. */
  nbAttendus: number;
  /** `nbPassages / nbAttendus`, borné à 1 — au-delà, c'est un doublon, pas une couverture. */
  couverture: number;
  /** Écart médian observé, en minutes. `null` sous deux passages. */
  ecartMedianMinutes: number | null;
  /** Trous dépassant le seuil d'oubli, du plus récent au plus ancien. */
  trous: Trou[];
  /** Minutes écoulées depuis le dernier passage. `null` si aucun passage connu. */
  depuisDernierMinutes: number | null;
  /** Vrai quand le poll est EN CE MOMENT en retard au-delà du seuil. */
  enRetardMaintenant: boolean;
  /** Vrai quand aucun passage n'est connu — à distinguer d'une cadence dégradée. */
  aucunHistorique: boolean;
}

/**
 * Analyse la cadence observée sur une fenêtre. PURE.
 *
 * ⚠️ « Aucun passage » et « cadence dégradée » sont deux situations OPPOSÉES qui produisent
 * toutes deux un écran vide : la première veut dire que la surveillance vient d'être
 * installée (ou que la table est vide), la seconde qu'elle fonctionne et rapporte un
 * problème. `aucunHistorique` les sépare — sans ça, une installation neuve ressemblerait à
 * une panne totale.
 *
 * ⚠️ Le trou de FIN (depuis le dernier passage jusqu'à maintenant) est traité à part : il
 * est EN COURS, donc il n'a pas la même valeur qu'un trou refermé. Le confondre avec les
 * autres ferait clignoter une alerte à chaque fois qu'on regarde l'écran 31 minutes après
 * le dernier poll, ce qui est parfaitement normal.
 */
export function analyserCadence(params: {
  passages: PassagePoll[];
  maintenant: Date;
  fenetreHeures?: number;
  cadenceMinutes?: number;
}): Cadence {
  const {
    passages,
    maintenant,
    fenetreHeures = 24,
    cadenceMinutes = CADENCE_POLL_MINUTES,
  } = params;

  const debutFenetre = new Date(maintenant.getTime() - fenetreHeures * 3_600_000);
  const seuil = seuilOubliMinutes(cadenceMinutes);

  const dans = passages
    .filter((p) => Number.isFinite(p.t.getTime()))
    .filter((p) => p.t >= debutFenetre && p.t <= maintenant)
    .sort((a, b) => a.t.getTime() - b.t.getTime());

  const nbAttendus = Math.max(1, Math.round((fenetreHeures * 60) / cadenceMinutes));

  if (dans.length === 0) {
    return {
      nbPassages: 0,
      nbAttendus,
      couverture: 0,
      ecartMedianMinutes: null,
      trous: [],
      depuisDernierMinutes: null,
      enRetardMaintenant: false,
      aucunHistorique: true,
    };
  }

  const ecarts: number[] = [];
  const trous: Trou[] = [];
  for (let i = 1; i < dans.length; i += 1) {
    const minutes = (dans[i]!.t.getTime() - dans[i - 1]!.t.getTime()) / 60_000;
    ecarts.push(minutes);
    if (minutes > seuil) {
      trous.push({
        debut: dans[i - 1]!.t,
        fin: dans[i]!.t,
        minutes,
        // Un trou de 101 min à 30 min de cadence a sauté 2 passages (le 3e est celui qui a
        // fini par tourner). `floor(101/30) - 1 = 2`.
        passagesManques: Math.max(1, Math.floor(minutes / cadenceMinutes) - 1),
      });
    }
  }

  const dernier = dans[dans.length - 1]!;
  const depuisDernier = (maintenant.getTime() - dernier.t.getTime()) / 60_000;

  return {
    nbPassages: dans.length,
    nbAttendus,
    couverture: Math.min(1, dans.length / nbAttendus),
    ecartMedianMinutes: ecarts.length > 0 ? mediane(ecarts) : null,
    trous: trous.reverse(),
    depuisDernierMinutes: depuisDernier,
    enRetardMaintenant: depuisDernier > seuil,
    aucunHistorique: false,
  };
}

/** Médiane — pas la moyenne : un seul trou de 101 min tirerait la moyenne et donnerait
    une cadence « moyenne » que le poll n'a jamais eue. */
export function mediane(valeurs: number[]): number {
  const tri = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(tri.length / 2);
  return tri.length % 2 === 0 ? (tri[milieu - 1]! + tri[milieu]!) / 2 : tri[milieu]!;
}

export type GraviteCadence = "normale" | "degradee" | "rompue";

/**
 * Verdict sur la cadence, pour décider de ce qu'on affiche.
 *
 * Les seuils sont dérivés de la couverture observée, pas de compteurs absolus : « 3 trous »
 * ne veut rien dire sans savoir sur quelle durée. La couverture, elle, se compare.
 */
export function graviteCadence(c: Cadence): GraviteCadence {
  if (c.aucunHistorique) return "normale";
  if (c.enRetardMaintenant && c.depuisDernierMinutes !== null && c.depuisDernierMinutes > 180) {
    return "rompue";
  }
  if (c.couverture < 0.5) return "rompue";
  if (c.couverture < 0.85 || c.trous.length > 0) return "degradee";
  return "normale";
}

/**
 * Ce que la cadence observée COÛTE en données, dit en clair.
 *
 * C'est la phrase qui relie une statistique à ce que Marc constate : un trou n'est pas une
 * abstraction, c'est une recharge qu'il ne verra jamais. Rendue seulement quand il y a
 * quelque chose à dire — pas de phrase rassurante quand tout va bien, elle serait du bruit.
 */
export function consequenceCadence(c: Cadence): string | null {
  if (c.aucunHistorique || c.trous.length === 0) return null;

  const plusGrand = c.trous.reduce((max, t) => (t.minutes > max.minutes ? t : max), c.trous[0]!);
  const minutes = Math.round(plusGrand.minutes);

  return (
    `Le plus grand trou a duré ${minutes} min. Une recharge ou un trajet plus court que ça, ` +
    `commencé et terminé pendant ce silence, n’a laissé AUCUNE trace : ni l’un ni l’autre ` +
    `n’est mesuré par la voiture — les deux sont déduits de relevés qui l’encadrent.`
  );
}
