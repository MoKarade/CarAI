"use client";

// app/ui/ChoixLieu.tsx — désigner un lieu de recharge : sur la carte, ou par son adresse.
//
// Marc, 21/08 : « quand je choisis un lieu de recharge je veux pouvoir choisir sur la map,
// choisir une adresse, choisir le rayon et tarif ».
//
// ══ CE QUE ÇA REMPLACE ═══════════════════════════════════════════════════════════════
// Deux champs `latitude` / `longitude` à remplir à la main, avec pour seule aide « ouvre la
// position dans Maps, elle est dans l'URL ». Marc y a tapé `460926.9` : une valeur que le
// schéma refuse, mais que le formulaire acceptait visuellement — et le refus était SILENCIEUX.
// Une coordonnée n'est pas une donnée qu'un humain saisit ; c'est une donnée qu'il DÉSIGNE.
//
// ══ POURQUOI LE RAYON EST DESSINÉ ════════════════════════════════════════════════════
// Le rayon décide quelles recharges seront attribuées à ce lieu, donc facturées à son
// tarif. Un nombre en mètres ne dit rien : 120 m, c'est la borne du voisin ou pas ? Le
// cercle le montre. Son échelle passe par `metresParPixel`, cosinus de latitude compris —
// sans lui, à Québec, le cercle couvrirait 176 m là où il en annonce 120.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  composerVue,
  pointDepuisCadre,
  rayonEnPixels,
  recalerDecalage,
  TAILLE_TUILE,
  ZOOM_MAX,
  ZOOM_MIN,
  type PointGeo,
} from "@/lib/vehicle/carte";

const LARGEUR = 640;
const HAUTEUR = 420;

export interface ReponseAdresse {
  ok: boolean;
  lat?: number;
  lng?: number;
  libelle?: string;
  message?: string;
}

export function ChoixLieu({
  centre,
  chercherAdresse,
}: {
  /** Où ouvrir la carte : la dernière position connue de la voiture, à défaut Québec. */
  centre: PointGeo;
  /** Action serveur — la clé de géocodage ne descend JAMAIS au navigateur. */
  chercherAdresse: (adresse: string) => Promise<ReponseAdresse>;
}) {
  const [point, setPoint] = useState<PointGeo | null>(null);
  const [rayonM, setRayonM] = useState(120);
  const [zoom, setZoom] = useState(16);
  const [decalage, setDecalage] = useState({ x: 0, y: 0 });
  const [adresse, setAdresse] = useState("");
  const [message, setMessage] = useState<{ ton: "ok" | "erreur"; texte: string } | null>(null);
  const [cherche, setCherche] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const glisse = useRef({ x: 0, y: 0, actif: false, bouge: false });

  // La vue se cadre sur le point CHOISI s'il y en a un, sinon sur le centre proposé.
  const ancre = point ?? centre;
  const vue = useMemo(
    () => composerVue({ points: [ancre], largeur: LARGEUR, hauteur: HAUTEUR, zoom, decalage }),
    [ancre, zoom, decalage],
  );

  const dansLeCadre = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    // ⚠️ On repasse dans le repère de la VUE, pas en pixels d'écran : confondre les deux
    // décale le point de tout le facteur d'affichage.
    return { x: ((clientX - r.left) / r.width) * LARGEUR, y: ((clientY - r.top) / r.height) * HAUTEUR };
  }, []);

  const changerZoom = useCallback(
    (dz: number, autour?: { x: number; y: number }) => {
      setZoom((z) => {
        const cible = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + dz));
        const vrai = cible - z;
        if (vrai === 0) return z;
        const a = autour ?? { x: LARGEUR / 2, y: HAUTEUR / 2 };
        setDecalage((d) => ({
          x: recalerDecalage({ decalage: d.x, taille: LARGEUR, position: a.x, dz: vrai }),
          y: recalerDecalage({ decalage: d.y, taille: HAUTEUR, position: a.y, dz: vrai }),
        }));
        return cible;
      });
    },
    [],
  );

  // ⚠️ Écouteur NATIF `{ passive: false }` : React attache `onWheel` en passif, où
  // `preventDefault()` est ignoré — la page défilerait EN MÊME TEMPS que la carte zoome.
  // Et le zoom exige Ctrl/⌘, comme partout ailleurs dans l'app : capturer la molette nue
  // rendrait la page infranchissable dès que le curseur passe sur la carte.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const surMolette = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      changerZoom(e.deltaY < 0 ? 1 : -1, dansLeCadre(e.clientX, e.clientY) ?? undefined);
    };
    svg.addEventListener("wheel", surMolette, { passive: false });
    return () => svg.removeEventListener("wheel", surMolette);
  }, [changerZoom, dansLeCadre]);

  const surAdresse = async () => {
    setCherche(true);
    setMessage(null);
    try {
      const r = await chercherAdresse(adresse);
      if (r.ok && typeof r.lat === "number" && typeof r.lng === "number") {
        setPoint({ lat: r.lat, lng: r.lng });
        setDecalage({ x: 0, y: 0 });
        setZoom(17);
        setMessage({ ton: "ok", texte: r.libelle || "Adresse trouvée." });
      } else {
        setMessage({ ton: "erreur", texte: r.message ?? "Adresse introuvable." });
      }
    } finally {
      setCherche(false);
    }
  };

  if (!vue) return null;
  const rayonPx = rayonEnPixels(rayonM, ancre.lat, vue.zoom);
  const marqueur = point ? vue.marqueurs[0]! : null;

  return (
    <div className="choix-lieu">
      <div className="cl-adresse">
        <label>
          <span className="etiquette-champ">Adresse</span>
          <input
            type="text"
            value={adresse}
            placeholder="1 rue Exemple, Ville-Exemple"
            onChange={(e) => setAdresse(e.target.value)}
            // ⚠️ Le formulaire d'ajout ENGLOBE ce champ : sans ça, Entrée enregistrerait le
            // lieu au lieu de chercher l'adresse — avec les coordonnées d'avant.
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void surAdresse();
              }
            }}
          />
        </label>
        <button type="button" onClick={() => void surAdresse()} disabled={cherche || !adresse.trim()}>
          {cherche ? "Recherche…" : "Chercher"}
        </button>
      </div>
      {message && <p className={`cl-message ${message.ton}`}>{message.texte}</p>}

      <div className="carte-cadre carte-interactive" style={{ aspectRatio: `${LARGEUR} / ${HAUTEUR}` }}>
        {vue.tuiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={t.cle}
            src={t.url}
            alt=""
            width={TAILLE_TUILE}
            height={TAILLE_TUILE}
            loading="lazy"
            draggable={false}
            className="tuile-osm"
            // La largeur se calcule ICI : sans elle, chaque tuile s'affiche à ses 256 px
            // naturels et la grille ne pave plus.
            style={{
              width: `${(TAILLE_TUILE / vue.largeur) * 100}%`,
              left: `${(t.gauche / vue.largeur) * 100}%`,
              top: `${(t.haut / vue.hauteur) * 100}%`,
            }}
          />
        ))}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${vue.largeur} ${vue.hauteur}`}
          className="calque calque-actif"
          role="application"
          aria-label="Carte — tape pour poser le lieu de recharge"
          onPointerDown={(e) => {
            glisse.current = { x: e.clientX, y: e.clientY, actif: true, bouge: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!glisse.current.actif) return;
            const dx = e.clientX - glisse.current.x;
            const dy = e.clientY - glisse.current.y;
            // Seuil : sans lui, un appui avec un frémissement de 1 px passerait pour un
            // glisser et ne poserait jamais le point.
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) glisse.current.bouge = true;
            glisse.current.x = e.clientX;
            glisse.current.y = e.clientY;
            const r = e.currentTarget.getBoundingClientRect();
            const echelle = vue.largeur / Math.max(1, r.width);
            setDecalage((d) => ({ x: d.x + dx * echelle, y: d.y + dy * echelle }));
          }}
          onPointerUp={(e) => {
            const glissait = glisse.current.bouge;
            glisse.current.actif = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
            if (glissait) return;
            const p = dansLeCadre(e.clientX, e.clientY);
            if (p) {
              setPoint(pointDepuisCadre(p, vue));
              setMessage(null);
            }
          }}
          onPointerCancel={() => {
            glisse.current.actif = false;
          }}
        >
          {marqueur && (
            <>
              {/* Le rayon d'appariement, à l'échelle RÉELLE du terrain. */}
              <circle cx={marqueur.x} cy={marqueur.y} r={rayonPx} className="cl-rayon" />
              <circle cx={marqueur.x} cy={marqueur.y} r="7" className="cl-point" />
            </>
          )}
        </svg>
      </div>

      <div className="carte-boutons">
        <button type="button" onClick={() => changerZoom(1)} disabled={vue.zoom >= ZOOM_MAX} aria-label="Zoomer">
          +
        </button>
        <button type="button" onClick={() => changerZoom(-1)} disabled={vue.zoom <= ZOOM_MIN} aria-label="Dézoomer">
          −
        </button>
        <span className="hint">
          Tape la carte pour poser le lieu · glisse pour te déplacer · Ctrl + molette pour zoomer
        </span>
      </div>

      <label className="cl-rayon-champ">
        <span className="etiquette-champ">Rayon d’appariement : {rayonM} m</span>
        <input
          type="range"
          min={20}
          max={500}
          step={10}
          value={rayonM}
          onChange={(e) => setRayonM(Number(e.target.value))}
          className="curseur-limite"
        />
        <span className="aide">
          Une recharge faite dans ce cercle sera facturée au tarif de ce lieu. Trop large, et
          la borne du voisin y tombe aussi.
        </span>
      </label>

      {/* Ce que le formulaire enverra. Pas de champ à taper : la valeur est DÉSIGNÉE. */}
      <input type="hidden" name="lat" value={point ? point.lat.toFixed(6) : ""} />
      <input type="hidden" name="lng" value={point ? point.lng.toFixed(6) : ""} />
      <input type="hidden" name="rayonM" value={rayonM} />

      <p className={`cl-etat ${point ? "" : "vide"}`}>
        {point
          ? `Lieu posé à ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}.`
          : "Aucun lieu posé — tape la carte ou cherche une adresse."}
      </p>
    </div>
  );
}
