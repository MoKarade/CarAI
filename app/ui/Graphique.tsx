// app/ui/Graphique.tsx — les courbes de l'onglet Analyse, PARTAGÉES avec le tableau de
// bord.
//
// Déplacé depuis `app/analyse/page.tsx` le 12/08/2026 pour que l'accueil puisse en
// afficher deux (charge, bail) SANS dupliquer le rendu — une seule définition, deux écrans.
// C'est aussi l'occasion où le rendu a été enrichi visuellement (Marc : « améliore les
// visuellement ») : dégradé sous la courbe (`aireSvg`, purement décoratif — l'axe reste
// étiqueté par les repères, jamais remplacé par une couleur), trait aux extrémités
// arrondies, carte plus respirante. Aucun de ces ajouts ne change un chiffre affiché.

import { InfoTap } from "./Pastille";
import {
  aireSvg,
  type BandeSurvol,
  type TraceBail,
  type TraceDouble,
  type TraceMulti,
  type TraceSvg,
} from "@/lib/vehicle/analyse";
import { formaterAge } from "@/lib/vehicle/state";

/** Fuseau de Marc : les dates affichées sont les siennes, jamais l'UTC de Vercel. */
export const formatDate = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "America/Toronto",
  dateStyle: "short",
});

/** Pour les frises : une bascule sans son HEURE ne situe rien dans la journée. */
export const formatDateHeure = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "America/Toronto",
  dateStyle: "short",
  timeStyle: "short",
});

/**
 * LE SURVOL — « glisser la souris sur le graph pour voir les valeurs » (Marc, 13/08).
 *
 * ══ POURQUOI C'EST DU HTML PAR-DESSUS LE SVG, ET SANS UNE LIGNE DE JAVASCRIPT ════════
 *
 * Le SVG est étiré (`preserveAspectRatio="none"`) pour remplir la largeur : tout texte
 * placé dedans serait déformé horizontalement. Les repères de survol vivent donc en HTML
 * au-dessus, positionnés en POURCENTAGE — ils suivent l'étirement sans en souffrir.
 *
 * Et tout tient en CSS (`:hover` sur une bande révèle sa ligne, sa pastille et sa bulle) :
 * pas de JS client, donc rien à hydrater, rien à charger, et le graphique reste ce qu'il a
 * toujours été — du HTML rendu par le serveur. Le compromis assumé : sur un écran tactile
 * il faut toucher plutôt que survoler, et la bulle reste tant qu'on ne touche pas ailleurs.
 */
function Survol({
  bandes,
  fmt,
  format,
}: {
  bandes: BandeSurvol[];
  fmt: (v: number) => string;
  format: Intl.DateTimeFormat;
}) {
  if (bandes.length === 0) return null;
  return (
    <div className="survol" aria-hidden="true">
      {bandes.map((b) => (
        <div
          key={b.t.toISOString()}
          className="bande"
          style={{
            left: `${b.gauchePct}%`,
            width: `${b.largeurPct}%`,
            // La ligne et la pastille se placent par rapport à la BANDE : l'abscisse du
            // relevé n'est pas forcément son centre (bandes de largeurs inégales).
            ["--x" as string]: `${b.largeurPct === 0 ? 50 : ((b.xPct - b.gauchePct) / b.largeurPct) * 100}%`,
            ["--y" as string]: `${b.yPct}%`,
          }}
        >
          <span className="repere-v" />
          <span className="pastille-survol" />
          <span className={`bulle ${b.xPct > 70 ? "vers-gauche" : ""}`}>
            <strong>{fmt(b.valeur)}</strong>
            <span className="quand-bulle">{format.format(b.t)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function Graphique({
  id,
  titre,
  trace,
  unite,
  decimales,
  nbPoints,
  explication,
}: {
  /** Identifiant STABLE et UNIQUE sur la page — sert de base au dégradé SVG (`<defs>` ne
      se partage pas entre plusieurs graphiques d'un même écran). */
  id: string;
  titre: string;
  trace: TraceSvg;
  unite: string | null;
  decimales: number;
  nbPoints: number;
  /**
   * CE QUE LA COURBE DIT, en une phrase (Marc, 13/08 : « je veux des explications »).
   *
   * Une courbe sans lecture est un ornement : on voit que ça monte, on ne sait pas si c'est
   * bon signe. Une PHRASE, pas un paragraphe — le texte long est précisément ce qu'il
   * fallait retirer de cet écran.
   */
  explication?: string;
}) {
  const fmt = (v: number) => v.toFixed(decimales) + (unite ? ` ${unite}` : "");
  const degrade = `degrade-${id}`;
  return (
    <figure className="graphique">
      <figcaption>
        <strong>{titre}</strong>{" "}
        <span className="meta">
          {fmt(trace.min)} – {fmt(trace.max)} · {nbPoints} mesures ·{" "}
          {/* eslint-disable-next-line react-hooks/purity -- Server Component : rendu une fois par requête, l'âge affiché EST celui de la requête. */}
          {formaterAge((Date.now() - trace.dernier.getTime()) / 60_000)}
        </span>
      </figcaption>
      <div className="graphique-zone">
      <svg
        className="graphe"
        viewBox={`0 0 ${trace.largeur} ${trace.hauteur}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${titre}, de ${fmt(trace.min)} à ${fmt(trace.max)}`}
      >
        <defs>
          <linearGradient id={degrade} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.32" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grille : trois repères horizontaux. Leurs VALEURS sont écrites sous le tracé —
            une grille sans chiffres décore, elle n'informe pas. */}
        {trace.reperes.map((r) => (
          <line
            key={r.y}
            x1="0"
            x2={trace.largeur}
            y1={r.y}
            y2={r.y}
            className="grille"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Aire décorative sous la courbe : referme la MÊME polyline sur la ligne de base,
            ne peut donc jamais dessiner une forme différente de la courbe qu'elle habille.
            Aucun chiffre n'en dépend — seuls `reperes` et `fmt` en portent. */}
        <polygon points={aireSvg(trace)} fill={`url(#${degrade})`} stroke="none" />
        <polyline
          points={trace.polyline}
          fill="none"
          strokeWidth="2.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
        <Survol bandes={trace.bandes} fmt={fmt} format={formatDateHeure} />
      </div>
      {/* Axes en TEXTE plutôt que dans le SVG : le graphique est étiré horizontalement
          (preserveAspectRatio="none"), un texte à l'intérieur serait déformé. */}
      <div className="axes">
        <span>{formatDate.format(trace.premier)}</span>
        <span className="meta">
          {fmt(trace.reperes[0]!.valeur)} → {fmt(trace.reperes[2]!.valeur)}
        </span>
        <span>{formatDate.format(trace.dernier)}</span>
      </div>
      {explication && <InfoTap resume="Comment lire">{explication}</InfoTap>}
    </figure>
  );
}

/**
 * DEUX séries d'unités DIFFÉRENTES, chacune sur son échelle (Marc, 13/08 : « combine les
 * graphs autonomie et charge restante »).
 *
 * Ce que le composant doit rendre ÉVIDENT, sinon il ment : les deux courbes n'ont pas la
 * même échelle. D'où trois choses — l'unité écrite à CHAQUE bord, la légende qui donne la
 * dernière valeur de chaque série avec son unité, et une phrase qui dit qu'un croisement
 * des deux traits ne veut rien dire.
 */
export function GraphiqueDouble({
  titre,
  trace,
  explication,
}: {
  titre: string;
  trace: TraceDouble;
  explication?: string;
}) {
  const fmt = (axe: TraceDouble["gauche"], v: number) =>
    v.toFixed(axe.decimales) + (axe.unite ? ` ${axe.unite}` : "");

  return (
    <figure className="graphique graphique-double">
      <figcaption>
        <strong>{titre}</strong>{" "}
        <span className="meta">
          {/* eslint-disable-next-line react-hooks/purity -- Server Component : rendu une fois par requête, l'âge affiché EST celui de la requête. */}
          {formaterAge((Date.now() - trace.dernier.getTime()) / 60_000)}
        </span>
      </figcaption>
      <div className="graphique-zone">
        <svg
          className="graphe"
          viewBox={`0 0 ${trace.largeur} ${trace.hauteur}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${titre}. ${trace.gauche.libelle} : ${fmt(trace.gauche, trace.gauche.derniereValeur)}. ${trace.droite.libelle} : ${fmt(trace.droite, trace.droite.derniereValeur)}.`}
        >
          {trace.reperesY.map((y) => (
            <line
              key={y}
              x1="0"
              x2={trace.largeur}
              y1={y}
              y2={y}
              className="grille"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <polyline
            points={trace.gauche.polyline}
            fill="none"
            strokeWidth="2.5"
            className="serie-0"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* La seconde série est TIRETÉE en plus d'être colorée : deux traits pleins de
              couleurs voisines se confondent dès qu'ils se croisent, et en niveaux de gris
              (impression, daltonisme) la couleur seule ne distingue plus rien. */}
          <polyline
            points={trace.droite.polyline}
            fill="none"
            strokeWidth="2.5"
            strokeDasharray="7 4"
            className="serie-1"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div className="couche-survol serie-0">
          <Survol
            bandes={trace.gauche.bandes}
            fmt={(v) => fmt(trace.gauche, v)}
            format={formatDateHeure}
          />
        </div>
      </div>

      {/* Les DEUX échelles, chacune à son bord — c'est ce qui rend le double axe lisible
          plutôt que trompeur. */}
      <div className="axes axes-double">
        <span className="echelle-gauche">
          {fmt(trace.gauche, trace.gauche.reperes[0]!)} →{" "}
          {fmt(trace.gauche, trace.gauche.reperes[2]!)}
        </span>
        <span className="meta">
          {formatDate.format(trace.premier)} — {formatDate.format(trace.dernier)}
        </span>
        <span className="echelle-droite">
          {fmt(trace.droite, trace.droite.reperes[0]!)} →{" "}
          {fmt(trace.droite, trace.droite.reperes[2]!)}
        </span>
      </div>

      <ul className="legende">
        <li>
          <span className="pastille serie-0" aria-hidden="true" />
          {trace.gauche.libelle}{" "}
          <strong>{fmt(trace.gauche, trace.gauche.derniereValeur)}</strong>
        </li>
        <li>
          <span className="pastille serie-1 tiretee" aria-hidden="true" />
          {trace.droite.libelle}{" "}
          <strong>{fmt(trace.droite, trace.droite.derniereValeur)}</strong>
        </li>
      </ul>
      {explication && <InfoTap resume="Comment lire">{explication}</InfoTap>}
    </figure>
  );
}

/**
 * PLUSIEURS séries sur un axe COMMUN — les quatre pneus, typiquement.
 *
 * Ce que ce composant apporte et que quatre `Graphique` ne pouvaient pas : l'écart. Avec un
 * axe par courbe, deux roues à 240 et 205 kPa se dessinent identiques. Ici elles sont à deux
 * hauteurs différentes, et une roue qui décroche se voit décrocher.
 *
 * Chaque série porte sa couleur ET sa valeur de fin dans la légende : une légende qui ne
 * donnerait que la couleur obligerait à faire l'aller-retour entre le trait et le texte.
 */
export function GraphiqueMulti({
  titre,
  trace,
  unite,
  decimales = 0,
  explication,
}: {
  titre: string;
  trace: TraceMulti;
  unite: string | null;
  decimales?: number;
  explication?: string;
}) {
  const fmt = (v: number) => v.toFixed(decimales) + (unite ? ` ${unite}` : "");
  return (
    <figure className="graphique">
      <figcaption>
        <strong>{titre}</strong>{" "}
        <span className="meta">
          {fmt(trace.min)} – {fmt(trace.max)} ·{" "}
          {/* eslint-disable-next-line react-hooks/purity -- Server Component : rendu une fois par requête, l'âge affiché EST celui de la requête. */}
          {formaterAge((Date.now() - trace.dernier.getTime()) / 60_000)}
        </span>
      </figcaption>
      <div className="graphique-zone">
      <svg
        className="graphe"
        viewBox={`0 0 ${trace.largeur} ${trace.hauteur}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${titre}. ${trace.series
          .map((s) => `${s.libelle} : ${fmt(s.derniereValeur)}`)
          .join(", ")}.`}
      >
        {trace.reperes.map((r) => (
          <line
            key={r.y}
            x1="0"
            x2={trace.largeur}
            y1={r.y}
            y2={r.y}
            className="grille"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {trace.series.map((serie, i) => (
          <polyline
            key={serie.libelle}
            points={serie.polyline}
            fill="none"
            strokeWidth="2.5"
            className={`serie-${i % 4}`}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
        {/* Une couche de survol PAR SÉRIE : sur quatre pneus superposés, une couche unique
            ne pourrait montrer qu'une valeur là où l'intérêt est justement de comparer. */}
        {trace.series.map((serie, i) => (
          <div key={`survol-${serie.libelle}`} className={`couche-survol serie-${i % 4}`}>
            <Survol bandes={serie.bandes} fmt={fmt} format={formatDateHeure} />
          </div>
        ))}
      </div>
      <div className="axes">
        <span>{formatDate.format(trace.premier)}</span>
        <span className="meta">
          {fmt(trace.reperes[0]!.valeur)} → {fmt(trace.reperes[2]!.valeur)}
        </span>
        <span>{formatDate.format(trace.dernier)}</span>
      </div>
      <ul className="legende">
        {trace.series.map((serie, i) => (
          <li key={serie.libelle}>
            <span className={`pastille serie-${i % 4}`} aria-hidden="true" />
            {serie.libelle} <strong>{fmt(serie.derniereValeur)}</strong>
          </li>
        ))}
      </ul>
      {explication && <InfoTap resume="Comment lire">{explication}</InfoTap>}
    </figure>
  );
}

export function GraphiqueBail({
  trace,
  resume,
  debut,
  fin,
  limites,
}: {
  trace: TraceBail;
  resume: string;
  debut: Date;
  fin: Date;
  limites: string[];
}) {
  const km = (v: number) => `${Math.round(v).toLocaleString("fr-CA")} km`;
  return (
    <figure className="graphique">
      <figcaption>
        <strong>Kilométrage vs allocation du bail</strong>{" "}
        <span className="meta">{resume}</span>
      </figcaption>
      <svg
        className="graphe"
        viewBox={`0 0 ${trace.largeur} ${trace.hauteur}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Kilométrage réel comparé à l'allocation du bail. ${resume}`}
      >
        <defs>
          <linearGradient id="degrade-bail-reel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        {trace.reperes.map((r) => (
          <line
            key={r.y}
            x1="0"
            x2={trace.largeur}
            y1={r.y}
            y2={r.y}
            className="grille"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* L'allocation du contrat : la droite de référence. */}
        <polyline
          points={trace.alloue}
          fill="none"
          strokeWidth="2"
          className="ligne-allouee"
          vectorEffect="non-scaling-stroke"
        />
        {/* La projection est POINTILLÉE : c'est une hypothèse au rythme observé, pas une
            mesure. La confondre avec du réel serait exactement la fausse donnée qu'on
            s'interdit. */}
        {trace.projection && (
          <polyline
            points={trace.projection}
            fill="none"
            strokeWidth="2"
            strokeDasharray="6 4"
            className="ligne-projection"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {trace.reel && (
          <>
            <polygon
              points={`${trace.reel} ${trace.largeur},${trace.hauteur} 0,${trace.hauteur}`}
              fill="url(#degrade-bail-reel)"
              stroke="none"
            />
            <polyline
              points={trace.reel}
              fill="none"
              strokeWidth="2.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
      <div className="axes">
        <span>{formatDate.format(debut)}</span>
        <span className="meta">0 → {km(trace.maxY)}</span>
        <span>{formatDate.format(fin)}</span>
      </div>
      {/* Ce que la projection ne sait pas se lit SOUS la projection. Un dépassement de
          « 15 000 km » calculé sur six jours d'historique n'est pas faux, il est
          incomplet — et sans cette liste, rien ne le distingue d'un chiffre solide. */}
      {limites.length > 0 && (
        <ul className="limites">
          {limites.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <p className="hint">
        Plein : réel. Clair : autorisé. Pointillé : projection (hypothèse, pas une mesure).
      </p>
    </figure>
  );
}
