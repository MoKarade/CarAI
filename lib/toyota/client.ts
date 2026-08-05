// lib/toyota/client.ts — adaptateur vers l'API Toyota Connected Amérique du Nord (Doc 3).
//
// ══════════════════════════════════════════════════════════════════════════════════════
// CE FICHIER NE DEVINE PAS D'ENDPOINTS, ET C'EST UNE DÉCISION — LIRE AVANT DE LE COMPLÉTER
// ══════════════════════════════════════════════════════════════════════════════════════
//
// `ha-toyota-na` est une intégration Home Assistant écrite en PYTHON, bâtie sur la
// bibliothèque `toyota-na` (`pip install toyota-na`). Elle n'est PAS installable dans une
// app Node/Next.js : il n'existe pas d'équivalent npm. La seule voie était de réimplémenter
// son flux d'authentification en TypeScript, ce qui suppose de LIRE son `auth.py`.
//
// Cette lecture n'a pas été possible dans la session qui a écrit ce fichier : les dépôts
// tiers ne sont pas accessibles (l'ajout inter-comptes est refusé) et `smartcar.com` comme
// les sources externes utiles sont filtrés par la politique d'egress.
//
// La tentation aurait été d'écrire des URLs plausibles de mémoire. Ç'aurait produit du code
// qui COMPILE, qui a l'air complet, qui passe une revue rapide — et qui échoue à la
// première requête réelle, en donnant à croire que « Toyota a encore changé son API » alors
// que ces adresses n'ont jamais existé. C'est exactement la fausse donnée que ce projet
// s'interdit, transposée au code.
//
// Le reste du module Toyota est donc COMPLET et testé — extraction OTP, stratégie de poll à
// deux vitesses, santé/désactivation automatique, persistance, routes, isolation. Seul cet
// adaptateur reste à brancher, et il est réduit à une INTERFACE ÉTROITE : deux méthodes.
//
// ── POUR LE BRANCHER (une session avec accès réseau au dépôt `toyotha/toyota-na`) ─────
//  1. Lire `toyota_na/auth.py` : flux de login, requête OTP, échange et rafraîchissement
//     de jeton. Le README de `widewing/ha-toyota-na` crédite @visualage pour la méthode
//     d'authentification sans navigateur — c'est le point d'entrée à comprendre.
//  2. Implémenter `ClientToyotaHttp` ci-dessous en respectant l'interface. Aucun autre
//     fichier n'a besoin de changer : `cycle.ts` ne connaît que `ClientToyota`.
//  3. Vérifier d'abord avec un test d'authentification MINIMAL et isolé, code OTP saisi à
//     la main (Doc 3 §2.2). Si l'échec est spécifique au marché canadien, ARRÊTER ce module
//     et rester sur Smartcar — ce n'est pas un échec du projet (Doc 3 §7).

import type { SignalBrut } from "@/lib/smartcar/signals";
import type { Env } from "@/lib/env";

/**
 * Ce que CarAI attend d'une source Toyota. Interface DÉLIBÉRÉMENT étroite : plus elle est
 * petite, moins l'isolation exigée par le Doc 1 §1 peut fuir dans le reste de l'app.
 */
export interface ClientToyota {
  /**
   * Authentifie la session. Peut déclencher le pipeline OTP (Doc 3 §4).
   * Doit tenter le rafraîchissement de jeton AVANT de repasser par l'OTP (Doc 3 §4.4).
   */
  authentifier(): Promise<void>;

  /**
   * Lit l'état du véhicule.
   *
   * ⚠️ `reveilForce` est le paramètre qui peut vider la batterie 12 V du véhicule (Doc 3
   * §5.1). Il ne doit JAMAIS être mis à `true` par défaut, ni dérivé d'une autre condition
   * à l'intérieur de cette méthode : c'est `deciderPoll` qui en décide, et lui seul.
   */
  lireStatut(options: { reveilForce: boolean }): Promise<SignalBrut[]>;
}

export class ToyotaNonBranche extends Error {
  constructor() {
    super(
      "Module Toyota : l'adaptateur réseau n'est pas implémenté. Le protocole d'authentification de `toyota-na` n'a pas pu être lu (dépôt tiers inaccessible), et il n'a pas été deviné volontairement — voir l'en-tête de lib/toyota/client.ts. CarAI fonctionne normalement sur Smartcar.",
    );
    this.name = "ToyotaNonBranche";
  }
}

export interface CredentialsToyota {
  username: string;
  password: string;
}

/** Identifiants Toyota depuis l'environnement. JAMAIS en base, JAMAIS en dur (Doc 3 §4.1). */
export function credentialsToyota(
  env: Env = process.env,
): CredentialsToyota | null {
  const username = env.TOYOTA_USERNAME?.trim();
  const password = env.TOYOTA_PASSWORD?.trim();
  if (!username || !password) return null;
  return { username, password };
}

/**
 * Fabrique du client. Renvoie `null` tant que l'adaptateur n'est pas implémenté.
 *
 * `null` plutôt qu'une exception : « pas branché » est un ÉTAT CONNU et acceptable de
 * CarAI, pas un incident. Tout le reste du module sait déjà composer avec l'absence de
 * cette source — c'est précisément ce que l'isolation du Doc 1 §1 exige.
 */
export function creerClientToyota(
  // Le paramètre fait partie du contrat que l'implémentation à venir consommera. Le
  // retirer obligerait à toucher tous les appelants le jour du branchement, pour une
  // ligne de confort aujourd'hui.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _credentials: CredentialsToyota,
): ClientToyota | null {
  return null;
}
