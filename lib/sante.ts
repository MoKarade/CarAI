// lib/sante.ts — mémoire courte du verdict de santé (/api/sante).
//
// /api/sante est PUBLIQUE : sans mémoire, chaque appel — d'un inconnu comme de la vigie —
// toucherait Neon (SELECT 1 + assurerMigrations). Le quota Neon a déjà été dépassé le
// 29/09/2026 ; une route publique qui le consomme à la demande est un robinet ouvert.
//
// Le verdict (ok / pas ok) est donc gardé DUREE_CACHE_SANTE_MS par instance : au plus une
// sonde par fenêtre, les appels simultanés partagent la même. Une panne est mémorisée
// AUSSI — c'est justement quand la base tombe qu'il ne faut pas la marteler.

/** Durée pendant laquelle un verdict est réutilisé, par instance. */
export const DUREE_CACHE_SANTE_MS = 45_000;

type Sonde = () => Promise<boolean>;

/**
 * Enveloppe `sonde` : renvoie le dernier verdict tant qu'il a moins de `dureeMs`, sinon
 * relance UNE sonde (partagée entre appels simultanés). Une sonde qui lève vaut « pas ok ».
 */
export function creerCacheSante(
  sonde: Sonde,
  dureeMs: number = DUREE_CACHE_SANTE_MS,
  maintenant: () => number = Date.now,
): () => Promise<boolean> {
  let verdict: { ok: boolean; sondeA: number } | null = null;
  let enCours: Promise<boolean> | null = null;

  return async () => {
    if (verdict && maintenant() - verdict.sondeA < dureeMs) return verdict.ok;
    if (enCours) return enCours;

    enCours = (async () => {
      let ok = false;
      try {
        ok = await sonde();
      } catch (err) {
        console.error("[sante] sonde en erreur", err);
      }
      verdict = { ok, sondeA: maintenant() };
      enCours = null;
      return ok;
    })();
    return enCours;
  };
}
