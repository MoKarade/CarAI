// lib/vehicle/tarifsBornes.ts — ce que coûte une recharge, SELON L'ENDROIT. PUR, testé.
//
// Marc, 13/08/2026 : « pour le prix des bornes je veux une recherche intelligente […] un
// tarif horaire à un endroit, le prix d'Hydro à la maison […] pour les autres bornes,
// regarde où j'ai chargé sur la carte, trouve le fournisseur et estime le prix ».
//
// ══ POURQUOI LES LIEUX NE SONT PAS DANS CE FICHIER ═══════════════════════════════════
//
// ⚠️ Le dépôt CarAI est PUBLIC. L'adresse du domicile de Marc et celle de son employeur ne
// peuvent entrer dans AUCUN fichier versionné — c'est le garde-fou n°1 de JobAI appliqué
// ici. Les lieux vivent donc en BASE (clé de config `lieux`), saisis par Marc dans
// Réglages, exactement comme les termes du bail. Ce fichier ne contient que des FORMULES et
// des tarifs PUBLICS d'opérateurs ; aucune coordonnée personnelle.
//
// ══ TROIS QUALITÉS DE PRIX, ET ELLES NE SE MÉLANGENT JAMAIS ══════════════════════════
//
//   • `mesure`  — le tarif vient de Marc (son lieu, son contrat Hydro). C'est un vrai prix.
//   • `estime`  — le tarif vient de la table publique ci-dessous. C'est une hypothèse.
//   • `inconnu` — on ne sait pas. Montant `null`, jamais zéro.
//
// ⚠️ Marc a explicitement demandé les estimations (13/08), en connaissance du fait qu'elles
// ne sont pas mesurées : j'avais recommandé de n'afficher aucun montant deviné, il a tranché
// autrement. Le compromis tenu ici : l'estimation existe, mais elle est ÉTIQUETÉE partout,
// elle ne se totalise jamais en silence avec du mesuré, et un tarif saisi par Marc l'écrase
// toujours.

/** Comment une borne facture. Les deux existent au Québec, et ça change tout au calcul. */
export type ModeTarif = "horaire" | "kwh";

export type QualitePrix = "mesure" | "estime" | "inconnu";

/** Un lieu que Marc a nommé et tarifé lui-même. Vit en BASE, jamais dans le dépôt. */
export interface LieuTarife {
  /** Nom court, choisi par Marc (« Boulot », « Maison »). */
  nom: string;
  lat: number;
  lng: number;
  /** Rayon d'appariement, en mètres. Un stationnement fait quelques dizaines de mètres. */
  rayonM: number;
  mode: ModeTarif;
  /** $/h en mode horaire, $/kWh en mode kWh. */
  tarif: number;
}

/**
 * TARIFS PUBLICS TYPIQUES, par exploitant.
 *
 * ⚠️ CE SONT DES ORDRES DE GRANDEUR, PAS DES PRIX RELEVÉS. Ils ne viennent d'aucune API :
 * il n'existe pas de source gratuite donnant le tarif d'une borne précise, et chaque
 * exploitant facture différemment d'une borne à l'autre. Ils périmeront sans prévenir.
 *
 * Sources et date, comme l'exige la discipline « un chiffre sans source est SUSPECT »
 * (héritée de `FISCAL_REFERENCE.md` chez FinanceAI) :
 *   • Circuit électrique — grilles publiques du réseau d'Hydro-Québec, niveau 2 facturé à
 *     l'heure, recharge rapide facturée à la minute selon la puissance. Relevé le 13/08/2026.
 *   • FLO — tarification fixée PAR PROPRIÉTAIRE de borne ; la valeur ci-dessous est la plus
 *     courante observée sur le réseau public. Relevé le 13/08/2026.
 *   • Tesla / autres — non couverts : mieux vaut « inconnu » qu'un chiffre au hasard.
 *
 * ⚠️ Toute borne dont Marc saisit le tarif SORT de cette table : le mesuré gagne toujours.
 */
export interface TarifTypique {
  exploitant: string;
  mode: ModeTarif;
  tarif: number;
  /** Ce qu'on affiche à côté du montant pour que personne ne le prenne pour un relevé. */
  note: string;
}

export const TARIFS_TYPIQUES: readonly TarifTypique[] = [
  {
    exploitant: "circuit électrique",
    mode: "horaire",
    tarif: 1.0,
    note: "tarif typique du Circuit électrique en niveau 2 (13/08/2026)",
  },
  {
    exploitant: "flo",
    mode: "horaire",
    tarif: 1.5,
    note: "tarif FLO le plus courant en niveau 2 — chaque propriétaire fixe le sien (13/08/2026)",
  },
  {
    exploitant: "chargepoint",
    mode: "horaire",
    tarif: 1.5,
    note: "tarif ChargePoint typique en niveau 2 (13/08/2026)",
  },
];

/**
 * ══ LE PRIX DE LA RECHARGE RAPIDE SUIT LE DÉBIT ══════════════════════════════════════
 *
 * Marc, 14/09 : « pour le prix de l'électricité je veux que ce soit par rapport au débit
 * de charge ».
 *
 * ⚠️ CE QUE FAISAIT L'APP AVANT, mesuré en appelant le vrai code avec EXACTEMENT ce que
 * passent les trois appelants de production : une recharge rapide de 50 kWh en 30 minutes
 * (débit mesuré 100 kW) était facturée **3,91 $**, au tarif du kWh d'Hydro de Marc. Son
 * explication l'avouait déjà — « cette borne facture peut-être autrement » — sans que le
 * montant en tienne compte. Une borne publique rapide coûte plusieurs fois ce prix-là.
 *
 * ⚠️ Et la table des exploitants ci-dessus était INATTEIGNABLE : aucun des trois appelants
 * ne passe `exploitant`. Elle existe, elle est testée, et elle n'a jamais servi en
 * production. Elle reste en place (un jour un appelant l'alimentera) mais elle n'est PAS
 * le chemin que ce lot corrige.
 *
 * ⚠️⚠️ CES TARIFS SONT DES ORDRES DE GRANDEUR DE MÉMOIRE, PAS UNE GRILLE RELEVÉE, et Marc
 * a choisi cette option en connaissance de cause : la session n'a pas d'accès réseau vers
 * le site du Circuit électrique, et le dépôt interdit d'écrire un chiffre en le faisant
 * passer pour sourcé. Ce qui est SOLIDE ici, c'est la FORME — le prix du kWh monte avec la
 * puissance de la borne, et une recharge rapide coûte plusieurs fois le tarif domestique.
 * Ce qui est FRAGILE, c'est chaque valeur. Elles se corrigent toutes ici, en un endroit.
 * Un lieu tarifé par Marc (Réglages) les écrase toujours : le mesuré gagne sur l'estimé.
 *
 * ⚠️ LE DÉBIT MESURÉ SOUS-ESTIME LA BORNE, et Marc a accepté ce biais. C'est une MOYENNE
 * sur toute la session : une borne de 100 kW qui bride en fin de charge rend un débit
 * moyen bien plus bas. Le palier choisi est donc un MINORANT, donc le prix aussi. L'erreur
 * va toujours dans le même sens — on sous-facture, jamais l'inverse — et c'est dit à
 * l'écran plutôt que caché.
 */
export interface PalierRapide {
  /** Puissance NOMINALE de la classe de bornes, telle qu'on la nomme au Québec. */
  nominaleKw: number;
  /** Débit mesuré à partir duquel ce palier s'applique, en kW. */
  seuilKw: number;
  /** $/kWh. Ordre de grandeur, jamais un relevé. */
  tarifKwh: number;
}

/**
 * ⚠️ LES SEUILS SONT DÉRIVÉS, PAS CHOISIS. Marc a demandé les paliers 50 / 100 / 180 kW —
 * ce sont des puissances NOMINALES de bornes, alors qu'on classe sur un débit MESURÉ. La
 * frontière neutre entre deux classes nominales est leur milieu : (50+100)/2 = 75 et
 * (100+180)/2 = 140. Écrire 100 et 180 aurait exigé qu'une borne atteigne sa puissance
 * nominale en moyenne sur toute la session, ce qu'aucune ne fait.
 *
 * Le plancher à 20 kW est celui qui sépare DÉJÀ le niveau 2 de la recharge rapide dans
 * `charges.ts` (`SEUIL_RAPIDE_KW`) : une seule définition de « c'est une borne rapide »,
 * pas deux qui divergeront.
 */
/**
 * Le tarif d'un kWh à la maison, en ORDRE DE GRANDEUR. Décision de Marc, 14/09 :
 * « signalé mais tout estimé ».
 *
 * ══ CE QUE CETTE CONSTANTE CHANGE, ET POURQUOI ELLE EST ACCEPTABLE ═══════════════════
 *
 * Avant elle, une recharge faite hors des lieux connus, à vitesse normale, et sans tarif
 * renseigné dans les Réglages, rendait `inconnu` — donc « — » à l'écran. C'était fidèle au
 * principe « rien n'est deviné à ta place », et ça laissait quatre recharges sans montant
 * dans un cumul qui se veut un total. Marc a tranché : il préfère un ordre de grandeur
 * ANNONCÉ à un trou.
 *
 * ⚠️ Ce n'est PAS un assouplissement du no-fake-data, et la frontière tient à trois choses :
 *   • la qualité reste `estime`, jamais `mesure` — le hub et l'écran ne les additionnent
 *     jamais, donc ce chiffre n'entre pas dans le total « mesuré » ;
 *   • l'explication DIT que c'est un ordre de grandeur et comment l'exacter ;
 *   • l'écran Réglages signale que le tarif manque, tant qu'il manque.
 *
 * ⚠️⚠️ LA VALEUR EST DE MÉMOIRE, comme les tarifs de bornes. Le tarif d'Hydro-Québec dépend
 * du palier de consommation, de l'abonnement et de la date ; 0,08 $/kWh est l'ordre de
 * grandeur d'un tarif résidentiel québécois, pas le tarif de Marc. Un chiffre renseigné
 * dans les Réglages le remplace immédiatement — c'est le but.
 */
export const TARIF_DOMESTIQUE_ORDRE_DE_GRANDEUR = 0.08;

export const PALIERS_RAPIDE: readonly PalierRapide[] = [
  { nominaleKw: 180, seuilKw: 140, tarifKwh: 0.55 },
  { nominaleKw: 100, seuilKw: 75, tarifKwh: 0.45 },
  { nominaleKw: 50, seuilKw: 20, tarifKwh: 0.35 },
];

/**
 * Le palier qui correspond à un débit mesuré, ou `null` si la charge n'est pas rapide.
 * PURE.
 *
 * ⚠️ Les paliers sont parcourus du plus puissant au moins puissant : le premier dont le
 * seuil est atteint gagne. Dans l'autre sens, un débit de 200 kW tomberait dans le palier
 * 50 kW — le premier dont il dépasse le seuil — et serait facturé au tarif le plus bas.
 */
export function palierRapide(puissanceKw: number | null | undefined): PalierRapide | null {
  if (puissanceKw === null || puissanceKw === undefined) return null;
  if (!Number.isFinite(puissanceKw)) return null;
  return PALIERS_RAPIDE.find((p) => puissanceKw >= p.seuilKw) ?? null;
}

/** Retrouve un tarif typique par nom d'exploitant, insensible à la casse. PURE. */
export function tarifTypique(exploitant: string | null | undefined): TarifTypique | null {
  if (!exploitant) return null;
  const cle = exploitant.trim().toLowerCase();
  if (cle === "") return null;
  return (
    TARIFS_TYPIQUES.find((t) => cle === t.exploitant || cle.includes(t.exploitant)) ?? null
  );
}

const RAYON_TERRE_M = 6_371_000;

/**
 * Distance entre deux points, en mètres (haversine). PURE.
 *
 * ⚠️ Pas de distance « à plat » sur les degrés : à la latitude de Québec, un degré de
 * longitude vaut ~0,68 fois un degré de latitude. Une comparaison naïve apparierait une
 * borne située à 300 m à l'est comme si elle était à 450 m — et raterait le bon lieu.
 */
export function distanceM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAYON_TERRE_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Le lieu connu qui correspond à une position — le PLUS PROCHE dans son rayon. PURE.
 *
 * ⚠️ Le plus proche, pas le premier trouvé : deux lieux dont les rayons se chevauchent
 * (une borne au travail et une borne publique en face) doivent départager par la distance,
 * sinon l'ordre de saisie déciderait du prix.
 */
export function lieuDeLaPosition(
  position: { lat: number; lng: number } | null,
  lieux: readonly LieuTarife[],
): LieuTarife | null {
  if (!position) return null;
  let meilleur: { lieu: LieuTarife; d: number } | null = null;
  for (const lieu of lieux) {
    const d = distanceM(position, lieu);
    if (d > lieu.rayonM) continue;
    if (!meilleur || d < meilleur.d) meilleur = { lieu, d };
  }
  return meilleur?.lieu ?? null;
}

export interface PrixSession {
  /** `null` quand on ne sait pas — jamais zéro, qui se lirait « gratuit ». */
  montant: number | null;
  qualite: QualitePrix;
  /** D'où vient le prix, en une phrase affichable telle quelle. */
  explication: string;
}

/**
 * Ce qu'a coûté une session. PURE, testée.
 *
 * L'ordre des sources n'est pas négociable : un lieu tarifé par Marc l'emporte sur tout,
 * puis le tarif du kWh de son contrat, puis seulement la table publique. Le MESURÉ gagne
 * toujours sur l'ESTIMÉ.
 *
 * ⚠️ Une borne HORAIRE se facture au temps BRANCHÉ, pas à l'énergie : c'est exactement le
 * cas d'un lieu à tarif horaire (ex. 1 $/h). Confondre les deux ferait payer une charge lente moins
 * cher qu'une rapide, alors que c'est l'inverse.
 */
export function prixSession(params: {
  dureeMinutes: number;
  energieKwh: number | null;
  /** Le lieu reconnu, s'il y en a un. */
  lieu: LieuTarife | null;
  /** Le tarif du kWh du contrat de Marc (Réglages) — pour la maison et le repli. */
  tarifKwh: number | null;
  /** L'exploitant identifié pour une borne publique, s'il l'a été. */
  exploitant?: string | null;
  /**
   * Le DÉBIT mesuré de la session, en kW (`estimerBorne().puissanceKw`). C'est lui qui
   * choisit le palier de la recharge rapide — demande de Marc, 14/09.
   *
   * ⚠️ Optionnel, et le rester : un appelant qui ne le passe pas retombe exactement sur
   * le comportement d'avant. Le rendre requis aurait cassé les trois appelants d'un coup
   * pour un gain nul, alors que l'absence de débit veut dire quelque chose de précis —
   * « on ne sait pas à quelle vitesse ça a chargé » — et se traite comme telle.
   */
  puissanceKw?: number | null;
  /**
   * `true` quand les bornes de la session sont des FENÊTRES de sondage, pas un temps de
   * branchement mesuré — ce qui est le cas de TOUTE session déduite du SOC, donc de
   * toutes aujourd'hui.
   *
   * ⚠️ REQUIS, délibérément, contrairement à `puissanceKw` juste au-dessus. L'absence
   * d'un débit veut dire quelque chose (« on ne sait pas à quelle vitesse ça a chargé ») ;
   * l'absence de celui-ci ne veut rien dire — toute session a des bornes, exactes ou non.
   * Le rendre optionnel aurait laissé un défaut silencieux `false` décider qu'un montant
   * est mesuré, et les trois appelants auraient continué de compiler sans le passer. Ici
   * c'est le compilateur qui garantit le câblage, pas la vigilance de qui édite.
   */
  bornesEstimees: boolean;
}): PrixSession {
  const {
    dureeMinutes,
    energieKwh,
    lieu,
    tarifKwh,
    exploitant = null,
    puissanceKw = null,
    bornesEstimees,
  } = params;

  // 1. UN LIEU CONNU DE MARC — c'est un vrai prix, il gagne sur tout le reste.
  if (lieu) {
    if (lieu.mode === "horaire") {
      // ⚠️ UN MAJORANT MULTIPLIÉ PAR UN TARIF NE DONNE PAS UNE MESURE (Marc, 17/09).
      // Une borne horaire facture le temps BRANCHÉ ; quand les bornes de la session sont
      // des fenêtres de sondage, ce temps est un majorant — donc le montant aussi. Le
      // présenter en `mesure` lui donnait l'habillage d'un prix relevé : sur la session
      // du 17/09, « 1,00 $/h sur 3 h 52 » affichait 3,86 $ pour une charge qui a duré ce
      // qu'elle a duré, et personne ne pouvait le savoir en lisant l'écran.
      // Le montant RESTE affiché — un trou dans un cumul coûte plus cher qu'un chiffre
      // dont on dit la valeur — mais il dit ce qu'il est : un plafond.
      const montant = (dureeMinutes / 60) * lieu.tarif;
      if (bornesEstimees) {
        return {
          montant,
          qualite: "estime",
          explication:
            `${lieu.nom} — ${lieu.tarif.toFixed(2)} $/h, AU PLUS : la durée ` +
            `(${formaterDuree(dureeMinutes)}) est la fenêtre entre deux relevés, pas un ` +
            `temps de branchement mesuré. Le vrai montant est inférieur ou égal.`,
        };
      }
      return {
        montant,
        qualite: "mesure",
        explication: `${lieu.nom} — ${lieu.tarif.toFixed(2)} $/h sur ${formaterDuree(dureeMinutes)}`,
      };
    }
    if (energieKwh === null) {
      return {
        montant: null,
        qualite: "inconnu",
        explication: `${lieu.nom} est facturé au kWh, mais l’énergie de cette session n’est pas connue`,
      };
    }
    return {
      montant: energieKwh * lieu.tarif,
      qualite: "mesure",
      explication: `${lieu.nom} — ${lieu.tarif.toFixed(3)} $/kWh sur ${energieKwh.toFixed(1)} kWh`,
    };
  }

  // 2. UNE RECHARGE RAPIDE — le prix suit le DÉBIT (Marc, 14/09).
  //
  // ⚠️ Placé APRÈS le lieu et AVANT la table des exploitants : un lieu que Marc a tarifé
  // lui-même reste un vrai prix et gagne, même si la charge y est rapide. La table des
  // exploitants, elle, ne connaît que du niveau 2 à l'heure — l'appliquer à une charge
  // rapide rendrait un montant dérisoire, ce qui est exactement le défaut corrigé ici.
  const palier = palierRapide(puissanceKw);
  if (palier) {
    if (energieKwh === null) {
      return {
        montant: null,
        qualite: "inconnu",
        explication:
          "Recharge rapide, mais l’énergie de cette session n’est pas connue — aucun montant ne serait honnête",
      };
    }
    return {
      montant: energieKwh * palier.tarifKwh,
      qualite: "estime",
      explication:
        `Estimation : recharge rapide à ~${puissanceKw!.toFixed(0)} kW mesurés, ` +
        `tarif d’ordre de grandeur d’une borne ${palier.nominaleKw} kW ` +
        `(${palier.tarifKwh.toFixed(2)} $/kWh). Le débit mesuré est une MOYENNE, donc le ` +
        `palier et le montant sont des minorants.`,
    };
  }

  // 3. UNE BORNE PUBLIQUE IDENTIFIÉE — tarif TYPIQUE, donc estimation assumée.
  const typique = tarifTypique(exploitant);
  if (typique) {
    if (typique.mode === "horaire") {
      return {
        montant: (dureeMinutes / 60) * typique.tarif,
        qualite: "estime",
        explication: `Estimation : ${typique.note}`,
      };
    }
    if (energieKwh !== null) {
      return {
        montant: energieKwh * typique.tarif,
        qualite: "estime",
        explication: `Estimation : ${typique.note}`,
      };
    }
  }

  // 4. NI LIEU, NI DÉBIT RAPIDE, NI EXPLOITANT — le tarif du kWh de Marc est le dernier
  //    repli raisonnable,
  //    et il reste une ESTIMATION : rien ne dit que cette borne facture au prix d'Hydro.
  if (energieKwh !== null && tarifKwh !== null) {
    return {
      montant: energieKwh * tarifKwh,
      qualite: "estime",
      explication:
        "Estimation au tarif de ton kWh — le lieu n’est pas reconnu, cette borne facture peut-être autrement",
    };
  }

  // 5. RIEN DE CONNU, MAIS ON SAIT COMBIEN DE kWh SONT PASSÉS — décision de Marc, 14/09 :
  //    « signalé mais tout estimé ». Plutôt qu'un trou dans le cumul, un ordre de grandeur
  //    qui s'annonce comme tel. Renseigner son tarif dans les Réglages le remplace.
  if (energieKwh !== null) {
    return {
      montant: energieKwh * TARIF_DOMESTIQUE_ORDRE_DE_GRANDEUR,
      qualite: "estime",
      explication:
        `Estimation grossière : ni lieu connu, ni borne rapide, et aucun tarif renseigné — ` +
        `compté à ${TARIF_DOMESTIQUE_ORDRE_DE_GRANDEUR.toFixed(2)} $/kWh, l’ordre de ` +
        `grandeur d’un tarif résidentiel. Renseigne ton tarif du kWh dans les Réglages pour ` +
        `que ce montant devienne le tien.`,
    };
  }

  // 6. MÊME PAS L'ÉNERGIE : là, il n'y a rien à estimer. Un montant exigerait d'inventer la
  //    grandeur elle-même, pas seulement son prix — ce qui reste hors de question.
  return {
    montant: null,
    qualite: "inconnu",
    explication:
      "Énergie inconnue pour cette session — sans les kWh, aucun montant ne serait honnête",
  };
}

function formaterDuree(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

/**
 * Totalise en SÉPARANT le mesuré de l'estimé. PURE.
 *
 * ⚠️ Un total unique qui mélangerait les deux serait le chiffre malhonnête par excellence —
 * exactement ce que le contrat du hub interdit avec ses périodes (`totalsByPeriod`, « jamais
 * d'agrégat entre unités incomparables »). Ici l'incomparable n'est pas l'unité, c'est la
 * CONFIANCE : additionner un prix connu et un prix supposé produit un montant dont personne
 * ne peut dire ce qu'il vaut.
 */
export function totaliserPrix(prix: readonly PrixSession[]): {
  mesure: number;
  estime: number;
  nbInconnus: number;
} {
  let mesure = 0;
  let estime = 0;
  let nbInconnus = 0;
  for (const p of prix) {
    if (!prixExploitable(p)) {
      nbInconnus += 1;
      continue;
    }
    if (p.qualite === "mesure") mesure += p.montant!;
    else estime += p.montant!;
  }
  return { mesure, estime, nbInconnus };
}

/**
 * Ce prix compte-t-il dans un total ? PURE.
 *
 * ⚠️ Source UNIQUE du critère, parce que deux endroits l'utilisent — le total et le cumul
 * de la courbe — et qu'ils doivent exclure EXACTEMENT les mêmes sessions. Deux copies, et
 * un jour la courbe monterait plus haut que le total posé juste au-dessus d'elle, sur le
 * même écran, sans que rien ne dise laquelle a raison.
 *
 * Un montant nul est légitime (une borne gratuite existe) ; c'est `null` et la qualité
 * `inconnu` qui disent « on ne sait pas », et ceux-là ne se comptent jamais comme zéro.
 */
export function prixExploitable(p: PrixSession): boolean {
  return p.montant !== null && p.qualite !== "inconnu";
}

/** Ce qu'un MOIS de recharges a coûté. Le mesuré et l'estimé restent séparés, comme partout. */
export interface MoisDeRecharge {
  /** Clé triable `AAAA-MM`, dans le fuseau de Marc. */
  cle: string;
  mesure: number;
  estime: number;
  nbSessions: number;
  nbInconnus: number;
  kwh: number;
}

/**
 * Les recharges regroupées par mois CALENDAIRE, du plus ancien au plus récent. PURE.
 *
 * ⚠️ LE MOIS SE DÉCIDE DANS LE FUSEAU DE MARC, jamais en UTC. Une recharge branchée le
 * 31 août à 21 h locale est le 1ᵉʳ septembre en UTC : comptée là, elle ferait démarrer un
 * mois sur une session qui appartient au précédent, et la tendance dirait le contraire de
 * ce qu'il a vécu. La clé passe donc par `Intl`, pas par `getMonth()`.
 *
 * ⚠️ Un mois SANS recharge n'apparaît pas : il n'y a rien à dire dessus, et une ligne à
 * zéro se lirait « ce mois-là n'a rien coûté » alors qu'il peut n'avoir rien été OBSERVÉ.
 * C'est à l'affichage de le traiter s'il veut une série continue.
 */
export function rechargesParMois(
  sessions: readonly { debut: Date; energieKwh: number | null; prix: PrixSession }[],
  fuseau = "America/Toronto",
): MoisDeRecharge[] {
  const cleDuMois = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuseau,
    year: "numeric",
    month: "2-digit",
  });
  const parCle = new Map<string, MoisDeRecharge>();
  for (const s of sessions) {
    // `en-CA` rend « 2026-09 » : triable en ordre lexicographique, ce dont dépend le tri.
    const cle = cleDuMois.format(s.debut);
    const mois = parCle.get(cle) ?? {
      cle,
      mesure: 0,
      estime: 0,
      nbSessions: 0,
      nbInconnus: 0,
      kwh: 0,
    };
    mois.nbSessions += 1;
    mois.kwh += s.energieKwh ?? 0;
    if (!prixExploitable(s.prix)) mois.nbInconnus += 1;
    else if (s.prix.qualite === "mesure") mois.mesure += s.prix.montant!;
    else mois.estime += s.prix.montant!;
    parCle.set(cle, mois);
  }
  return [...parCle.values()].sort((a, b) => a.cle.localeCompare(b.cle));
}

/** Un point de la courbe de cumul : ce qu'on a dépensé JUSQU'À cette recharge incluse. */
export interface PointCumul {
  t: Date;
  /** Cumul des prix MESURÉS. */
  mesure: number;
  /** Cumul des prix ESTIMÉS. Jamais additionné au précédent — voir `totaliserPrix`. */
  estime: number;
}

/**
 * La courbe de ce que les recharges ont coûté, du plus ancien au plus récent. PURE, testée.
 *
 * Demande de Marc, 14/09 : « courbe aussi de prix à rajouter », avec le CUMUL en ordonnée.
 *
 * ══ DEUX COURBES, PARCE QU'UN SEUL CUMUL SERAIT UN CHIFFRE INVENTÉ ══════════════════
 *
 * Le mesuré et l'estimé ne s'additionnent pas (cf. `totaliserPrix`). Une courbe unique les
 * fondrait — et une courbe est PIRE qu'un total pour ça : on lit une pente, une allure,
 * une projection, sans jamais revoir la note de bas de page qui disait que la moitié est
 * supposée. Les deux montent donc séparément, sur le même axe.
 *
 * ⚠️ UNE SESSION SANS PRIX NE FAIT PAS DE POINT. Elle n'en fait pas un à zéro non plus —
 * un palier sur un cumul se lit « cette recharge était gratuite », ce qui est exactement
 * le mensonge que `montant: null` existe pour éviter. Elle est COMPTÉE (`nbIgnorees`) et
 * l'écran le dit : une courbe qui saute des moments sans l'avouer est une courbe fausse.
 */
export function cumulerPrix(sessions: readonly { debut: Date; prix: PrixSession }[]): {
  points: PointCumul[];
  /** Combien de sessions n'ont pas pu entrer dans la courbe, faute de prix. */
  nbIgnorees: number;
} {
  // ⚠️ Copie avant tri : `reconstituerCharges` rend du plus RÉCENT au plus ancien, et
  // trier sur place réordonnerait le tableau de l'appelant — donc le fil affiché.
  const ordonnees = [...sessions].sort((a, b) => a.debut.getTime() - b.debut.getTime());
  const points: PointCumul[] = [];
  let mesure = 0;
  let estime = 0;
  let nbIgnorees = 0;
  for (const s of ordonnees) {
    if (!prixExploitable(s.prix)) {
      nbIgnorees += 1;
      continue;
    }
    if (s.prix.qualite === "mesure") mesure += s.prix.montant!;
    else estime += s.prix.montant!;
    points.push({ t: s.debut, mesure, estime });
  }
  return { points, nbIgnorees };
}

/**
 * Où était la voiture pendant une session de recharge. PURE, testée.
 *
 * ⚠️ On prend le dernier relevé AVANT ou PENDANT la session, jamais le suivant. La bZ ne
 * publie sa position qu'à l'arrêt (`LAST_PARKED`) : le relevé qui suit une recharge peut
 * déjà être le stationnement d'ARRIVÉE du trajet suivant, à des kilomètres de la borne.
 * Prendre le plus proche dans le temps, sans regarder le sens, apparierait donc la maison
 * à une recharge faite au travail.
 *
 * `toleranceMs` borne la remontée : un relevé vieux de trois jours ne dit pas où la voiture
 * était hier soir.
 */
export function positionPendant(
  session: { debut: Date; fin: Date },
  positions: readonly { t: Date; lat: number; lng: number }[],
  toleranceMs = 12 * 3_600_000,
): { lat: number; lng: number } | null {
  const finMs = session.fin.getTime();
  let meilleure: { p: { lat: number; lng: number }; t: number } | null = null;
  for (const p of positions) {
    const t = p.t.getTime();
    if (t > finMs) continue;
    if (!meilleure || t > meilleure.t) meilleure = { p: { lat: p.lat, lng: p.lng }, t };
  }
  if (!meilleure) return null;
  // Trop vieux pour dire quoi que ce soit de cette session.
  if (session.debut.getTime() - meilleure.t > toleranceMs) return null;
  return meilleure.p;
}
