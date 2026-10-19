"use client";

// app/ui/Voiture3D.tsx — la bZ en trois dimensions, et les états posés dessus.
//
// Marc, 18/09/2026 : « je le veux beaucoup plus poussé, limite une interface 3D où je peux
// voir la voiture, tourner autour, et voir les états de chaque élément ».
//
// ══ CE MODULE NE DÉCIDE RIEN ═════════════════════════════════════════════════════════
//
// Tout ce qui se juge vit dans `lib/vehicle/vue3d.ts` (le repère, le cadrage, la
// visibilité d'un marqueur) et `lib/vehicle/pointsVoiture.ts` (la valeur, le ton, le
// libellé). Ici : du WebGL, et rien d'autre. C'est délibéré — jsdom n'a pas de WebGL, donc
// ce fichier n'est pas testable, donc **tout ce qui pourrait être faux doit en sortir**.
//
// ⚠️ Les valeurs affichées sont EXACTEMENT celles du schéma 2D : mêmes `PointVoiture`,
// construits une seule fois par `construirePointsVoiture`. Les redériver ici donnerait deux
// voitures qui ne disent pas la même chose, et c'est la page qu'on regarde le moins qui
// mentirait — sans que personne ne s'en aperçoive.
//
// ══ POURQUOI IL N'EST JAMAIS IMPORTÉ DIRECTEMENT ═════════════════════════════════════
//
// `three` pèse plus que tout le reste du bundle réuni, et le modèle fait 6 Mo. Un import
// statique les ferait descendre sur le téléphone de Marc à CHAQUE ouverture de l'accueil,
// pour un écran qu'il ouvre de temps en temps. `VueVoiture3D` le charge donc par
// `next/dynamic`, et `tests/chargementDiffere3d.test.ts` refuse tout import statique.
//
// ══ LE RENDU EST À LA DEMANDE, PAS EN BOUCLE ═════════════════════════════════════════
//
// Rien ne bouge tout seul dans cette scène : une voiture immobile, des marqueurs fixes.
// Une boucle `requestAnimationFrame` continue ferait tourner le GPU à 60 images par seconde
// pour redessiner la même image — sur un téléphone, ça se mesure en pourcentage de
// batterie. On dessine donc quand la caméra bouge, et seulement là.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointVoiture } from "@/lib/vehicle/pointsVoiture";
import {
  CENTRE_VOITURE,
  bornesOrbite,
  distanceCadrage,
  libelleElement,
  marqueurAtteignable,
  positionCameraDepart,
  repartirPoints,
  visibiliteMarqueur,
  type Point3D,
} from "@/lib/vehicle/vue3d";

const CHEMIN_MODELE = "/modele/bz.glb";
const CHEMIN_DECODEUR = "/draco/";
const FOV_DEG = 45;

/** Un marqueur tel que le DOM le connaît : position en % du cadre, et son état. */
interface MarqueurEcran {
  id: string;
  libelle: string;
  gauchePct: number;
  hautPct: number;
  visibilite: number;
  atteignable: boolean;
}

export interface Voiture3DProps {
  points: readonly PointVoiture[];
}

export default function Voiture3D({ points }: Voiture3DProps) {
  const cadre = useRef<HTMLDivElement | null>(null);
  const [avancement, setAvancement] = useState(0);
  const [pret, setPret] = useState(false);
  const [panne, setPanne] = useState<string | null>(null);
  const [marqueurs, setMarqueurs] = useState<MarqueurEcran[]>([]);
  const [ouvert, setOuvert] = useState<string | null>(null);

  const { surLaVoiture, horsVoiture } = repartirPoints(points);
  // ⚠️ Les ancres traversent l'effet : on les fige en chaîne pour que l'effet ne se rejoue
  // pas à chaque rendu (`surLaVoiture` est un tableau neuf à chaque fois).
  const clefAncres = surLaVoiture.map((m) => `${m.point.id}`).join("|");

  useEffect(() => {
    const hote = cadre.current;
    if (!hote) return;

    let vivant = true;
    let nettoyer: (() => void) | null = null;

    // ⚠️ Import DYNAMIQUE, à l'intérieur de l'effet : trois mégaoctets de JavaScript qui ne
    // partent qu'au moment où quelqu'un veut vraiment voir la voiture.
    (async () => {
      const [THREE, { OrbitControls }, { GLTFLoader }, { DRACOLoader }, { RoomEnvironment }] =
        await Promise.all([
          import("three"),
          import("three/examples/jsm/controls/OrbitControls.js"),
          import("three/examples/jsm/loaders/GLTFLoader.js"),
          import("three/examples/jsm/loaders/DRACOLoader.js"),
          import("three/examples/jsm/environments/RoomEnvironment.js"),
        ]);
      if (!vivant) return;

      let rendu: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        rendu = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      } catch (e) {
        // ⚠️ Pas de repli silencieux : un appareil sans WebGL doit l'apprendre, sinon il
        // regarde un rectangle vide en se demandant si l'app est cassée. Le détail technique
        // va dans la console (diagnostic), pas à l'écran de Marc.
        console.error("[3d] WebGL indisponible", e);
        setPanne("La vue 3D n’est pas disponible sur cet appareil.");
        return;
      }

      const largeur = () => hote.clientWidth || 1;
      const hauteur = () => hote.clientHeight || 1;

      rendu.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      rendu.setSize(largeur(), hauteur());
      rendu.toneMapping = THREE.ACESFilmicToneMapping;
      rendu.toneMappingExposure = 1.1;
      hote.appendChild(rendu.domElement);

      const scene = new THREE.Scene();
      // Un environnement PROCÉDURAL : la carrosserie de la bZ porte un vernis
      // (`KHR_materials_clearcoat`) qui n'a rien à refléter sans lui — elle sortirait
      // plate et grise. Généré en mémoire, donc aucun fichier de plus à télécharger.
      const pmrem = new THREE.PMREMGenerator(rendu);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

      // ⚠️ Plans de coupe en MÈTRES — les unités de la scène. À 1/5000 (les valeurs du
      // premier jet, pensées en centimètres), le plan proche coupait toute la voiture.
      const camera = new THREE.PerspectiveCamera(FOV_DEG, largeur() / hauteur(), 0.05, 200);
      const placerCamera = () => {
        const d = distanceCadrage(FOV_DEG, largeur() / hauteur());
        const p = positionCameraDepart(d);
        camera.position.set(p.x, p.y, p.z);
        camera.updateProjectionMatrix();
      };
      placerCamera();

      const bornes = bornesOrbite(distanceCadrage(FOV_DEG, largeur() / hauteur()));
      const controles = new OrbitControls(camera, rendu.domElement);
      controles.target.set(CENTRE_VOITURE.x, CENTRE_VOITURE.y, CENTRE_VOITURE.z);
      // Pas de translation : elle fait sortir la voiture du cadre et il n'y a aucun moyen
      // évident de revenir. On tourne autour et on approche, c'est tout ce qui est demandé.
      controles.enablePan = false;
      controles.enableDamping = true;
      controles.minDistance = bornes.min;
      controles.maxDistance = bornes.max;
      // On ne passe pas SOUS le sol : la voiture n'a pas de dessous modélisé.
      controles.maxPolarAngle = Math.PI / 2;
      controles.update();

      const projeter = () => {
        const cam: Point3D = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        const v = new THREE.Vector3();
        setMarqueurs(
          surLaVoiture.map(({ point, element, ancre }) => {
            v.set(ancre.x, ancre.y, ancre.z).project(camera);
            const visibilite = visibiliteMarqueur(ancre, cam);
            return {
              id: point.id,
              libelle: libelleElement(element),
              gauchePct: ((v.x + 1) / 2) * 100,
              hautPct: ((1 - v.y) / 2) * 100,
              visibilite,
              atteignable: marqueurAtteignable(visibilite),
            };
          }),
        );
      };

      const dessiner = () => {
        controles.update();
        rendu.render(scene, camera);
        projeter();
      };

      // ⚠️ `enableDamping` continue de bouger la caméra APRÈS le geste : sans quelques
      // images de plus, la voiture se fige en pleine inertie. On dessine donc tant que les
      // contrôles bougent, et on s'arrête dès que c'est stable — jamais une boucle infinie.
      let enCours = false;
      let trame = 0;
      const demanderRendu = () => {
        if (enCours) return;
        enCours = true;
        let restant = 90;
        const pas = () => {
          if (!vivant) return;
          dessiner();
          restant -= 1;
          if (restant > 0) {
            trame = requestAnimationFrame(pas);
          } else {
            enCours = false;
          }
        };
        trame = requestAnimationFrame(pas);
      };
      controles.addEventListener("change", () => {
        // Relance le compte à rebours : tant qu'on manipule, on continue de dessiner.
        enCours = false;
        cancelAnimationFrame(trame);
        demanderRendu();
      });

      const surRedimension = () => {
        rendu.setSize(largeur(), hauteur());
        camera.aspect = largeur() / hauteur();
        // Le cadrage dépend du RATIO : tourner le téléphone change la distance qu'il faut
        // pour tout voir, donc les bornes aussi.
        const b = bornesOrbite(distanceCadrage(FOV_DEG, largeur() / hauteur()));
        controles.minDistance = b.min;
        controles.maxDistance = b.max;
        placerCamera();
        controles.update();
        demanderRendu();
      };
      const observateur = new ResizeObserver(surRedimension);
      observateur.observe(hote);

      const draco = new DRACOLoader().setDecoderPath(CHEMIN_DECODEUR);
      const chargeur = new GLTFLoader().setDRACOLoader(draco);

      chargeur.load(
        CHEMIN_MODELE,
        (gltf) => {
          if (!vivant) return;
          // ⚠️ ON NE TOURNE RIEN. Les nœuds du modèle portent DÉJÀ leur quart de tour et
          // leur échelle — c'est mesuré dans le fichier, verrouillé par
          // `tests/modele3d.test.ts`, et expliqué en tête de `lib/vehicle/vue3d.ts`. Le
          // premier jet ajoutait ici une SECONDE rotation : la voiture partait couchée.
          scene.add(gltf.scene);
          setPret(true);
          demanderRendu();
        },
        (evt) => {
          if (!vivant || !evt.total) return;
          setAvancement(Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
        },
        (e) => {
          if (!vivant) return;
          // La cause précise (décodeur absent, réseau coupé, fichier corrompu) reste dans la
          // console pour le diagnostic ; l'écran dit seulement ce qui se passe, en mots simples.
          console.error("[3d] modèle non chargé", e);
          setPanne("Le modèle 3D n’a pas pu être chargé.");
        },
      );

      nettoyer = () => {
        cancelAnimationFrame(trame);
        observateur.disconnect();
        controles.dispose();
        draco.dispose();
        pmrem.dispose();
        scene.traverse((objet) => {
          const maille = objet as { geometry?: { dispose(): void }; material?: unknown };
          maille.geometry?.dispose();
          const materiaux = Array.isArray(maille.material) ? maille.material : [maille.material];
          for (const m of materiaux) {
            (m as { dispose?: () => void } | undefined)?.dispose?.();
          }
        });
        rendu.dispose();
        rendu.domElement.remove();
      };
    })().catch((e: unknown) => {
      if (!vivant) return;
      console.error("[3d] démarrage impossible", e);
      setPanne("La vue 3D n’a pas pu démarrer.");
    });

    return () => {
      vivant = false;
      nettoyer?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clefAncres]);

  const basculer = useCallback((id: string) => {
    setOuvert((actuel) => (actuel === id ? null : id));
  }, []);

  const parId = new Map(points.map((p) => [p.id as string, p]));

  return (
    <div className="v3d">
      <div className="v3d-cadre" ref={cadre}>
        {!pret && !panne && (
          <p className="v3d-attente" role="status">
            Chargement de la voiture… {avancement > 0 ? `${avancement} %` : ""}
          </p>
        )}
        {panne && (
          <p className="v3d-panne" role="status">
            {panne}
          </p>
        )}
        {pret &&
          marqueurs.map((m) => {
            const point = parId.get(m.id);
            if (!point) return null;
            return (
              <div
                key={m.id}
                className="v3d-marqueur"
                style={{
                  left: `${m.gauchePct}%`,
                  top: `${m.hautPct}%`,
                  opacity: 0.25 + 0.75 * m.visibilite,
                  // Un marqueur qu'on ne voit pas ne doit pas se cliquer au travers de la
                  // tôle : on viserait une portière et on ouvrirait le pneu d'en face.
                  pointerEvents: m.atteignable ? "auto" : "none",
                }}
              >
                <button
                  type="button"
                  className={`v3d-pastille ton-${point.ton}`}
                  aria-expanded={ouvert === m.id}
                  onClick={() => basculer(m.id)}
                >
                  <span className="v3d-valeur">{point.valeur}</span>
                  {point.unite && <span className="v3d-unite">{point.unite}</span>}
                  <span className="sr-only"> — {m.libelle}</span>
                </button>
                {ouvert === m.id && (
                  <div className="v3d-bulle" role="status">
                    <strong>{point.libelle}</strong>
                    {point.detail.map((ligne, i) => (
                      <p key={i}>{ligne}</p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {/* ⚠️ Ce qui n'a pas de lieu sur une carrosserie s'affiche ICI, en clair. Un odomètre
          posé sur une portière inventerait un endroit, et l'endroit se lirait comme un sens. */}
      {horsVoiture.length > 0 && (
        <ul className="v3d-hors">
          {horsVoiture.map((p) => (
            <li key={p.id}>
              <span className="v3d-hors-libelle">{p.libelle}</span>
              <span className="v3d-hors-valeur">
                {p.valeur}
                {p.unite ? ` ${p.unite}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
