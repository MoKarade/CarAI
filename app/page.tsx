// app/page.tsx — l'accueil « style constructeur », version DENSE (17/08/2026, 2ᵉ passe).
//
// ══ LA REFONTE, ET D'OÙ ELLE VIENT ═══════════════════════════════════════════════════
// Marc, 17/08 : « j'aime pas l'affichage, trop de texte » — puis, capture à l'appui sur la
// première version : « trop vide d'info », « pas de texte pour la voiture, juste des
// couleurs/icônes ». Seize réponses de cadrage au total. Chaque choix ci-dessous est le
// SIEN :
//   • Le HAUT : charge & autonomie + où est la voiture — carte GOOGLE (Embed API, clé).
//   • Sous la voiture : des ICÔNES SEULES, détail au tap — zéro texte à l'écran.
//   • Dense : coûts du mois, dernière recharge, activité du jour, charge en cours.
//   • Sombre assumé, icônes SVG, badges (`.insigne`) + ⓘ à la place des paragraphes.
//
// Server Component : base et jetons côté serveur, session revérifiée ici. Îlots client :
// le schéma pilotable (`SchemaInteractif`) et les courbes.
//
// ⚠️ CETTE PAGE NE DOIT JAMAIS RENDRE UN 500 (vécu le 05/08) : `collecter()` séquence les
// migrations et n'échoue jamais vers l'appelant ; le reste vit dans un try qui dégrade.
//
// ── CE QUE CET ÉCRAN REFUSE DE FAIRE ─────────────────────────────────────────────────
// Afficher un chiffre qu'il n'a pas. L'énergie d'une recharge est toujours ~ (déduite du
// SOC), un coût sans tarif est « — », l'estimation de fin de charge refuse de répondre
// sans montée récente du SOC. La refonte change la FORME, jamais l'honnêteté.

import { redirect } from "next/navigation";
import { collecter } from "@/lib/vehicle/instantane";
import { reparerEnArrierePlan } from "@/lib/reparationAuto";
import { Onglets } from "@/app/ui/Onglets";
import { formaterAge, tonFraicheur } from "@/lib/vehicle/state";
import type { EtatBail } from "@/lib/vehicle/lease";
import {
  MESSAGE_BAIL_NON_RENSEIGNE,
  avanceSurLeBail,
  calculerEtatBail,
  libelleDepassementProjete,
  resumerBail,
} from "@/lib/vehicle/lease";
import {
  construireAlertes,
  estVrai,
  referencesDepuisSeries,
  type Alerte,
} from "@/lib/vehicle/alertes";
import { recommander, type Recommandation } from "@/lib/vehicle/recommandation";
import {
  serieEtat,
  seriesPneus,
  serieNumerique,
  sousEchantillonner,
  traceBail,
  traceDouble,
  type TraceDouble,
} from "@/lib/vehicle/analyse";
import {
  calculerBilan,
  debutDuJourLocal,
  debutDuMoisLocal,
  type BilanQuotidien,
} from "@/lib/vehicle/bilan";
import { historiqueOdometre } from "@/lib/vehicle/history";
import { historiquePositions, lienCarte, type PointPosition } from "@/lib/vehicle/position";
import { composerVue, type VueCarte } from "@/lib/vehicle/carte";
import {
  estimerBorne,
  etatBandeauCharge,
  reconstituerCharges,
  statutDeCharge,
  type EtatBandeauCharge,
  type PointCharge,
  type PointSoc,
  type SessionCharge,
} from "@/lib/vehicle/charges";
import {
  lieuDeLaPosition,
  positionPendant,
  prixSession,
  totaliserPrix,
  type PrixSession,
} from "@/lib/vehicle/tarifsBornes";
import { decouperTrajets, trajetsDansLaFenetre } from "@/lib/vehicle/trajets";
import { lireBail, lireLieux } from "@/lib/config";
import { messagePanne } from "@/lib/panne";
import { NonAutorise, requireSession } from "@/lib/session";
import { SEUIL_SILENCE_HEURES } from "@/lib/hubSummary";
import { GraphiqueBail, GraphiqueDouble } from "@/app/ui/Graphique";
import { SchemaVehicule } from "@/app/ui/SchemaVehicule";
import { SchemaInteractif } from "@/app/ui/SchemaInteractif";
import { VueVoiture3D } from "@/app/ui/VueVoiture3D";
import { construirePointsVoiture } from "@/lib/vehicle/pointsAccueil";
import { construireEtatSchema, type EtatSchema } from "@/lib/vehicle/etatSchema";
import { Barre } from "@/app/ui/Jauge";
import { BoutonRafraichir } from "@/app/ui/BoutonRafraichir";
import { Carte } from "@/app/ui/Carte";
import { CarteGoogle, cleMapsEmbed } from "@/app/ui/CarteGoogle";
import { InfoTap, Pastille, Pastilles } from "@/app/ui/Pastille";
import {
} from "@/app/ui/IndicateursVoiture";
import {
  IcoCalendrier,
  IcoChevron,
  IcoCompteur,
  IcoCourbe,
  IcoHorloge,
  IcoJauge,
  IcoPiece,
  IcoPosition,
  IcoPrise,
  IcoRoute,
} from "@/app/ui/Icones";
import { MontantPrix, dollars } from "@/app/ui/Montant";
import type { LectureBail } from "@/lib/financeai/bail";
import type { PaiementsBail } from "@/lib/vehicle/paiementsBail";
import { messageBail } from "@/lib/vehicle/messageBail";

export const dynamic = "force-dynamic";

/** Fuseau de Marc — toute frontière de jour/mois se calcule chez lui, jamais en UTC. */
const FUSEAU = "America/Toronto";

/** Fenêtre du graphique de charge sur l'accueil — un rappel visuel, pas un explorateur. */
const FENETRE_CHARGE_JOURS = 14;

/**
 * Repère d'autonomie « pleine », pour REMPLIR la barre — jamais pour affirmer un chiffre.
 * C'est l'échelle de la jauge, comme le 8 000 d'un compte-tours.
 */

/** Zoom de la carte de position : assez pour reconnaître le quartier. */
const ZOOM_CARTE = 15;

const km0 = (n: number) => Math.round(n).toLocaleString("fr-CA");
/** Un pourcentage à une décimale. `Intl` pose l'insécable avant le signe, pas nous. */
const pourcent = (n: number) =>
  new Intl.NumberFormat("fr-CA", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n / 100);
const formatHeure = new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU,
  hour: "2-digit",
  minute: "2-digit",
});
const formatJour = new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/**
 * LA DERNIÈRE MISE À JOUR — en clair, tout en haut (demande Marc, 17/08 : « je veux que
 * ce soit indiqué clairement c'est quand la dernière update »).
 *
 * L'instant affiché est celui du relevé le plus récent PRODUIT PAR LA VOITURE
 * (`recordedAt`, jamais l'heure de réception) — le principe « une mesure porte toujours
 * son recordedAt » rendu visible au lieu de vivre derrière une icône au tap. Le ton suit
 * `tonFraicheur` : vert dans le rythme normal (30–60 min), orange au-delà de 90 min,
 * rouge après 6 h — le même seuil que l'alerte de silence du summary.
 */
function DerniereMaj({ instant }: { instant: Date | null }) {
  // eslint-disable-next-line react-hooks/purity -- Server Component (page force-dynamic) : rendu une fois par requête, l'âge affiché EST celui de la requête.
  const minutes = instant === null ? null : (Date.now() - instant.getTime()) / 60_000;
  return (
    <div className="maj">
      <Pastilles>
        <Pastille ton={tonFraicheur(minutes)} icone={<IcoHorloge taille={13} />}>
          {instant === null || minutes === null
            ? "Aucune donnée reçue du véhicule"
            : // Moins de 24 h : l'heure suffit, et le badge tient sur un téléphone
              // (capture du 17/08 : la date complète débordait). Plus vieux : la date
              // entière — « il y a 3 j » sans date ferait recalculer de tête.
              `Mis à jour ${formaterAge(minutes)} · ${
                minutes < 24 * 60
                  ? formatHeure.format(instant)
                  : `${formatJour.format(instant)} ${formatHeure.format(instant)}`
              }`}
        </Pastille>
        <InfoTap resume="Ce que veut dire cette heure">
          <p>
            C’est l’instant du relevé le plus récent produit par la voiture — pas l’heure
            où CarAI l’a reçu. Toyota rafraîchit les données aux 30–60 min : un âge dans
            cet ordre est normal. Au-delà de 6 h, le canal est probablement en panne —
            l’état complet se lit sur la page <a href="/donnees">Données</a>.
          </p>
        </InfoTap>
      </Pastilles>
    </div>
  );
}

/** « 4 h 10 », « 35 min » — une durée qui se lit d'un coup d'œil. PURE. */
function dureeCourte(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const reste = m % 60;
  return reste === 0 ? `${h} h` : `${h} h ${String(reste).padStart(2, "0")}`;
}

/**
 * LE HÉROS — la voiture pilotable + l'état vital + la carte Google.
 *
 * Sous la voiture : des ICÔNES SEULES (2ᵉ passe de cadrage — « pas de texte pour la
 * voiture »). Chaque icône est colorée par l'état et s'ouvre au tap sur le détail complet.
 */
/**
 * L'ESSENTIEL — trois chiffres, tout en haut, TÉLÉPHONE SEULEMENT.
 *
 * ⚠️ CE BLOC CONTREDIT EN PARTIE UNE DÉCISION DU 20/08, et c'est délibéré. Ce jour-là,
 * « TOUT ce que la voiture sait se pose SUR elle » avait fait disparaître l'anneau de
 * charge et la rangée d'autonomie, parce qu'ils redisaient à côté ce que la carrosserie
 * disait déjà. La raison tenait — sur un ÉCRAN LARGE, où les deux se voient ensemble.
 *
 * Sur téléphone, non : le héros mesure 1 557 px de haut, soit presque deux écrans. Il
 * faut faire défiler avant le moindre chiffre de contexte, et l'app s'ouvre sur un dessin
 * sans réponse. Marc, 13/09 : « trop plat, trop d'info de partout, pas assez regroupé ».
 * Ce bandeau n'est donc pas le retour du bloc supprimé : c'est le résumé AU-DESSUS DE LA
 * LIGNE DE FLOTTAISON, et il n'existe que là où le problème existe (`@media` mobile).
 * Sur grand écran, la décision du 20/08 reste intacte au pixel près.
 *
 * No-fake-data : une valeur absente rend « — », jamais un zéro plausible.
 */
/**
 * LES TROIS CHIFFRES DU COUP D'ŒIL — charge, coût, autonomie.
 *
 * ⚠️ Choisis par Marc le 18/09/2026, nommément, à la question « si tu ne pouvais voir que
 * trois chiffres en ouvrant l'app, lesquels ? ». Ce ne sont donc pas trois métriques parmi
 * d'autres : c'est la réponse à « pourquoi j'ouvre CarAI », et rien ne s'ajoute ici sans
 * qu'il en retire un.
 *
 * ⚠️ **Le « Aujourd'hui » qui occupait la troisième place a cédé au COÛT.** Il n'était pas
 * faux — il était au mauvais endroit : les kilomètres du jour vivent dans « Ce mois-ci »,
 * juste en dessous, et ils ne décident de rien à l'instant où l'on ouvre l'écran.
 *
 * ⚠️ **AUCUN TEXTE ICI.** Arbitrage de Marc au même moment (« je veux pas trop de texte ou
 * blabla, très épuré et simple ») : un chiffre, son unité, son libellé. La fin de charge
 * annoncée, le rythme mesuré et les réserves du calcul existent — ils sont dans le héros et
 * dans le bail, un cran plus bas. Ce qui remonte ici doit tenir en un mot.
 */
function Essentiel({
  soc,
  enCharge,
  coutTotal,
  autonomieKm,
}: {
  soc: number | null;
  /** La voiture le DIT (`mode === "en-charge"`), on ne le déduit pas d'un câble branché. */
  enCharge: boolean;
  /** Ce qui est VERSÉ au bail — la part exactement connue, jamais un total reconstitué. */
  coutTotal: number | null;
  autonomieKm: number | null;
}) {
  const chiffres: {
    valeur: string;
    unite: string | null;
    libelle: string;
    ton: string;
    vivant?: boolean;
  }[] = [
    {
      valeur: soc === null ? "—" : String(Math.round(soc)),
      unite: soc === null ? null : "%",
      // « En charge » plutôt qu'une phrase : l'état tient dans le libellé, et le point qui
      // bat à côté le dit sans un mot de plus.
      libelle: enCharge ? "En charge" : "Charge",
      // Le ton suit la valeur, pas le rôle : c'est ce qui rend la couleur informative.
      ton: soc === null ? "inconnu" : soc <= 20 ? "danger" : soc <= 40 ? "attention" : "ok",
      vivant: enCharge,
    },
    {
      valeur: coutTotal === null ? "—" : dollars(coutTotal),
      unite: null,
      libelle: "Versé au bail",
      ton: "neutre",
    },
    {
      valeur: autonomieKm === null ? "—" : km0(autonomieKm),
      unite: autonomieKm === null ? null : "km",
      libelle: "Autonomie",
      ton: "neutre",
    },
  ];

  return (
    <section className="essentiel" aria-label="L’essentiel">
      {chiffres.map((c) => (
        <div key={c.libelle} className={`ess-item ton-${c.ton}`}>
          <span className="ess-valeur">
            {c.valeur}
            {c.unite && <span className="ess-unite">{c.unite}</span>}
          </span>
          <span className="ess-libelle">
            {c.vivant && <span className="ess-pouls" aria-hidden="true" />}
            {c.libelle}
          </span>
        </div>
      ))}
    </section>
  );
}

function HerosVoiture({
  schema,
  finCharge,
  rythmeCharge,
  soc,
  autonomieKm,
  odometreKm,
  derniereSynchro,
  position,
  vueCarte,
  cleGoogle,
}: {
  schema: EtatSchema;
  /** Fin de charge annoncée, déjà formatée — `null` hors charge. */
  finCharge: { heure: string; duree: string } | null;
  /** Le rythme MESURÉ depuis les relevés — ce que portait le bandeau supprimé. */
  rythmeCharge: string | null;
  soc: number | null;
  autonomieKm: number | null;
  odometreKm: number | null;
  derniereSynchro: Date | null;
  position: PointPosition | null;
  vueCarte: VueCarte | null;
  cleGoogle: string | null;
}) {
  const age = (d: Date | null) =>
    // eslint-disable-next-line react-hooks/purity -- Server Component (page force-dynamic) : rendu une fois par requête, l'âge affiché EST celui de la requête.
    d === null ? null : formaterAge((Date.now() - d.getTime()) / 60_000);



  // ⚠️ TOUT ce que la voiture sait se pose SUR elle (Marc, 20/08). Les blocs séparés
  // (anneau de charge, autonomie, rangée de pastilles) ont disparu : ils disaient la même
  // chose une deuxième fois, à un autre endroit, et c'est ce qui rendait l'accueil vide en
  // haut et bavard en bas.
  const points = construirePointsVoiture({
    schema,
    finCharge,
    rythmeCharge,
    soc,
    autonomieKm,
    odometreKm,
    derniereSynchro,
    maintenant: new Date(),
  });

  return (
    <section className="heros-constructeur" aria-label="État du véhicule">
      {/* ── LA VOITURE, pilotable — icônes seules en dessous ──────────────────────── */}
      <div className="hc-voiture">
        <SchemaInteractif verrouillee={schema.verrouillee} points={points}>
          <SchemaVehicule etat={schema} />
        </SchemaInteractif>

        {/* La même voiture, en volume — et les MÊMES points, jamais redérivés. Le modèle
            pèse 6 Mo : il ne part qu'au clic, et le bouton écrit ce que ça coûte. */}
        <VueVoiture3D points={points} />
      </div>

      {/* ── L'ÉTAT VITAL : charge, autonomie, position ────────────────────────────── */}
      <div className="hc-etat">
        <div className="hc-carte">
          {position ? (
            <>
              {cleGoogle ? (
                // La carte GOOGLE (Embed API) — le choix de Marc, avec ce qu'il implique :
                // la position part vers Google à l'affichage (assumé au cadrage).
                <CarteGoogle
                  lat={position.lat}
                  lng={position.lng}
                  zoom={ZOOM_CARTE}
                  cle={cleGoogle}
                  titre="Dernière position de la voiture"
                />
              ) : vueCarte ? (
                // Repli sans clé : la carte OSM — l'app dégrade, elle ne casse pas.
                <a href="/trajets" className="hc-carte-lien" aria-label="Voir les trajets">
                  <Carte vue={vueCarte} />
                </a>
              ) : null}
              <Pastilles genre="la ligne sous la carte de la dernière position de la voiture">
                <Pastille ton="neutre" icone={<IcoPosition taille={13} />}>
                  {position.type?.toUpperCase() === "REAL_TIME" ? "En déplacement" : "Stationnée"}
                </Pastille>
                <Pastille ton="neutre" icone={<IcoHorloge taille={13} />}>
                  {age(position.t) ?? "—"}
                </Pastille>
                <a className="insigne insigne-lien" href="/trajets">
                  Trajets <IcoChevron taille={12} />
                </a>
                <a className="insigne insigne-lien" href={lienCarte(position)}>
                  Maps <IcoChevron taille={12} />
                </a>
              </Pastilles>
            </>
          ) : (
            <p className="hc-sans-position">
              <IcoPosition taille={16} /> Aucune position publiée pour l’instant.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/** CE QUI CLOCHE — et rien d'autre. Zéro alerte est la réponse normale, en un insigne. */
/**
 * Ce qui cloche — et RIEN du tout quand rien ne cloche.
 *
 * ⚠️ Jusqu'au 18/09/2026, l'absence d'alerte affichait une pastille « Rien à signaler »
 * sous un titre « Ce qui cloche ». Arbitrage de Marc ce jour-là (« visible seulement s'il
 * y a quelque chose ») : un bandeau qui dit que tout va bien tous les jours de l'année
 * apprend à ne plus être lu, et le jour où il change vraiment, personne ne le remarque.
 * C'est le même raisonnement que « un avertissement PERMANENT est un avertissement mort »,
 * déjà payé sur DriveAI.
 *
 * ⚠️ **Le composant rend sa SECTION ENTIÈRE, titre compris, ou `null`.** L'appelant ne
 * teste rien : deux endroits qui décident de la même présence, c'est une règle et demie —
 * et celui qui serait oublié laisserait un titre orphelin au-dessus du vide.
 */
function Alertes({ alertes }: { alertes: Alerte[] }) {
  if (alertes.length === 0) return null;
  return (
    <section className="grp grp-alertes" aria-label="Ce qui cloche">
      <h2 className="grp-titre">Ce qui cloche</h2>
    <ul className="alertes">
      {alertes.map((a) => (
        <li key={a.cle} className={a.gravite}>
          <span className="titre">{a.titre}</span>
          <span className="meta">{a.detail}</span>
        </li>
      ))}
    </ul>
    </section>
  );
}

/**
 * LA RECOMMANDATION — une phrase quand il y a une action à prendre, RIEN sinon.
 *
 * Le composant rend son élément ENTIER ou `null` : l'appelant ne teste rien, pour la même
 * raison que `Alertes` (deux endroits qui décident d'une même présence, c'est une règle et
 * demie). La phrase vient de `recommander`, qui la déduit des alertes déjà calculées.
 */
function RecommandationAccueil({ reco }: { reco: Recommandation | null }) {
  if (reco === null) return null;
  return (
    <p className="recommandation" role="status">
      {reco.texte}
    </p>
  );
}

/** Résumé de la dernière recharge, prêt à afficher en tuile. */
interface DerniereRecharge {
  session: SessionCharge;
  prix: PrixSession;
  nomLieu: string | null;
}

/**
 * LES TUILES — kilométrage, coûts, dernière recharge (accueil DENSE, choix de Marc :
 * « coûts + dernière recharge + activité du jour »).
 *
 * ⚠️ Les totaux d'argent séparent toujours MESURÉ et ESTIMÉ (`totaliserPrix`) : les deux
 * qualités ne s'additionnent jamais dans un même chiffre.
 */
function Tuiles({
  bilan,
  nbTrajetsJour,
  totaux,
  nbSessions,
  derniere,
}: {
  bilan: BilanQuotidien;
  nbTrajetsJour: number | null;
  totaux: { mesure: number; estime: number; nbInconnus: number } | null;
  nbSessions: number;
  derniere: DerniereRecharge | null;
}) {
  const km = (v: number | null) => (v === null ? "—" : `${km0(v)} km`);
  const part = bilan.partDuMoisPourcent;

  return (
    <ul className="tuiles">
      {/* ⚠️ VEDETTE : c'est le chiffre qui bouge tous les jours, et cinq tuiles de poids
          identique ne hiérarchisent rien (Marc, 13/09 : « trop plat »). Elle s'étale sur
          toute la largeur SUR TÉLÉPHONE seulement — la classe est inerte au-dessus. */}
      <li className="tuile tuile-vedette">
        <span className="tuile-icone" aria-hidden="true">
          <IcoRoute taille={18} />
        </span>
        <span className="tuile-valeur">{km(bilan.kmAujourdhui)}</span>
        <span className="tuile-libelle">Aujourd’hui</span>
        {nbTrajetsJour !== null && nbTrajetsJour > 0 && (
          <span className="tuile-detail">
            {nbTrajetsJour} trajet{nbTrajetsJour > 1 ? "s" : ""}
          </span>
        )}
      </li>
      <li className="tuile">
        <span className="tuile-icone" aria-hidden="true">
          <IcoCalendrier taille={18} />
        </span>
        <span className="tuile-valeur">{km(bilan.kmCeMois)}</span>
        <span className="tuile-libelle">Ce mois-ci</span>
        {bilan.budgetMensuelKm !== null && (
          <span className="tuile-detail">sur {km(bilan.budgetMensuelKm)}</span>
        )}
      </li>
      <li className={`tuile ${part !== null && part > 100 ? "alerte" : ""}`}>
        <span className="tuile-icone" aria-hidden="true">
          <IcoJauge taille={18} />
        </span>
        <span className="tuile-valeur">{part === null ? "—" : `${Math.round(part)} %`}</span>
        <span className="tuile-libelle">Budget consommé</span>
      </li>
      {totaux && (
        <li className="tuile">
          <span className="tuile-icone" aria-hidden="true">
            <IcoPiece taille={18} />
          </span>
          {totaux.mesure > 0 || totaux.estime > 0 ? (
            <MontantPrix mesure={totaux.mesure} estime={totaux.estime} />
          ) : (
            <span className="tuile-valeur">{nbSessions > 0 ? "—" : "0 $"}</span>
          )}
          <span className="tuile-libelle">Recharges du mois</span>
          <span className="tuile-detail">
            {nbSessions} session{nbSessions > 1 ? "s" : ""}
            {totaux.nbInconnus > 0 ? ` · ${totaux.nbInconnus} sans prix` : ""}
          </span>
        </li>
      )}
      {derniere && (
        <li className="tuile">
          <span className="tuile-icone" aria-hidden="true">
            <IcoPrise taille={18} />
          </span>
          <span className="tuile-valeur">
            {derniere.session.energieKwh !== null
              ? `~${derniere.session.energieKwh.toFixed(1)} kWh`
              : derniere.session.deltaSocPoints !== null
                ? `+${Math.round(derniere.session.deltaSocPoints)} pts`
                : "—"}
          </span>
          <span className="tuile-libelle">Dernière recharge</span>
          <span className="tuile-detail">
            {formatJour.format(derniere.session.debut)}
            {derniere.nomLieu ? ` · ${derniere.nomLieu}` : ""}
            {derniere.prix.montant !== null
              ? ` · ${derniere.prix.qualite === "estime" ? "~" : ""}${dollars(derniere.prix.montant)}`
              : ""}
          </span>
        </li>
      )}
    </ul>
  );
}

/**
 * LE BAIL, en bandeau compact — plus le héros (choix de Marc). Le chiffre qui commande
 * reste `rythmeRestantAutoriseKmParJour`.
 */
function BandeauBail({
  bail,
  paiements,
  lecture,
}: {
  bail: EtatBail;
  /** Le versé et le total du contrat, ou `null` quand FinanceAI n'a pas de quoi les calculer. */
  paiements: PaiementsBail | null;
  /** L'état de la lecture — c'est lui qui dit POURQUOI, quand `paiements` est absent. */
  lecture: LectureBail;
}) {
  const depasse = bail.ecartKmParJour !== null && bail.ecartKmParJour > 0;
  const ecart = bail.ecartKmParJour === null ? null : Math.abs(bail.ecartKmParJour);

  // [BAIL-04] — le POURCENTAGE du forfait, et son seul point de comparaison honnête.
  //
  // ⚠️ Le ticket disait « `consommePourcent` est déjà calculé, rien ne le lit ». Recensé :
  // la barre ci-dessous le MONTRAIT déjà — en le RE-CALCULANT à la main. Deux lectures du
  // même fait, dont une amputée de la comparaison au temps écoulé. Ce qui manquait n'était
  // donc pas la barre, c'était le chiffre ET ce qui permet de le lire.
  //
  // ⚠️ Le TON de la barre ne bouge pas : il suit `depasse` (le rythme dépasse ce qui
  // reste autorisé par jour), qui est PROSPECTIF. L'avance, elle, est rétrospective. Deux
  // signaux distincts, deux peintures distinctes — les fondre en dirait un pour l'autre.
  const avance = avanceSurLeBail(bail);
  const part = avance === null ? null : avance.consommePourcent / 100;
  // [BAIL-01] Le dépassement en DOLLARS, seulement quand le tarif est connu et qu'un dépassement
  // est projeté ; sinon rien de neuf à l'écran (jamais « 0 $ » pour un coût inconnu).
  const libelleCout = libelleDepassementProjete(bail);

  return (
    <section className="bandeau-bail" aria-label="Bail">
      <div className="bb-verdict">
        {ecart === null ? (
          <>
            <span className="verdict-nombre">
              {bail.rythmeRestantAutoriseKmParJour !== null
                ? km0(bail.rythmeRestantAutoriseKmParJour)
                : "—"}
            </span>
            <span className="verdict-legende">km/jour disponibles</span>
          </>
        ) : (
          <>
            <span className={`verdict-nombre ${depasse ? "alerte" : "ok"}`}>
              {depasse ? "+" : "−"}
              {km0(ecart)}
            </span>
            <span className="verdict-legende">km/jour {depasse ? "de trop" : "de marge"}</span>
          </>
        )}
        <Pastilles>
          {bail.rythmeKmParJour !== null && (
            <Pastille ton="neutre">{km0(bail.rythmeKmParJour)} roulés/j</Pastille>
          )}
          {bail.rythmeRestantAutoriseKmParJour !== null && (
            <Pastille ton="neutre">
              {km0(bail.rythmeRestantAutoriseKmParJour)} autorisés/j
            </Pastille>
          )}
          <Pastille ton="neutre">
            {bail.joursRestants.toLocaleString("fr-CA")} jours restants
          </Pastille>
          {libelleCout !== null && <Pastille ton="attention">{libelleCout}</Pastille>}
          {avance !== null && (
            // Les DEUX chiffres, toujours : « 6,8 % du forfait » est excellent au bout d'un
            // an et catastrophique au bout d'un mois. Le second n'est pas un détail, c'est
            // ce qui rend le premier lisible.
            <Pastille
              ton={
                avance.gravite === "alerte"
                  ? "danger"
                  : avance.gravite === "attention"
                    ? "attention"
                    : "ok"
              }
            >
              {pourcent(avance.consommePourcent)} du forfait · {pourcent(avance.ecoulePourcent)}{" "}
              du temps
            </Pastille>
          )}
        </Pastilles>
      </div>
      <Barre
        fraction={part}
        libelle="Allocation du bail"
        valeur={bail.kilometrageActuel !== null ? `${km0(bail.kilometrageActuel)} km` : "—"}
        plafond={`${km0(bail.allocationTotale)} km`}
        ton={depasse ? "danger" : "accent"}
      />
      <BailEnDollars paiements={paiements} lecture={lecture} />
    </section>
  );
}

/**
 * Les DOLLARS du bail — « ce que j'ai payé sur le prix total » (Marc, 15/09).
 *
 * ⚠️ Le total est `mensualité × durée`, JAMAIS le montant financé : les deux ne coïncident
 * qu'à taux nul, et le second n'est pas ce que Marc versera. Le calcul vit dans
 * `lib/vehicle/paiementsBail.ts`, PUR ; ici on ne fait que peindre.
 *
 * ⚠️ Quand les montants manquent, on DIT lequel des sept états on est — pas un tiret. Chacun
 * appelle un geste différent, et un tiret unique enverrait chercher au mauvais endroit.
 */
function BailEnDollars({
  paiements,
  lecture,
}: {
  paiements: PaiementsBail | null;
  lecture: LectureBail;
}) {
  const manque = messageBail(lecture, paiements !== null);
  if (manque) {
    return (
      <p className={`bail-dollars-absent${manque.aConfigurer ? " a-configurer" : ""}`}>
        {manque.texte}
      </p>
    );
  }
  if (!paiements) return null;

  return (
    <>
      <Barre
        fraction={paiements.fraction}
        libelle="Payé sur le bail"
        valeur={dollars(paiements.payeContrat)}
        plafond={dollars(paiements.totalContrat)}
        ton="accent"
      />
      <p className="bail-dollars-detail">
        {paiements.versementsFaits} versement{paiements.versementsFaits > 1 ? "s" : ""} sur{" "}
        {paiements.versementsTotal} · {dollars(paiements.mensualite)} par mois
      </p>
      {paiements.reserves.length > 0 && (
        <ul className="bail-dollars-reserves">
          {paiements.reserves.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function Coquille({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <main className="shell">
      <div className="carte carte-large">
        <h1>{titre}</h1>
        <Onglets actif="/" />
        {children}
      </div>
    </main>
  );
}

export default async function Home() {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof NonAutorise) redirect("/login");
    throw err;
  }

  // La reconstruction post-incident (migration 0005) avance SEULE, après la réponse.
  // Elle s'éteint définitivement une fois la dernière livraison relue.
  reparerEnArrierePlan();

  const maintenant = new Date();
  const { instantane, etat, typePanne } = await collecter(maintenant);

  // Le résultat d'une commande s'affiche désormais DANS la feuille du schéma, sans
  // recharger la page (Marc, 18/08 : « je veux pas que ça refresh la page ni la carte »).
  // Le journal complet reste sur Réglages.

  let alertes: Alerte[] = [];
  let bilan: BilanQuotidien | null = null;
  let grapheEtat: TraceDouble | null = null;
  let schema: EtatSchema | null = null;
  let dernierePosition: PointPosition | null = null;
  let vueCarte: VueCarte | null = null;
  let totauxMois: { mesure: number; estime: number; nbInconnus: number } | null = null;
  let nbSessionsMois = 0;
  let derniereRecharge: DerniereRecharge | null = null;
  let bandeauCharge: EtatBandeauCharge | null = null;
  let nbTrajetsJour: number | null = null;
  let grapheBail: {
    trace: NonNullable<ReturnType<typeof traceBail>>;
    resume: string;
    debut: Date;
    fin: Date;
    limites: string[];
  } | null = null;
  // [BAIL-DOLLARS] Les MONTANTS du bail viennent de FinanceAI — CarAI n'en connaît aucun.
  // La lecture ne lève jamais : elle rend l'un de ses sept états, et l'écran DIT lequel.
  //
  // ⚠️ LUS DEPUIS `collecter()`, PLUS RELUS ICI. Depuis que le summary du hub publie
  // « Versé au bail », c'est `collecter()` qui interroge FinanceAI — et cette page l'appelait
  // une SECONDE fois. Deux appels réseau par chargement, pour la même question, avec la
  // possibilité que les deux réponses diffèrent : un solde peut bouger entre les deux, et
  // l'écran afficherait alors un montant que la carte du hub contredit, sans que rien ne dise
  // lequel a raison. Une lecture, une vérité.
  const lectureBail: LectureBail = instantane.lectureBail ?? { statut: "non-configure" };
  const paiements: PaiementsBail | null = instantane.paiements;

  if (!typePanne) {
    try {
      const veille = new Date(maintenant.getTime() - 24 * 3_600_000);
      const roues = await seriesPneus({
        depuis: new Date(maintenant.getTime() - 30 * 86_400_000),
      });
      alertes = construireAlertes({
        mesures: etat.mesures,
        referencesPneus: referencesDepuisSeries(roues.series, veille),
      });
      schema = construireEtatSchema({
        etat,
        seriesRoues: roues.series,
        uniteRoues: roues.unite,
        maintenant,
      });

      // ── Fenêtres : frontières calculées dans le fuseau de Marc, jamais en UTC ─────
      const debutMois = debutDuMoisLocal(maintenant, FUSEAU);
      const debutJour = debutDuJourLocal(maintenant, FUSEAU);
      const depuisCharge = new Date(maintenant.getTime() - FENETRE_CHARGE_JOURS * 86_400_000);
      // Le SOC sert au graphe (14 j) ET aux recharges du mois : UNE lecture qui couvre
      // les deux fenêtres, filtrée ensuite — jamais deux requêtes pour la même série.
      const depuisSoc = debutMois < depuisCharge ? debutMois : depuisCharge;
      // Fenêtre positions ÉLARGIE d'un jour : la bZ ne publie qu'à l'arrêt, et le relevé
      // qui situe une recharge du 1ᵉʳ du mois peut dater de la veille (même règle que
      // l'écran Recharges).
      const fenetrePositions = new Date(debutMois.getTime() - 86_400_000);

      const [odoBrut, termes, odoBail, socSerie, autonomieSerie, positions, etatsSerie, lieux] =
        await Promise.all([
          historiqueOdometre({ granularite: "brut" }),
          lireBail(),
          historiqueOdometre(),
          serieNumerique("battery_soc", { depuis: depuisSoc }),
          serieNumerique("battery_range", { depuis: depuisCharge }),
          historiquePositions({ depuis: fenetrePositions }),
          serieEtat("charging_status", { depuis: debutMois }),
          lireLieux(),
        ]);
      bilan = calculerBilan({
        historiqueOdometre: odoBrut,
        allocationKm: termes?.kilometrageAutorise ?? null,
        dureeMois: termes?.dureeMois ?? null,
        maintenant,
      });

      dernierePosition = positions[positions.length - 1] ?? null;
      if (dernierePosition) {
        vueCarte = composerVue({
          points: [{ lat: dernierePosition.lat, lng: dernierePosition.lng }],
          largeur: 640,
          hauteur: 400,
          zoom: ZOOM_CARTE,
        });
      }

      // ── Recharges du mois — MÊME chaîne que l'écran Recharges, mêmes règles ───────
      const etatsCharge: PointCharge[] = etatsSerie.changements.map((c) => ({
        t: c.t,
        enCharge: estVrai(c.valeur),
      }));
      const pointsSocMois: PointSoc[] = socSerie.points
        .filter((p) => p.t >= debutMois)
        .map((p) => ({ t: p.t, pourcent: p.valeur }));
      const mesureCapacite = etat.mesures.find(
        (m) => m.metricType === "battery_capacity_nominal" || m.metricType === "battery_capacity",
      );
      const tarif = termes?.tarifKwh ?? null;
      const sessions = reconstituerCharges({
        etatsCharge,
        socs: pointsSocMois,
        historiqueOdometre: odoBrut,
        capaciteKwh: mesureCapacite?.valueNumeric ?? null,
        tarifKwh: tarif,
      });
      nbSessionsMois = sessions.length;
      const prixMois = sessions.map((s) =>
        prixSession({
          dureeMinutes: s.dureeMinutes,
          energieKwh: s.energieKwh,
          lieu: lieuDeLaPosition(positionPendant(s, positions), lieux),
          tarifKwh: tarif,
          // Le DÉBIT choisit le palier de la recharge rapide (Marc, 14/09). Sans lui, une
          // charge rapide retombait au tarif du kWh domestique — 3,91 $ pour 50 kWh.
          puissanceKw: estimerBorne(s)?.puissanceKw ?? null,
          // Une borne horaire multiplie ce temps : si les bornes sont des fenêtres de
          // sondage, le montant est un PLAFOND et le dit.
          bornesEstimees: s.bornesEstimees,
        }),
      );
      totauxMois = totaliserPrix(prixMois);
      if (sessions[0] && prixMois[0]) {
        derniereRecharge = {
          session: sessions[0],
          prix: prixMois[0],
          nomLieu: lieuDeLaPosition(positionPendant(sessions[0], positions), lieux)?.nom ?? null,
        };
      }

      // Ce que le bandeau charge a le droit d'affirmer — estimation, montée, ou limite.
      const limite = etat.mesures.find((m) => m.metricType === "charge_limit");
      bandeauCharge = etatBandeauCharge({
        soc: pointsSocMois,
        ciblePourcent:
          limite && limite.valueNumeric !== null && limite.valueNumeric > 1
            ? limite.valueNumeric
            : null,
        maintenant,
      });

      // Trajets d'aujourd'hui — même découpage que l'écran Trajets.
      nbTrajetsJour = trajetsDansLaFenetre(
        decouperTrajets(positions, { historiqueOdometre: odoBrut }),
        debutJour,
      ).length;

      // ── Graphes ───────────────────────────────────────────────────────────────────
      const pointsSoc14j = socSerie.points.filter((p) => p.t >= depuisCharge);
      grapheEtat = traceDouble({
        gauche: {
          libelle: "Charge",
          unite: socSerie.unite,
          points: sousEchantillonner(pointsSoc14j),
        },
        droite: {
          libelle: "Autonomie",
          unite: autonomieSerie.unite,
          points: sousEchantillonner(autonomieSerie.points),
        },
      });

      // Sans bail en base : pas de graphe, et l'écran le dit (`bailAbsent`) au lieu d'un chiffre.
      const etatBail = termes
        ? calculerEtatBail({ bail: termes, historiqueOdometre: odoBail, maintenant })
        : null;
      const traceB = etatBail ? traceBail({ etat: etatBail, historique: odoBail }) : null;
      if (etatBail && traceB) {
        grapheBail = {
          trace: traceB,
          resume: resumerBail(etatBail),
          debut: etatBail.debutBail,
          fin: etatBail.finBail,
          limites: etatBail.limites,
        };
      }

    } catch (err) {
      // Un souci d'historique ne vide pas l'écran : on perd le détail, on garde l'état.
      console.error("[accueil] lectures d'historique impossibles", err);
      alertes = construireAlertes({ mesures: etat.mesures });
    }
  }

  if (typePanne) {
    return (
      <Coquille titre="CarAI ne peut pas lire ses données">
        <p className="lead">{messagePanne(typePanne)}</p>
        <p className="hint">
          Une panne, pas une absence de données — les dernières valeurs connues ne sont
          volontairement pas affichées, elles auraient l’air à jour.
        </p>
      </Coquille>
    );
  }

  const silencieux =
    instantane.silenceWebhookHeures !== null &&
    instantane.silenceWebhookHeures >= SEUIL_SILENCE_HEURES;
  const cleGoogle = cleMapsEmbed();
  // ⚠️ Le statut de charge est calculé UNE fois et partagé par le bandeau ET le point de
  // la trappe. Deux appels séparés, c'est deux vérités qui finissent par diverger — et ici
  // elles diraient des heures de fin différentes sur le même écran.
  const statutCharge = statutDeCharge(etat.mesures);
  // Ce que le bandeau disait et que rien d'autre ne porte : le rythme MESURÉ depuis les
  // relevés. Il ne remplace pas l'heure annoncée par la voiture, il la RECOUPE — et une
  // divergence entre les deux est la seule chose qui puisse révéler que la voiture ment.
  const rythmeCharge =
    bandeauCharge?.mode === "estimation"
      ? `Mesuré depuis les relevés : +${bandeauCharge.estimation.rythmePointsParHeure.toFixed(0)} points/h, fin vers ${formatHeure.format(bandeauCharge.estimation.finEstimee)} à ${bandeauCharge.estimation.ciblePourcent} %.`
      : bandeauCharge?.mode === "en-charge"
        ? `Mesuré depuis les relevés : +${Math.round(bandeauCharge.gainPoints)} point${bandeauCharge.gainPoints >= 2 ? "s" : ""} depuis ${formatHeure.format(bandeauCharge.depuis)}.`
        : bandeauCharge?.mode === "limite"
          ? `Limite de charge atteinte (${Math.round(bandeauCharge.ciblePourcent)} % configurés).`
          : null;

  const finCharge = statutCharge.finAnnoncee
    ? {
        heure: formatHeure.format(statutCharge.finAnnoncee.instant),
        duree: dureeCourte(statutCharge.finAnnoncee.minutesRestantes),
      }
    : null;

  return (
    <Coquille titre="Toyota bZ">
      {etat.vide ? (
        <>
          <p className="lead">Aucune donnée du véhicule pour l’instant.</p>
          <p className="hint">
            Connecte le véhicule à Smartcar pour que les données commencent à arriver.{" "}
            <a href="/api/connect">Lancer le Connect</a>
          </p>
        </>
      ) : (
        <>
          {/* ⚠️ QUATRE GROUPES, et le regroupement est la réponse à « trop d'info de
              partout » (Marc, 13/09). Rien n'est retiré ni replié : les douze blocs à plat
              deviennent quatre sujets nommés. Retirer aurait produit du NEUTRE, pas du
              lisible — la leçon est déjà payée ailleurs dans l'écosystème.

              ⚠️ ET LE DESKTOP NE BOUGE PAS. `.grp` vaut `display: contents` au-dessus de
              700 px et les titres y sont masqués : les enfants coulent alors EXACTEMENT
              comme avant, boîte pour boîte. Le regroupement n'existe que là où l'écran est
              étroit, c'est-à-dire là où le problème existe. */}
          <Essentiel
            soc={instantane.batterieSoc?.valeur ?? null}
            enCharge={statutCharge.mode === "en-charge"}
            coutTotal={paiements?.payeContrat ?? null}
            autonomieKm={instantane.autonomieKm}
          />

          <section className="grp grp-voiture" aria-label="La voiture">
            <h2 className="grp-titre">La voiture</h2>

            {/* QUAND datent les données — toujours visible, tout en haut (Marc, 17/08).
                Et juste à côté, de quoi y répondre : `[UI-02]`. Le bouton est ICI parce que
                c'est ici qu'on lit la fraîcheur — la question et le geste au même endroit. */}
            <div className="maj-ligne">
              <DerniereMaj instant={etat.fraicheurMax} />
              <BoutonRafraichir />
            </div>

            {silencieux && (
              <Pastilles>
                <Pastille ton="attention">
                  Aucune donnée depuis {Math.floor(instantane.silenceWebhookHeures!)} h
                </Pastille>
                <InfoTap>
                  Le webhook Smartcar est peut-être désactivé — Smartcar coupe un webhook de
                  lui-même après 6 livraisons en échec. L’état complet du canal se lit sur la
                  page <a href="/donnees">Données</a>.
                </InfoTap>
              </Pastilles>
            )}

            {/* LE HÉROS — la voiture pilotable, la charge, l'autonomie, la carte Google. */}
            {schema && (
              <HerosVoiture
                schema={schema}
                finCharge={finCharge}
                rythmeCharge={rythmeCharge}
                soc={instantane.batterieSoc?.valeur ?? null}
                autonomieKm={instantane.autonomieKm}
                odometreKm={instantane.odometreKm}
                derniereSynchro={etat.fraicheurMax}
                position={dernierePosition}
                vueCarte={vueCarte}
                cleGoogle={cleGoogle}
              />
            )}
          </section>

          <RecommandationAccueil reco={recommander(alertes)} />

          <Alertes alertes={alertes} />

          {bilan && (
            <section className="grp grp-mois" aria-label="Ce mois-ci">
              <h2 className="grp-titre">Ce mois-ci</h2>
              <Tuiles
                bilan={bilan}
                nbTrajetsJour={nbTrajetsJour}
                totaux={totauxMois}
                nbSessions={nbSessionsMois}
                derniere={derniereRecharge}
              />
            </section>
          )}

          {instantane.bail && (
            <section className="grp grp-bail" aria-label="Le bail">
              <h2 className="grp-titre">Le bail</h2>
              <BandeauBail bail={instantane.bail} paiements={paiements} lecture={lectureBail} />
            </section>
          )}
          {instantane.bail === null && (
            <section className="grp grp-bail" aria-label="Le bail">
              <h2 className="grp-titre">Le bail</h2>
              <p className="hint">{MESSAGE_BAIL_NON_RENSEIGNE}</p>
            </section>
          )}

          <h2>
            <IcoCourbe taille={17} />
            Charge et autonomie · {FENETRE_CHARGE_JOURS} derniers jours
          </h2>
          {grapheEtat ? (
            <GraphiqueDouble
              titre={`Charge et autonomie — ${FENETRE_CHARGE_JOURS} derniers jours`}
              trace={grapheEtat}
              explication="Deux ÉCHELLES différentes : la charge à gauche, l’autonomie à droite. Un croisement des deux traits ne veut donc rien dire — ce qu’on lit, c’est la FORME. Quand l’autonomie décroche alors que la charge tient, c’est le froid ou la conduite qui coûtent."
            />
          ) : (
            <p className="hint">
              Pas encore assez de relevés pour tracer la charge et l’autonomie ensemble.
            </p>
          )}

          <h2>
            <IcoCompteur taille={17} />
            Kilométrage vs bail
          </h2>
          {grapheBail && (
            <GraphiqueBail
              trace={grapheBail.trace}
              resume={grapheBail.resume}
              debut={grapheBail.debut}
              fin={grapheBail.fin}
              limites={grapheBail.limites}
            />
          )}
        </>
      )}

      {instantane.bail && instantane.bail.limites.length > 0 && !grapheBail && (
        <ul className="limites">
          {instantane.bail.limites.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}

      {instantane.toyotaDesactive && (
        <p className="hint">
          Source Toyota non officielle désactivée automatiquement. CarAI continue de
          fonctionner sur Smartcar seul.
        </p>
      )}

      <p className="pied">
        <a href="/api/connect">Reconnecter le véhicule</a>
        <span aria-hidden="true"> · </span>
        <a href="/donnees">Données brutes</a>
      </p>
    </Coquille>
  );
}
