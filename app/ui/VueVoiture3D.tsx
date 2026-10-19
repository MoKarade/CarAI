"use client";

// app/ui/VueVoiture3D.tsx — la porte d'entrée de la vue 3D, et le seul endroit qui la charge.
//
// ══ POURQUOI UNE PORTE, ET PAS LA 3D DIRECTEMENT SUR L'ACCUEIL ═══════════════════════
//
// Marc, au cadrage du 18/09 : le premier écran doit être COURT, « pas trop de texte ou
// blabla, très épuré ». Et la 3D coûte **6 Mo de modèle plus le moteur de rendu**. La
// poser d'office sur l'accueil, c'est payer ça à chaque ouverture — y compris quand on
// regarde juste son niveau de charge dans un stationnement, en réseau mobile.
//
// Le poids est donc ÉCRIT sur le bouton. Un chargement de 6 Mo qui démarre sans prévenir
// est exactement le genre de chose qu'on découvre sur sa facture.
//
// ⚠️ `dynamic(..., { ssr: false })` n'est pas un détail de confort : c'est CE qui garde
// `three` hors du bundle de l'accueil. Un import statique de `Voiture3D` ici annulerait
// tout, sans rien casser ni rien afficher d'anormal — d'où la garde de source
// `tests/chargementDiffere3d.test.ts`.

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { PointVoiture } from "@/lib/vehicle/pointsVoiture";
import { COTE_VERIFIE } from "@/lib/vehicle/ancresVoiture";

const Voiture3D = dynamic(() => import("./Voiture3D"), {
  ssr: false,
  loading: () => (
    <p className="v3d-attente" role="status">
      Préparation de la vue 3D…
    </p>
  ),
});

export function VueVoiture3D({ points }: { points: readonly PointVoiture[] }) {
  const [ouverte, setOuverte] = useState(false);

  // Échap ferme, comme partout ailleurs dans l'app. Et le fond de page ne défile pas
  // derrière la vue : on tourne autour de la voiture au doigt, le défilement volerait le geste.
  useEffect(() => {
    if (!ouverte) return;
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOuverte(false);
    };
    document.addEventListener("keydown", surTouche);
    const defilementInitial = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", surTouche);
      document.body.style.overflow = defilementInitial;
    };
  }, [ouverte]);

  return (
    <>
      <button type="button" className="v3d-ouvrir" onClick={() => setOuverte(true)}>
        Voir en 3D
        <span className="v3d-poids">6 Mo</span>
      </button>

      {ouverte && (
        <div className="v3d-plein" role="dialog" aria-modal="true" aria-label="La voiture en 3D">
          <div className="v3d-barre">
            <p className="v3d-aide">Fais glisser pour tourner autour. Pince pour approcher.</p>
            <button type="button" className="v3d-fermer" onClick={() => setOuverte(false)}>
              Fermer
            </button>
          </div>

          <Voiture3D points={points} />

          {/* ⚠️ Tant que personne n'a confirmé quel côté du modèle est la gauche, l'écran le
              DIT. Afficher « avant-gauche » sur la roue de droite serait une mesure juste
              posée au mauvais endroit — donc un chiffre faux, en pire : il a l'air placé. */}
          {!COTE_VERIFIE && (
            <p className="v3d-reserve">
              Gauche et droite ne sont pas encore confirmées sur ce modèle : une pression est
              la bonne, son côté reste à vérifier.
            </p>
          )}
        </div>
      )}
    </>
  );
}
