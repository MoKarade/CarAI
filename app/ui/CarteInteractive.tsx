"use client";

// app/ui/CarteInteractive.tsx — la carte des trajets, zoomable et cliquable.
//
// Marc, 14/08/2026 : « pour les trajets je veux pouvoir zoomer, cliquer sur la carte ».
//
// ══ CE QUI CHANGE PAR RAPPORT À `Carte.tsx` ═════════════════════════════════════════
// `Carte.tsx` reste : rendu serveur, zéro JavaScript, cadrage figé sur le trajet entier.
// Elle sert partout où la carte est une ILLUSTRATION (accueil, résumé d'un trajet).
//
// Ici, la carte est un OUTIL : on veut s'approcher d'une intersection, suivre une rue,
// lire l'heure d'un relevé. Ça demande un état d'interface, donc un composant client.
// La projection, elle, reste la MÊME fonction pure (`composerVue`) — deux rendus, une
// seule géométrie. C'est ce qui garantit que le tracé tombe sur les rues des deux côtés.
//
// ⚠️ VIE PRIVÉE : chaque déplacement et chaque zoom demande de NOUVELLES tuiles à
// openstreetmap.org, dont les coordonnées disent approximativement où on regarde. La carte
// figée en demandait un lot une fois ; celle-ci en demande à chaque geste. C'est le prix de
// l'interactivité, et il se dit à l'écran plutôt que de se découvrir plus tard.
//
// ⚠️ OSM est BÉNÉVOLE et sa politique interdit le téléchargement en masse. Le plafond
// `MAX_TUILES` de `composerVue` continue de s'appliquer, et le zoom est borné aux niveaux
// réellement servis.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TAILLE_TUILE,
  ZOOM_MAX,
  ZOOM_MIN,
  composerVue,
  recalerDecalage,
  zoomPourCadrer,
  type PointGeo,
} from "@/lib/vehicle/carte";

const FUSEAU = "America/Toronto";
const fmtInstant = new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU,
  dateStyle: "medium",
  timeStyle: "short",
});

export interface PointCarte extends PointGeo {
  /** Instant du relevé, en ISO. Absent quand la source ne date pas la position. */
  iso?: string;
  libelle?: string;
}

const LARGEUR = 640;
const HAUTEUR = 420;

export function CarteInteractive({
  points,
  legende,
  cheminInconnu = false,
  sansChemin = false,
}: {
  points: PointCarte[];
  legende?: string;
  cheminInconnu?: boolean;
  /**
   * ⚠️ Aucun trait entre les points. Pour un NUAGE de relevés d'arrêt (la « zone
   * parcourue »), l'ordre n'est pas un itinéraire : relier les points dessinerait un
   * chemin que personne n'a mesuré. Même règle que l'image statique qu'elle remplace.
   */
  sansChemin?: boolean;
}) {
  const zoomInitial = useMemo(
    () => (points.length > 0 ? zoomPourCadrer(points, LARGEUR, HAUTEUR) : 13),
    [points],
  );

  const [zoom, setZoom] = useState(zoomInitial);
  const [decalage, setDecalage] = useState({ x: 0, y: 0 });
  const [choisi, setChoisi] = useState<number | null>(null);

  const glisse = useRef<{ x: number; y: number; actif: boolean; bouge: boolean }>({
    x: 0,
    y: 0,
    actif: false,
    bouge: false,
  });
  const svgRef = useRef<SVGSVGElement | null>(null);

  const vue = useMemo(
    () => composerVue({ points, largeur: LARGEUR, hauteur: HAUTEUR, zoom, decalage }),
    [points, zoom, decalage],
  );

  /** Change de zoom en gardant fixe le point visé. Sans ça, chaque cran recentrerait
      brutalement sur le trajet et ferait fuir l'endroit qu'on regardait. */
  const changerZoom = useCallback(
    (dz: number, ancre?: { x: number; y: number }) => {
      const cible = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + dz));
      const vraiDz = cible - zoom;
      if (vraiDz === 0) return;
      const a = ancre ?? { x: LARGEUR / 2, y: HAUTEUR / 2 };
      setDecalage((d) => ({
        x: recalerDecalage({ decalage: d.x, taille: LARGEUR, position: a.x, dz: vraiDz }),
        y: recalerDecalage({ decalage: d.y, taille: HAUTEUR, position: a.y, dz: vraiDz }),
      }));
      setZoom(cible);
    },
    [zoom],
  );

  const positionDansCadre = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * LARGEUR,
      y: ((clientY - rect.top) / rect.height) * HAUTEUR,
    };
  }, []);

  // ══ ZOOM À LA MOLETTE : POURQUOI CE N'EST PAS UN `onWheel` REACT ═══════════════════════
  //
  // ⚠️ Marc, 20/08 : « quand je zoom ça scroll la page ». MÊME CAUSE que les graphiques le
  // matin même — React attache `onWheel` en écouteur PASSIF, où `preventDefault()` est
  // ignoré par le navigateur. Le zoom s'appliquait bien, EN MÊME TEMPS que le défilement
  // de la page : la carte partait hors de l'écran pendant qu'elle zoomait.
  //
  // ⚠️ ET LA LEÇON DE FOND : j'avais corrigé UNE surface (les graphiques) sans chercher
  // les autres. Un `grep onWheel` aurait trouvé celle-ci le même jour. Quand on pose une
  // règle d'interaction, la chercher partout où elle s'applique — c'est exactement la
  // classe du demi-correctif de l'odomètre (une voie de lecture corrigée sur deux).
  //
  // Ctrl/⌘ exigé, comme le mode `cooperative` de Google Maps : la molette NUE doit faire
  // défiler la page. Une carte pleine largeur au milieu d'une page longue qui capture la
  // molette rend cette page infranchissable. Sur trackpad macOS, le pincer envoie
  // précisément `ctrlKey` — le pincement zoome sans une ligne de plus.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const surMolette = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // molette nue : la page défile, comme attendu
      e.preventDefault();
      const a = positionDansCadre(e.clientX, e.clientY);
      changerZoom(e.deltaY < 0 ? 1 : -1, a ?? undefined);
    };
    svg.addEventListener("wheel", surMolette, { passive: false });
    return () => svg.removeEventListener("wheel", surMolette);
  }, [positionDansCadre, changerZoom]);

  if (!vue) {
    return (
      <p className="hint">
        Aucune position enregistrée sur cette période — il n’y a pas de trajet à cartographier.
      </p>
    );
  }

  const recentre = decalage.x !== 0 || decalage.y !== 0 || zoom !== zoomInitial;
  const point = choisi !== null ? points[choisi] : undefined;
  const marqueur = choisi !== null ? vue.marqueurs[choisi] : undefined;

  return (
    <figure className="carte-osm carte-interactive">
      <div className="carte-cadre" style={{ aspectRatio: `${LARGEUR} / ${HAUTEUR}` }}>
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
            // ⚠️ La LARGEUR se calcule ICI, pas en CSS, et son absence CASSE la carte :
            // sans elle chaque tuile s'affiche à ses 256 px naturels quelle que soit la
            // largeur réelle du cadre, donc la grille ne pave plus. C'est exactement ce qui
            // manquait à ce composant le 14/08 — « la carte marche pas » (Marc, 17/08).
            // Elle se dérive de `vue.largeur` : les deux ne peuvent pas diverger.
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
          role="img"
          aria-label={legende ?? "Trajet du véhicule sur la carte"}
          onPointerDown={(e) => {
            glisse.current = { x: e.clientX, y: e.clientY, actif: true, bouge: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!glisse.current.actif) return;
            const dx = e.clientX - glisse.current.x;
            const dy = e.clientY - glisse.current.y;
            // Seuil : sans lui, un clic avec un frémissement de 1 px serait pris pour un
            // glisser et le marqueur ne s'ouvrirait jamais au doigt.
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) glisse.current.bouge = true;
            glisse.current.x = e.clientX;
            glisse.current.y = e.clientY;
            const rect = e.currentTarget.getBoundingClientRect();
            const echelle = vue.largeur / Math.max(1, rect.width);
            setDecalage((d) => ({ x: d.x + dx * echelle, y: d.y + dy * echelle }));
          }}
          onPointerUp={(e) => {
            glisse.current.actif = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            glisse.current.actif = false;
          }}
        >
          {!sansChemin && (
            <>
              <polyline
                points={vue.polyline}
                fill="none"
                strokeWidth="7"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="trace-fond"
              />
              <polyline
                points={vue.polyline}
                fill="none"
                strokeWidth="3.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                className={cheminInconnu ? "trace trace-devinee" : "trace"}
              />
            </>
          )}

          {/* Chaque relevé est CLIQUABLE. La cible tactile est un cercle transparent bien
              plus large que la pastille : 44 px de cible pour 7 px de dessin, sinon rien
              n'est atteignable au doigt. */}
          {vue.marqueurs.map((m, i) => {
            const estBout = i === 0 || i === vue.marqueurs.length - 1;
            const classe =
              i === 0 ? "pt-depart" : i === vue.marqueurs.length - 1 ? "pt-arrivee" : "pt-etape";
            return (
              <g key={`${m.x},${m.y},${i}`}>
                <circle cx={m.x} cy={m.y} r={estBout ? 6 : 3.5} className={classe} />
                {choisi === i && <circle cx={m.x} cy={m.y} r="11" className="pt-choisi" />}
                <circle
                  cx={m.x}
                  cy={m.y}
                  r="16"
                  className="cible"
                  onClick={() => {
                    // Un glisser se termine par un `click` : sans ce garde, déplacer la
                    // carte ouvrirait le relevé qui se trouve sous le doigt à l'arrivée.
                    if (glisse.current.bouge) return;
                    setChoisi((c) => (c === i ? null : i));
                  }}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="carte-boutons">
        <button
          type="button"
          onClick={() => changerZoom(1)}
          disabled={zoom >= ZOOM_MAX}
          aria-label="Zoomer"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => changerZoom(-1)}
          disabled={zoom <= ZOOM_MIN}
          aria-label="Dézoomer"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => {
            setZoom(zoomInitial);
            setDecalage({ x: 0, y: 0 });
          }}
          disabled={!recentre}
        >
          Recentrer
        </button>
      </div>

      {/* Le détail du relevé cliqué. En TEXTE sous la carte plutôt qu'en bulle flottante :
          lisible au doigt, jamais coupé par un bord, et dans le flux pour un lecteur
          d'écran. Rien n'est inventé — si la source n'a pas daté la position, on le dit. */}
      {point && marqueur && (
        <div className="carte-detail">
          <strong>{point.libelle ?? `Relevé ${choisi! + 1} sur ${points.length}`}</strong>
          <dl>
            <div>
              <dt>Quand</dt>
              <dd>
                {point.iso ? (
                  fmtInstant.format(new Date(point.iso))
                ) : (
                  <span className="meta">non daté par la source</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Position</dt>
              <dd>
                {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
              </dd>
            </div>
          </dl>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Ouvrir dans Maps
          </a>
        </div>
      )}

      <figcaption className="meta">
        {legende ? <>{legende} · </> : null}
        <span className="pastille depart" /> départ <span className="pastille arrivee" /> arrivée
        {" · "}glisse pour déplacer, <strong>Ctrl/⌘ + molette</strong> ou les boutons pour
        zoomer, clique un point pour son détail
        {/* La légende NOMME le geste réel : « molette » tout court a été écrit ici pendant
            que la molette nue faisait défiler la page — une consigne inapplicable est pire
            qu'une absence de consigne, on cherche ce qui ne marche pas au mauvais endroit. */}
        {cheminInconnu ? (
          <>
            {" · "}
            <strong>trait pointillé</strong> : la voiture n’enregistre que les deux bouts, la
            rue empruntée entre les deux n’est pas connue
          </>
        ) : null}
        {" · "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">
          © OpenStreetMap
        </a>
      </figcaption>
    </figure>
  );
}
