// lib/config.ts — configuration PERSISTÉE (table `app_config`), par opposition aux secrets.
//
// La règle de partage est simple et sans exception :
//   • SECRET (identifiants Smartcar, mot de passe Toyota, jetons) → variable d'environnement.
//   • ÉTAT DURABLE non secret (userId Connect, vehicleId, termes du bail, santé du module
//     Toyota) → cette table.
//
// Pourquoi ne pas tout mettre en variables d'environnement : le `userId` de Smartcar naît
// d'un flow OAuth déclenché par Marc depuis l'app. Le poser en variable d'environnement
// l'obligerait à copier une valeur dans le tableau de bord Vercel et à redéployer — soit
// exactement la « commande à taper » qu'il refuse. Un écrit en base est immédiat.
//
// Pourquoi ne pas tout mettre en base non plus : un secret en base est un secret qui fuit
// au premier dump, à la première sauvegarde, au premier écran de debug.

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { appConfig } from "./db/schema";

export const CLE_SMARTCAR_USER = "smartcar.userId";
export const CLE_SMARTCAR_VEHICLE = "smartcar.vehicleId";
export const CLE_SMARTCAR_COMPAT = "smartcar.compatibilite";
export const CLE_BAIL = "bail";
export const CLE_TOYOTA_SANTE = "toyota.sante";
export const CLE_LIEUX = "lieux";
/**
 * Curseur de la RÉPARATION post-migration 0005 (incident du 18/08/2026) : dernier
 * `event_id` de livraison relu. Absent = réparation jamais lancée ; `"fini"` = terminée.
 * Vit en base — une variable de module serait vide à chaque démarrage à froid, donc la
 * réparation repartirait de zéro toutes les 30 minutes, pour toujours.
 *
 * ⚠️ La clé porte une VERSION (`.v2`). La v1 s'est déclarée « terminée » sans qu'on
 * puisse dire ce qu'elle avait écrit : elle ne comptait rien par métrique, et Marc voyait
 * toujours zéro position. Un curseur qui fige un « je n'ai pas su faire » le fige À VIE ;
 * bumper la version relance le travail sous les règles courantes (leçon DriveAI). Le
 * rejeu est idempotent, donc re-passer ne coûte que le temps de relecture.
 */
export const CLE_REJEU_CURSEUR = "reparation.rejeu0005.v2";
/** Valeur sentinelle du curseur ci-dessus quand tout a été relu. */
export const REJEU_TERMINE = "fini";

/**
 * Termes du bail (Doc 4 §3.4 : « à stocker en config ou en base plutôt qu'en dur »).
 *
 * Aucune valeur par défaut dans le code : les termes vivent en base, saisis dans Réglages
 * (aucune donnée perso dans un fichier versionné). Ils sont MODIFIABLES sans redéploiement,
 * parce qu'un bail se renégocie et qu'un chiffre figé dans le code finit toujours par mentir.
 *
 * `coutParKmExcedentaire` est volontairement NULLABLE : le cadrage note que cette donnée
 * n'a pas été fournie (Doc 4 §3.4). Tant qu'elle est absente, le calcul annonce un
 * dépassement en kilomètres SANS chiffrer le coût — un montant inventé serait pire que pas
 * de montant, surtout sur un sujet où Marc va prendre une décision financière.
 */
export const SchemaBail = z.object({
  debut: z.string().describe("Date de signature, AAAA-MM-JJ"),
  dureeMois: z.number().int().positive(),
  kilometrageAutorise: z.number().positive(),
  coutParKmExcedentaire: z.number().nonnegative().nullable().default(null),
  devise: z.string().default("CAD"),
  /**
   * Odomètre à la SIGNATURE, tel qu'écrit au contrat. Nullable, et c'est tout le sujet :
   * CarAI n'a pas enregistré dès la signature. Sans ce point d'ancrage, le rythme se mesure
   * sur la seule fenêtre observée et la projection du bail SOUS-ESTIME le dépassement sans
   * le dire. Renseigné, il rend la projection exacte ; absent, la limite est NOMMÉE dans
   * `EtatBail.limites` au lieu d'être masquée par un chiffre rassurant.
   */
  kilometrageInitial: z.number().nonnegative().nullable().default(null),
  /**
   * Prix du kWh, pour chiffrer les recharges. Nullable, et pour la même raison que
   * `coutParKmExcedentaire` : le tarif d'Hydro-Québec dépend du palier, de l'abonnement et
   * de la date. L'écrire en dur produirait un montant faux qui aurait l'air juste, sur un
   * chiffre que Marc voudra comparer à sa facture réelle.
   *
   * Rangé avec le bail plutôt que dans une clé à part : c'est la même surface de config
   * « ce que coûte la voiture », modifiable sans redéploiement.
   */
  tarifKwh: z.number().nonnegative().nullable().default(null),
});
export type Bail = z.infer<typeof SchemaBail>;

/**
 * LES LIEUX DE RECHARGE de Marc, avec leur tarif.
 *
 * ⚠️ POURQUOI EN BASE ET PAS DANS LE CODE. Le dépôt CarAI est PUBLIC. L'adresse du domicile
 * de Marc et celle de son employeur ne peuvent entrer dans aucun fichier versionné — c'est
 * le garde-fou n°1 de JobAI, appliqué ici. Ces coordonnées vivent donc dans la config, comme
 * les termes du bail : saisies dans Réglages, jamais commitées, modifiables sans
 * redéploiement.
 *
 * ⚠️ Aucune valeur par défaut : un lieu inventé apparierait des recharges au mauvais tarif.
 * Tant que la liste est vide, les recharges se chiffrent au mieux et le disent.
 */
export const SchemaLieu = z
  .object({
    nom: z.string().min(1).max(40),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    // Un stationnement fait quelques dizaines de mètres ; 2 km apparierait le quartier.
    rayonM: z.number().int().min(20).max(2_000).default(120),
    // Le tarif est FACULTATIF (CarAI#8) : un lieu nommé après coup, depuis Activité, n'a pas de
    // tarif tant que Marc n'en a pas saisi un. Les deux vont ensemble : un mode sans tarif, ou
    // l'inverse, ne chiffrerait rien et serait un lieu à moitié bon.
    mode: z.enum(["horaire", "kwh"]).optional(),
    tarif: z.number().nonnegative().optional(),
  })
  .refine((l) => (l.mode === undefined) === (l.tarif === undefined), {
    message: "le mode de facturation et le tarif vont ensemble",
    path: ["tarif"],
  });
export type Lieu = z.infer<typeof SchemaLieu>;

export const SchemaLieux = z.array(SchemaLieu).max(50);

/** Les lieux enregistrés, ou une liste vide. Jamais de lieu par défaut. */
export async function lireLieux(): Promise<Lieu[]> {
  return (await lireConfig(CLE_LIEUX, SchemaLieux)) ?? [];
}

/** Santé du module Toyota (Doc 3 §6.1) : compteur d'échecs et désactivation automatique. */
export const SchemaSanteToyota = z.object({
  echecsConsecutifs: z.number().int().nonnegative().default(0),
  desactiveLe: z.string().nullable().default(null),
  derniereErreur: z.string().nullable().default(null),
  dernierSucces: z.string().nullable().default(null),
  /** Odomètre au dernier poll — sert à détecter « le véhicule vient de s'arrêter » (Doc 3 §5.2). */
  dernierOdometre: z.number().nullable().default(null),
  dernierReveilForce: z.string().nullable().default(null),
});
export type SanteToyota = z.infer<typeof SchemaSanteToyota>;

export const SANTE_TOYOTA_DEFAUT: SanteToyota = {
  echecsConsecutifs: 0,
  desactiveLe: null,
  derniereErreur: null,
  dernierSucces: null,
  dernierOdometre: null,
  dernierReveilForce: null,
};

/**
 * Lit une valeur de config. `null` si absente — jamais une valeur inventée.
 *
 * Générique sur le SCHÉMA (`S extends z.ZodTypeAny`) et non sur le type de sortie : avec
 * `z.ZodType<T>`, TypeScript exige que l'entrée et la sortie du schéma coïncident, ce que
 * `.default()` rend faux par construction (un champ à défaut est optionnel en entrée,
 * garanti en sortie). C'est précisément la tolérance qu'on veut ici — une config écrite
 * avant l'ajout d'un champ doit rester lisible.
 */
export async function lireConfig<S extends z.ZodTypeAny>(
  cle: string,
  schema: S,
): Promise<z.infer<S> | null> {
  const lignes = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, cle))
    .limit(1);

  const brute = lignes[0]?.value;
  if (brute === undefined || brute === null) return null;

  const resultat = schema.safeParse(brute);
  if (!resultat.success) {
    // Une config hors schéma est signalée, pas silencieusement remplacée : la remplacer par
    // un défaut ferait disparaître le symptôme en gardant la cause.
    console.error(`[config] valeur invalide pour ${cle}`, resultat.error.issues);
    return null;
  }
  return resultat.data;
}

/** Écrit une valeur de config (upsert). */
export async function ecrireConfig(cle: string, valeur: unknown): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key: cle, value: valeur as object, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: valeur as object, updatedAt: new Date() },
    });
}

/** Lit une chaîne simple (userId, vehicleId). */
export async function lireConfigTexte(cle: string): Promise<string | null> {
  return lireConfig(cle, z.string().min(1));
}

/**
 * Termes du bail, lus en base SEULEMENT (saisis dans Réglages). Aucun repli dans le code :
 * `null` = bail non renseigné, et chaque écran le dit au lieu d'afficher un chiffre.
 */
export async function lireBail(): Promise<Bail | null> {
  return lireConfig(CLE_BAIL, SchemaBail);
}

/** Santé du module Toyota, avec repli sur un état neuf. */
export async function lireSanteToyota(): Promise<SanteToyota> {
  return (await lireConfig(CLE_TOYOTA_SANTE, SchemaSanteToyota)) ?? SANTE_TOYOTA_DEFAUT;
}

export async function ecrireSanteToyota(sante: SanteToyota): Promise<void> {
  await ecrireConfig(CLE_TOYOTA_SANTE, sante);
}
