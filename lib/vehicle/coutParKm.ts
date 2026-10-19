// lib/vehicle/coutParKm.ts — « ça me coûte combien du 100 km ? » (demande de Marc, 15/09).
//
// Le chiffre que tout le monde comprend, parce qu'il se compare à un plein d'essence. Il est
// aussi le plus facile à rendre FAUX de façon crédible, et ce module existe pour ça.
//
// ⚠️ DEUX PIÈGES MESURÉS SUR DES DONNÉES RÉELLES, le 15/09 :
//
// 1. LE NUMÉRATEUR ET LE DÉNOMINATEUR NE COUVRENT PAS LA MÊME PÉRIODE. L'odomètre dit
//    plusieurs milliers de km depuis la signature ; les recharges observées ne commencent que
//    bien plus tard. Diviser l'un par l'autre rend un coût quatre fois trop bas,
//    sans que rien ne cloche à l'écran. Le seul remède est de mesurer les deux sur la MÊME
//    fenêtre — d'où `kmParcourus`, que l'appelant calcule sur la fenêtre des recharges.
//
// 2. MÊME SUR UNE FENÊTRE COMMUNE, L'HISTORIQUE A DES TROUS. Mesuré : quelques centaines de kWh
//    observés pour des milliers de km, soit moins de 4 kWh/100 km — impossible pour une bZ, qui en consomme ~15. Une
//    recharge que le canal n'a pas vue manque au numérateur, jamais au dénominateur : le
//    coût obtenu est donc TOUJOURS un PLANCHER. `couverture` le chiffre au lieu de le taire,
//    et elle se DÉRIVE du véhicule (capacité × état de charge ÷ autonomie), jamais d'une
//    consommation écrite en dur qui serait fausse pour un autre véhicule ou un autre hiver.

/** Ce que 100 km ont coûté en électricité, et ce que ce chiffre vaut. */
export interface CoutParCentKm {
  kmParcourus: number;
  kwhObserve: number;
  /** $/100 km en ne comptant QUE les recharges dont le prix est MESURÉ. */
  mesureParCentKm: number;
  /** $/100 km en comptant aussi les estimées. Le haut de la fourchette. */
  totalParCentKm: number;
  /** Part du montant total qui est estimée, 0 à 1. */
  partEstimee: number;
  /**
   * Part des kilomètres que l'énergie OBSERVÉE peut expliquer (1 = tout s'explique).
   * `null` quand la consommation de référence est inconnue — et `null` veut dire « on ne
   * sait pas », jamais « c'est bon ».
   */
  couverture: number | null;
}

/**
 * La consommation de référence du véhicule, en kWh/100 km. PURE.
 *
 * ⚠️ DÉRIVÉE de ce que la voiture publie, jamais écrite en dur : l'autonomie annoncée
 * correspond à l'état de charge COURANT, pas à une batterie pleine. Ignorer le `soc`
 * donnerait une consommation surestimée d'autant — à 64 %, un facteur 1,6.
 *
 * Rend `null` dès qu'un terme manque : une consommation inventée contaminerait la
 * couverture, qui contaminerait la phrase affichée sous le prix.
 */
export function consommationReference(params: {
  capaciteKwh: number | null;
  autonomieKm: number | null;
  socPourcent: number | null;
}): number | null {
  const { capaciteKwh, autonomieKm, socPourcent } = params;
  if (capaciteKwh === null || autonomieKm === null || socPourcent === null) return null;
  if (!(capaciteKwh > 0) || !(autonomieKm > 0)) return null;
  if (!(socPourcent > 0) || socPourcent > 100) return null;
  const energieDisponible = capaciteKwh * (socPourcent / 100);
  return (energieDisponible / autonomieKm) * 100;
}

/**
 * Le coût aux 100 km sur une fenêtre où les DEUX grandeurs sont mesurées. PURE.
 *
 * Rend `null` sans dénominateur : une division sans kilomètres ne se rabat pas sur zéro,
 * et « 0 $/100 km » se lirait « rouler ne coûte rien ».
 */
export function coutParCentKm(params: {
  totaux: { mesure: number; estime: number };
  kmParcourus: number;
  kwhObserve: number;
  consoReferenceKwhParCentKm: number | null;
}): CoutParCentKm | null {
  const { totaux, kmParcourus, kwhObserve, consoReferenceKwhParCentKm } = params;
  if (!Number.isFinite(kmParcourus) || kmParcourus <= 0) return null;

  const total = totaux.mesure + totaux.estime;
  if (!Number.isFinite(total) || total <= 0) return null;

  const cents = kmParcourus / 100;
  const attendu =
    consoReferenceKwhParCentKm !== null && consoReferenceKwhParCentKm > 0
      ? consoReferenceKwhParCentKm * cents
      : null;

  return {
    kmParcourus,
    kwhObserve,
    mesureParCentKm: totaux.mesure / cents,
    totalParCentKm: total / cents,
    partEstimee: totaux.estime / total,
    couverture: attendu === null ? null : kwhObserve / attendu,
  };
}

/**
 * Le seuil au-delà duquel on cesse de présenter le coût comme une mesure de la période.
 *
 * ⚠️ 0,85 n'est pas un chiffre rond choisi au hasard : l'énergie est DÉDUITE de l'état de
 * charge, par paliers de 1 %, donc elle sous-compte structurellement de quelques pourcents
 * même quand aucune session ne manque. En dessous, c'est l'historique qui est troué, pas
 * l'arrondi. Mesuré le 15/09 sur les données réelles : couverture de 0,25 — un quart.
 */
export const COUVERTURE_SUFFISANTE = 0.85;
