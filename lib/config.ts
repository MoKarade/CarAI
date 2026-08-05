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

/**
 * Termes du bail (Doc 4 §3.4 : « à stocker en config ou en base plutôt qu'en dur »).
 *
 * Les valeurs par défaut viennent du cadrage — bail signé le 14 juillet 2026, 112 000 km
 * sur 48 mois. Elles sont MODIFIABLES sans redéploiement, parce qu'un bail se renégocie et
 * qu'un chiffre figé dans le code finit toujours par mentir.
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
});
export type Bail = z.infer<typeof SchemaBail>;

export const BAIL_DEFAUT: Bail = {
  debut: "2026-07-14",
  dureeMois: 48,
  kilometrageAutorise: 112_000,
  coutParKmExcedentaire: null,
  devise: "CAD",
};

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

/** Lit une valeur de config. `null` si absente — jamais une valeur inventée. */
export async function lireConfig<T>(cle: string, schema: z.ZodType<T>): Promise<T | null> {
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

/** Termes du bail, avec repli sur les valeurs du cadrage si rien n'a encore été personnalisé. */
export async function lireBail(): Promise<Bail> {
  return (await lireConfig(CLE_BAIL, SchemaBail)) ?? BAIL_DEFAUT;
}

/** Santé du module Toyota, avec repli sur un état neuf. */
export async function lireSanteToyota(): Promise<SanteToyota> {
  return (await lireConfig(CLE_TOYOTA_SANTE, SchemaSanteToyota)) ?? SANTE_TOYOTA_DEFAUT;
}

export async function ecrireSanteToyota(sante: SanteToyota): Promise<void> {
  await ecrireConfig(CLE_TOYOTA_SANTE, sante);
}
