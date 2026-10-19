// app/donnees/planificateurRafraichissement.ts — la logique PURE du rafraîchissement auto.
//
// Séparée du composant pour être testable sans navigateur. Règles (transfert Neon, 30/09) :
//  - un tick toutes les `intervalleMs` ;
//  - aucun rafraîchissement tant que l'onglet est caché (chaque refresh relit la base) ;
//  - au retour visible, UN rafraîchissement si au moins un tick a été sauté.

export const INTERVALLE_DONNEES_MS = 15 * 60_000;

export type CibleVisibilite = {
  visibilityState: string;
  addEventListener: (type: "visibilitychange", cb: () => void) => void;
  removeEventListener: (type: "visibilitychange", cb: () => void) => void;
};

export function demarrerRafraichissement(
  intervalleMs: number,
  rafraichir: () => void,
  cible: CibleVisibilite,
): () => void {
  let enRetard = false;

  const id = setInterval(() => {
    if (cible.visibilityState === "hidden") {
      enRetard = true;
      return;
    }
    rafraichir();
  }, intervalleMs);

  const auRetour = () => {
    if (cible.visibilityState === "hidden" || !enRetard) return;
    enRetard = false;
    rafraichir();
  };
  cible.addEventListener("visibilitychange", auRetour);

  return () => {
    clearInterval(id);
    cible.removeEventListener("visibilitychange", auRetour);
  };
}
