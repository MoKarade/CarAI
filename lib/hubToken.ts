// lib/hubToken.ts
// Vérifie le header x-hub-token du hub en temps constant (via digests de longueur fixe :
// timingSafeEqual exige des buffers de même taille — la longueur du secret ne fuite pas).

import { createHash, timingSafeEqual } from "node:crypto";

export function hubTokenValid(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
