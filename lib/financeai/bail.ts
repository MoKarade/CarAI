// lib/financeai/bail.ts — ce que FinanceAI sait du bail, lu par CarAI. SERVEUR UNIQUEMENT.
//
// CarAI connaît les TERMES du bail (dates, durée, kilométrage : `lib/vehicle/lease.ts`) et
// aucun DOLLAR. La mensualité, le solde et le taux vivent dans FinanceAI, qui les publie sur
// `GET /vehicule/bail` — un endpoint dédié, gardé par un jeton qui lui est propre (ADR 0017
// de FinanceAI, ADR 0004 ici).
//
// ⚠️ « INJOIGNABLE » N'EST PAS UNE PANNE DE CARAI, et c'est vrai des DEUX façons dont ce
// serveur peut être hébergé — le PC de Marc, éteint une bonne partie du temps ; ou Cloud Run
// en scale-to-zero, qui met ~2 s à se réveiller. Chaque mode d'échec se distingue donc des
// autres, et l'écran DIT lequel : un bandeau qui afficherait un tiret pour « éteint »,
// « jeton refusé » et « aucune dette enregistrée » enverrait chercher au mauvais endroit.
//
// ⚠️ Le jeton ne sort jamais d'ici : il vient de l'environnement, il part dans un en-tête,
// il n'est ni journalisé ni renvoyé au client.

import { z } from "zod";

/** Ce que l'endpoint publie. Les clés inconnues sont strippées par Zod : FinanceAI peut
 *  ajouter un champ sans casser CarAI. */
const SchemaBailPublie = z.object({
  nom: z.string().min(1),
  devise: z.literal("CAD"),
  solde: z.number().finite(),
  mensualite: z.number().finite().positive().nullable(),
  tauxAnnuelPourcent: z.number().finite(),
  montantOrigine: z.number().finite().nullable(),
  debut: z.string().min(1).nullable(),
  finTerme: z.string().min(1).nullable(),
  champsAbsents: z.array(z.string()),
  dataAsOf: z.string().min(1).nullable(),
});

const SchemaReponse = z.object({ ok: z.literal(true), bail: SchemaBailPublie });

export type BailPublie = z.infer<typeof SchemaBailPublie>;

/**
 * Le résultat d'une lecture. Sept états, et ils ne se confondent pas : chacun appelle un
 * geste DIFFÉRENT de Marc (poser une variable, rallumer son PC, corriger un jeton, nommer
 * la bonne dette, enregistrer la dette). Les fondre en `null` reviendrait à lui dire
 * « quelque chose ne va pas » sans jamais dire quoi.
 */
export type LectureBail =
  | { statut: "ok"; bail: BailPublie }
  /** Ni URL ni jeton : l'intégration n'est pas branchée. Ce n'est PAS une panne. */
  | { statut: "non-configure" }
  /** Le serveur n'a pas répondu — éteint, réseau, délai dépassé. */
  | { statut: "injoignable"; detail: string }
  /** 401/403 : le jeton ne correspond pas. */
  | { statut: "refuse" }
  /** 404 : FinanceAI n'a aucune dette de véhicule enregistrée. */
  | { statut: "absent" }
  /** 409 : plusieurs véhicules — FinanceAI refuse de choisir, et il a raison. */
  | { statut: "ambigu"; candidates: string[] }
  /** Réponse hors schéma, ou 5xx : on ne rend PAS un chiffre qu'on n'a pas su lire. */
  | { statut: "invalide"; detail: string };

/**
 * Délai par défaut : celui de l'ACCUEIL de CarAI. Le serveur peut être éteint (PC de Marc) et
 * il faut alors échouer VITE — l'accueil ne doit pas attendre trois secondes de plus pour une
 * ligne d'information.
 *
 * ⚠️ Ce n'est PAS le bon délai pour tous les appelants, d'où le paramètre. Le summary du hub
 * a un budget très différent : Hubperso accorde 9 s à chaque app, et son résultat est mis en
 * cache 60 s côté CarAI. Un serveur en scale-to-zero (Cloud Run, `MIN_INSTANCES=0`) met ~2 s
 * à démarrer, auxquels s'ajoute la lecture de l'état : à 3 s, le PREMIER appel après une mise
 * en veille échouerait presque toujours, et « injoignable » deviendrait l'état normal d'un
 * serveur qui va bien. Voir `DELAI_SUMMARY_MS`.
 */
const DELAI_MS = 3_000;

/**
 * Délai du chemin SUMMARY. Tenu sous le budget de 9 s du hub avec de la marge : si CarAI
 * dépassait, le hub afficherait « CarAI injoignable » — donc accuserait la voiture pour une
 * lenteur de FinanceAI.
 */
export const DELAI_SUMMARY_MS = 6_000;

/**
 * Lit le bail chez FinanceAI. IMPURE (réseau, environnement) — le calcul qui en découle est
 * dans `lib/vehicle/paiementsBail.ts`, PUR et testable sans serveur.
 *
 * @param fetchImpl injectable pour les tests ; par défaut le `fetch` global.
 */
export async function lireBailFinanceAI(
  fetchImpl: typeof fetch = fetch,
  delaiMs: number = DELAI_MS,
): Promise<LectureBail> {
  const url = process.env.FINANCEAI_BAIL_URL;
  const jeton = process.env.FINANCEAI_BAIL_TOKEN;
  if (!url || !jeton) return { statut: "non-configure" };

  let reponse: Response;
  try {
    reponse = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${jeton}` },
      // Un solde est un instantané : jamais de cache, ni côté Next ni côté HTTP.
      cache: "no-store",
      signal: AbortSignal.timeout(delaiMs),
    });
  } catch (err) {
    return { statut: "injoignable", detail: err instanceof Error ? err.message : String(err) };
  }

  if (reponse.status === 401 || reponse.status === 403) return { statut: "refuse" };
  if (reponse.status === 404) return { statut: "absent" };
  if (reponse.status === 409) {
    const corps = await lireJson(reponse);
    const candidates = z.object({ candidates: z.array(z.string()) }).safeParse(corps);
    return { statut: "ambigu", candidates: candidates.success ? candidates.data.candidates : [] };
  }
  if (!reponse.ok) {
    return { statut: "invalide", detail: `HTTP ${reponse.status}` };
  }

  const corps = await lireJson(reponse);
  const parse = SchemaReponse.safeParse(corps);
  if (!parse.success) {
    // ⚠️ On ne « répare » pas une réponse hors contrat : un champ manquant deviendrait un
    // montant à zéro, et un zéro crédible est pire qu'un refus visible.
    return { statut: "invalide", detail: parse.error.issues[0]?.message ?? "réponse hors schéma" };
  }
  return { statut: "ok", bail: parse.data.bail };
}

/** JSON tolérant : un corps illisible n'est pas une exception, c'est un `null` que le
 *  schéma rejettera ensuite avec un message utile. */
async function lireJson(r: Response): Promise<unknown> {
  try {
    return await r.json();
  } catch {
    return null;
  }
}
