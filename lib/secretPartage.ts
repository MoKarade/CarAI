// lib/secretPartage.ts — comparaison d'un secret partagé, en temps constant.
//
// Une seule définition pour les routes hors session (`/api/cron/*`, webhook OTP Toyota) :
// une correction faite ici vaut pour les trois, au lieu d'en laisser deux derrière.
// Le 503 « désactivé » (secret non configuré) et le 401 « refusé » restent dans chaque
// route, parce que le secret attendu et le message n'y sont pas les mêmes.

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compare deux secrets via des digests de longueur fixe : `timingSafeEqual` lève sur des
 * buffers de tailles différentes, et comparer les chaînes brutes révélerait la longueur.
 * Un secret fourni absent ou vide est toujours refusé.
 */
export function secretValide(fourni: string | null, attendu: string): boolean {
  if (!fourni) return false;
  const a = createHash("sha256").update(fourni).digest();
  const b = createHash("sha256").update(attendu).digest();
  return timingSafeEqual(a, b);
}
