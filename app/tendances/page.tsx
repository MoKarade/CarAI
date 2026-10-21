// app/tendances/page.tsx (ex-/analyse, renommé à l'étape 2 de la refonte) — l'onglet Analyse : l'état du véhicule, puis ce qu'il devient.
//
// ══ REFONTE DU 13/08/2026 (Marc) ═════════════════════════════════════════════════════
//
// « Je veux des explications, des graphs clairs, des variables logiques, des images pour
// les pneus et pour tout ce qui serait pertinent ; clair, simple, concis, beau à voir et
// utile ; enlève tout le texte inutile et la liste des variables. »
//
// Ce qui a été RETIRÉ, et pourquoi :
//   • Les quatre listes de signaux (« qui fonctionnent », « à débloquer », « non fournis »,
//     « sans valeur ») — c'était LA « liste des variables ». Elles répondaient à une question
//     d'INTÉGRATION (« Smartcar me sert-il ce code ? »), pas à une question sur la voiture.
//     Cette question a toujours sa place, mais dans `/donnees`, pas ici.
//   • Le dépliage brut des métriques structurées (portières, vitres, minuteries) en tableaux
//     `chemin → valeur`. Le SCHÉMA les montre mieux : une portière ouverte se voit, elle ne
//     se lit pas dans une ligne `values.2.isOpen = true`.
//   • Les frises de bascules booléennes. Même raison — l'état courant est sur le schéma.
//   • Les paragraphes d'explication de la mécanique interne (« rendu côté serveur », « la
//     liste vient de la base »). Vrai, mais ça n'aide pas Marc à décider quoi que ce soit.
//
// Ce qui a été AJOUTÉ :
//   • Le SCHÉMA du véhicule, peint par ses propres mesures (`app/ui/SchemaVehicule.tsx`).
//   • Les quatre pneus sur UN SEUL axe (`traceMulti`) : avec un axe par roue, deux pressions
//     écartées de 35 kPa se dessinaient identiques — l'écart, seule chose qui compte sur des
//     pneus, était effacé par la mise à l'échelle.
//   • Une phrase d'explication SOUS chaque courbe : ce qu'elle dit, pas comment elle est faite.
//
// ⚠️ CE QUI N'A PAS CHANGÉ : la DÉCOUVERTE reste faite depuis la base
// (`metriquesDisponibles`). Une liste de courbes écrite à la main a toujours les deux mêmes
// défauts en même temps — elle promet ce qui n'existe pas et ignore ce qui existe (leçon du
// 12/08, `SERIES_ANALYSE` : six de ses dix entrées visaient des signaux que la bZ refuse).
// Une métrique numérique nouvelle apparaît donc encore ici toute seule ; elle n'aura
// simplement pas de phrase d'explication tant qu'on ne lui en aura pas écrit une.
//
// Server Component derrière le middleware + requireSession. Jamais de 500 : panne classée.

import { redirect } from "next/navigation";
import { baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { classerPanne, messagePanne } from "@/lib/panne";
import {
  decimalesPour,
  metriquesDisponibles,
  estMuette,
  libelleReleves,
  serieCourbe,
  serieNumerique,
  seriesPneus,
  sousEchantillonner,
  traceBail,
  traceMulti,
  traceSvg,
  type GranulariteCourbe,
  type TraceBail,
  type TraceMulti,
  type TraceSvg,
} from "@/lib/vehicle/analyse";
import { libellePosition } from "@/lib/vehicle/schemaVehicule";
import { lireBail } from "@/lib/config";
import {
  calculerConsommation,
  serieConsommation,
  type Consommation,
} from "@/lib/vehicle/consommation";
import { lireEtatVehicule, type MesureQualifiee } from "@/lib/vehicle/state";
import { historiqueOdometre } from "@/lib/vehicle/history";
import { MESSAGE_BAIL_NON_RENSEIGNE, calculerEtatBail, resumerBail } from "@/lib/vehicle/lease";
import {
  analyserFenetre,
  DEFAUT_TENDANCES,
  dansLaFenetre,
  RACCOURCIS_GLISSANTS,
} from "@/lib/vehicle/fenetre";
import { SelecteurFenetre } from "@/app/ui/SelecteurFenetre";
import {
  comparerAutonomie,
  joursAvantRecharge,
  kmParJourDeSemaine,
  projeterPneu,
  type AutonomieComparee,
  type JourDeSemaine,
  type ProjectionPneu,
} from "@/lib/vehicle/deductions";
import { mediane } from "@/lib/vehicle/alertes";
import { formaterAge, libelle } from "@/lib/vehicle/state";
import {
  GraphiqueBail,
  GraphiqueMulti,
  formatDate,
  formatDateHeure,
} from "@/app/ui/Graphique";
import { GraphiquesLies, type SerieGraphique } from "@/app/ui/GraphiquesLies";
import { SchemaVehicule } from "@/app/ui/SchemaVehicule";
import { construireEtatSchema, type EtatSchema } from "@/lib/vehicle/etatSchema";
import {
  formaterCoordonnee,
  historiquePositions,
  lienCarte,
  traceTrajet,
  type PointPosition,
  type TraceTrajet,
} from "@/lib/vehicle/position";
import { NonAutorise, requireSession } from "@/lib/session";
import { Onglets } from "@/app/ui/Onglets";
import { capaciteBatterieKwh } from "@/lib/vehicle/capacite";
import { cleMapsEmbed } from "@/app/ui/CarteGoogle";
import { CarteGoogleVivante } from "@/app/ui/CarteGoogleVivante";
import { CarteInteractive } from "@/app/ui/CarteInteractive";
import { BoutonRafraichir } from "@/app/donnees/rafraichissement";

export const dynamic = "force-dynamic";

/** Étiquette de survol d'un relevé sur la carte, dans le fuseau de Marc. */
const fmtInstantCarte = new Intl.DateTimeFormat("fr-CA", {
  timeZone: "America/Toronto",
  dateStyle: "medium",
  timeStyle: "short",
});

/**
 * CE QUE CHAQUE COURBE DIT — une phrase, jamais un paragraphe.
 *
 * Le texte long est exactement ce qu'il fallait retirer de cet écran. Chaque entrée répond à
 * « qu'est-ce que je regarde, et qu'est-ce qui serait anormal ? » — pas à « comment c'est
 * calculé », qui n'aide personne à décider.
 *
 * ⚠️ Table OUVERTE : une métrique absente d'ici s'affiche quand même, sans phrase. C'est
 * voulu — l'inverse (n'afficher que ce qui est listé) reproduirait `SERIES_ANALYSE` et son
 * défaut, qui était d'ignorer ce qui existe.
 */
const EXPLICATIONS: Readonly<Record<string, string>> = {
  battery_soc:
    "Les montées sont des recharges, les descentes des trajets. Le détail de chaque branchement est dans l’onglet Recharges.",
  battery_range:
    "L’autonomie estimée par la voiture elle-même — elle tient compte de ta conduite récente et du froid, donc elle bouge à charge égale.",
  odometer:
    "C’est la PENTE qui compte, pas la valeur : c’est elle qui décide du dépassement de bail.",
  battery_capacity_nominal:
    "La capacité de la batterie. Elle sert à convertir un gain de charge en kWh — si elle change, c’est le constructeur qui a révisé sa valeur.",
  battery_capacity:
    "La capacité de la batterie. Elle sert à convertir un gain de charge en kWh.",
  charge_limit: "La limite de charge programmée dans la voiture.",
  speed:
    "Un relevé toutes les 30 minutes : c’est un échantillon, pas une courbe de conduite — ça ne dessine aucun trajet.",
  outside_temperature:
    "Le froid coûte de l’autonomie : c’est la courbe à regarder à côté de la consommation quand elle grimpe l’hiver.",
  inside_temperature: "Température de l’habitacle au moment du relevé.",
  charge_time_remaining:
    "Temps de charge restant annoncé par la voiture. ⚠️ La bZ ne le remet PAS à zéro en fin de session : entre deux charges, la courbe reste figée sur la dernière valeur annoncée — ce n’est pas un compte à rebours qui tourne.",
};

/** La phrase de la courbe de consommation : ce qu'elle est, et ce qu'elle n'est pas. */
const EXPLICATION_CONSOMMATION =
  "Un point par trajet retenu, à sa date de fin. C’est une estimation : la capacité de la batterie vient de la configuration, et la veille de la voiture est comptée dans le trajet.";

function Coquille({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <main className="shell">
      <div className="carte carte-large">
        <h1>{titre}</h1>
        <Onglets actif="/tendances" />
        {children}
      </div>
    </main>
  );
}

/** L'ordre d'affichage des courbes : ce qui décide d'abord, le reste ensuite. */
const PRIORITE = ["battery_soc", "battery_range", "odometer"];

interface Courbe {
  metricType: string;
  trace: TraceSvg;
  unite: string | null;
  decimales: number;
  nbPoints: number;
  /** `brut` = relevés réels ; sinon chaque point résume une heure ou un jour (CarAI#254). */
  granularite: GranulariteCourbe;
  /** Les relevés RÉELS de la fenêtre — l'historique détaillé sous la courbe. */
  points: Array<{ t: Date; valeur: number }>;
}

/**
 * LE PANNEAU D'ÉTAT — le schéma, et à côté les trois chiffres qui n'ont pas de place dessus.
 *
 * Côte à côte plutôt qu'empilés : le schéma répond à « est-ce que tout est normal ? », les
 * chiffres à « combien ? ». Les séparer par un défilement de page casserait le coup d'œil.
 */
function PanneauEtat({
  schema,
  soc,
  autonomieKm,
  odometreKm,
}: {
  schema: EtatSchema;
  soc: number | null;
  autonomieKm: number | null;
  odometreKm: number | null;
}) {
  const problemes = schema.pneus.filter((p) => p.etat !== "ok");
  const nbOuverts =
    schema.portieresOuvertes.length +
    schema.vitresOuvertes.length +
    schema.ouvrantsSansPosition;

  return (
    <div className="panneau-etat">
      <SchemaVehicule etat={schema} />

      <div className="panneau-cote">
        <ul className="chiffres">
          <li>
            <span className="etiquette">Charge</span>
            <span className="nombre">{soc !== null ? `${Math.round(soc)} %` : "—"}</span>
          </li>
          <li>
            <span className="etiquette">Autonomie</span>
            <span className="nombre">
              {autonomieKm !== null ? `${Math.round(autonomieKm)} km` : "—"}
            </span>
          </li>
          <li>
            <span className="etiquette">Odomètre</span>
            <span className="nombre">
              {odometreKm !== null ? `${Math.round(odometreKm).toLocaleString("fr-CA")} km` : "—"}
            </span>
          </li>
          <li>
            <span className="etiquette">Ouvrants</span>
            <span className="nombre">{nbOuverts === 0 ? "fermés" : `${nbOuverts} ouvert(s)`}</span>
          </li>
        </ul>

        {/* Le verdict des pneus en toutes lettres — la couleur seule ne dit pas de combien. */}
        {schema.pneus.length === 0 ? (
          <p className="verdict-schema neutre">Aucune pression de pneu mesurée</p>
        ) : problemes.length === 0 ? (
          <p className="verdict-schema ok">Les quatre pneus sont cohérents entre eux</p>
        ) : (
          <ul className="alertes">
            {problemes.map((p) => (
              <li key={p.libelle} className={p.etat === "alerte" ? "alerte" : "avertissement"}>
                <span className="titre">
                  Pneu {p.position ? libellePosition(p.position) : p.libelle}
                </span>
                <span className="meta">{p.raison}</span>
              </li>
            ))}
          </ul>
        )}

        <ul className="legende-schema">
          <li>
            <span className="pastille etat-ok" aria-hidden="true" /> cohérent
          </li>
          <li>
            <span className="pastille etat-surveiller" aria-hidden="true" /> à surveiller
          </li>
          <li>
            <span className="pastille etat-alerte" aria-hidden="true" /> écart net
          </li>
          <li>
            <span className="pastille etat-inconnu" aria-hidden="true" /> pas de relevé
          </li>
        </ul>

        {schema.mesureLe && (
          <p className="hint">
            {/* eslint-disable-next-line react-hooks/purity -- Server Component : rendu une fois par requête, l'âge affiché EST celui de la requête. */}
            Relevé {formaterAge((Date.now() - schema.mesureLe.getTime()) / 60_000)} ·{" "}
            {formatDateHeure.format(schema.mesureLe)}
          </p>
        )}
      </div>
    </div>
  );
}

/** LA CONSOMMATION RÉELLE — le chiffre par lequel une électrique se juge. */
function ConsommationReelle({ conso }: { conso: Consommation }) {
  if (conso.kwhPar100km === null) {
    return (
      <p className="hint">
        Pas calculable sur cette période : il faut au moins deux relevés où l’odomètre avance
        ET la charge baisse, plus la capacité de la batterie.
        {conso.nbEcartes > 0
          ? ` ${conso.nbEcartes} segment(s) écarté(s) — voiture surtout à l’arrêt.`
          : ""}
      </p>
    );
  }

  return (
    <>
      <ul className="chiffres">
        <li>
          <span className="etiquette">Consommation</span>
          <span className="nombre">{conso.kwhPar100km.toFixed(1)} kWh/100 km</span>
        </li>
        <li>
          <span className="etiquette">Autonomie à ce rythme</span>
          <span className="nombre">
            {conso.autonomieTheoriqueKm !== null
              ? `${Math.round(conso.autonomieTheoriqueKm)} km`
              : "—"}
          </span>
        </li>
        <li>
          <span className="etiquette">Mesuré sur</span>
          <span className="nombre">{Math.round(conso.kmTotal).toLocaleString("fr-CA")} km</span>
        </li>
        <li>
          <span className="etiquette">Énergie</span>
          <span className="nombre">{conso.kwhTotal.toFixed(1)} kWh</span>
        </li>
      </ul>
      <p
        className="explication"
        title="La batterie se vide aussi à l’arrêt (veille, préchauffage, froid) et la voiture ne publie pas ce détail : cette part est comptée ici."
      >
        Calculé sur {conso.nbSegments} segment(s) où l’odomètre avance et la charge baisse —
        une recharge n’est jamais comptée comme une consommation. C’est un <strong>plafond
        honnête</strong> : la décharge à l’arrêt y est incluse.
      </p>
    </>
  );
}

/**
 * La ZONE PARCOURUE : un nuage de relevés RÉELS sur une carte qu'on peut zoomer et
 * déplacer (Marc, 20/08 : « je peux pas zoomer ni me déplacer, inutile »). Carte Google
 * vivante quand la clé est là et que « Maps JavaScript API » est activée ; sinon la carte
 * interactive de CarAI (tuiles OSM), qui zoome aussi. Sans clé du tout, la même carte
 * CarAI. Aucun chemin ne rend d'image figée.
 *
 * ⚠️ `sansChemin` / pas de `trajets` : on ne relie JAMAIS ces points. Ce sont des arrêts
 * indépendants, pas un itinéraire — les vrais trajets sont dans l'onglet Activité.
 */
function Trajet({
  trace,
  points,
  cleGoogle,
}: {
  trace: TraceTrajet;
  points: PointPosition[];
  cleGoogle: string | null;
}) {
  const derniere = points[points.length - 1]!;
  const etendue =
    trace.etendueKm < 1
      ? `${Math.round(trace.etendueKm * 1000)} m`
      : `${trace.etendueKm.toFixed(1)} km`;
  const entete = (
    <figcaption>
      <strong>Zone parcourue</strong>{" "}
      <span className="meta">
        {trace.nbPoints} position(s) · environ {etendue} ·{" "}
        {/* eslint-disable-next-line react-hooks/purity -- Server Component : rendu une fois par requête, l'âge affiché EST celui de la requête. */}
        {formaterAge((Date.now() - derniere.t.getTime()) / 60_000)}
      </span>
    </figcaption>
  );

  // La carte dessinée par CarAI : sans clé, sans réseau tiers, toujours disponible.
  // Elle sert de repli quand Google Static échoue, et de rendu unique quand il n'y a pas
  // de clé du tout — un seul morceau de JSX pour les deux cas, donc rien à faire diverger.
  const carteMaison = (
    <>
      <svg
        viewBox={`0 0 ${trace.largeur} ${trace.hauteur}`}
        className="carte"
        role="img"
        aria-label={`Zone parcourue, ${trace.nbPoints} positions sur environ ${etendue}.`}
      >
        <polyline
          points={trace.chemin}
          fill="none"
          strokeWidth="2"
          stroke="currentColor"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={trace.derniere.x} cy={trace.derniere.y} r="5" className="point-actuel" />
      </svg>
      <p className="explication">
        La forme est fidèle (la longitude est corrigée par la latitude) mais ce n’est pas une
        carte : ni rue, ni échelle. Les vrais itinéraires sont dans l’onglet Trajets.{" "}
        <a href={lienCarte(derniere)} target="_blank" rel="noreferrer noopener">
          Dernière position sur Maps
        </a>{" "}
        ({formaterCoordonnee(derniere.lat)}, {formaterCoordonnee(derniere.lng)}).
      </p>
    </>
  );

  const legende = (
    <p className="hint">
      {trace.nbPoints} position(s) sur environ {etendue} — chaque point est un{" "}
      <strong>relevé réel</strong> de position (la bZ ne publie qu’à l’arrêt) ; le point
      marqué est la dernière position. Ctrl/⌘ + molette pour zoomer, glisser pour se
      déplacer.
    </p>
  );
  const ariaZone = `Zone parcourue, ${trace.nbPoints} positions sur environ ${etendue}.`;

  const pointsCarte = points.map((p) => ({
    lat: p.lat,
    lng: p.lng,
    iso: p.t.toISOString(),
    libelle: fmtInstantCarte.format(p.t),
  }));

  if (cleGoogle && pointsCarte.length > 0) {
    return (
      <figure className="graphique">
        {entete}
        <CarteGoogleVivante points={pointsCarte} marquerDerniere cle={cleGoogle} legende={legende}>
          <CarteInteractive points={pointsCarte} legende={ariaZone} sansChemin />
        </CarteGoogleVivante>
      </figure>
    );
  }

  if (pointsCarte.length > 0) {
    return (
      <figure className="graphique">
        {entete}
        <CarteInteractive points={pointsCarte} legende={ariaZone} sansChemin />
        {legende}
      </figure>
    );
  }

  return (
    <figure className="graphique">
      {entete}
      {carteMaison}
    </figure>
  );
}

/**
 * LES DÉDUCTIONS — ce que les mesures disent une fois rapprochées.
 *
 * Chaque tuile ne s'affiche que si sa déduction a tenu : les fonctions de
 * `lib/vehicle/deductions.ts` rendent `null` plutôt qu'un chiffre quand la donnée ne les
 * porte pas, et l'écran respecte ce refus. Une section qui se remplit à moitié dit la
 * vérité ; une section toujours pleine mentirait une fois sur deux.
 */
function Deductions({
  autonomie,
  joursCharge,
  rythmeKmParJour,
  projections,
  semaine,
}: {
  autonomie: AutonomieComparee | null;
  joursCharge: number | null;
  rythmeKmParJour: number | null;
  projections: ProjectionPneu[];
  semaine: JourDeSemaine[];
}) {
  const maxSemaine = Math.max(...semaine.map((j) => j.moyenneKm), 0);
  const aQuelqueChose =
    autonomie !== null || joursCharge !== null || projections.length > 0 || maxSemaine > 0;

  if (!aQuelqueChose) {
    return (
      <p className="hint">
        Rien à déduire pour l’instant : il faut plusieurs jours de relevés pour qu’une
        tendance veuille dire quelque chose.
      </p>
    );
  }

  return (
    <>
      {autonomie && (
        <div className="deduction">
          <p className="deduction-titre">
            La voiture annonce <strong>{Math.round(autonomie.annonceeKm)} km</strong>, ta
            consommation réelle en donne{" "}
            <strong>{Math.round(autonomie.reelleKm)} km</strong>
          </p>
          <p className="explication">
            {autonomie.ecartKm < 0
              ? `Soit ${Math.round(-autonomie.ecartKm)} km de moins que promis (${Math.round(Math.abs(autonomie.ecartPourcent))} % d’optimisme). C’est l’écart à garder en tête avant un long trajet.`
              : `Soit ${Math.round(autonomie.ecartKm)} km de plus qu’annoncé : la voiture est prudente. Calculé sur ta consommation mesurée, pas sur la sienne.`}
          </p>
        </div>
      )}

      {joursCharge !== null && (
        <div className="deduction">
          <p className="deduction-titre">
            À ton rythme, il te reste{" "}
            <strong>
              {joursCharge < 1
                ? "moins d’une journée"
                : `${joursCharge.toFixed(1)} jour${joursCharge >= 2 ? "s" : ""}`}
            </strong>{" "}
            avant de devoir recharger
          </p>
          {rythmeKmParJour !== null && (
            <p className="explication">
              Sur la base de {Math.round(rythmeKmParJour)} km par jour observés sur la
              période. Ce n’est pas une alerte : c’est l’autonomie restante divisée par ce
              que tu roules vraiment.
            </p>
          )}
        </div>
      )}

      {projections.length > 0 && (
        <div className="deduction">
          <p className="deduction-titre">Pneus qui se dégonflent</p>
          <ul className="limites">
            {projections.map((p) => (
              <li key={p.libelle}>
                <strong>{p.libelle}</strong> perd {p.perteParSemaineKpa.toFixed(1)} kPa par
                semaine
                {p.seuilAtteintLe
                  ? ` — au seuil d’alerte vers le ${formatDate.format(p.seuilAtteintLe)}`
                  : " — pas encore de date de seuil"}
                .
              </li>
            ))}
          </ul>
          <p className="explication">
            Tendance mesurée sur les relevés, pas une règle générale. Le seuil est le même
            que celui des alertes de l’accueil : l’écart aux autres roues.
          </p>
        </div>
      )}

      {maxSemaine > 0 && (
        <div className="deduction">
          <p className="deduction-titre">Où partent tes kilomètres</p>
          <ul className="barres">
            {semaine.map((j) => (
              <li key={j.index}>
                <span className="barre-libelle">{j.libelle}</span>
                <span className="barre-piste">
                  <span
                    className="barre-remplissage"
                    style={{ width: `${maxSemaine > 0 ? (j.moyenneKm / maxSemaine) * 100 : 0}%` }}
                  />
                </span>
                <span className="barre-valeur">
                  {j.nbJours === 0 ? "—" : `${Math.round(j.moyenneKm)} km`}
                </span>
              </li>
            ))}
          </ul>
          <p className="explication">
            Moyenne par journée RÉELLEMENT observée — pas par semaine : sur une période de
            dix jours il y a deux lundis et un seul mercredi, et diviser tout pareil
            inventerait un creux.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * L'HISTORIQUE DÉTAILLÉ d'une courbe (Marc, 13/08 : « un historique détaillé de toutes les
 * données »).
 *
 * Replié par défaut, et attaché à SA courbe plutôt que dans un tableau général : la
 * question « c'était combien exactement le 12 à 8 h ? » se pose en regardant un graphique,
 * pas en ouvrant un autre écran. L'écart au relevé précédent est calculé ici parce que
 * c'est lui qu'on cherche — une colonne de valeurs absolues oblige à faire les
 * soustractions de tête.
 */
function HistoriqueDetaille({
  points,
  unite,
  decimales,
  metricType,
  granularite,
}: {
  points: Array<{ t: Date; valeur: number }>;
  unite: string | null;
  decimales: number;
  metricType: string;
  granularite: GranulariteCourbe;
}) {
  if (points.length === 0) return null;
  // Du plus RÉCENT au plus ancien : on cherche presque toujours ce qui vient de se passer.
  const lignes = [...points].reverse().slice(0, 200);
  const fmt = (v: number) => v.toFixed(decimales) + (unite ? ` ${unite}` : "");

  return (
    <details className="replie">
      <summary>
        Historique détaillé ({libelleReleves(granularite, metricType, points.length)})
      </summary>
      <div className="defilement">
        <table className="tableau">
          <thead>
            <tr>
              <th>Quand</th>
              <th className="nombre">Valeur</th>
              <th className="nombre">Écart</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((p, i) => {
              const precedent = lignes[i + 1];
              const ecart = precedent ? p.valeur - precedent.valeur : null;
              return (
                <tr key={p.t.toISOString()}>
                  <td>{formatDateHeure.format(p.t)}</td>
                  <td className="nombre">{fmt(p.valeur)}</td>
                  <td className="nombre">
                    {ecart === null ? "—" : `${ecart > 0 ? "+" : ""}${fmt(ecart)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {points.length > lignes.length && (
        <p className="hint">
          Les {lignes.length} plus récents sur {points.length}. Tout l’historique est
          exportable depuis l’onglet <a href="/donnees">Données</a>.
        </p>
      )}
    </details>
  );
}

export default async function Tendances({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof NonAutorise) redirect("/login");
    throw err;
  }

  if (!baseConfiguree()) {
    return (
      <Coquille titre="Tendances">
        <p className="lead">La base de données n’est pas branchée : aucune donnée ne peut être analysée.</p>
      </Coquille>
    );
  }

  const params = await searchParams;
  const seul = (cle: string) => {
    const v = params[cle];
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  };
  const maintenant = new Date();
  const fenetre = analyserFenetre(
    { periode: seul("periode"), du: seul("du"), au: seul("au") },
    maintenant,
    { raccourcis: RACCOURCIS_GLISSANTS, defaut: DEFAUT_TENDANCES },
  );
  const depuis = fenetre.depuis;

  let courbes: Courbe[] = [];
  let tracePneus: TraceMulti | null = null;
  let unitePneus: string | null = null;
  let schema: EtatSchema | null = null;
  let bail: {
    trace: TraceBail;
    resume: string;
    debut: Date;
    fin: Date;
    limites: string[];
  } | null = null;
  let bailRenseigne = true;
  let positions: PointPosition[] = [];
  let conso: Consommation | null = null;
  let soc: number | null = null;
  let autonomieKm: number | null = null;
  let odometreKm: number | null = null;
  let nbMetriques = 0;
  let nbCourbesPlates = 0;
  let autonomie: AutonomieComparee | null = null;
  let semaine: JourDeSemaine[] = [];
  let joursCharge: number | null = null;
  let rythmeKmParJour: number | null = null;
  let projections: ProjectionPneu[] = [];

  try {
    await assurerMigrations();

    // Les métriques MUETTES (jamais une seule valeur, toutes colonnes confondues) sont
    // écartées AVANT tout comptage — décision de Marc, 19/08 : « supprime-les ». Les
    // compter donnait un total flatteur d'une quinzaine de signaux qui n'ont jamais rien
    // dit, et la liste des courbes disponibles s'en trouvait diluée.
    const inventaire = (await metriquesDisponibles({ depuis })).filter((m) => !estMuette(m));
    nbMetriques = inventaire.length;
    // ⚠️ Seules les séries NUMÉRIQUES deviennent des courbes. Les états booléens et les
    // structures ne sont plus dépliés en tableaux : le schéma les montre, et c'était eux la
    // « liste des variables » que Marc voulait voir disparaître.
    const numeriques = inventaire.filter((m) => m.forme === "numerique");

    const [etatVehicule, termes, odoBail, roues, lieux, series] = await Promise.all([
      lireEtatVehicule(),
      lireBail(),
      // L'historique du BAIL couvre tout le contrat, pas la fenêtre du sélecteur : c'est une
      // trajectoire depuis la signature.
      historiqueOdometre(),
      // ⚠️ FENÊTRE FIXE, indépendante du filtre (Marc, 13/08 : « je veux que les infos des
      // pneus, verrouillage, autonomie, charge soient toujours à jour »). Ces séries servent
      // à DEUX choses : la courbe (qui suit le filtre, coupée plus bas) et surtout la
      // RÉFÉRENCE de chaque roue. Lues sur la période choisie, sélectionner « 24 h » vidait
      // la référence — le schéma perdait sa détection de dérive au moment où on zoomait.
      seriesPneus({ depuis: new Date(maintenant.getTime() - 30 * 86_400_000) }),
      historiquePositions({ depuis }),
      Promise.all(
        numeriques.map(async (m) => {
          // CarAI#254 : au-delà de 7 jours, la base rend UN point par heure ou par jour au
          // lieu de milliers de relevés qu'on jetait aussitôt.
          const { points, unite, granularite } = await serieCourbe(m.metricType, {
            depuis,
            jusqu: fenetre.jusqu,
            maintenant,
          });
          // ⚠️ En BRUT, la lecture SQL ne connaît que la borne BASSE : la borne haute d'une
          // plage (« du 1er au 5 août ») se coupe ici, sinon une plage passée afficherait
          // tout jusqu'à aujourd'hui. Un agrégat a déjà reçu les DEUX bornes en SQL — y
          // rappeler `dansLaFenetre` écarterait sa première tranche, partielle.
          const dansFenetre = granularite === "brut" ? dansLaFenetre(points, fenetre) : points;
          const trace = traceSvg(sousEchantillonner(dansFenetre));
          return trace
            ? {
                metricType: m.metricType,
                trace,
                unite: unite ?? m.unite,
                decimales: decimalesPour(trace.min, trace.max),
                nbPoints: dansFenetre.length,
                granularite,
                points: dansFenetre,
              }
            : null;
        }),
      ),
    ]);

    positions = lieux;
    unitePneus = roues.unite;
    tracePneus = traceMulti(
      roues.series.map((s) => ({
        libelle: s.libelle,
        points: sousEchantillonner(dansLaFenetre(s.points, fenetre)),
      })),
    );

    // ⚠️ UNE COURBE PLATE N'EST PAS UNE COURBE (Marc, 19/08 : « supprime les graphes qui
    // n'ont aucun sens, donc qui ont tout le temps la même mesure »). Trois relevés à
    // 33,0 A, quatre à 65,0 % de carburant sur un électrique, trois à 22,5 °C : ce sont
    // les traces du véhicule SIMULÉ, figées du 6 au 11 août, et elles occupaient un
    // graphique entier chacune avec « amplitude 0,0 » écrit dessous.
    //
    // Le critère est l'AMPLITUDE NULLE, pas une liste de noms : une métrique qui se met à
    // varier réapparaît d'elle-même. Et le nombre de courbes écartées est AFFICHÉ — une
    // absence qu'on ne compte pas se lit comme « il n'y a rien », ce qui est faux.
    const toutes = series
      .filter((c): c is Courbe => c !== null)
      .sort((a, b) => rang(a.metricType) - rang(b.metricType));
    courbes = toutes.filter((c) => c.trace.max > c.trace.min);
    nbCourbesPlates = toutes.length - courbes.length;

    // ── L'ÉTAT COURANT, celui que le schéma peint ────────────────────────────────────
    const derniere = (metrique: string): MesureQualifiee | undefined =>
      etatVehicule.mesures.find((m) => m.metricType === metrique);

    soc = derniere("battery_soc")?.valueNumeric ?? null;
    autonomieKm = derniere("battery_range")?.valueNumeric ?? null;
    odometreKm = derniere("odometer")?.valueNumeric ?? null;

    // ⚠️ UNE seule définition de cet état, partagée avec l'accueil
    // (`lib/vehicle/etatSchema.ts`). Elle était écrite ici ; la recopier sur l'accueil
    // aurait donné deux versions qui divergent par un bout — la fenêtre de référence, le
    // repli du verrouillage, la fraîcheur retenue.
    schema = construireEtatSchema({
      etat: etatVehicule,
      seriesRoues: roues.series,
      uniteRoues: roues.unite,
      maintenant,
    });

    // ── CONSOMMATION ─────────────────────────────────────────────────────────────────
    const [odoBrut, socSerie] = await Promise.all([
      historiqueOdometre({ granularite: "brut", debut: depuis ?? undefined }),
      serieNumerique("battery_soc", { depuis }),
    ]);
    // ⚠️ JAMAIS `?.valueNumeric` : la bZ publie sa capacité en JSON, pas en numérique.
    // Lire la colonne numérique rendait `null` partout — voir lib/vehicle/capacite.ts.
    const capacite = capaciteBatterieKwh(etatVehicule);
    conso = calculerConsommation({
      odometre: odoBrut,
      socs: socSerie.points.map((p) => ({ t: p.t, pourcent: p.valeur })),
      capaciteKwh: capacite,
    });

    // ── DÉDUCTIONS — ce que les données disent sans le dire ──────────────────────────
    autonomie = comparerAutonomie({
      autonomieAnnonceeKm: autonomieKm,
      socPourcent: soc,
      capaciteKwh: capacite,
      consommationKwhPar100km: conso?.kwhPar100km ?? null,
    });
    semaine = kmParJourDeSemaine(odoBrut);
    // Rythme observé sur la fenêtre : c'est lui qui donne un sens à « combien de jours ».
    const joursObserves = semaine.reduce((n, j) => n + j.nbJours, 0);
    const kmTotalFenetre = semaine.reduce((n, j) => n + j.totalKm, 0);
    const kmParJour = joursObserves > 0 ? kmTotalFenetre / joursObserves : null;
    // On projette sur l'autonomie RÉELLE quand on l'a — celle annoncée est optimiste, et
    // c'est justement ce que la comparaison vient de mesurer.
    joursCharge = joursAvantRecharge(autonomie?.reelleKm ?? autonomieKm, kmParJour);
    rythmeKmParJour = kmParJour;

    // `schema.pneus` plutôt qu'une variable locale : une seule source pour les pneus de
    // l'écran, celle que le schéma dessine.
    const pneusDuSchema = schema.pneus;
    if (pneusDuSchema.length >= 3) {
      const parLibelle = new Map(roues.series.map((r) => [r.libelle, r.points]));
      projections = pneusDuSchema
        .map((p) => {
          const serie = parLibelle.get(p.libelle);
          if (!serie) return null;
          const autres = pneusDuSchema
            .filter((q) => q.libelle !== p.libelle)
            .map((q) => q.pressionKpa);
          return projeterPneu({
            libelle: p.position ? libellePosition(p.position) : p.libelle,
            serie,
            pressionActuelleKpa: p.pressionKpa,
            medianeAutresKpa: mediane(autres),
            maintenant,
          });
        })
        .filter((x): x is ProjectionPneu => x !== null);
    }

    // ── BAIL ─────────────────────────────────────────────────────────────────────────
    // Sans bail en base (aucun terme dans le code) : pas de graphe, et l'écran le dit.
    bailRenseigne = termes !== null;
    const etatBail = termes
      ? calculerEtatBail({ bail: termes, historiqueOdometre: odoBail, maintenant })
      : null;
    const traceB = etatBail ? traceBail({ etat: etatBail, historique: odoBail }) : null;
    if (etatBail && traceB) {
      bail = {
        trace: traceB,
        resume: resumerBail(etatBail),
        debut: etatBail.debutBail,
        fin: etatBail.finBail,
        limites: etatBail.limites,
      };
    }
  } catch (err) {
    console.error("[analyse] lecture impossible", err);
    return (
      <Coquille titre="Tendances">
        <p className="lead">{messagePanne(classerPanne(err))}</p>
      </Coquille>
    );
  }

  const trajet = traceTrajet(positions);
  const rienDuTout = nbMetriques === 0;
  const cleGoogle = cleMapsEmbed();

  // ── LA COURBE DE CONSOMMATION OUVRE LES COURBES LIÉES (CarAI#41) ───────────────────
  // Dérivée des segments déjà retenus par `calculerConsommation` : aucune mesure ni calcul
  // de plus. Elle partage l'axe de temps et le zoom des autres (Marc, 14/08 : « une échelle
  // identique, même quand je zoome »), d'où sa place DANS ce composant : les pneus restent
  // au-dessus sur leur axe unique, voir plus bas.
  const seriesConso = conso ? serieConsommation(conso) : [];
  const seriesLiees: SerieGraphique[] = [
    ...(seriesConso.length > 0
      ? [
          {
            id: "consommation",
            titre: "Consommation (estimation)",
            points: seriesConso,
            unite: "kWh/100 km",
            decimales: 1,
            teinte: 0,
            explication: EXPLICATION_CONSOMMATION,
          },
        ]
      : []),
    ...courbes.map((c, i) => ({
      id: c.metricType,
      titre: libelle(c.metricType),
      points: c.points,
      unite: c.unite,
      decimales: c.decimales,
      teinte: (i + (seriesConso.length > 0 ? 1 : 0)) % 6,
      explication: EXPLICATIONS[c.metricType],
    })),
  ];

  return (
    <Coquille titre="Tendances">
      <BoutonRafraichir />

      {rienDuTout ? (
        <p className="lead">Aucune donnée en base pour l’instant — rien à analyser.</p>
      ) : (
        <>
          {/* Par deux sur PC (`.colonnes-pc`, globals.css) : la consommation et l'état, puis
              les déductions et le bail. Un membre absent laisse l'autre pleine largeur.

              CarAI#30 (Marc, 19/10) : la CONSOMMATION ouvre l'écran, avant l'état du véhicule. */}
          <div className="colonnes-pc">
            {conso && (
              <section>
                <h2>Consommation réelle</h2>
                <ConsommationReelle conso={conso} />
              </section>
            )}

            {schema && (
              <section>
                <h2>Le véhicule maintenant</h2>
                <PanneauEtat
                  schema={schema}
                  soc={soc}
                  autonomieKm={autonomieKm}
                  odometreKm={odometreKm}
                />
              </section>
            )}
          </div>

          <div className="colonnes-pc">
            <section>
              <h2>Ce que ça permet de déduire</h2>
              <Deductions
                autonomie={autonomie}
                joursCharge={joursCharge}
                rythmeKmParJour={rythmeKmParJour}
                projections={projections}
                semaine={semaine}
              />
            </section>

            {!bailRenseigne && (
              <section>
                <h2>Bail</h2>
                <p className="hint">{MESSAGE_BAIL_NON_RENSEIGNE}</p>
              </section>
            )}

            {bail && (
              <section>
                <h2>Bail</h2>
                <GraphiqueBail
                  trace={bail.trace}
                  resume={bail.resume}
                  debut={bail.debut}
                  fin={bail.fin}
                  limites={bail.limites}
                />
              </section>
            )}
          </div>

          <h2>Évolution</h2>
          <SelecteurFenetre
            fenetre={fenetre}
            base="/tendances"
            raccourcis={RACCOURCIS_GLISSANTS}
            defaut={DEFAUT_TENDANCES}
          />

          {tracePneus && (
            <GraphiqueMulti
              titre="Pression des quatre pneus"
              trace={tracePneus}
              unite={unitePneus}
              explication="Les quatre roues partagent le même axe : c’est l’ÉCART entre les traits qui compte, pas leur forme. Une roue qui s’éloigne des trois autres se dégonfle."
            />
          )}

          {/* TOUTES les courbes numériques dans UN composant : c'est ce qui leur donne un
              axe de temps commun et un zoom partagé (Marc, 14/08 : « une échelle identique,
              même quand je zoome »). Rendues séparément, chacune se calait sur ses propres
              bornes et deux creux simultanés ne tombaient pas à la même abscisse.

              ⚠️ Les PNEUS restent au-dessus dans `GraphiqueMulti`, sur un axe UNIQUE. Les
              passer ici leur donnerait un axe par roue — exactement le défaut que la refonte
              du 13/08 a corrigé : deux pressions écartées de 35 kPa s'y dessinaient
              identiques, et l'écart est la seule chose qui compte sur des pneus. */}
          {conso && seriesConso.length === 0 && (
            <p className="hint">
              Pas de courbe de consommation sur cette période : aucun segment de roulage
              exploitable
              {conso.nbEcartes > 0
                ? ` (${conso.nbEcartes} écarté(s) : voiture surtout à l’arrêt)`
                : ""}
              . Rien n’est tracé plutôt qu’une courbe inventée.
            </p>
          )}

          {seriesLiees.length > 0 && <GraphiquesLies series={seriesLiees} />}

          {/* Le relevé détaillé reste disponible sous les courbes, une entrée par métrique.
              Il répond à « quelle valeur exactement, et quand » — le survol d'une courbe le
              dit pour un point, ce tableau le dit pour tous. */}
          {courbes.map((c) => (
            <details key={c.metricType} className="detail-metrique">
              <summary>{libelle(c.metricType)} — relevé détaillé</summary>
              <HistoriqueDetaille
                points={c.points}
                unite={c.unite}
                decimales={c.decimales}
                metricType={c.metricType}
                granularite={c.granularite}
              />
            </details>
          ))}

          {/* ⚠️ CarAI#254 : au-delà de 7 jours chaque point d'une courbe RÉSUME une heure ou un
              jour. Le dire — une moyenne qui se lirait comme un relevé serait une fausse mesure,
              et elle lisse un pic bref. Le brut reste dans l'onglet Données. */}
          {courbes.length > 0 && courbes[0]!.granularite !== "brut" && (
            <p className="hint">
              Sur cette période, chaque point résume{" "}
              {courbes[0]!.granularite === "heure" ? "une heure" : "un jour"} de relevés (la
              moyenne, ou le maximum pour l’odomètre) : un pic très bref y est lissé. Pour les
              relevés exacts, choisis 7 jours ou moins, ou ouvre l’onglet Données.
            </p>
          )}

          {nbCourbesPlates > 0 && (
            <p className="hint">
              {nbCourbesPlates} courbe{nbCourbesPlates > 1 ? "s" : ""} masquée
              {nbCourbesPlates > 1 ? "s" : ""} : la mesure ne bouge pas du début à la fin de
              la période, il n’y a rien à y lire. Le détail brut reste dans l’onglet Données.
            </p>
          )}

          {trajet && <Trajet trace={trajet} points={positions} cleGoogle={cleGoogle} />}

          {courbes.length === 0 && !tracePneus && !trajet && (
            <p className="hint">
              Rien sur cette période — élargis la fenêtre, ou attends la prochaine livraison.
            </p>
          )}

          <p className="hint">
            Le détail brut de chaque signal — y compris ceux que la bZ refuse — est dans
            l’onglet <a href="/donnees">Données</a>.
          </p>
        </>
      )}
    </Coquille>
  );
}

/** Ce qui décide d'abord, le reste ensuite. PURE. */
function rang(metricType: string): number {
  const i = PRIORITE.indexOf(metricType);
  return i === -1 ? PRIORITE.length : i;
}
