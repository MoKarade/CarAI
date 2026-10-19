// lib/vehicle/paiementsBail.ts — « ce que j'ai payé sur le prix total du bail ». PURE.
//
// Deux sources, et chacune fait foi sur SON domaine :
//  - CarAI  : les TERMES du contrat (date de signature, durée) — `TermesBail`.
//  - FinanceAI : les DOLLARS (mensualité, solde, taux) — `lib/financeai/bail.ts`.
//
// ⚠️ LE TOTAL D'UN BAIL EST `mensualité × durée`, JAMAIS le montant financé. Les deux
// coïncident à taux nul et divergent dès que le taux ne l'est pas — `montantOrigine` est le
// CAPITAL, pas la somme des versements. Le prendre pour numérateur afficherait un « total »
// que Marc ne paiera jamais. Il sert donc de CONTRÔLE de cohérence, et à rien d'autre.
//
// ⚠️ CE MODULE NE FOND RIEN. Le versé au contrat et le coût des recharges sont deux
// grandeurs différentes : l'une se compare à un plafond contractuel, l'autre non. Elles sont
// rendues SÉPARÉMENT, et c'est l'écran qui les met côte à côte en le disant.

import type { TermesBail } from "./lease";

/** Ce que l'écran a besoin de savoir, et rien de plus. */
export interface PaiementsBail {
  mensualite: number;
  /** Versements déjà dus depuis la signature, borné à la durée du bail. */
  versementsFaits: number;
  /** Nombre total de versements du contrat. */
  versementsTotal: number;
  /** Ce qui a été versé au contrat à ce jour. */
  payeContrat: number;
  /** Ce que le contrat coûtera en tout — `mensualite × versementsTotal`. */
  totalContrat: number;
  /** Part du contrat déjà versée (0..1). */
  fraction: number;
  /**
   * Écarts relevés entre ce que CarAI sait et ce que FinanceAI publie. JAMAIS corrigés en
   * silence : un écart veut dire qu'une des deux sources est fausse, et ce n'est pas à ce
   * module de décider laquelle.
   */
  reserves: string[];
}

/** Ce que le calcul attend de FinanceAI — un sous-ensemble de `BailPublie`, pour que ce
 *  module reste PUR et testable sans le client réseau. */
export interface ChiffresBail {
  mensualite: number | null;
  solde: number;
  tauxAnnuelPourcent: number;
  montantOrigine: number | null;
  debut: string | null;
}

/** Tolérance du contrôle de cohérence, en dollars. Un bail se règle au cent près, mais un
 *  versement peut être arrondi et un mois peut être à cheval : sous ce seuil, le rapprochement
 *  ne dit rien d'utile. Au-dessus, il dit quelque chose et on l'écrit. */
const TOLERANCE_DOLLARS = 100;

/**
 * Combien de versements sont dus entre la signature et `maintenant`.
 *
 * ⚠️ Convention : un versement par MOIS COMPLET écoulé. Le premier mois n'est donc pas compté
 * tant qu'il n'est pas révolu — c'est la lecture PRUDENTE (elle sous-estime le payé plutôt que
 * de le sur-estimer). Si le contrat prélève à la signature, le contrôle de cohérence avec le
 * solde le dira : c'est exactement à ça qu'il sert.
 */
export function versementsDus(debut: Date, maintenant: Date, dureeMois: number): number {
  if (!(dureeMois > 0)) return 0;
  const ms = maintenant.getTime() - debut.getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;

  let mois =
    (maintenant.getUTCFullYear() - debut.getUTCFullYear()) * 12 +
    (maintenant.getUTCMonth() - debut.getUTCMonth());
  // Le mois n'est révolu que passé le quantième de la signature.
  if (maintenant.getUTCDate() < debut.getUTCDate()) mois -= 1;
  return Math.max(0, Math.min(dureeMois, mois));
}

/**
 * Le versé et le total du contrat, ou `null` quand la mensualité manque.
 *
 * `null` N'EST PAS un zéro : sans mensualité, aucun total n'existe, et une barre « 0 sur 0 »
 * aurait l'air d'une mesure. L'écran affiche alors ce qui manque, nommément.
 */
export function paiementsBail(params: {
  termes: TermesBail;
  chiffres: ChiffresBail;
  maintenant: Date;
}): PaiementsBail | null {
  const { termes, chiffres, maintenant } = params;
  const mensualite = chiffres.mensualite;
  if (mensualite === null || !(mensualite > 0)) return null;
  if (!(termes.dureeMois > 0)) return null;

  const debut = new Date(`${termes.debut}T00:00:00Z`);
  if (Number.isNaN(debut.getTime())) return null;

  const versementsTotal = termes.dureeMois;
  const versementsFaits = versementsDus(debut, maintenant, versementsTotal);
  const payeContrat = mensualite * versementsFaits;
  const totalContrat = mensualite * versementsTotal;

  const reserves: string[] = [];

  // CONTRÔLE 1 — le solde. À taux nul, ce qui reste dû vaut exactement les versements restants.
  // À taux non nul, la relation n'est plus linéaire : le contrôle n'aurait aucun sens, on
  // s'abstient plutôt que de signaler un faux écart.
  if (chiffres.tauxAnnuelPourcent === 0) {
    const resteAttendu = mensualite * (versementsTotal - versementsFaits);
    const ecart = Math.abs(chiffres.solde - resteAttendu);
    if (ecart > TOLERANCE_DOLLARS) {
      reserves.push(
        `le solde publié (${arrondi(chiffres.solde)} $) s'écarte de ${arrondi(ecart)} $ des ` +
          `${versementsTotal - versementsFaits} versements restants`,
      );
    }
  }

  // CONTRÔLE 2 — le montant financé. Il ne vaut la somme des versements qu'à taux nul ET sans
  // comptant. C'est le cas de ce bail (confirmé par Marc), donc un écart est une information.
  if (chiffres.montantOrigine !== null && chiffres.tauxAnnuelPourcent === 0) {
    const ecart = Math.abs(chiffres.montantOrigine - totalContrat);
    if (ecart > TOLERANCE_DOLLARS) {
      reserves.push(
        `le montant financé (${arrondi(chiffres.montantOrigine)} $) s'écarte de ` +
          `${arrondi(ecart)} $ du total des versements`,
      );
    }
  }

  // CONTRÔLE 3 — la date. CarAI fait foi sur les termes ; une divergence dit qu'une des deux
  // saisies est fausse, et Marc est le seul à pouvoir trancher.
  if (chiffres.debut !== null && chiffres.debut !== termes.debut) {
    reserves.push(`FinanceAI date le début au ${chiffres.debut}, CarAI au ${termes.debut}`);
  }

  return {
    mensualite,
    versementsFaits,
    versementsTotal,
    payeContrat,
    totalContrat,
    fraction: totalContrat > 0 ? payeContrat / totalContrat : 0,
    reserves,
  };
}

function arrondi(n: number): string {
  return Math.round(n).toLocaleString("fr-CA");
}
