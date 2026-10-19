// lib/vehicle/reglages.ts — validation des RÉGLAGES saisis par Marc. PURE, testée.
//
// ══ POURQUOI CE FICHIER EXISTE (Marc, 13/08 : « le prix pour les recharges marche
//    toujours pas — sois plus précis et logique ») ══════════════════════════════════════
//
// Le prix ne marchait pas, et ce n'était pas un bug de calcul : `reconstituerCharges` sait
// très bien multiplier des kWh par un tarif. Le défaut était en amont — `tarifKwh` vivait
// dans la config (`CLE_BAIL`), et **rien dans toute l'application n'écrivait jamais cette
// clé**. `ecrireConfig` n'était appelé que pour les identifiants Smartcar. Le tarif ne
// pouvait donc être renseigné par AUCUN geste : ni écran, ni formulaire, ni commande.
//
// C'est la leçon JobAI mot pour mot : « une donnée qu'on ne peut ni fournir ni corriger
// n'est pas une limite de produit, c'est un défaut ». Refuser d'inventer un prix du kWh
// était juste ; ne donner aucun moyen de le saisir ne l'était pas. Les deux ensemble
// donnaient un écran qui affiche « — » pour toujours.
//
// Ce module contient la partie qui doit être testée : lire ce qu'un formulaire HTML envoie
// (des chaînes, toujours) et en faire des termes de bail valides — ou refuser en disant
// pourquoi.
//
// ⚠️ Un champ VIDE n'est pas zéro. Effacer le tarif remet `null` (« je ne sais pas »), ce
// qui fait disparaître les montants ; saisir `0` affirmerait que l'électricité est
// gratuite. Les deux sont des réponses légitimes et différentes, et le parseur les
// distingue — c'est tout l'objet de `nombreOuNull`.

import { SchemaBail, type Bail } from "@/lib/config";

export interface ResultatReglages {
  ok: boolean;
  /** Les termes validés, prêts à écrire. Absent en cas d'erreur. */
  bail?: Bail;
  /** Ce qui cloche, en français, champ par champ. Vide quand tout va bien. */
  erreurs: string[];
}

/**
 * Un nombre, ou `null` si le champ est VIDE. PURE.
 *
 * `Number("")` vaut 0 — le piège déjà rencontré sur `Number(null)` dans le schéma du
 * véhicule, sous un autre visage. Un champ laissé vide doit rendre « inconnu », jamais
 * « zéro » : sur un tarif, la différence sépare « aucun montant affiché » de « les
 * recharges sont gratuites ».
 */
export function nombreOuNull(valeur: FormDataEntryValue | null | undefined): number | null {
  if (typeof valeur !== "string") return null;
  const nettoye = valeur.trim().replace(",", ".");
  if (nettoye === "") return null;
  const n = Number(nettoye);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** Un nombre obligatoire : `null` si absent, `NaN` si illisible. PURE. */
export function nombreRequis(valeur: FormDataEntryValue | null | undefined): number | null {
  return nombreOuNull(valeur);
}

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Transforme la saisie du formulaire en termes de bail. PURE, testée.
 *
 * Toutes les erreurs sont rendues D'UN COUP plutôt qu'une à la fois : un formulaire qui
 * refuse un champ, puis le suivant, puis le suivant fait recommencer trois fois.
 */
export function lireReglages(form: {
  get(cle: string): FormDataEntryValue | null;
}): ResultatReglages {
  const erreurs: string[] = [];

  const debut = String(form.get("debut") ?? "").trim();
  if (!DATE_ISO.test(debut)) {
    erreurs.push("La date de signature doit être au format AAAA-MM-JJ.");
  } else if (Number.isNaN(new Date(`${debut}T12:00:00Z`).getTime())) {
    erreurs.push("La date de signature n’existe pas.");
  }

  const dureeMois = nombreRequis(form.get("dureeMois"));
  if (dureeMois === null || !Number.isInteger(dureeMois) || dureeMois <= 0) {
    erreurs.push("La durée du bail doit être un nombre entier de mois, supérieur à zéro.");
  }

  const kilometrageAutorise = nombreRequis(form.get("kilometrageAutorise"));
  if (kilometrageAutorise === null || !(kilometrageAutorise > 0)) {
    erreurs.push("Le kilométrage autorisé doit être un nombre supérieur à zéro.");
  }

  const kilometrageInitial = nombreOuNull(form.get("kilometrageInitial"));
  if (kilometrageInitial !== null && !(kilometrageInitial >= 0)) {
    erreurs.push("L’odomètre à la signature doit être positif (ou vide s’il est inconnu).");
  }

  const tarifKwh = nombreOuNull(form.get("tarifKwh"));
  if (tarifKwh !== null && !(tarifKwh >= 0)) {
    erreurs.push("Le tarif du kWh doit être positif (ou vide s’il est inconnu).");
  }

  const coutParKmExcedentaire = nombreOuNull(form.get("coutParKmExcedentaire"));
  if (coutParKmExcedentaire !== null && !(coutParKmExcedentaire >= 0)) {
    erreurs.push("Le coût au km excédentaire doit être positif (ou vide s’il est inconnu).");
  }

  const deviseBrute = String(form.get("devise") ?? "").trim().toUpperCase();
  const devise = deviseBrute === "" ? "CAD" : deviseBrute;
  if (!/^[A-Z]{3}$/.test(devise)) {
    erreurs.push("La devise s’écrit en trois lettres (CAD, USD, EUR…).");
  }

  if (erreurs.length > 0) return { ok: false, erreurs };

  // Dernier filet : le schéma qui fait autorité ailleurs dans l'app. Deux validations
  // valent mieux qu'une quand la seconde est la SOURCE DE VÉRITÉ — celle-ci attrape ce que
  // les règles ci-dessus auraient laissé passer, plutôt que de la contourner.
  const candidat = {
    debut,
    dureeMois,
    kilometrageAutorise,
    kilometrageInitial,
    tarifKwh,
    coutParKmExcedentaire,
    devise,
  };
  const parse = SchemaBail.safeParse(candidat);
  if (!parse.success) {
    return {
      ok: false,
      erreurs: parse.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`),
    };
  }

  return { ok: true, bail: parse.data, erreurs: [] };
}

/** Ce que le formulaire de bail montre au départ : une valeur par champ, `undefined` = champ vide. */
export interface ValeursFormulaireBail {
  debut: string | undefined;
  dureeMois: string | undefined;
  kilometrageAutorise: string | undefined;
  kilometrageInitial: string | undefined;
  coutParKmExcedentaire: string | undefined;
  tarifKwh: string | undefined;
  devise: string;
}

const texteOuVide = (n: number | null | undefined): string | undefined =>
  n === null || n === undefined ? undefined : String(n);

/**
 * Valeurs de départ du formulaire. Aucun terme dans le code (CarAI#239) : sans bail en base
 * (`null`), tous les champs sont VIDES (jamais « 0 »), sauf la devise qui reste « CAD ».
 * Un champ nullable inconnu reste vide aussi quand le bail existe. PURE, testée.
 */
export function valeursFormulaireBail(bail: Bail | null): ValeursFormulaireBail {
  return {
    debut: bail?.debut,
    dureeMois: texteOuVide(bail?.dureeMois),
    kilometrageAutorise: texteOuVide(bail?.kilometrageAutorise),
    kilometrageInitial: texteOuVide(bail?.kilometrageInitial),
    coutParKmExcedentaire: texteOuVide(bail?.coutParKmExcedentaire),
    tarifKwh: texteOuVide(bail?.tarifKwh),
    devise: bail?.devise ?? "CAD",
  };
}
