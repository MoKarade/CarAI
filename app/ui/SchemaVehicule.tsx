// app/ui/SchemaVehicule.tsx — la voiture vue de dessus, peinte par ses propres mesures.
//
// Marc, 13/08/2026 : « des images pour les pneus et pour tout ce qui serait pertinent ».
// Marc, 20/08/2026 : « voiture comme une image 3d d'une bZ ». Le dessin au trait a donc
// laissé place à un RENDU du vrai modèle (provenance et réglages dans
// `lib/vehicle/geometrieVoiture.ts`). Ce qui change est le fond ; ce qui reste est la
// règle : les états se posent PAR-DESSUS, aux endroits MESURÉS.
//
// Ce composant NE DÉCIDE RIEN : `lib/vehicle/schemaVehicule.ts` place chaque mesure et
// choisit son état (fonctions pures, testées) ; ici on ne fait que dessiner. C'est ce qui
// permet de vérifier au test qu'une roue molle est bien la BONNE roue, sans navigateur.
//
// ⚠️ Rien n'est dessiné qui ne soit mesuré. Une roue sans relevé reste GRISE en pointillé
// plutôt que verte : sur une carrosserie, l'absence de couleur d'alerte se lit « tout va
// bien », et c'est exactement le mensonge qu'on s'interdit. Même règle pour les ouvrants :
// une position que la source ne nomme pas n'est pas coloriée, elle est COMPTÉE à côté.
//
// ⚠️ L'ÉTAT VIT DANS LE CONTOUR, jamais dans un aplat. Remplies de leur couleur, les roues
// devenaient quatre barres fluo qui criaient plus fort que les valeurs qu'on vient lire
// (défaut trouvé au banc le 20/08) — et sur une photo, un aplat écrase en plus le pneu
// qu'il recouvre.
//
// Image + SVG rendus côté SERVEUR : zéro bibliothèque, zéro octet de donnée brute envoyé
// au navigateur.

import {
  IMAGE_VOITURE,
  OUVRANTS,
  RATIO_IMAGE,
  ROUES,
  type Boite,
} from "@/lib/vehicle/geometrieVoiture";
import {
  libellePosition,
  type PneuDiagnostique,
  type Position,
} from "@/lib/vehicle/schemaVehicule";

// `EtatSchema` vit dans `lib/vehicle/etatSchema.ts`, avec la fonction qui le construit :
// deux pages le rendent (Analyse et Accueil), et le type doit vivre à côté de sa
// construction plutôt que dans l'un des deux dessins. Ré-exporté ici pour que « le
// composant et son type » restent importables ensemble.
import type { EtatSchema } from "@/lib/vehicle/etatSchema";
export type { EtatSchema };

/** Le repère du calque, en unités d'image. Les % de la géométrie s'y projettent. */
const VB = { largeur: 1000, hauteur: Math.round(1000 / RATIO_IMAGE) };

/** Une boîte en % devient un rectangle du repère. PURE. */
function rect(b: Boite) {
  const largeur = (b.largeur / 100) * VB.largeur;
  const hauteur = (b.hauteur / 100) * VB.hauteur;
  return {
    x: (b.x / 100) * VB.largeur - largeur / 2,
    y: (b.y / 100) * VB.hauteur - hauteur / 2,
    width: largeur,
    height: hauteur,
  };
}

export function SchemaVehicule({ etat }: { etat: EtatSchema }) {
  const parPosition = new Map<Position, PneuDiagnostique>();
  for (const p of etat.pneus) if (p.position) parPosition.set(p.position, p);

  const positions = Object.keys(ROUES) as Position[];
  const ouvertes = new Set<Position>([...etat.portieresOuvertes, ...etat.vitresOuvertes]);

  return (
    <div className="voiture" style={{ aspectRatio: VB.largeur + " / " + VB.hauteur }}>
      {/* Le rendu lui-même. `next/image` ne ferait que faire transiter par notre serveur un
          WebP de 80 Ko déjà optimal et de taille connue. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="voiture-image"
        src={IMAGE_VOITURE}
        alt={descriptionAccessible(etat)}
        width={760}
        height={1685}
        decoding="async"
      />

      <svg
        className="voiture-calque"
        viewBox={"0 0 " + VB.largeur + " " + VB.hauteur}
        aria-hidden="true"
        focusable="false"
      >
        {/* LES QUATRE ROUES. Contour seul : la couleur dit l'état sans recouvrir le pneu.
            La classe vient de la MESURE — sans relevé, `inconnu`, jamais `ok`. */}
        {positions.map((position) => {
          const pneu = parPosition.get(position);
          const classe = pneu ? pneu.etat : "inconnu";
          const r = rect(ROUES[position]);
          return (
            <rect
              key={"roue-" + position}
              {...r}
              rx={r.width * 0.42}
              className={"v-roue " + classe}
            >
              <title>
                {pneu
                  ? "Pneu " +
                    libellePosition(position) +
                    " : " +
                    Math.round(pneu.pressionKpa) +
                    " kPa" +
                    (pneu.raison ? " — " + pneu.raison : "")
                  : "Pneu " + libellePosition(position) + " : aucune mesure"}
              </title>
            </rect>
          );
        })}

        {/* LES QUATRE OUVRANTS, le long des flancs. Un ouvrant FERMÉ reste discret : c'est
            l'ouvert qui doit sauter aux yeux, pas la normalité. */}
        {positions.map((position) => {
          const estOuvert = ouvertes.has(position);
          const r = rect(OUVRANTS[position]);
          return (
            <rect
              key={"ouvrant-" + position}
              {...r}
              rx={r.width / 2}
              className={"v-ouvrant " + (estOuvert ? "ouvert" : "ferme")}
            >
              <title>
                {estOuvert
                  ? "Ouvrant " + libellePosition(position) + " OUVERT"
                  : "Ouvrant " + libellePosition(position) + " fermé"}
              </title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Ce que le schéma dit à qui ne le voit pas. Un texte de remplacement qui se contenterait
 * de « schéma du véhicule » rendrait l'image inutile au lecteur d'écran — c'est le CONTENU
 * qu'il faut énoncer, pas le support. Porté par l'`alt` de l'image, le calque étant
 * `aria-hidden` : deux descriptions concurrentes se liraient deux fois.
 */
function descriptionAccessible(etat: EtatSchema): string {
  const morceaux: string[] = ["Vue de dessus du véhicule."];

  const mesures = etat.pneus.filter((p) => p.position);
  if (mesures.length === 0) morceaux.push("Aucune pression de pneu mesurée.");
  else {
    morceaux.push(
      "Pression des pneus : " +
        mesures
          .map((p) => libellePosition(p.position!) + " " + Math.round(p.pressionKpa) + " kPa")
          .join(", ") +
        ".",
    );
    const problemes = mesures.filter((p) => p.etat !== "ok");
    morceaux.push(
      problemes.length === 0
        ? "Aucun écart entre les roues."
        : problemes.map((p) => libellePosition(p.position!) + " : " + p.raison + ".").join(" "),
    );
  }

  const nbOuverts =
    etat.portieresOuvertes.length + etat.vitresOuvertes.length + etat.ouvrantsSansPosition;
  morceaux.push(nbOuverts === 0 ? "Tout est fermé." : nbOuverts + " ouvrant(s) ouvert(s).");

  if (etat.verrouillee !== null) {
    morceaux.push(etat.verrouillee ? "Voiture verrouillée." : "Voiture déverrouillée.");
  }
  return morceaux.join(" ");
}
