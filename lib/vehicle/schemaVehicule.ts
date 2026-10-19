// lib/vehicle/schemaVehicule.ts — l'état du véhicule ramené à sa GÉOMÉTRIE.
//
// ══ POURQUOI CE MODULE EXISTE ════════════════════════════════════════════════════════
//
// Marc, 13/08/2026 : « je veux des images pour les pneus et pour tout ce qui serait
// pertinent ». Une pression de pneu est une donnée SPATIALE : « 210 kPa » ne dit rien tant
// qu'on ne sait pas QUELLE roue, et un tableau de quatre lignes oblige à reconstruire
// mentalement la voiture. Un schéma vu de dessus répond à la vraie question — « laquelle
// est molle ? » — sans lecture.
//
// Ce fichier ne dessine rien : il fait la partie qui doit être TESTÉE, c'est-à-dire placer
// chaque mesure à sa position et décider de son état. Le SVG vit dans
// `app/ui/SchemaVehicule.tsx` et ne fait que rendre ce que ces fonctions décident.
//
// ══ LES SEUILS NE SONT PAS RÉINVENTÉS ICI ════════════════════════════════════════════
//
// ⚠️ Ils sont IMPORTÉS de `lib/vehicle/alertes.ts`. Le schéma et les alertes de l'accueil
// doivent dire la même chose : une roue peinte en rouge ici alors qu'aucune alerte ne
// tombe (ou l'inverse) détruirait la confiance dans les deux écrans à la fois. Recopier
// « 20 » ici aurait produit exactement cette divergence au premier rajustement.
//
// Et comme dans `alertes.ts`, AUCUN seuil constructeur n'est écrit : la pression nominale
// de la bZ n'est pas dans les données. On détecte par COMPARAISON — une roue contre les
// autres, une roue contre sa propre habitude.

import { BAISSE_PNEU_KPA, ECART_PNEU_KPA, mediane } from "@/lib/vehicle/alertes";

/** Les quatre coins, tels que le schéma les dessine. */
export type Position = "avant-gauche" | "avant-droite" | "arriere-gauche" | "arriere-droite";

export const POSITIONS: readonly Position[] = [
  "avant-gauche",
  "avant-droite",
  "arriere-gauche",
  "arriere-droite",
];

const LIBELLES_POSITION: Record<Position, string> = {
  "avant-gauche": "avant gauche",
  "avant-droite": "avant droite",
  "arriere-gauche": "arrière gauche",
  "arriere-droite": "arrière droite",
};

export function libellePosition(position: Position): string {
  return LIBELLES_POSITION[position];
}

/**
 * Reconnaît une position dans un libellé libre. PURE, testée.
 *
 * Accepte ce que `rouesDuJson` produit (« avant gauche ») ET les formes que les sources
 * emploient pour les ouvrants (`frontLeft`, `front_left`, `REAR_RIGHT`…). Rend `null`
 * quand la position n'est pas reconnaissable — mieux vaut ne rien placer sur le schéma que
 * de dessiner une portière ouverte du mauvais côté.
 */
export function positionDepuisLibelle(libelle: string): Position | null {
  const n = libelle
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const avant = /(avant|front|fore)/.test(n);
  const arriere = /(arriere|rear|back)/.test(n);
  const gauche = /(gauche|left)/.test(n);
  const droite = /(droite|droit|right)/.test(n);

  // Une seule des deux dimensions suffit à rendre la position AMBIGUË : on refuse.
  if (avant === arriere) return null;
  if (gauche === droite) return null;

  if (avant) return gauche ? "avant-gauche" : "avant-droite";
  return gauche ? "arriere-gauche" : "arriere-droite";
}

/**
 * Position depuis les coordonnées `row`/`column` de Smartcar. PURE, testée.
 *
 * Convention mesurée sur la bZ (06/08/2026, `wheel-tires`) : rangée 0 = avant,
 * colonne 0 = gauche — la même que `rouesDuJson`.
 */
export function positionDepuisRangee(row: unknown, column: unknown): Position | null {
  const r = coordonnee(row);
  const c = coordonnee(column);
  if (r === null || c === null) return null;
  const rangee = r === 1 ? "arriere" : r === 0 ? "avant" : null;
  const cote = c === 1 ? "droite" : c === 0 ? "gauche" : null;
  if (!rangee || !cote) return null;
  return `${rangee}-${cote}` as Position;
}

/**
 * Une coordonnée, ou `null`. PURE.
 *
 * ⚠️ Le passage par `Number()` seul est un piège, trouvé par son test : `Number(null)`,
 * `Number("")` et `Number([])` valent tous **0** — donc un champ ABSENT devenait la rangée
 * 0, c'est-à-dire « avant », et le module inventait la position qu'il promet de ne jamais
 * deviner. Seuls un vrai nombre et une chaîne numérique non vide sont acceptés.
 */
function coordonnee(valeur: unknown): number | null {
  if (typeof valeur === "number") return Number.isFinite(valeur) ? valeur : null;
  if (typeof valeur === "string" && valeur.trim() !== "") {
    const n = Number(valeur);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export type EtatPneu = "ok" | "surveiller" | "alerte";

export interface PneuDiagnostique {
  /** `null` si la source nomme la roue autrement que par un coin reconnaissable. */
  position: Position | null;
  libelle: string;
  pressionKpa: number;
  /** Le psi est l'unité des pompes à air d'ici — le kPa ne se compare à rien au garage. */
  psi: number;
  etat: EtatPneu;
  /** Écart à la médiane des AUTRES roues, en kPa. `null` sous trois roues. */
  ecartKpa: number | null;
  /** Baisse par rapport à sa propre référence passée. `null` sans référence. */
  baisseKpa: number | null;
  /** Ce qui justifie l'état, en une phrase courte. Vide quand tout va bien. */
  raison: string;
}

/** 1 kPa = 0,145038 psi. Conversion exacte, pas un arrondi de confort. */
export const PSI_PAR_KPA = 0.1450377;

/**
 * L'état de chaque roue, prêt à peindre. PURE, testée.
 *
 * Deux comparaisons, exactement celles de `alertes.ts` :
 *   • à la MÉDIANE des autres roues (le véhicule est son propre témoin) ;
 *   • à SA PROPRE référence passée (ce qui attrape une crevaison lente que les quatre
 *     roues, descendant ensemble par temps froid, masqueraient).
 *
 * Trois niveaux au lieu de deux : `alerte` au seuil des alertes, `surveiller` à la MOITIÉ
 * de ce seuil. Cette moitié n'existe QUE sur ce schéma — elle ne crée aucune alerte, elle
 * colore. Une dérive qui commence mérite d'être visible avant de mériter d'être criée.
 */
export function diagnostiquerPneus(
  roues: Array<{ libelle: string; pression: number }>,
  references?: Map<string, number>,
): PneuDiagnostique[] {
  return roues.map((roue) => {
    const autres = roues.filter((r) => r.libelle !== roue.libelle).map((r) => r.pression);
    const ecartKpa = autres.length >= 2 ? mediane(autres) - roue.pression : null;

    const reference = references?.get(roue.libelle);
    const baisseKpa = reference === undefined ? null : reference - roue.pression;

    let etat: EtatPneu = "ok";
    let raison = "";
    if (ecartKpa !== null && ecartKpa >= ECART_PNEU_KPA) {
      etat = "alerte";
      raison = `${Math.round(ecartKpa)} kPa sous les autres roues`;
    } else if (baisseKpa !== null && baisseKpa >= BAISSE_PNEU_KPA) {
      etat = "alerte";
      raison = `${Math.round(baisseKpa)} kPa sous son habitude`;
    } else if (ecartKpa !== null && ecartKpa >= ECART_PNEU_KPA / 2) {
      etat = "surveiller";
      raison = `${Math.round(ecartKpa)} kPa sous les autres roues`;
    } else if (baisseKpa !== null && baisseKpa >= BAISSE_PNEU_KPA / 2) {
      etat = "surveiller";
      raison = `${Math.round(baisseKpa)} kPa sous son habitude`;
    }

    return {
      position: positionDepuisLibelle(roue.libelle),
      libelle: roue.libelle,
      pressionKpa: roue.pression,
      psi: roue.pression * PSI_PAR_KPA,
      etat,
      ecartKpa,
      baisseKpa,
      raison,
    };
  });
}

export interface Ouvrant {
  /** Le nom que la SOURCE emploie — jamais un nom inventé pour faire joli. */
  cle: string;
  /** `null` quand le corps ne dit pas de quel coin il s'agit. */
  position: Position | null;
  ouvert: boolean;
}

/**
 * Déplie un corps d'ouvrants (portières, vitres) en états positionnés. PURE, testée.
 *
 * ⚠️ La position n'est JAMAIS devinée. Deux formes sont reconnues — les coordonnées
 * `row`/`column` de Smartcar, et un nom qui contient le coin (`frontLeft`) — et tout le
 * reste rend `position: null`. Le schéma affiche alors un compte sans colorier de portière :
 * dessiner « arrière droite ouverte » parce que c'était la troisième du tableau serait une
 * donnée inventée sur un écran qui sert justement à vérifier qu'on a tout fermé.
 */
export function ouvrantsDuJson(valueJson: unknown): Ouvrant[] {
  const corps = (valueJson ?? {}) as Record<string, unknown>;
  const brut = corps.values;
  const liste = Array.isArray(brut)
    ? brut
    : Array.isArray((brut as Record<string, unknown>)?.values)
      ? ((brut as Record<string, unknown>).values as unknown[])
      : null;

  if (liste) {
    const sorties: Ouvrant[] = [];
    for (const entree of liste) {
      const item = (entree ?? {}) as Record<string, unknown>;
      const ouvert = lireBooleen(item);
      if (ouvert === null) continue;
      const position =
        positionDepuisRangee(item.row, item.column) ??
        (typeof item.name === "string" ? positionDepuisLibelle(item.name) : null);
      sorties.push({
        cle: position ? libellePosition(position) : nomDeSecours(item, sorties.length),
        position,
        ouvert,
      });
    }
    return sorties;
  }

  // Forme « un objet par ouvrant » : { frontLeft: { isOpen: true }, … }
  const sorties: Ouvrant[] = [];
  for (const [cle, sous] of Object.entries(corps)) {
    if (sous === null || typeof sous !== "object" || Array.isArray(sous)) continue;
    const ouvert = lireBooleen(sous as Record<string, unknown>);
    if (ouvert === null) continue;
    sorties.push({ cle, position: positionDepuisLibelle(cle), ouvert });
  }
  return sorties;
}

/** Lit `isOpen` / `is_open` quel que soit sa casse. `null` si le champ est absent. */
function lireBooleen(item: Record<string, unknown>): boolean | null {
  for (const [cle, valeur] of Object.entries(item)) {
    if (!/^is_?open$/i.test(cle)) continue;
    if (typeof valeur === "boolean") return valeur;
    if (typeof valeur === "string") {
      const v = valeur.trim().toLowerCase();
      if (v === "true") return true;
      if (v === "false") return false;
    }
  }
  return null;
}

function nomDeSecours(item: Record<string, unknown>, index: number): string {
  return typeof item.name === "string" && item.name.trim() !== ""
    ? item.name
    : `ouvrant ${index + 1}`;
}

export interface ResumeOuvrants {
  /** Positions dont on SAIT qu'elles sont ouvertes. */
  ouvertes: Position[];
  /** Ouvrants ouverts dont la position est inconnue — comptés, jamais placés. */
  nbOuvertsSansPosition: number;
  nbTotal: number;
}

/** Ce que le schéma peut peindre, et ce qu'il doit se contenter de compter. PURE, testée. */
export function resumerOuvrants(ouvrants: Ouvrant[]): ResumeOuvrants {
  const ouvertes: Position[] = [];
  let nbOuvertsSansPosition = 0;
  for (const o of ouvrants) {
    if (!o.ouvert) continue;
    if (o.position) ouvertes.push(o.position);
    else nbOuvertsSansPosition += 1;
  }
  return { ouvertes, nbOuvertsSansPosition, nbTotal: ouvrants.length };
}
