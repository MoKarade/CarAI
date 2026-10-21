// lib/export/acces.ts — qui peut lire la sauvegarde, et avec quoi elle est chiffrée (CarAI#13).
//
// Séparé de la route pour être testé sans base : la décision (503 / 401 / 400 / feu vert) ne
// dépend que de l'environnement, de l'en-tête et du curseur. Échec FERMÉ à chaque étage.

import { secretValide } from "@/lib/secretPartage";
import { cleDepuisEnv, decoderCurseur, type Curseur } from "@/lib/export/sauvegarde";

export const ENTETE_JETON = "x-export-token";

export type DecisionExport =
  | { type: "refus"; statut: 400 | 401 | 503; erreur: string }
  | { type: "ok"; cle: Buffer; curseur: Curseur };

export function decider(params: {
  jeton: string | null;
  apres: string | null;
  env: Record<string, string | undefined>;
}): DecisionExport {
  const { jeton, apres, env } = params;
  const attendu = env.EXPORT_TOKEN?.trim();
  const cle = cleDepuisEnv(env.EXPORT_KEY);

  // Le MESSAGE ne dit pas laquelle des deux manque : seul un opérateur le sait de toute façon,
  // et il lit la configuration, pas la réponse.
  if (!attendu || !cle) {
    return {
      type: "refus",
      statut: 503,
      erreur: "export désactivé : EXPORT_TOKEN ou EXPORT_KEY absent ou invalide.",
    };
  }
  if (!secretValide(jeton, attendu)) {
    return { type: "refus", statut: 401, erreur: "non autorisé" };
  }
  const curseur = decoderCurseur(apres);
  if (!curseur) {
    return { type: "refus", statut: 400, erreur: "curseur invalide : repars de zéro (sans « apres »)." };
  }
  return { type: "ok", cle, curseur };
}
