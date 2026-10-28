// app/activite/page.tsx — ACTIVITÉ : trajets et recharges en UN fil (étape 2, 17/08).
//
// Choix de Marc (24 réponses de cadrage) : « on revit sa journée telle qu'elle s'est
// passée » — un FIL MÊLÉ groupé par jour (trajet · recharge · trajet…), la grande carte
// Google en haut (le DERNIER trajet par défaut, celui qu'on tape sinon), le détail dans
// un panneau sous la carte, les tuiles du mois en tête, période par défaut AUJOURD'HUI
// avec sélecteur libre, et des ADRESSES lisibles (géocodage inverse, cache à vie).
//
// Cet écran REMPLACE /trajets et /recharges (qui redirigent ici). Les règles d'honnêteté
// des deux écrans d'origine survivent intégralement : heures encadrées quand la nuit n'a
// pas de relevés, distances « min. » quand le compteur ne couvre pas, énergie toujours ~
// (déduite du SOC), coûts mesurés et estimés JAMAIS additionnés.
//
// Server Component derrière le middleware + requireSession. Jamais de 500 : panne classée.

import { redirect } from "next/navigation";
import { baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { classerPanne, messagePanne } from "@/lib/panne";
import { historiqueOdometre } from "@/lib/vehicle/history";
import { historiquePositions, formaterCoordonnee } from "@/lib/vehicle/position";
import {
  decouperTrajets,
  formaterDuree,
  libelleDuree,
  lienArrivee,
  lienItineraire,
  profilerReleves,
  reconcilier,
  jugerConcordance,
  trajetsDansLaFenetre,
  INCERTITUDE_MAX_MINUTES,
  type ProfilReleves,
  type Reconciliation,
  type Trajet,
  type VerdictConcordance,
} from "@/lib/vehicle/trajets";
import {
  cleJourLocale,
  construireFil,
  consoTrajet,
  energieTrajetKwh,
  trajetsDuMemeJour,
  type JourFil,
} from "@/lib/vehicle/fil";
import {
  HAUSSE_MIN_POINTS,
  estimerBorne,
  libelleEstimationBorne,
  reconstituerCharges,
  socProche,
  type PointCharge,
  type PointSoc,
  type SessionCharge,
} from "@/lib/vehicle/charges";
import {
  cumulerPrix,
  rechargesParMois,
  type MoisDeRecharge,
  lieuDeLaPosition,
  positionPendant,
  prixSession,
  totaliserPrix,
  type PrixSession,
} from "@/lib/vehicle/tarifsBornes";
import {
  LIMITE_HISTORIQUE_COMPLET,
  serieEtat,
  serieNumerique,
  traceMulti,
  type TraceMulti,
} from "@/lib/vehicle/analyse";
import { GraphiqueMulti } from "@/app/ui/Graphique";
import { estVrai } from "@/lib/vehicle/alertes";
import { lireEtatVehicule, mesuresPour } from "@/lib/vehicle/state";
import { lireBail, lireLieux, type Lieu } from "@/lib/config";
import { nommerLieuRecharge } from "@/app/activite/actions";
import { FormulaireNommerLieu } from "@/app/activite/FormulaireNommerLieu";
import { cleGeo, cleGeocodage, nommerPoints } from "@/lib/geocodage";
import { CarteInteractive } from "@/app/ui/CarteInteractive";
import { CarteGoogleItineraire, cleMapsEmbed } from "@/app/ui/CarteGoogle";
import { CarteGoogleVivante } from "@/app/ui/CarteGoogleVivante";
import { InfoTap, Pastille, Pastilles } from "@/app/ui/Pastille";
import { IcoEclair } from "@/app/ui/Icones";
import {
  analyserFenetre,
  instantDansLaFenetre,
  parametresFenetre,
  RACCOURCI_AUJOURDHUI,
  RACCOURCIS_ACTIVITE,
  FUSEAU_MARC,
} from "@/lib/vehicle/fenetre";
import { SelecteurFenetre } from "@/app/ui/SelecteurFenetre";


import { NonAutorise, requireSession } from "@/lib/session";
import { reparerEnArrierePlan } from "@/lib/reparationAuto";
import { Onglets } from "@/app/ui/Onglets";
import { capaciteBatterieKwh } from "@/lib/vehicle/capacite";
import {
  COUVERTURE_SUFFISANTE,
  consommationReference,
  coutParCentKm,
  type CoutParCentKm,
} from "@/lib/vehicle/coutParKm";
import { kmEntre } from "@/lib/vehicle/bilan";
import { MontantPrix, dollars } from "@/app/ui/Montant";
import { BoutonRafraichir } from "@/app/donnees/rafraichissement";

export const dynamic = "force-dynamic";

const FUSEAU = "America/Toronto";

const heure = new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU,
  hour: "2-digit",
  minute: "2-digit",
});

const jourLong = new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU,
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** « 11/08 » — pour situer un départ qui n'est pas du même jour que l'arrivée. */
const jourCourt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU,
  day: "2-digit",
  month: "2-digit",
});

/**
 * Date COURTE MAIS DATÉE, pour le point de départ du cumul. ⚠️ Pas `jourCourt` : il rend
 * « 14/07 » sans année, et un cumul « depuis le début » qui traversera plusieurs années
 * deviendrait ambigu au premier janvier — le genre de chiffre qui a l'air juste.
 */
const jourAvecAnnee = new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * « 2026-09 » → « septembre 2026 ». PURE.
 *
 * ⚠️ La clé est DÉJÀ dans le fuseau de Marc (`rechargesParMois` s'en charge) : on la relit
 * donc en UTC, à midi, pour ne pas la re-décaler d'un fuseau au moment de l'afficher.
 */
function libelleMois(cle: string): string {
  const [annee, mois] = cle.split("-").map(Number);
  if (!annee || !mois) return cle;
  return new Intl.DateTimeFormat("fr-CA", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(annee, mois - 1, 15, 12)));
}

function Coquille({ children }: { children: React.ReactNode }) {
  return (
    <main className="shell">
      <div className="carte carte-large">
        <h1>Activité</h1>
        <Onglets actif="/activite" />
        {children}
      </div>
    </main>
  );
}

function departPrecis(t: { departIncertitudeMinutes: number }): boolean {
  return t.departIncertitudeMinutes <= INCERTITUDE_MAX_MINUTES;
}

function km(n: number): string {
  return n >= 10 ? `${Math.round(n)} km` : `${n.toFixed(1)} km`;
}

/** Le nom d'un point, s'il en a un — lieu de Marc ou adresse géocodée. */
function nomDe(adresses: Map<string, string>, p: { lat: number; lng: number }): string | null {
  return adresses.get(cleGeo(p.lat, p.lng)) ?? null;
}

/** Ce qu'un trajet sait dire de son énergie — calculé UNE fois, affiché partout pareil. */
function energieDe(
  t: Trajet,
  socs: PointSoc[],
  capaciteKwh: number | null,
): { kwh: number | null; conso: number | null } {
  const kwh = energieTrajetKwh({
    socDebut: socProche(socs, t.debut),
    socFin: socProche(socs, t.fin),
    capaciteKwh,
  });
  return { kwh, conso: consoTrajet({ energieKwh: kwh, distanceKm: t.distanceKm }) };
}

function LigneTrajet({
  t,
  selection,
  paramsFenetre,
  adresses,
  socs,
  capaciteKwh,
}: {
  t: Trajet;
  selection: string | null;
  /** La fenêtre sérialisée (`parametresFenetre`) — pour que « Voir » la conserve. */
  paramsFenetre: string;
  adresses: Map<string, string>;
  socs: PointSoc[];
  capaciteKwh: number | null;
}) {
  const memeJour = cleJourLocale(t.debut) === cleJourLocale(t.fin);
  const { kwh, conso } = energieDe(t, socs, capaciteKwh);
  const nomDepart = nomDe(adresses, t.depart);
  const nomArrivee = nomDe(adresses, t.arrivee);

  return (
    <li className="evenement ev-trajet">
      <span className="quand">
        {departPrecis(t) ? (
          <>
            {!memeJour ? <span className="meta">{jourCourt.format(t.debut)} </span> : null}
            {heure.format(t.debut)} → {heure.format(t.fin)}
          </>
        ) : (
          <>
            <span className="meta">arrivée </span>
            {heure.format(t.fin)}
          </>
        )}
      </span>
      {/* Les ADRESSES (choix de Marc) : lieu nommé d'abord, géocodage sinon, coordonnées
          en dernier recours — jamais un libellé inventé. */}
      <span className="ou">
        {nomDepart ?? formaterCoordonnee(t.depart.lat)}
        {" → "}
        {nomArrivee ?? formaterCoordonnee(t.arrivee.lat)}
      </span>
      <span className="combien">
        {km(t.distanceKm)}
        {t.distanceEstimee ? (
          <span
            className="approx"
            title="au moins — le compteur ne couvre pas ce trajet, la distance vient des relevés GPS reliés en ligne droite"
          >
            &nbsp;min.
          </span>
        ) : null}
        {kwh !== null && (
          <span className="meta">
            {" "}
            · ~{kwh.toFixed(1)} kWh{conso !== null ? ` · ~${conso.toFixed(1)}/100` : ""}
          </span>
        )}
      </span>
      <span className="duree">
        {departPrecis(t) ? (
          <>
            {libelleDuree(t.dureeMinutes)}
            {t.dureeEstFenetre ? (
              <span
                className="approx"
                title="fenêtre entre deux relevés : elle peut contenir du temps à l’arrêt"
              >
                &nbsp;max.
              </span>
            ) : null}
          </>
        ) : (
          <span
            className="approx"
            title="départ inconnu : la voiture n’a rien publié entre les deux stationnements"
          >
            durée inconnue
          </span>
        )}
      </span>
      <span className="liens">
        {selection === t.debut.toISOString() ? (
          <strong>sur la carte</strong>
        ) : (
          <a
            href={`/activite?${paramsFenetre}&trajet=${encodeURIComponent(t.debut.toISOString())}`}
          >
            Voir
          </a>
        )}
        {" · "}
        <a href={lienItineraire(t)} target="_blank" rel="noreferrer noopener">
          Maps
        </a>
      </span>
    </li>
  );
}

function LigneRecharge({
  session,
  prix,
  nomLieu,
  position,
}: {
  session: SessionCharge;
  prix: PrixSession;
  nomLieu: string | null;
  /** Où la voiture était pendant la recharge : de quoi nommer le lieu d'un geste (CarAI#8). */
  position: { lat: number; lng: number } | null;
}) {
  return (
    <li className="evenement ev-recharge">
      <span className="quand">
        <span className="ico-recharge" aria-hidden="true">
          <IcoEclair taille={13} />
        </span>
        {heure.format(session.debut)} → {heure.format(session.fin)}
      </span>
      <span className="ou">{nomLieu ?? "lieu inconnu"}</span>
      <span className="combien">
        {session.socDebut !== null && session.socFin !== null ? (
          <>
            {Math.round(session.socDebut)} % → {Math.round(session.socFin)} %
          </>
        ) : (
          "—"
        )}
        {session.energieKwh !== null && (
          <span className="meta"> · ~{session.energieKwh.toFixed(1)} kWh</span>
        )}
      </span>
      <span className="duree">
        {formaterDuree(session.dureeMinutes)}
        {estimerBorne(session) && (
          <span className="meta"> · {libelleEstimationBorne(session)}</span>
        )}
      </span>
      <span className="liens">
        {prix.montant !== null ? (
          <span title={prix.explication}>
            {prix.qualite === "estime" ? "~" : ""}
            {dollars(prix.montant)}
          </span>
        ) : (
          <span className="meta" title={prix.explication}>
            prix —
          </span>
        )}
      </span>
      {nomLieu === null && position !== null && (
        <FormulaireNommerLieu position={position} nommer={nommerLieuRecharge} />
      )}
    </li>
  );
}

function Journee({
  jour,
  prixParSession,
  lieuxParSession,
  positionsParSession,
  selection,
  paramsFenetre,
  adresses,
  socs,
  capaciteKwh,
}: {
  jour: JourFil;
  prixParSession: Map<SessionCharge, PrixSession>;
  lieuxParSession: Map<SessionCharge, string | null>;
  positionsParSession: Map<SessionCharge, { lat: number; lng: number } | null>;
  selection: string | null;
  paramsFenetre: string;
  adresses: Map<string, string>;
  socs: PointSoc[];
  capaciteKwh: number | null;
}) {
  const date = new Date(`${jour.cle}T12:00:00.000Z`);
  return (
    <section className="journee">
      <h2>
        {jourLong.format(date)}{" "}
        <span className="meta">
          {jour.nbTrajets} trajet{jour.nbTrajets > 1 ? "s" : ""} · {km(jour.kmTrajets)}
          {jour.nbRecharges > 0
            ? ` · ${jour.nbRecharges} recharge${jour.nbRecharges > 1 ? "s" : ""}`
            : ""}
        </span>
      </h2>
      <ul className="fil">
        {jour.evenements.map((e) =>
          e.genre === "trajet" ? (
            <LigneTrajet
              key={`t-${e.trajet.debut.toISOString()}`}
              t={e.trajet}
              selection={selection}
              paramsFenetre={paramsFenetre}
              adresses={adresses}
              socs={socs}
              capaciteKwh={capaciteKwh}
            />
          ) : (
            <LigneRecharge
              key={`r-${e.session.debut.toISOString()}`}
              session={e.session}
              prix={
                prixParSession.get(e.session) ?? {
                  montant: null,
                  qualite: "inconnu",
                  explication: "prix non calculé",
                }
              }
              nomLieu={lieuxParSession.get(e.session) ?? null}
              position={positionsParSession.get(e.session) ?? null}
            />
          ),
        )}
      </ul>
    </section>
  );
}

/**
 * La CONCORDANCE — le total reconstitué face au compteur.
 *
 * ⚠️ REPLIÉE DEPUIS LE 14/09, MAIS SON VERDICT SE LIT SANS OUVRIR. C'est un contrôle de
 * cohérence : on l'ouvre quand un chiffre surprend, pas à chaque consultation. Sur
 * téléphone elle poussait le FIL — ce qu'on vient voir — 213 px plus bas (mesuré au banc
 * à 390 px, marges comprises), sur les ~1 814 px qui le précédaient déjà.
 *
 * ⚠️ CE QUI NE SE REPLIE PAS, C'EST LE FAIT. Le résumé porte le verdict complet, écart
 * compris — « Compteur 128 km · trajets 126 km — 2 km sans relevé de position » — parce
 * que cet écart EST l'information honnête de ce bloc : des kilomètres qui comptent pour
 * le bail et manquent au détail. Un titre neutre (« Concordance ») aurait été plus court
 * et aurait caché exactement ce que ce bloc existe pour dire. Replier n'autorise pas à
 * taire ; ce que le repli contient, c'est l'EXPLICATION et le profil des relevés.
 */
function Concordance({ bilan, profil }: { bilan: Reconciliation; profil: ProfilReleves }) {
  // ⚠️ UN SEUL jugement pour les DEUX rendus (le résumé et l'explication). Les recomposer
  // séparément, c'est écrire la règle deux fois — et deux écritures d'une même règle
  // divergent, jusqu'au jour où le résumé annonce « concorde » au-dessus d'un écart.
  const v = jugerConcordance(bilan);

  return (
    <details className="replie concordance">
      <summary>{resumeConcordance(v)}</summary>
      {v.genre === "sans-compteur" ? (
        <p>
          {v.nbReleves === 0 ? "Aucun relevé de compteur" : "Un seul relevé de compteur"} sur
          cette période : rien à comparer. Pas une panne — l’odomètre n’est publié qu’au
          réveil de la voiture.
        </p>
      ) : (
        <p>
          <strong>Compteur : {km(v.kmCompteur)}</strong>
          {" · "}trajets : {km(v.kmTrajets)}.{" "}
          {v.genre === "concorde" ? (
            <>Concorde.</>
          ) : v.genre === "manque" ? (
            <>
              <strong>{km(v.ecartKm)}</strong> roulés sans relevé de position — comptent pour
              le bail, manquent au détail.
            </>
          ) : (
            <>
              Détail au-delà du compteur de <strong>{km(v.ecartKm)}</strong> — cherche du côté
              des trajets <em>min.</em>
            </>
          )}
        </p>
      )}
      <p className="hint">
        {profil.total} relevé{profil.total > 1 ? "s" : ""} de position · {profil.stationnement}{" "}
        à l’arrêt · {profil.enRoute} en roulant
        {profil.sansType > 0 ? ` · ${profil.sansType} sans type` : ""}.
      </p>
    </details>
  );
}

/** Le verdict en UNE ligne — celle qu'on lit sans déplier. Voir `Concordance`. */
function resumeConcordance(v: VerdictConcordance): string {
  if (v.genre === "sans-compteur") {
    return v.nbReleves === 0
      ? "Aucun relevé de compteur sur cette période"
      : "Un seul relevé de compteur sur cette période";
  }
  const tete = `Compteur ${km(v.kmCompteur)} · trajets ${km(v.kmTrajets)}`;
  if (v.genre === "concorde") return `${tete} — concorde`;
  return v.genre === "manque"
    ? `${tete} — ${km(v.ecartKm)} sans relevé de position`
    : `${tete} — ${km(v.ecartKm)} de détail au-delà du compteur`;
}

export default async function Activite({
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

  // La reconstruction post-incident (migration 0005) avance SEULE, après la réponse.
  // Elle s'éteint définitivement une fois la dernière livraison relue.
  reparerEnArrierePlan();

  if (!baseConfiguree()) {
    return (
      <Coquille>
        <p className="lead">La base de données n’est pas branchée : rien ne peut être reconstitué.</p>
      </Coquille>
    );
  }

  const maintenant = new Date();
  const params = await searchParams;
  const seul = (cle: string): string | null => {
    const v = params[cle];
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  };
  // LA FENÊTRE — raccourcis, jour précis, ou plage (Marc, 14/09 : « filtrer par date mois
  // etc »). Même fonction et même sélecteur que Tendances ; ce qui diffère est déclaré
  // ici : « aujourd'hui » est proposé, et c'est le défaut (choix de Marc du 17/08).
  const fenetre = analyserFenetre(
    { periode: seul("periode"), du: seul("du"), au: seul("au") },
    maintenant,
    { fuseau: FUSEAU, raccourcis: RACCOURCIS_ACTIVITE, defaut: RACCOURCI_AUJOURDHUI },
  );
  const depuis = fenetre.depuis;
  const paramsFenetre = parametresFenetre(fenetre);

  let journees: JourFil[] = [];
  let bilan: Reconciliation;
  let profil: ProfilReleves;
  let nbPositions: number;
  let estimes = 0;
  let tousLesTrajets: Trajet[] = [];
  let socsFenetre: PointSoc[] = [];
  let capaciteKwh: number | null = null;
  // Diagnostic des recharges : quand ZÉRO session sort, ces compteurs disent POURQUOI
  // (relevés absents / aucune montée / sessions hors période) — l'ancienne page Recharges
  // le faisait, la refonte l'avait perdu, et « ça n'affiche rien » redevenait indéchiffrable.
  let nbSocLus = 0;
  let nbSessionsLues = 0;
  const prixParSession = new Map<SessionCharge, PrixSession>();
  const lieuxParSession = new Map<SessionCharge, string | null>();
  const positionsParSession = new Map<SessionCharge, { lat: number; lng: number } | null>();
  let totauxFenetre: { mesure: number; estime: number; nbInconnus: number } = {
    mesure: 0,
    estime: 0,
    nbInconnus: 0,
  };
  let nbSessionsFenetre = 0;
  let kwhFenetre = 0;
  // Le CUMUL depuis le premier relevé (Marc, 14/09 : « je veux que ça fasse tout
  // l'historique »). Séparé du mois, jamais confondu avec lui.
  let totauxTout: { mesure: number; estime: number; nbInconnus: number } = {
    mesure: 0,
    estime: 0,
    nbInconnus: 0,
  };
  let nbSessionsTout = 0;
  let kwhTout = 0;
  /** La courbe de cumul de la FENÊTRE. `null` = pas assez de points pour un trait. */
  let traceCumul: TraceMulti | null = null;
  /** Les recharges de la fenêtre qu'aucun prix ne permet de placer sur la courbe. */
  let nbIgnoreesCumul = 0;
  /** Le coût aux 100 km sur la FENÊTRE affichée — `null` si une des deux grandeurs manque. */
  let coutCentKm: CoutParCentKm | null = null;
  /** Les recharges mois par mois, du plus ancien au plus récent. */
  let moisRecharges: MoisDeRecharge[] = [];
  /** Les sessions de la fenêtre, pour le détail replié. */
  let sessionsDetail: { debut: Date; lieu: string | null; kwh: number | null; prix: PrixSession; dureeMinutes: number }[] = [];
  let debutHistorique: Date | null = null;
  /** Vrai si la lecture du SOC a buté sur sa borne : le cumul sous-compte alors. */
  let historiqueTronque = false;
  let adresses = new Map<string, string>();
  let lieux: Lieu[] = [];

  try {
    await assurerMigrations();
    // ══ LA LECTURE COUVRE TOUT L'HISTORIQUE, LE FILTRE NE TOUCHE QUE L'AFFICHAGE ══════
    //
    // ⚠️ Correction d'un défaut de ma propre passe du 14/09 (lot « cumul depuis le début »,
    // jamais mis en ligne). La lecture était bornée par la période choisie, élargie au
    // début du mois pour les tuiles. Donc `sessionsToutes` ne contenait pas toutes les
    // sessions, seulement toutes les sessions LUES — et le cumul « depuis le début »
    // changeait quand Marc basculait le sélecteur, exactement ce que son commentaire
    // promettait d'empêcher. Un nom qui ment (« toutes ») sur une grandeur qui se veut un
    // TOTAL est le pire des deux : le chiffre a l'air d'un cumul, il n'en est pas un.
    //
    // Mesuré le 14/09 avant de trancher : 661 relevés de charge, 669 positions et 1 257
    // d'odomètre en base — soit ~17 relevés de charge par jour depuis le 06/08. Tout lire
    // coûte donc quelques milliers de lignes, et `LIMITE_HISTORIQUE_COMPLET` (50 000) tient
    // près de huit ans à ce rythme. L'exactitude du total vaut largement ce prix-là ; le
    // jour où il ne le vaudra plus, `tronquee` le dira au lieu de l'amputer en silence.
    //
    // ⚠️ Les positions suivent la MÊME borne, et ce n'est pas un détail : le prix d'une
    // session vient du LIEU, et le lieu vient de la position pendant la session. Lire les
    // charges depuis toujours mais les positions sur un mois ferait retomber toutes les
    // vieilles sessions sur « lieu non reconnu » — donc sans prix, donc un cumul
    // silencieusement sous-compté, avec une explication plausible à l'écran.
    const [positions, odo, etatVehicule, socSerie, etatsSerie, lieuxConnus, termes] =
      await Promise.all([
        historiquePositions({ depuis: null, limite: LIMITE_HISTORIQUE_COMPLET }),
        historiqueOdometre({ granularite: "brut" }),
        lireEtatVehicule(),
        serieNumerique("battery_soc", { depuis: null, limite: LIMITE_HISTORIQUE_COMPLET }),
        serieEtat("charging_status", { depuis: null, limite: LIMITE_HISTORIQUE_COMPLET }),
        lireLieux(),
        lireBail(),
      ]);
    lieux = lieuxConnus;

    // ⚠️ La borne HAUTE n'existe que dans deux modes sur quatre (un jour précis, une
    // plage) — c'est précisément pourquoi elle s'oublie. `instantDansLaFenetre` la porte
    // pour tout le monde plutôt que de laisser chaque filtre la réécrire.
    const positionsFenetre = positions.filter((p) => instantDansLaFenetre(p.t, fenetre));
    nbPositions = positionsFenetre.length;
    profil = profilerReleves(positionsFenetre);

    const trajets = trajetsDansLaFenetre(
      decouperTrajets(positions, { historiqueOdometre: odo }),
      depuis,
    ).filter((t) => instantDansLaFenetre(t.debut, fenetre));
    estimes = trajets.filter((t) => t.distanceEstimee).length;
    bilan = reconcilier(trajets, odo, depuis);

    // ── Recharges : même chaîne que partout ───────────────────────────────────────────
    // ⚠️ JAMAIS `?.valueNumeric` : la bZ publie sa capacité en JSON, pas en numérique.
    capaciteKwh = capaciteBatterieKwh(etatVehicule);
    const tarif = termes?.tarifKwh ?? null;
    const etatsCharge: PointCharge[] = etatsSerie.changements.map((c) => ({
      t: c.t,
      enCharge: estVrai(c.valeur),
    }));
    const socs: PointSoc[] = socSerie.points.map((p) => ({ t: p.t, pourcent: p.valeur }));
    socsFenetre = socs;
    nbSocLus = socs.length;
    const sessionsToutes = reconstituerCharges({
      etatsCharge,
      socs,
      historiqueOdometre: odo,
      capaciteKwh,
      tarifKwh: tarif,
    });

    // Prix et lieu par session — calculés UNE fois, servis au fil ET aux tuiles.
    for (const s of sessionsToutes) {
      const position = positionPendant(s, positions);
      const lieu = lieuDeLaPosition(position, lieux);
      lieuxParSession.set(s, lieu?.nom ?? null);
      positionsParSession.set(s, position);
      prixParSession.set(
        s,
        prixSession({
          dureeMinutes: s.dureeMinutes,
          energieKwh: s.energieKwh,
          lieu,
          tarifKwh: tarif,
          // Le DÉBIT choisit le palier de la recharge rapide (Marc, 14/09).
          puissanceKw: estimerBorne(s)?.puissanceKw ?? null,
          // Une borne horaire multiplie ce temps : si les bornes sont des fenêtres de
          // sondage, le montant est un PLAFOND et le dit.
          bornesEstimees: s.bornesEstimees,
        }),
      );
    }

    const sessionsFenetre = sessionsToutes.filter((s) => instantDansLaFenetre(s.debut, fenetre));

    // ── LES TUILES SUIVENT LE FILTRE (arbitrage de Marc, 14/09) ───────────────────────
    // Elles parlaient du MOIS quel que soit le filtre. Un chiffre qui ne bouge pas
    // au-dessus d'une liste qui bouge n'est pas « un repère » : on le lit comme le total
    // de ce qu'on regarde, et il ne l'est pas. « Depuis le début » reste le seul repère
    // fixe, et il DIT qu'il l'est.
    nbSessionsFenetre = sessionsFenetre.length;
    totauxFenetre = totaliserPrix(sessionsFenetre.map((s) => prixParSession.get(s)!));
    kwhFenetre = sessionsFenetre.reduce((somme, s) => somme + (s.energieKwh ?? 0), 0);

    // ── LE CUMUL DEPUIS LE DÉBUT ──────────────────────────────────────────────────────
    // ⚠️ Sur `sessionsToutes`, jamais sur la fenêtre : le cumul ne doit pas changer quand
    // Marc bascule le sélecteur. Ça n'est vrai que depuis que la LECTURE couvre tout
    // l'historique (voir le bloc de lecture) — auparavant `sessionsToutes` ne contenait
    // que ce que la période avait laissé lire, et le total suivait donc le filtre en
    // silence. `historiqueTronque` reste le garde-fou de dernier recours.
    nbSessionsTout = sessionsToutes.length;
    totauxTout = totaliserPrix(sessionsToutes.map((s) => prixParSession.get(s)!));
    kwhTout = sessionsToutes.reduce((somme, s) => somme + (s.energieKwh ?? 0), 0);
    debutHistorique = sessionsToutes.at(-1)?.debut ?? null;
    historiqueTronque = socSerie.tronquee;

    nbSessionsLues = sessionsToutes.length;

    // ── LE COÛT AUX 100 KM (Marc, 15/09 : « le chiffre qui se compare à un plein ») ────
    //
    // ⚠️ LES DEUX GRANDEURS SE MESURENT SUR LA MÊME FENÊTRE. L'odomètre porte tout le bail ;
    // les recharges observées ne commencent que trois semaines plus tard. Diviser l'un par
    // l'autre rend un coût quatre fois trop bas — mesuré le 15/09 — et rien à l'écran ne
    // cloche. D'où `kmEntre`, borné comme la fenêtre, et jamais `kmDepuis`.
    //
    // ⚠️ SUR « TOUT », LE DÉPART N'EST PAS LE DÉBUT DU BAIL mais celui de l'HISTORIQUE des
    // recharges : c'est là que le numérateur commence.
    const debutCout = depuis ?? debutHistorique;
    const finFenetre = fenetre.jusqu ?? new Date();
    const kmFenetre = debutCout === null ? null : kmEntre(odo, debutCout, finFenetre);
    // La consommation de référence se DÉRIVE du véhicule : capacité × état de charge ÷
    // autonomie annoncée. Elle sert à dire quelle PART des kilomètres les recharges
    // observées expliquent — sans elle, la couverture reste `null`, jamais « tout va bien ».
    const derniereNumerique = (metrique: string): number | null => {
      const m = mesuresPour(etatVehicule, metrique).sort(
        (a, b) => b.recordedAt.getTime() - a.recordedAt.getTime(),
      )[0];
      return typeof m?.valueNumeric === "number" ? m.valueNumeric : null;
    };
    const consoRef = consommationReference({
      capaciteKwh,
      autonomieKm: derniereNumerique("battery_range"),
      socPourcent: derniereNumerique("battery_soc"),
    });
    coutCentKm =
      kmFenetre === null
        ? null
        : coutParCentKm({
            totaux: totauxFenetre,
            kmParcourus: kmFenetre,
            kwhObserve: kwhFenetre,
            consoReferenceKwhParCentKm: consoRef,
          });

    // ── LA TENDANCE PAR MOIS et LE DÉTAIL PAR SESSION (Marc, 15/09) ───────────────────
    // La tendance porte TOUT l'historique, comme le cumul : filtrée sur « aujourd'hui »,
    // elle ne montrerait qu'un mois, donc aucune tendance.
    moisRecharges = rechargesParMois(
      sessionsToutes.map((s) => ({
        debut: s.debut,
        energieKwh: s.energieKwh,
        prix: prixParSession.get(s)!,
      })),
      FUSEAU_MARC,
    );
    // Le détail suit la FENÊTRE : c'est une liste, elle répond au filtre comme le fil.
    sessionsDetail = sessionsFenetre.map((s) => ({
      debut: s.debut,
      lieu: lieuxParSession.get(s) ?? null,
      kwh: s.energieKwh,
      dureeMinutes: s.dureeMinutes,
      prix: prixParSession.get(s)!,
    }));

    // ── LA COURBE DE CUMUL (Marc, 14/09 : « courbe aussi de prix à rajouter ») ─────────
    //
    // Elle porte la FENÊTRE, comme les tuiles : son dernier point vaut donc exactement le
    // total affiché au-dessus. C'est vérifiable à l'œil, et c'est ce qui rend les deux
    // lisibles ensemble — une courbe sur tout l'historique posée sous un total filtré
    // donnerait deux chiffres différents pour la même chose, sans dire lequel est lequel.
    //
    // ⚠️ Une série n'est tracée que si elle a QUELQUE CHOSE : un cumul resté à zéro
    // dessinerait une ligne plate au ras de l'axe, qu'on lirait comme une mesure (« rien
    // n'a été estimé ce mois-ci ») alors qu'elle ne dit rien du tout.
    const cumul = cumulerPrix(
      sessionsFenetre.map((s) => ({ debut: s.debut, prix: prixParSession.get(s)! })),
    );
    nbIgnoreesCumul = cumul.nbIgnorees;
    const dernier = cumul.points.at(-1);
    const series: Array<{ libelle: string; points: { t: Date; valeur: number }[] }> = [];
    if (dernier && dernier.mesure > 0) {
      series.push({
        libelle: "Prix connus",
        points: cumul.points.map((c) => ({ t: c.t, valeur: c.mesure })),
      });
    }
    if (dernier && dernier.estime > 0) {
      series.push({
        libelle: "Estimations",
        points: cumul.points.map((c) => ({ t: c.t, valeur: c.estime })),
      });
    }
    // Deux points au minimum : un trait a besoin de deux bouts. Avec un seul, la polyline
    // ne dessine rien et l'écran afficherait un cadre vide sans dire pourquoi.
    traceCumul = cumul.points.length >= 2 ? traceMulti(series, { hauteur: 170 }) : null;

    journees = construireFil({ trajets, sessions: sessionsFenetre, fuseau: FUSEAU });
    tousLesTrajets = trajets;

    // ── Adresses : extrémités des trajets AFFICHÉS, lieux d'abord, cache, Google borné ──
    const pointsANommer = trajets.flatMap((t) => [t.depart, t.arrivee]);
    adresses = await nommerPoints({
      points: pointsANommer,
      lieux,
      cle: cleGeocodage(),
    });
  } catch (err) {
    console.error("[activite] lecture impossible", err);
    return (
      <Coquille>
        <p className="lead">{messagePanne(classerPanne(err))}</p>
      </Coquille>
    );
  }

  const totalTrajets = journees.reduce((s, j) => s + j.nbTrajets, 0);
  const totalKm = journees.reduce((s, j) => s + j.kmTrajets, 0);
  const totalRecharges = journees.reduce((s, j) => s + j.nbRecharges, 0);

  // ── La carte : le DERNIER trajet par défaut (choix de Marc), celui qu'on tape sinon,
  //    la vue d'ensemble sur demande (`?trajet=tous`). ─────────────────────────────────
  const demande = Array.isArray(params.trajet) ? params.trajet[0] : params.trajet;
  const vueEnsemble = demande === "tous";
  const trajetAffiche = vueEnsemble
    ? null
    : (tousLesTrajets.find((t) => t.debut.toISOString() === demande) ??
      // plus récent = fin la plus tardive
      [...tousLesTrajets].sort((a, b) => b.fin.getTime() - a.fin.getTime())[0] ??
      null);
  const selection = trajetAffiche?.debut.toISOString() ?? null;

  const pointsGlobaux = [...tousLesTrajets]
    .sort((a, b) => a.debut.getTime() - b.debut.getTime())
    .flatMap((t) => t.points);

  // ── LA CARTE COUVRE LA JOURNÉE, PAS LE SEUL TRAJET SÉLECTIONNÉ (Marc, 18/09) ──────
  //
  // « ça coupe à la moitié du trajet » : un déplacement découpé en plusieurs trajets ne
  // montrait que son DERNIER morceau, puisque la carte suit le trajet sélectionné et que
  // celui-ci est le plus récent par défaut. Le découpage a été corrigé par ailleurs
  // (`PAUSE_MINUTES`, re-mesuré), mais il restera toujours des journées à plusieurs
  // trajets — et c'est la trace du JOUR que Marc veut voir.
  //
  // ⚠️ Le panneau de détail, lui, continue de parler du trajet SÉLECTIONNÉ : dès qu'une
  // journée porte plusieurs trajets, la carte et lui ne décrivent plus le même objet. C'est
  // ÉCRIT à l'écran plutôt que laissé à deviner — deux chiffres différents pour ce qui
  // ressemble à la même chose est exactement ce qui fait douter du reste.
  const trajetsCarte = trajetAffiche
    ? trajetsDuMemeJour(tousLesTrajets, trajetAffiche, FUSEAU)
    : [];
  const carteCouvreLaJournee = trajetsCarte.length > 1;
  const kmCarte = trajetsCarte.reduce((somme, t) => somme + t.distanceKm, 0);
  const pointsCarte = trajetAffiche ? trajetsCarte.flatMap((t) => t.points) : pointsGlobaux;
  // Vue d'ensemble : on pointe le DÉPART et l'ARRIVÉE de chaque trajet, pas chaque relevé.
  // Le trait porte déjà le reste, et un marqueur par relevé noierait les extrémités — ce
  // sont elles qui répondent à « où suis-je allé ».
  const marqueursZone = tousLesTrajets.flatMap((t) => {
    const depart = t.points[0];
    const arrivee = t.points[t.points.length - 1];
    if (!depart) return [];
    const etiquette = `${heure.format(t.debut)} → ${heure.format(t.fin)} · ${km(t.distanceKm)}`;
    const bornes = [{ lat: depart.lat, lng: depart.lng, libelle: `Départ ${etiquette}` }];
    if (arrivee && arrivee !== depart) {
      bornes.push({ lat: arrivee.lat, lng: arrivee.lng, libelle: `Arrivée ${etiquette}` });
    }
    return bornes;
  });
  const cleGoogle = cleMapsEmbed();
  const detail = trajetAffiche ? energieDe(trajetAffiche, socsFenetre, capaciteKwh) : null;

  return (
    <Coquille>
      <BoutonRafraichir />

      {/* ── LES TUILES SUIVENT LE FILTRE, sauf le cumul, qui DIT qu'il ne le suit pas. ── */}
      <ul className="tuiles">
        <li className="tuile">
          <MontantPrix mesure={totauxFenetre.mesure} estime={totauxFenetre.estime} />
          <span className="tuile-libelle">Recharges ({fenetre.libelle.toLowerCase()})</span>
          <span className="tuile-detail">
            {nbSessionsFenetre} session{nbSessionsFenetre > 1 ? "s" : ""}
            {totauxFenetre.nbInconnus > 0 ? ` · ${totauxFenetre.nbInconnus} sans prix` : ""}
          </span>
        </li>
        <li className="tuile">
          <span className="tuile-valeur">
            {kwhFenetre > 0 ? `~${kwhFenetre.toFixed(0)} kWh` : "—"}
          </span>
          <span className="tuile-libelle">Énergie ({fenetre.libelle.toLowerCase()})</span>
          <span className="tuile-detail">déduite du % de batterie</span>
        </li>
        {/* ⚠️ LE COÛT AUX 100 KM EST UN PLANCHER, et la tuile le DIT quand il l'est. Une
            recharge que le canal n'a pas vue manque au numérateur, jamais au dénominateur :
            mesuré le 15/09, l'énergie observée n'explique qu'un QUART des kilomètres. Un
            chiffre quatre fois trop bas et parfaitement crédible est exactement ce que
            « no fake data » interdit — d'où la couverture, affichée et pas déduite. */}
        {coutCentKm !== null && (
          <li className="tuile">
            <MontantPrix
              mesure={coutCentKm.mesureParCentKm}
              estime={coutCentKm.totalParCentKm - coutCentKm.mesureParCentKm}
            />
            <span className="tuile-libelle">Coût / 100 km</span>
            <span className="tuile-detail">
              sur {km(coutCentKm.kmParcourus)}
              {coutCentKm.couverture === null
                ? " · couverture inconnue"
                : coutCentKm.couverture < COUVERTURE_SUFFISANTE
                  ? ` · ⚠ ces recharges n’expliquent que ${Math.round(coutCentKm.couverture * 100)} % de ces km — le vrai coût est plus élevé`
                  : ""}
            </span>
          </li>
        )}
        {/* ⚠️ LE CUMUL, séparé du mois et jamais fondu dedans. Il porte sa DATE DE DÉPART :
            un « depuis le début » sans date ne dit pas depuis quand, et le début réel est
            le premier relevé reçu, pas la signature du bail. Si la lecture a buté sur sa
            borne, on le DIT — un cumul amputé qui se présente comme complet est pire qu'un
            chiffre absent. */}
        <li className="tuile">
          <MontantPrix mesure={totauxTout.mesure} estime={totauxTout.estime} />
          <span className="tuile-libelle">Recharges depuis le début</span>
          <span className="tuile-detail">
            {nbSessionsTout} session{nbSessionsTout > 1 ? "s" : ""}
            {kwhTout > 0 ? ` · ~${kwhTout.toFixed(0)} kWh` : ""}
            {totauxTout.nbInconnus > 0 ? ` · ${totauxTout.nbInconnus} sans prix` : ""}
            {debutHistorique ? ` · depuis le ${jourAvecAnnee.format(debutHistorique)}` : ""}
            {historiqueTronque ? " · ⚠ historique tronqué, ce total sous-compte" : ""}
          </span>
        </li>
        <li className="tuile">
          <span className="tuile-valeur">{totalTrajets}</span>
          <span className="tuile-libelle">
            Trajet{totalTrajets > 1 ? "s" : ""} ({fenetre.libelle.toLowerCase()})
          </span>
          <span className="tuile-detail">{km(totalKm)}</span>
        </li>
      </ul>

      {/* ══ LE DÉTAIL DES RECHARGES, REPLIÉ ═══════════════════════════════════════════
          Marc, 15/09 : « manque le détail par session » et « manque la tendance ». Replié,
          parce que l'écran s'ouvre pour voir ce qui s'est passé aujourd'hui — pas pour
          éplucher trente sessions. Le repli vaut aussi sur grand écran : un `<details>`
          fermé masque son contenu par le shadow DOM, et une règle d'auteur ne le défait
          pas (mesuré au lot Réglages du 14/09).

          ⚠️ LA TENDANCE PORTE TOUT L'HISTORIQUE, LE DÉTAIL PORTE LA FENÊTRE. Une tendance
          filtrée sur « aujourd'hui » ne montrerait qu'un mois, donc aucune tendance ; une
          liste qui ignorerait le filtre contredirait le fil juste en dessous. */}
      {(moisRecharges.length > 0 || sessionsDetail.length > 0) && (
        <details className="replie">
          <summary>
            Le détail des recharges
            {moisRecharges.length > 0 ? ` — ${moisRecharges.length} mois observés` : ""}
          </summary>

          {moisRecharges.length > 1 && (
            <>
              <p className="hint">
                Mois par mois, depuis le début. Un mois sans recharge observée n’a pas de
                ligne : rien n’a été vu, ce qui n’est pas « rien dépensé ».
              </p>
              <div className="defilement">
                <table className="tableau">
                  <thead>
                    <tr>
                      <th scope="col">Mois</th>
                      <th scope="col">Mesuré</th>
                      <th scope="col">Estimé</th>
                      <th scope="col">Énergie</th>
                      <th scope="col">Sessions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {moisRecharges.map((m) => (
                      <tr key={m.cle}>
                        <th scope="row">{libelleMois(m.cle)}</th>
                        <td>{m.mesure > 0 ? dollars(m.mesure) : "—"}</td>
                        <td>{m.estime > 0 ? `~${dollars(m.estime)}` : "—"}</td>
                        <td>{m.kwh > 0 ? `~${m.kwh.toFixed(0)} kWh` : "—"}</td>
                        <td>
                          {m.nbSessions}
                          {m.nbInconnus > 0 ? ` · ${m.nbInconnus} sans prix` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {sessionsDetail.length > 0 && (
            <>
              <h3 className="grp-titre">
                Chaque recharge ({fenetre.libelle.toLowerCase()})
              </h3>
              <ul className="liste-sessions">
                {sessionsDetail.map((d) => (
                  <li key={d.debut.toISOString()}>
                    <span className="ls-quand">{jourAvecAnnee.format(d.debut)}</span>
                    <span className="ls-lieu">{d.lieu ?? "lieu non reconnu"}</span>
                    <span className="ls-montant">
                      {d.prix.montant === null
                        ? "—"
                        : `${d.prix.qualite === "mesure" ? "" : "~"}${dollars(d.prix.montant)}`}
                    </span>
                    <span className="ls-detail">
                      {d.kwh !== null ? `~${d.kwh.toFixed(1)} kWh · ` : ""}
                      {d.prix.explication}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}

      <SelecteurFenetre
        fenetre={fenetre}
        base="/activite"
        raccourcis={RACCOURCIS_ACTIVITE}
        defaut={RACCOURCI_AUJOURDHUI}
      />

      {/* ── LA COURBE DU CUMUL ────────────────────────────────────────────────────────
          Elle suit la fenêtre : son dernier point est le total de la tuile ci-dessus.
          Quand il n'y a pas de quoi tracer, on DIT pourquoi et on donne la sortie — un
          cadre vide, ou pire l'absence de tout cadre, se lit « la courbe n'existe pas »
          alors que c'est la période qui est trop courte. */}
      {traceCumul ? (
        <GraphiqueMulti
          titre="Ce que les recharges ont coûté"
          trace={traceCumul}
          unite="$"
          decimales={2}
          explication={
            `Le trait monte à chaque recharge et reste plat entre deux : le dernier point est ` +
            `le total affiché plus haut.` +
            (nbIgnoreesCumul > 0
              ? ` ${nbIgnoreesCumul} recharge${nbIgnoreesCumul > 1 ? "s" : ""} sans prix connu ` +
                `n’y ${nbIgnoreesCumul > 1 ? "figurent" : "figure"} pas — la courbe ne les compte ` +
                `pas pour zéro.`
              : "")
          }
        />
      ) : (
        <p className="hint">
          Pas assez de recharges chiffrées sur cette période pour tracer une courbe (il en
          faut au moins deux
          {nbIgnoreesCumul > 0
            ? `, et ${nbIgnoreesCumul} de cette période n’${nbIgnoreesCumul > 1 ? "ont" : "a"} aucun prix connu`
            : ""}
          ).
          {fenetre.periode !== "tout" && (
            <>
              {" "}
              <a className="lien-action" href="/activite?periode=tout">
                Voir tout l’historique
              </a>
            </>
          )}
        </p>
      )}

      {totalTrajets === 0 && totalRecharges === 0 ? (
        <>
          <p className="lead">
            Rien sur cette période.
            {fenetre.periode === RACCOURCI_AUJOURDHUI && (
              <>
                {" "}
                <a className="lien-action" href="/activite?periode=7j">
                  Voir les 7 derniers jours
                </a>
              </>
            )}
          </p>
          <p className="hint">
            {nbPositions === 0
              ? "Aucune position publiée ici."
              : `${nbPositions} position(s), mais aucun déplacement > 300 m ni recharge.`}
          </p>
          <Concordance bilan={bilan} profil={profil} />
        </>
      ) : (
        <>
          {/* ── LA GRANDE CARTE ─────────────────────────────────────────────────────── */}
          {trajetAffiche && cleGoogle ? (
            // La légende (« itinéraire reconstitué… ») vit DANS le composant, à côté de
            // l'iframe qu'elle décrit — y compris le repli « sur place » d'une boucle.
            <CarteGoogleItineraire
              points={pointsCarte}
              cle={cleGoogle}
              titre={
                carteCouvreLaJournee
                  ? `${jourLong.format(trajetAffiche.fin)} — ${trajetsCarte.length} trajets · ${km(kmCarte)}`
                  : `Trajet ${heure.format(trajetAffiche.debut)} → ${heure.format(trajetAffiche.fin)}`
              }
            />
          ) : cleGoogle && tousLesTrajets.length > 0 ? (
            // La VUE D'ENSEMBLE (`?trajet=tous`) sur Google — demande de Marc, 17/08 :
            // « c'est l'ancienne map qui apparaît, je veux pas ça ». L'Embed ne sait pas
            // montrer N trajets, et l'image Static ne se zoomait pas (20/08 : « je peux
            // pas zoomer ni me déplacer, inutile ») → Maps JavaScript API, avec la carte
            // CarAI en repli — qui zoome aussi. Voir lib/carteVivante.ts.
            <CarteGoogleVivante
              points={marqueursZone}
              trajets={tousLesTrajets.map((t) => t.points.map((p) => ({ lat: p.lat, lng: p.lng })))}
              cle={cleGoogle}
              legende={
                <p className="hint">
                  {totalTrajets} trajet{totalTrajets > 1 ? "s" : ""} · {km(totalKm)} (
                  {fenetre.libelle.toLowerCase()}) — chaque trait relie les{" "}
                  <strong>relevés réels</strong> d’un trajet ; la route exacte entre deux
                  relevés n’est pas enregistrée (la bZ ne publie sa position qu’à l’arrêt).
                  Ctrl/⌘ + molette pour zoomer, glisser pour se déplacer.
                </p>
              }
            >
              <CarteInteractive
                points={pointsCarte.map((p, i) => ({
                  lat: p.lat,
                  lng: p.lng,
                  iso: p.t?.toISOString(),
                  libelle: `Relevé ${i + 1} sur ${pointsCarte.length}`,
                }))}
                cheminInconnu
                legende={`${totalTrajets} trajet${totalTrajets > 1 ? "s" : ""} · ${km(totalKm)}`}
              />
            </CarteGoogleVivante>
          ) : pointsCarte.length > 0 ? (
            <CarteInteractive
              points={pointsCarte.map((p, i) => ({
                lat: p.lat,
                lng: p.lng,
                iso: p.t?.toISOString(),
                libelle:
                  trajetAffiche && !carteCouvreLaJournee
                    ? i === 0
                      ? "Départ"
                      : i === pointsCarte.length - 1
                        ? "Arrivée"
                        : `Relevé ${i + 1}`
                    : `Relevé ${i + 1} sur ${pointsCarte.length}`,
              }))}
              // Plusieurs trajets dans la vue : entre l'arrivée de l'un et le départ du
              // suivant, la voiture était garée — le trait qui les relie n'est donc pas un
              // chemin parcouru, et il se dessine comme tel.
              cheminInconnu={
                trajetAffiche ? carteCouvreLaJournee || trajetAffiche.cheminInconnu : true
              }
              legende={
                trajetAffiche
                  ? carteCouvreLaJournee
                    ? `${jourLong.format(trajetAffiche.fin)} · ${trajetsCarte.length} trajets · ${km(kmCarte)}`
                    : `${heure.format(trajetAffiche.debut)} → ${heure.format(trajetAffiche.fin)} · ${km(trajetAffiche.distanceKm)}`
                  : `${totalTrajets} trajet${totalTrajets > 1 ? "s" : ""} · ${km(totalKm)}`
              }
            />
          ) : null}

          {/* La carte couvre la JOURNÉE, le panneau ci-dessous UN trajet : le dire, plutôt
              que de laisser deux chiffres se contredire sans explication. */}
          {carteCouvreLaJournee && trajetAffiche && (
            <p className="hint">
              La carte montre la journée entière — {trajetsCarte.length} trajets, {km(kmCarte)}.
              Le détail ci-dessous ne porte que sur celui de{" "}
              {heure.format(trajetAffiche.debut)}.
            </p>
          )}

          {/* ── LE PANNEAU DU TRAJET AFFICHÉ (choix de Marc : carte + panneau) ──────── */}
          {trajetAffiche && (
            <div className="panneau-trajet">
              <Pastilles>
                <Pastille ton="neutre">
                  {heure.format(trajetAffiche.debut)} → {heure.format(trajetAffiche.fin)}
                </Pastille>
                <Pastille ton="neutre">
                  {km(trajetAffiche.distanceKm)}
                  {trajetAffiche.distanceEstimee ? " min." : ""}
                </Pastille>
                {departPrecis(trajetAffiche) && (
                  <Pastille ton="neutre">{libelleDuree(trajetAffiche.dureeMinutes)}</Pastille>
                )}
                {detail?.kwh != null && (
                  <Pastille ton="estime">~{detail.kwh.toFixed(1)} kWh</Pastille>
                )}
                {detail?.conso != null && (
                  <Pastille ton="estime">~{detail.conso.toFixed(1)} kWh/100</Pastille>
                )}
                <a className="insigne insigne-lien" href={lienItineraire(trajetAffiche)}>
                  Maps
                </a>
                <a className="insigne insigne-lien" href={lienArrivee(trajetAffiche)}>
                  Arrivée
                </a>
                <a
                  className="insigne insigne-lien"
                  href={`/activite?${paramsFenetre}&trajet=tous`}
                >
                  Tous les trajets
                </a>
                <InfoTap>
                  {nomDe(adresses, trajetAffiche.depart) ?? "départ sans adresse connue"} →{" "}
                  {nomDe(adresses, trajetAffiche.arrivee) ?? "arrivée sans adresse connue"}.
                  L’énergie est déduite du % de batterie et de la capacité nominale — la bZ ne mesure
                  pas l’énergie. Une distance « min. » vient des relevés GPS reliés en ligne
                  droite : la vraie est plus grande.
                </InfoTap>
              </Pastilles>
            </div>
          )}

          <Concordance bilan={bilan} profil={profil} />

          {estimes > 0 && (
            <p className="hint">
              <strong>{estimes}</strong> trajet{estimes > 1 ? "s" : ""} marqué
              {estimes > 1 ? "s" : ""} <em>min.</em> : distance GPS en ligne droite, la vraie
              est plus grande.
            </p>
          )}

          {/* ── LE FIL, par jour ────────────────────────────────────────────────────── */}
          {/* Les journées côte à côte sur PC (`.colonnes-pc`, globals.css) : chacune est une
              section autonome, l'ordre chronologique se lit de gauche à droite puis de haut en bas. */}
          <div className="colonnes-pc">
            {journees.map((j) => (
              <Journee
                key={j.cle}
                jour={j}
                prixParSession={prixParSession}
                lieuxParSession={lieuxParSession}
                positionsParSession={positionsParSession}
                selection={selection}
                paramsFenetre={paramsFenetre}
                adresses={adresses}
                socs={socsFenetre}
                capaciteKwh={capaciteKwh}
              />
            ))}
          </div>

          {/* Zéro recharge : DIRE pourquoi (Marc, 18/08 : « mes anciennes charges ne
              s'affichent plus ») — trois causes possibles, trois phrases différentes. */}
          {totalRecharges === 0 && (
            <p className="hint">
              Aucune recharge sur cette période.{" "}
              {nbSocLus === 0
                ? "Aucun relevé d’état de charge dans la fenêtre lue — si le badge de l’accueil est orange ou rouge, c’est le canal de données qui est en panne (état complet sur Réglages)."
                : nbSessionsLues === 0
                  ? `${nbSocLus} relevé(s) d’état de charge lus, mais aucune montée à l’arrêt d’au moins ${HAUSSE_MIN_POINTS} points — rien à reconstituer.`
                  : `${nbSessionsLues} session(s) reconstituée(s) juste avant cette période — élargis la période pour les voir.`}
            </p>
          )}
        </>
      )}
    </Coquille>
  );
}
