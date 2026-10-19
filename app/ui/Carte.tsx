// app/ui/Carte.tsx — carte à tuiles OpenStreetMap, rendue CÔTÉ SERVEUR.
//
// Marc, 12/08/2026 : « je veux voir les trajets dans l'app sans aller dans Maps », puis
// « vraies rues exactes, carte de Maps mais dans l'app ».
//
// Zéro JavaScript, zéro dépendance : des `<img>` posées en grille et un `<svg>` par-dessus.
// Le navigateur ne demande que les tuiles du cadrage, et le tracé est calculé au serveur
// avec la MÊME projection que celle des tuiles (`lib/vehicle/carte.ts`, vérifiée contre le
// référentiel slippy-map) — sans quoi le trajet passerait à côté des rues.
//
// ⚠️ Ce qui change pour la vie privée, et qui se dit à l'écran : afficher un fond de carte
// fait demander des tuiles à openstreetmap.org, dont les coordonnées révèlent
// approximativement où on regarde. C'est le prix des vraies rues.

import { TAILLE_TUILE, type VueCarte } from "@/lib/vehicle/carte";

export function Carte({
  vue,
  legende,
  cheminInconnu = false,
}: {
  vue: VueCarte;
  legende?: string;
  /**
   * `true` quand la route entre les relevés n'est PAS enregistrée.
   *
   * ⚠️ C'est la réponse à « ça devrait pas faire vol d'oiseau » (Marc, 12/08/2026). La bZ
   * ne publie sa position, pour l'essentiel, qu'à l'arrêt : entre deux relevés, le chemin
   * suivi est INCONNU. Un trait plein l'affirmerait — CarAI n'a pas le droit de dessiner
   * une route que la voiture n'a pas déclarée. Le trait devient donc pointillé et la
   * légende le dit, plutôt que de faire passer un raccourci de dessin pour une mesure.
   */
  cheminInconnu?: boolean;
}) {
  const depart = vue.marqueurs[0];
  const arrivee = vue.marqueurs[vue.marqueurs.length - 1];
  // Les relevés intermédiaires : les montrer, c'est montrer OÙ la donnée existe vraiment.
  const etapes = vue.marqueurs.slice(1, -1);

  // Un RAYON ne connaît pas `non-scaling-stroke` : les marqueurs restent en unités du
  // cadre. On les dimensionne donc relativement à la composition, pour qu'ils gardent la
  // taille RELATIVE qu'ils avaient quand la carte se composait à 640 — sinon composer plus
  // large les réduirait à un point invisible sur un téléphone, où la carte est réduite.
  const echelle = vue.largeur / 640;
  const rayon = (base: number) => Math.round(base * echelle * 10) / 10;

  return (
    <figure className="carte-osm" style={{ aspectRatio: `${vue.largeur} / ${vue.hauteur}` }}>
      <div className="carte-cadre">
        {vue.tuiles.map((t) => (
          /* Tuiles externes de taille fixe (256×256) posées en grille. `next/image` les
             ferait transiter par notre serveur pour « optimiser » un raster déjà optimal,
             en ajoutant une facture de transformation d'images pour rien. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={t.cle}
            src={t.url}
            alt=""
            width={TAILLE_TUILE}
            height={TAILLE_TUILE}
            loading="lazy"
            // ⚠️ `tuile-osm`, PAS `tuile` : la refonte a introduit une règle globale
            // `.tuile` (rembourrage, bordure, coins arrondis) pour les tuiles du tableau de
            // bord, qui s'appliquait aussi à CELLES-CI — d'où des gouttières entre les
            // tuiles de la carte, « carte toujours tronquée » (Marc, 13/08).
            className="tuile-osm"
            // ⚠️ La LARGEUR se calcule ici, pas en CSS. Elle valait `calc(256 / 640 * 100%)`
            // avec le 640 de la composition ÉCRIT EN DUR : composer à une autre taille
            // décalait alors toutes les tuiles, en silence. Elle se dérive maintenant de
            // `vue.largeur`, donc les deux ne peuvent plus diverger.
            style={{
              width: `${(TAILLE_TUILE / vue.largeur) * 100}%`,
              left: `${(t.gauche / vue.largeur) * 100}%`,
              top: `${(t.haut / vue.hauteur) * 100}%`,
            }}
          />
        ))}

        <svg
          viewBox={`0 0 ${vue.largeur} ${vue.hauteur}`}
          className="calque"
          role="img"
          aria-label={legende ?? "Trajet du véhicule sur la carte"}
        >
          {/* Deux traits superposés : un large clair dessous, un fin coloré dessus. C'est
              ce qui rend le tracé lisible aussi bien sur une route claire que sur une forêt
              sombre — un trait unique disparaît sur l'une ou sur l'autre.

              ⚠️ `vectorEffect="non-scaling-stroke"` — LA cause des « gros traits » (Marc,
              13/08). Le SVG est composé à `vue.largeur` puis étiré à la largeur de la carte
              (jusqu'à 84 rem depuis la refonte) : sans cet attribut, l'épaisseur est étirée
              avec, et un trait de 7 se dessinait à ~14 px. Ici l'épaisseur est en pixels
              d'ÉCRAN, donc constante quel que soit le cadrage — c'est déjà ce que font tous
              les graphiques de l'app. */}
          <polyline
            points={vue.polyline}
            fill="none"
            strokeWidth="5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className="trace-fond"
          />
          <polyline
            points={vue.polyline}
            fill="none"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            className={cheminInconnu ? "trace trace-devinee" : "trace"}
          />
          {/* Les marqueurs, eux, sont dessinés en unités du cadre : un cercle ne peut pas
              porter `non-scaling-stroke` sur son RAYON. Ils sont donc dimensionnés d'après
              l'échelle réelle pour rester de taille constante à l'écran. */}
          {etapes.map((p) => (
            <circle key={`${p.x},${p.y}`} cx={p.x} cy={p.y} r={rayon(3.5)} className="pt-etape" />
          ))}
          {depart && <circle cx={depart.x} cy={depart.y} r={rayon(6)} className="pt-depart" />}
          {arrivee && (
            <circle cx={arrivee.x} cy={arrivee.y} r={rayon(6)} className="pt-arrivee" />
          )}
        </svg>
      </div>

      {/* Attribution EXIGÉE par la licence OpenStreetMap (ODbL). Ce n'est pas une politesse :
          utiliser les tuiles sans créditer viole les conditions du service. */}
      <figcaption className="meta">
        {legende ? <>{legende} · </> : null}
        <span className="pastille depart" /> départ <span className="pastille arrivee" /> arrivée
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
