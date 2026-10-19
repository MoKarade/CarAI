"use client";

// app/ui/GraphiquesLies.tsx — les courbes zoomables, LIÉES par un axe de temps commun.
//
// ══ POURQUOI UN COMPOSANT CLIENT, ALORS QUE TOUT LE RESTE EST RENDU AU SERVEUR ══════
// Demandes de Marc (14/08) : voir les heures, une échelle visible, ZOOMER, une échelle
// identique entre courbes même en zoomant, plus de détail, une analyse sous chaque courbe.
// Le zoom et le survol sont des états d'interface : ils ne peuvent pas vivre au serveur.
//
// Ce qui reste au serveur : la LECTURE des mesures. Ce composant ne fait aucun fetch, ne
// porte aucun jeton — il reçoit des points déjà lus et se contente de les dessiner.
//
// ══ CE QUI EST PARTAGÉ, ET CE QUI NE L'EST PAS ══════════════════════════════════════
// PARTAGÉ  : l'axe du TEMPS (fenêtre + zoom) et le curseur de survol. Un même instant est
//            à la même abscisse sur toutes les courbes, et le survol le marque partout —
//            c'est ce qui permet de voir qu'une chute de charge tombe pendant un trajet.
// PROPRE   : l'axe VERTICAL de chaque courbe. Superposer des %, des km et des kPa sur une
//            échelle commune écraserait tout sauf la plus grande — ce serait joli et
//            illisible. Chaque axe Y est donc calé sur ses valeurs VISIBLES et étiqueté.
//
// ⚠️ Le survol lit la mesure la PLUS PROCHE, jamais une interpolation : afficher « 78,4 % »
// à un instant où le véhicule n'a rien mesuré serait une donnée inventée.

import { InfoTap } from "./Pastille";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointSerie } from "@/lib/vehicle/analyse";
import {
  ZOOM_COMPLET,
  analyserSerie,
  appliquerZoom,
  fenetreCommune,
  pointLePlusProche,
  projeter,
  reperesTemps,
  zoomerAutour,
  type FenetreTemps,
  type Zoom,
} from "@/lib/vehicle/graphique";

const FUSEAU = "America/Toronto";

const fmtInstant = new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU,
  dateStyle: "medium",
  timeStyle: "short",
});
const fmtJour = new Intl.DateTimeFormat("fr-CA", { timeZone: FUSEAU, dateStyle: "medium" });

/** Marges de la zone traçable. La gauche loge les étiquettes de l'axe vertical, le bas
    celles du temps — sans elles, « échelle visible » resterait une grille muette. */
const MARGE = { gauche: 54, droite: 14, haut: 10, bas: 28 };

export interface SerieGraphique {
  id: string;
  titre: string;
  points: PointSerie[];
  unite: string | null;
  decimales: number;
  /** Index de teinte dans la palette (`--serie-N`). Stable par métrique. */
  teinte: number;
  /**
   * Ce que la courbe DIT — une phrase, pas un paragraphe.
   *
   * Vient de la table `EXPLICATIONS` de la page Analyse (refonte du 13/08). Elle répond à
   * « qu'est-ce que je regarde, et qu'est-ce qui serait anormal ? », là où l'analyse
   * statistique juste en dessous répond à « qu'a fait cette valeur sur la période ». Les
   * deux se complètent : la phrase est fixe et humaine, les chiffres suivent le zoom.
   */
  explication?: string;
}

/** Largeur mesurée du conteneur. Rend le texte NET et l'aspect juste : un SVG étiré par
    `preserveAspectRatio="none"` déformerait les chiffres des axes. */
function useLargeur(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [largeur, setLargeur] = useState(760);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver((entrees) => {
      const l = entrees[0]?.contentRect.width;
      if (l && l > 0) setLargeur(Math.round(l));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return [ref, largeur];
}

export function GraphiquesLies({
  series,
  hauteurCourbe = 190,
}: {
  series: SerieGraphique[];
  hauteurCourbe?: number;
}) {
  const [zoom, setZoom] = useState<Zoom>(ZOOM_COMPLET);
  /** Instant survolé, PARTAGÉ : le repère apparaît sur toutes les courbes à la fois. */
  const [instant, setInstant] = useState<number | null>(null);
  const [conteneur, largeur] = useLargeur();

  const totale = useMemo(
    () => fenetreCommune(series.map((s) => s.points)),
    [series],
  );
  const fenetre = useMemo(
    () => (totale ? appliquerZoom(totale, zoom) : null),
    [totale, zoom],
  );

  const zoomActif = zoom.debut > 0 || zoom.fin < 1;

  const zoomer = useCallback((facteur: number, ancre = 0.5) => {
    setZoom((z) => zoomerAutour(z, ancre, facteur));
  }, []);

  if (!totale || !fenetre) {
    return (
      <p className="vide">
        Aucune mesure datée à tracer. Les courbes apparaîtront dès que le véhicule aura
        transmis des relevés horodatés.
      </p>
    );
  }

  const plot = Math.max(120, largeur - MARGE.gauche - MARGE.droite);

  return (
    <div className="graphiques-lies" ref={conteneur}>
      <ControleTemps
        totale={totale}
        fenetre={fenetre}
        zoom={zoom}
        setZoom={setZoom}
        zoomer={zoomer}
        zoomActif={zoomActif}
      />

      {series.map((serie) => (
        <Courbe
          key={serie.id}
          serie={serie}
          fenetre={fenetre}
          largeurPlot={plot}
          hauteur={hauteurCourbe}
          instant={instant}
          setInstant={setInstant}
          onZoom={zoomer}
        />
      ))}
    </div>
  );
}

/** Brosse temporelle + boutons. UN seul contrôle pour toutes les courbes — c'est ce qui
    rend l'échelle commune évidente à l'œil au lieu d'être une promesse dans une doc. */
function ControleTemps({
  totale,
  fenetre,
  zoom,
  setZoom,
  zoomer,
  zoomActif,
}: {
  totale: FenetreTemps;
  fenetre: FenetreTemps;
  zoom: Zoom;
  setZoom: (z: Zoom) => void;
  zoomer: (facteur: number, ancre?: number) => void;
  zoomActif: boolean;
}) {
  const duree = fenetre.t1 - fenetre.t0;
  const jours = duree / 86_400_000;
  const largeurLisible =
    jours >= 2
      ? `${Math.round(jours)} jours`
      : duree >= 3_600_000
        ? `${Math.round(duree / 3_600_000)} h`
        : `${Math.round(duree / 60_000)} min`;

  return (
    <div className="controle-temps">
      <div className="ct-info">
        <strong>{fmtInstant.format(fenetre.t0)}</strong>
        <span className="fleche" aria-hidden="true">
          →
        </span>
        <strong>{fmtInstant.format(fenetre.t1)}</strong>
        <span className="meta">({largeurLisible})</span>
      </div>

      {/* Deux curseurs natifs : accessibles au clavier, utilisables au doigt, et rien à
          installer. Une brosse dessinée à la main serait plus jolie et moins utilisable. */}
      <div className="ct-brosse">
        <label>
          <span className="sr-only">Début de la fenêtre</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(zoom.debut * 1000)}
            onChange={(e) => {
              const d = Number(e.target.value) / 1000;
              setZoom({ debut: Math.min(d, zoom.fin - 0.002), fin: zoom.fin });
            }}
          />
        </label>
        <label>
          <span className="sr-only">Fin de la fenêtre</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(zoom.fin * 1000)}
            onChange={(e) => {
              const f = Number(e.target.value) / 1000;
              setZoom({ debut: zoom.debut, fin: Math.max(f, zoom.debut + 0.002) });
            }}
          />
        </label>
      </div>

      <div className="ct-boutons">
        <button type="button" onClick={() => zoomer(0.6)} aria-label="Zoomer">
          +
        </button>
        <button type="button" onClick={() => zoomer(1 / 0.6)} aria-label="Dézoomer">
          −
        </button>
        <button type="button" onClick={() => setZoom(ZOOM_COMPLET)} disabled={!zoomActif}>
          Tout
        </button>
        <button
          type="button"
          onClick={() => {
            // « Dernier jour » : une fraction du domaine total, pas une date absolue.
            const total = totale.t1 - totale.t0;
            const part = Math.min(1, 86_400_000 / total);
            setZoom({ debut: 1 - part, fin: 1 });
          }}
        >
          24 h
        </button>
      </div>
    </div>
  );
}

function Courbe({
  serie,
  fenetre,
  largeurPlot,
  hauteur,
  instant,
  setInstant,
  onZoom,
}: {
  serie: SerieGraphique;
  fenetre: FenetreTemps;
  largeurPlot: number;
  hauteur: number;
  instant: number | null;
  setInstant: (t: number | null) => void;
  onZoom: (facteur: number, ancre: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const trace = useMemo(
    () => projeter(serie.points, fenetre, { largeur: largeurPlot, hauteur, nbReperes: 5 }),
    [serie.points, fenetre, largeurPlot, hauteur],
  );

  const visibles = useMemo(
    () =>
      serie.points.filter((p) => {
        const t = p.t.getTime();
        return t >= fenetre.t0 && t <= fenetre.t1;
      }),
    [serie.points, fenetre],
  );

  const analyse = useMemo(() => analyserSerie(visibles), [visibles]);
  const graduations = useMemo(
    () => reperesTemps(fenetre, largeurPlot, { fuseau: FUSEAU }),
    [fenetre, largeurPlot],
  );

  const fmt = useCallback(
    (v: number) => v.toFixed(serie.decimales) + (serie.unite ? ` ${serie.unite}` : ""),
    [serie.decimales, serie.unite],
  );

  const largeurTotale = largeurPlot + MARGE.gauche + MARGE.droite;
  const hauteurTotale = hauteur + MARGE.haut + MARGE.bas;

  const xDepuisEvenement = useCallback(
    (clientX: number): number | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return null;
      const ratio = largeurTotale / rect.width;
      return (clientX - rect.left) * ratio - MARGE.gauche;
    },
    [largeurTotale],
  );

  // ══ ZOOM À LA MOLETTE : POURQUOI CE N'EST PAS UN `onWheel` REACT ═══════════════════
  //
  // ⚠️ Bug signalé par Marc (20/08) : « j'arrive pas à scroll sur les graphs, ça me fait
  // descendre la page ». La légende promettait « Molette pour zoomer » et il ne se passait
  // rien. Cause : React attache `onWheel` en écouteur PASSIF, où `preventDefault()` est
  // ignoré par le navigateur. Le zoom s'appliquait bien... en même temps que le défilement
  // de la page, qui emportait le graphique hors de l'écran avant qu'on voie quoi que ce
  // soit. Il faut un écouteur natif déclaré `{ passive: false }`.
  //
  // ⚠️ ET LE ZOOM EXIGE Ctrl/⌘. Capturer la molette NUE rendrait la page infranchissable :
  // sur un écran qui empile huit courbes, le curseur est presque toujours au-dessus de
  // l'une d'elles, et on ne pourrait plus jamais faire défiler. Ctrl + molette est le geste
  // de zoom standard, et sur trackpad macOS le pincer envoie précisément ctrlKey — donc le
  // pincement zoome sans rien coder de plus.
  //
  // Les boutons + / − restent la voie principale : sur un téléphone, d'où viennent les
  // captures de Marc, il n'y a aucune molette.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const surMolette = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // molette nue : la page défile, comme attendu
      e.preventDefault();
      const x = xDepuisEvenement(e.clientX);
      if (x === null) return;
      const ancre = Math.min(Math.max(x / largeurPlot, 0), 1);
      onZoom(e.deltaY < 0 ? 0.85 : 1 / 0.85, ancre);
    };
    svg.addEventListener("wheel", surMolette, { passive: false });
    return () => svg.removeEventListener("wheel", surMolette);
  }, [xDepuisEvenement, largeurPlot, onZoom]);

  // Point survolé : la mesure réelle la plus proche de l'instant partagé.
  const survole = useMemo(() => {
    if (!trace || instant === null) return null;
    const duree = fenetre.t1 - fenetre.t0;
    const x = ((instant - fenetre.t0) / duree) * largeurPlot;
    return pointLePlusProche(trace, x);
  }, [trace, instant, fenetre, largeurPlot]);

  if (!trace) {
    return (
      <figure className="courbe" data-teinte={serie.teinte}>
        <figcaption>
          <strong>{serie.titre}</strong>
        </figcaption>
        <p className="vide">
          Aucune mesure dans cette fenêtre. Élargis le zoom pour retrouver la courbe.
        </p>
      </figure>
    );
  }

  return (
    <figure className="courbe" data-teinte={serie.teinte}>
      <figcaption>
        <strong>{serie.titre}</strong>
        <span className="meta">
          {trace.points.length} mesure{trace.points.length > 1 ? "s" : ""} visible
          {trace.points.length > 1 ? "s" : ""}
        </span>
      </figcaption>

      {serie.explication && <InfoTap resume="Comment lire">{serie.explication}</InfoTap>}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${largeurTotale} ${hauteurTotale}`}
        className="trace"
        role="img"
        aria-label={`${serie.titre} : de ${fmt(trace.minY)} à ${fmt(trace.maxY)} sur la période affichée`}
        onPointerMove={(e) => {
          const x = xDepuisEvenement(e.clientX);
          if (x === null) return;
          const duree = fenetre.t1 - fenetre.t0;
          setInstant(fenetre.t0 + (Math.min(Math.max(x, 0), largeurPlot) / largeurPlot) * duree);
        }}
        onPointerLeave={() => setInstant(null)}
      >
        {/* Repères horizontaux ÉTIQUETÉS. Une grille sans chiffres décore, elle n'informe
            pas — c'est exactement ce que « je veux une échelle visible » demandait. */}
        {trace.reperes.map((r) => (
          <g key={r.y}>
            <line
              x1={MARGE.gauche}
              x2={MARGE.gauche + largeurPlot}
              y1={r.y + MARGE.haut}
              y2={r.y + MARGE.haut}
              className="grille"
            />
            <text
              x={MARGE.gauche - 8}
              y={r.y + MARGE.haut}
              className="etiquette-y"
              textAnchor="end"
              dominantBaseline="middle"
            >
              {r.valeur.toFixed(serie.decimales)}
            </text>
          </g>
        ))}

        {/* Graduations de TEMPS. Elles passent des jours aux heures quand on zoome. */}
        {graduations.map((g) => (
          <g key={g.t}>
            <line
              x1={MARGE.gauche + g.x}
              x2={MARGE.gauche + g.x}
              y1={MARGE.haut}
              y2={MARGE.haut + hauteur}
              className={g.jour ? "grille-jour" : "grille-verticale"}
            />
            <text
              x={MARGE.gauche + g.x}
              y={MARGE.haut + hauteur + 18}
              className={g.jour ? "etiquette-x jour" : "etiquette-x"}
              textAnchor="middle"
            >
              {g.libelle}
            </text>
          </g>
        ))}

        <g transform={`translate(${MARGE.gauche}, ${MARGE.haut})`}>
          <defs>
            <linearGradient id={`aire-${serie.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.30" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          <polygon
            points={`${trace.polyline} ${trace.points[trace.points.length - 1]!.x},${hauteur} ${trace.points[0]!.x},${hauteur}`}
            fill={`url(#aire-${serie.id})`}
            stroke="none"
          />
          <polyline
            points={trace.polyline}
            fill="none"
            className="ligne"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* « Plus de détail » : chaque MESURE réelle est marquée dès qu'elles sont assez
              espacées pour être distinguées. Au-delà, les points se colleraient en pâté. */}
          {trace.points.length <= 90 &&
            trace.points.map((p) => (
              <circle key={`${p.t}`} cx={p.x} cy={p.y} r="2.6" className="point" />
            ))}

          {survole && (
            <>
              <line
                x1={survole.x}
                x2={survole.x}
                y1={0}
                y2={hauteur}
                className="curseur"
              />
              <circle cx={survole.x} cy={survole.y} r="5" className="point-survole" />
            </>
          )}
        </g>
      </svg>

      {/* La valeur survolée en TEXTE plutôt qu'en infobulle SVG : lisible au doigt, elle ne
          sort pas du cadre près des bords, et elle reste dans le flux pour un lecteur
          d'écran. Quand rien n'est survolé, la ligne dit la dernière mesure. */}
      <p className="lecture" aria-live="polite">
        {survole ? (
          <>
            <strong>{fmt(survole.valeur)}</strong>{" "}
            <span className="meta">le {fmtInstant.format(survole.t)}</span>
          </>
        ) : (
          <span className="meta">
            Survole la courbe pour lire une mesure. Zoom : les boutons + et − ci-dessus, ou Ctrl + molette (pincer sur trackpad).
          </span>
        )}
      </p>

      {analyse && <AnalyseCourbe analyse={analyse} fmt={fmt} />}
    </figure>
  );
}

/** L'analyse demandée sous chaque courbe. Elle DÉCRIT ce que la fenêtre contient — elle
    ne prédit rien et ne conclut pas sur deux points. */
function AnalyseCourbe({
  analyse,
  fmt,
}: {
  analyse: NonNullable<ReturnType<typeof analyserSerie>>;
  fmt: (v: number) => string;
}) {
  const mot =
    analyse.tendance === "hausse"
      ? "en hausse"
      : analyse.tendance === "baisse"
        ? "en baisse"
        : analyse.tendance === "stable"
          ? "stable"
          : "trop peu de mesures pour conclure";

  return (
    <div className="analyse" data-tendance={analyse.tendance}>
      <div className="an-tendance">
        <span className="puce" aria-hidden="true" />
        <strong>{mot}</strong>
        {analyse.delta !== null && analyse.tendance !== "indeterminee" && (
          <span className="meta">
            {analyse.delta >= 0 ? "+" : "−"}
            {fmt(Math.abs(analyse.delta))} sur la période
          </span>
        )}
      </div>
      <dl className="an-chiffres">
        <div>
          <dt>Minimum</dt>
          <dd>{fmt(analyse.min)}</dd>
        </div>
        <div>
          <dt>Maximum</dt>
          <dd>{fmt(analyse.max)}</dd>
        </div>
        <div>
          <dt>Moyenne</dt>
          <dd>{fmt(analyse.moyenne)}</dd>
        </div>
        <div>
          <dt>Amplitude</dt>
          <dd>{fmt(analyse.amplitude)}</dd>
        </div>
        <div>
          <dt>Mesures</dt>
          <dd>{analyse.nbPoints}</dd>
        </div>
      </dl>
      <p className="an-note meta">
        Du {fmtJour.format(analyse.premier)} au {fmtJour.format(analyse.dernier)}. Moyenne
        arithmétique des relevés, non pondérée par le temps — les mesures ne sont pas
        équidistantes.
      </p>
    </div>
  );
}
