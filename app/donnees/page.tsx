// app/donnees/page.tsx — l'onglet « Base de données » : TOUT ce que la base contient.
//
// Quatre questions, dans cet ordre :
//   0. « Le CANAL est-il vivant ? » — l'état du webhook Smartcar (`PanneauWebhook`), en
//      TÊTE : un webhook désactivé ou sans abonné explique toutes les absences listées en
//      dessous, et lire « il manque 6 signaux » sans le savoir envoie chercher au mauvais
//      endroit.
//   1. « Est-ce qu'il MANQUE quelque chose ? » — la base comparée aux signaux confirmés
//      (`SIGNAUX_CONFIRMES_BZ` fait foi, le compte y vit et y évolue), chaque absence NOMMÉE. Un tableau de bord ne sait montrer
//      que ce qui existe ; ici on montre aussi ce qui n'arrive pas.
//   2. « Qu'est-ce qu'on a, au juste ? » — les dernières mesures INDIVIDUELLES (fenêtre
//      récente bornée) et l'agrégat par métrique (comptes, première/dernière).
//   3. « Est-ce que ça arrive encore ? » — la cadence du poll (`CadencePoll`, les passages
//      SAUTÉS), le journal des livraisons, et l'alerte « les livraisons arrivent mais rien
//      ne s'écrit ».
//
// ⚠️ Les deux panneaux de santé regardent des choses DIFFÉRENTES et se complètent :
// `PanneauWebhook` juge le canal PUSH (Smartcar livre-t-il ?), `CadencePoll` juge le canal
// PULL (le cron va-t-il chercher au rythme promis ?). L'un vert et l'autre rouge est un
// état parfaitement possible — c'est justement pour ça qu'ils sont séparés.
//
// « En live » : `RafraichissementAuto` re-rend ce Server Component toutes les 15 min (onglet visible seulement) avec
// des données fraîches — la page reste server-side, rien de la base ne part au navigateur
// en dehors du HTML rendu.
//
// Server Component derrière le middleware d'auth (aucune exclusion ajoutée au matcher) +
// revérification de session ici même — le patron de l'écosystème. Le CONTENU d'une
// position GPS n'est pas affiché (une ligne `location` montre « détail en base », jamais
// les coordonnées).
//
// ⚠️ Comme l'accueil : ne JAMAIS rendre un 500. Panne classée → écran honnête.

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { classerPanne, messagePanne } from "@/lib/panne";
import {
  bilanCouverture,
  inventaireMesures,
  journalLivraisons,
  type LigneInventaire,
  type LigneLivraison,
} from "@/lib/vehicle/inventaire";
import {
  PERIODES,
  depuisPourPeriode,
  listerMesures,
  pageEffective,
  periodeValide,
  valeurAffichable,
  type Periode,
} from "@/lib/vehicle/mesures";
import type { VehicleSnapshot } from "@/lib/db/schema";
import { formaterAge, libelle, nomSource } from "@/lib/vehicle/state";
import { NonAutorise, requireSession } from "@/lib/session";
import { derniereEcritureReussie, retentionRawJours } from "@/lib/smartcar/ingest";
import { SIGNAUX_CONFIRMES_BZ, metriquePourSignal } from "@/lib/smartcar/signals";
import { Onglets } from "@/app/ui/Onglets";
import { GraphiquesLies } from "@/app/ui/GraphiquesLies";
import {
  CADENCE_POLL_MINUTES,
  analyserCadence,
  consequenceCadence,
  graviteCadence,
  seuilOubliMinutes,
  type Cadence,
} from "@/lib/vehicle/cadence";
import { passagesRecents } from "@/lib/vehicle/pollJournal";
import {
  decimalesPour,
  serieNumerique,
  sousEchantillonner,
  traceSvg,
  type TraceSvg,
  type PointSerie,
} from "@/lib/vehicle/analyse";
import { abonnerVehicule, etatWebhook } from "@/lib/smartcar/webhookDiagnostic";
import type { Verdict } from "@/lib/smartcar/webhookEtat";
import { RafraichissementAuto } from "./rafraichissement";
import { MESSAGES_ABONNEMENT, PanneauWebhook } from "./webhook";

/**
 * Seuils de la détection « le pipeline n'écrit plus » : des livraisons dans les dernières
 * 24 h mais AUCUNE écriture depuis 48 h. La déduplication rend « 0 écrit » normal sur
 * quelques heures ; sur deux jours, un véhicule qui livre sans qu'une seule mesure change
 * n'existe pas — c'est la signature d'une enveloppe qui a changé ou d'un mapping cassé.
 */
const FENETRE_LIVRAISON_RECENTE_H = 24;
const SEUIL_ECRITURE_SILENCIEUSE_H = 48;

export const dynamic = "force-dynamic";

/** Fuseau de Marc : les dates affichées sont les siennes, jamais l'UTC de Vercel (leçon JobAI). */
const FUSEAU = "America/Toronto";

const formatDate = new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU,
  dateStyle: "medium",
  timeStyle: "short",
});

function Coquille({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <main className="shell">
      <div className="carte carte-large">
        <h1>{titre}</h1>
        <Onglets actif="/donnees" />
        {children}
      </div>
    </main>
  );
}

/** Taille d'une page du tableau. L'export CSV, lui, n'a pas de page : il livre tout. */
const TAILLE_PAGE = 100;

type ParametresRecherche = Record<string, string | string[] | undefined>;

function texteParam(params: ParametresRecherche, cle: string): string | null {
  const v = params[cle];
  const texte = Array.isArray(v) ? v[0] : v;
  return texte?.trim() || null;
}

/** Reconstruit la query string des filtres — pour l'export et la pagination. */
function queryFiltres(
  filtres: { metrique: string | null; source: string | null; periode: string; tout?: boolean },
  page?: number,
): string {
  const q = new URLSearchParams();
  if (filtres.metrique) q.set("metrique", filtres.metrique);
  if (filtres.source) q.set("source", filtres.source);
  if (filtres.periode !== "tout") q.set("periode", filtres.periode);
  if (filtres.tout) q.set("tout", "1");
  if (page && page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `?${s}` : "";
}

/**
 * Origine de la requête courante, reconstruite depuis les en-têtes.
 *
 * Ne sert que de REPLI : `callbackAttendu` préfère l'origine canonique déclarée dans
 * `SMARTCAR_REDIRECT_URI`. Sans ce repli, une instance sans variable déclarée ne saurait
 * pas contre quelle adresse comparer le callback du webhook.
 */
async function origineRequete(): Promise<string> {
  const h = await headers();
  const hote = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const protocole = h.get("x-forwarded-proto") ?? (hote.startsWith("localhost") ? "http" : "https");
  return `${protocole}://${hote}`;
}

/**
 * Abonne le véhicule au webhook CarAI.
 *
 * ⚠️ Server Action = point d'entrée POST à part entière : la session se REVÉRIFIE ici,
 * jamais « puisque le bouton n'est affiché qu'aux gens connectés » (même garde que les
 * commandes véhicule). Le retour passe par un CODE dans l'URL, dont le message est choisi
 * dans une table fixe — une phrase ne se fabrique pas en trafiquant une query string.
 */
async function abonner(): Promise<void> {
  "use server";

  try {
    await requireSession();
  } catch {
    redirect("/donnees?abonnement=session");
  }

  const code = await abonnerVehicule(await origineRequete());
  revalidatePath("/donnees");
  redirect(`/donnees?abonnement=${code}`);
}

/**
 * LA CADENCE DU POLL — ce qui manque, et ce que ça fait disparaître.
 *
 * Placé AVANT les livraisons du webhook : le webhook ne se déclenche que sur changement,
 * donc son silence est normal. C'est le poll qui garantit qu'on apprend quelque chose
 * régulièrement, et c'est LUI dont les absences font disparaître recharges et trajets.
 */
function CadencePoll({ cadence }: { cadence: Cadence }) {
  const gravite = graviteCadence(cadence);
  const consequence = consequenceCadence(cadence);

  if (cadence.aucunHistorique) {
    return (
      <>
        <h2>Cadence du poll</h2>
        <p className="hint">
          Aucun passage enregistré pour l’instant. La surveillance vient d’être installée :
          les passages s’inscriront au fil des exécutions. Ce n’est pas une panne — c’est un
          historique vide, ce qui est différent.
        </p>
      </>
    );
  }

  const pct = Math.round(cadence.couverture * 100);
  const median =
    cadence.ecartMedianMinutes !== null ? `${Math.round(cadence.ecartMedianMinutes)} min` : "—";

  return (
    <>
      <h2>Cadence du poll</h2>
      <ul className="chiffres" data-gravite={gravite}>
        <li>
          <span className="etiquette">Passages (24 h)</span>
          <span className="nombre">
            {cadence.nbPassages} / {cadence.nbAttendus}
          </span>
        </li>
        <li>
          <span className="etiquette">Couverture</span>
          <span className="nombre">{pct} %</span>
        </li>
        <li>
          <span className="etiquette">Écart médian</span>
          <span className="nombre">{median}</span>
        </li>
        <li>
          <span className="etiquette">Oublis</span>
          <span className="nombre">{cadence.trous.length}</span>
        </li>
      </ul>

      <p className="hint">
        Cadence visée : {CADENCE_POLL_MINUTES} min. Un écart au-delà de{" "}
        {seuilOubliMinutes()} min compte comme un passage SAUTÉ, pas comme un retard.
        {cadence.enRetardMaintenant && cadence.depuisDernierMinutes !== null ? (
          <>
            {" "}
            <strong>
              Aucun passage depuis {Math.round(cadence.depuisDernierMinutes)} min.
            </strong>
          </>
        ) : null}
      </p>

      {consequence && <p className="hint">{consequence}</p>}

      {cadence.trous.length > 0 && (
        <div className="defilement">
          <table className="tableau">
            <thead>
              <tr>
                <th scope="col">Silence de</th>
                <th scope="col">à</th>
                <th scope="col" className="nombre">Durée</th>
                <th scope="col" className="nombre">Passages sautés</th>
              </tr>
            </thead>
            <tbody>
              {cadence.trous.slice(0, 12).map((t) => (
                <tr key={t.debut.toISOString()}>
                  <td>{formatDate.format(t.debut)}</td>
                  <td>{formatDate.format(t.fin)}</td>
                  <td className="nombre">{Math.round(t.minutes)} min</td>
                  <td className="nombre">{t.passagesManques}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="hint">
        La cause est en amont de CarAI : les déclenchements programmés de GitHub Actions sont
        best-effort — mis en file sur une infrastructure partagée, retardés sous charge, et
        parfois abandonnés. Ce tableau ne les corrige pas, il les rend VISIBLES.
      </p>
    </>
  );
}

export default async function Donnees({
  searchParams,
}: {
  searchParams: Promise<ParametresRecherche>;
}) {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof NonAutorise) redirect("/login");
    throw err;
  }

  if (!baseConfiguree()) {
    return (
      <Coquille titre="Base de données">
        <p className="lead">
          La base de données n’est pas branchée : aucune donnée ne peut être lue ni enregistrée.
        </p>
      </Coquille>
    );
  }

  // ── Filtres du tableau, lus de l'URL (form GET : lisible, partageable, sans JS) ─────
  // La période est NORMALISÉE tout de suite : un `?periode=48h` inconnu (signet périmé,
  // faute de frappe) doit se LIRE « tout l'historique » partout — sélecteur compris —
  // plutôt qu'afficher « 24h » au-dessus d'une table qui couvre tout (revue du 06/08).
  const params = await searchParams;
  const filtresUrl = {
    metrique: texteParam(params, "metrique"),
    source: texteParam(params, "source"),
    periode: periodeValide(texteParam(params, "periode")) as string,
    // Défaut : SEULEMENT les lignes qui portent une valeur. `?tout=1` rouvre les traces
    // de refus, utiles au diagnostic mais qui noient les vraies mesures (58 signaux en
    // échec sur 74 : le tableau était aux trois quarts vide).
    tout: texteParam(params, "tout") === "1",
  };
  const pageBrute = Number(texteParam(params, "page") ?? "1");
  const pageDemandee = Number.isInteger(pageBrute) && pageBrute >= 1 ? pageBrute : 1;
  const instantRequete = new Date();
  const filtresRequete = {
    metricType: filtresUrl.metrique,
    source: filtresUrl.source,
    depuis: depuisPourPeriode(filtresUrl.periode, instantRequete),
    avecValeurSeulement: !filtresUrl.tout,
  };

  // Le message de retour d'abonnement : un CODE de l'URL traduit par une table FIXE.
  // Un code inconnu ne rend rien plutôt qu'une phrase vide ou brute.
  const messageAbonnement = MESSAGES_ABONNEMENT[texteParam(params, "abonnement") ?? ""] ?? null;

  let inventaire: LigneInventaire[];
  let livraisons: LigneLivraison[];
  let cadence: Cadence;
  let derniereEcriture: Date | null;
  let mesures: VehicleSnapshot[];
  let totalSelection: number;
  let verdictWebhook: Verdict | null = null;
  let page = pageDemandee;
  // ⚠️ La courbe n'existe QUE quand une métrique est sélectionnée. Tracer « toutes les
  // métriques » superposerait des kilomètres, des pourcentages et des kilopascals sur un
  // même axe : un graphique qui ne veut rien dire est pire qu'une absence de graphique.
  let courbe: {
    trace: TraceSvg;
    unite: string | null;
    nbPoints: number;
    /** Points bruts pour le rendu zoomable côté client. */
    points: PointSerie[];
  } | null = null;
  try {
    await assurerMigrations();
    let selection: Awaited<ReturnType<typeof listerMesures>>;
    let passages: Awaited<ReturnType<typeof passagesRecents>>;
    [inventaire, livraisons, derniereEcriture, selection, passages] = await Promise.all([
      inventaireMesures(),
      journalLivraisons(30),
      derniereEcritureReussie(),
      listerMesures({
        filtres: filtresRequete,
        limite: TAILLE_PAGE,
        offset: (pageDemandee - 1) * TAILLE_PAGE,
      }),
      // Le journal des passages du poll : c'est lui qui rend un cron sauté détectable.
      passagesRecents(24),
    ]);
    totalSelection = selection.total ?? 0;
    cadence = analyserCadence({ passages, maintenant: new Date() });

    // Page au-delà de la fin (vieux lien, sélection rétrécie sous le rafraîchissement
    // auto) : on sert la DERNIÈRE page réelle plutôt qu'un faux « aucune mesure » sans
    // lien de retour (revue du 06/08).
    page = pageEffective(pageDemandee, totalSelection, TAILLE_PAGE);
    if (page !== pageDemandee) {
      selection = await listerMesures({
        filtres: filtresRequete,
        limite: TAILLE_PAGE,
        offset: (page - 1) * TAILLE_PAGE,
      });
    }
    mesures = selection.lignes;

    if (filtresUrl.metrique) {
      // MÊME sélection que le tableau (métrique, source, période) : une courbe qui
      // couvrirait plus large que les lignes en dessous mentirait sur ce qu'on regarde.
      const { points, unite } = await serieNumerique(filtresUrl.metrique, {
        depuis: filtresRequete.depuis,
        source: filtresUrl.source,
      });
      const trace = traceSvg(sousEchantillonner(points));
      // Pas de points numériques (métrique textuelle, structurée, ou refusée) : aucune
      // courbe. Le tableau reste, lui, parfaitement lisible.
      // Points BRUTS conservés : le composant zoomable projette lui-même dans la
      // fenêtre visible, le tracé serveur ne sert plus qu'aux bornes.
      if (trace)
        courbe = { trace, unite, nbPoints: points.length, points: sousEchantillonner(points, 1500) };
    }
  } catch (err) {
    console.error("[donnees] lecture impossible", err);
    return (
      <Coquille titre="Base de données">
        <p className="lead">{messagePanne(classerPanne(err))}</p>
      </Coquille>
    );
  }

  // ── Diagnostic du webhook, dans SON PROPRE try ──────────────────────────────────────
  // Il interroge un service tiers ; le mêler au bloc précédent ferait tomber toute la page
  // sur une indisponibilité de Smartcar, alors que la base — le sujet de cet écran — se
  // lit parfaitement. Panne ici ⇒ pas de panneau, et le reste s'affiche.
  try {
    verdictWebhook = await etatWebhook(await origineRequete());
  } catch (err) {
    console.error("[donnees] diagnostic webhook impossible", err);
  }

  const couverture = bilanCouverture(inventaire);
  // eslint-disable-next-line react-hooks/purity -- Server Component (page force-dynamic) : rendu une fois par requête, l'âge affiché EST celui de la requête.
  const maintenant = Date.now();
  // Les lignes qui n'ont JAMAIS porté de valeur ne s'affichent plus (choix de Marc,
  // 18/08 : « retirer les sections toujours vides ») — leur historique a été purgé par la
  // migration 0005, mais une livraison peut en recréer au compte-gouttes. Ce qui MANQUE
  // reste nommé plus haut, par `bilanCouverture` : masquer ≠ taire.
  const inventaireUtile = inventaire.filter((l) => l.nbValeurs > 0);
  const totalMesures = inventaireUtile.reduce((somme, l) => somme + l.nbMesures, 0);
  const nbLignesSansValeur = inventaire.length - inventaireUtile.length;
  const retention = retentionRawJours();
  const pages = Math.max(1, Math.ceil(totalSelection / TAILLE_PAGE));
  // Les sélecteurs reflètent le filtre RÉELLEMENT appliqué : une valeur d'URL absente des
  // options connues y est AJOUTÉE — sinon le navigateur retombe sur « Toutes » pendant
  // que la table, elle, filtre (revue du 06/08).
  const metriquesConnues = [...new Set(inventaire.map((l) => l.metricType))].sort();
  if (filtresUrl.metrique && !metriquesConnues.includes(filtresUrl.metrique)) {
    metriquesConnues.push(filtresUrl.metrique);
  }
  const sourcesConnues = [...new Set(inventaire.map((l) => l.source))].sort();
  if (filtresUrl.source && !sourcesConnues.includes(filtresUrl.source)) {
    sourcesConnues.push(filtresUrl.source);
  }

  // « Livraisons récentes mais plus AUCUNE écriture » : la panne muette par excellence.
  // Le bandeau de couverture est cumulatif à vie — un flux qui a cessé d'écrire y reste
  // vert. Cette alerte-ci regarde le PRÉSENT.
  const derniereLivraison = livraisons[0]?.receivedAt ?? null;
  const fluxMuet =
    derniereLivraison !== null &&
    maintenant - derniereLivraison.getTime() < FENETRE_LIVRAISON_RECENTE_H * 3_600_000 &&
    (derniereEcriture === null ||
      maintenant - derniereEcriture.getTime() > SEUIL_ECRITURE_SILENCIEUSE_H * 3_600_000);

  return (
    <Coquille titre="Base de données">
      <RafraichissementAuto />

      {/* ── FLUX MUET : prime sur tout, y compris le bandeau vert ───────────────────── */}
      {fluxMuet && (
        <p className="lead" role="alert">
          Les livraisons Smartcar arrivent, mais PLUS RIEN ne s’écrit
          {derniereEcriture
            ? ` depuis ${formaterAge((maintenant - derniereEcriture.getTime()) / 60_000).replace("il y a ", "")}`
            : " (aucune écriture réussie en base)"}
          . Sur deux jours, ce n’est pas la déduplication : l’enveloppe Smartcar a
          probablement changé. Les payloads bruts des livraisons concernées sont conservés
          (la purge s’arrête d’elle-même tant que rien ne s’écrit) — rien n’est perdu, mais
          il faut corriger la lecture.
        </p>
      )}

      {/* ── LE CANAL, AVANT SON CONTENU ─────────────────────────────────────────────────
          Placé au-dessus de la couverture délibérément : un webhook désactivé explique
          TOUTES les absences listées en dessous. Lire « il manque 6 signaux » sans savoir
          que plus rien n'est livré depuis trois jours envoie chercher au mauvais endroit. */}
      {verdictWebhook && (
        <PanneauWebhook
          verdict={verdictWebhook}
          message={messageAbonnement}
          abonner={abonner as unknown as (form: FormData) => void}
        />
      )}

      {/* ── COUVERTURE : la ligne à lire en premier ─────────────────────────────────── */}
      {couverture.manquants.length === 0 && couverture.recus.length > 0 && !fluxMuet && (
        <p className="lead" role="status">
          Les {SIGNAUX_CONFIRMES_BZ.length} signaux confirmés de la bZ sont tous présents en
          base. Aucune donnée attendue ne manque.
        </p>
      )}
      {couverture.manquants.length > 0 && (
        <>
          <p className="lead" role="status">
            {couverture.recus.length}/{SIGNAUX_CONFIRMES_BZ.length} signaux confirmés
            présents en base. Jamais reçus :
          </p>
          <ul className="mesures">
            {couverture.manquants.map((code) => (
              <li key={code}>
                <span className="libelle">{libelle(metriquePourSignal(code))}</span>
                <span className="valeur">absent</span>
                <span className="meta">
                  <code>{code}</code> — confirmé fonctionnel le 06/08/2026, aucune mesure en
                  base. Vérifier la souscription du webhook côté Smartcar.
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {inventaire.length === 0 && (
        <p className="lead">Aucune mesure en base pour l’instant.</p>
      )}
      {couverture.horsListe.length > 0 && (
        <p className="hint">
          Signaux stockés hors liste de référence (rien d’anormal, mais ça se dit) :{" "}
          {couverture.horsListe.map((c, i) => (
            <span key={c}>
              {i > 0 ? ", " : ""}
              <code>{c}</code>
            </span>
          ))}
        </p>
      )}

      {/* ── INVENTAIRE PAR MÉTRIQUE ─────────────────────────────────────────────────── */}
      {inventaireUtile.length > 0 && (
        <>
          <h2>Mesures conservées ({totalMesures.toLocaleString("fr-CA")})</h2>
          <div className="defilement">
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Métrique</th>
                  <th scope="col">Source</th>
                  <th scope="col" className="nombre">Mesures</th>
                  <th scope="col">Première</th>
                  <th scope="col">Dernière</th>
                </tr>
              </thead>
              <tbody>
                {inventaireUtile.map((l) => (
                  <tr key={`${l.source}-${l.metricType}-${l.signalCode}`}>
                    <td>
                      {libelle(l.metricType)}
                      {l.signalCode ? (
                        <>
                          {" "}
                          <code>{l.signalCode}</code>
                        </>
                      ) : null}
                    </td>
                    <td>{nomSource(l.source)}</td>
                    <td className="nombre">{l.nbMesures.toLocaleString("fr-CA")}</td>
                    <td>{formatDate.format(l.premiere)}</td>
                    <td>
                      {formaterAge((maintenant - l.derniere.getTime()) / 60_000)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Chaque mesure est conservée pour toujours — la déduplication (une ligne par
            instant de mesure du véhicule) est passée avant l’écriture, donc ces comptes
            grandissent au rythme du véhicule, pas au rythme des livraisons.
            {nbLignesSansValeur > 0
              ? ` ${nbLignesSansValeur} signal(aux) sans aucune valeur ne sont pas listés (la voiture ne les fournit pas) — les absences qui comptent sont nommées plus haut.`
              : ""}
          </p>
        </>
      )}

      {/* ── LE TABLEAU : toutes les mesures, filtrables, paginées, exportables ──────── */}
      <h2>
        {filtresUrl.tout ? "Toutes les lignes" : "Mes données"} (
        {totalSelection.toLocaleString("fr-CA")})
      </h2>
      <p className="hint">
        {filtresUrl.tout ? (
          <>
            Les traces de refus sont incluses — une ligne par signal que la voiture ne
            fournit pas, sans valeur. Utile pour comprendre un trou dans une série.{" "}
            <a href={`/donnees${queryFiltres({ ...filtresUrl, tout: false })}`}>
              Revenir à mes données seulement
            </a>
            .
          </>
        ) : (
          <>
            Seules les lignes qui portent une <strong>valeur réelle</strong> sont affichées.
            La bZ refuse 58 des 74 signaux interrogés : leurs traces restent en base mais
            elles noieraient tes mesures.{" "}
            <a href={`/donnees${queryFiltres({ ...filtresUrl, tout: true })}`}>
              Afficher aussi les refus
            </a>
            .
          </>
        )}
      </p>

      <form method="get" className="filtres">
        <label>
          Métrique{" "}
          <select name="metrique" defaultValue={filtresUrl.metrique ?? ""}>
            <option value="">Toutes</option>
            {metriquesConnues.map((m) => (
              <option key={m} value={m}>
                {libelle(m)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source{" "}
          <select name="source" defaultValue={filtresUrl.source ?? ""}>
            <option value="">Toutes</option>
            {sourcesConnues.map((s) => (
              <option key={s} value={s}>
                {nomSource(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Période{" "}
          <select name="periode" defaultValue={filtresUrl.periode}>
            {(Object.keys(PERIODES) as Periode[]).map((p) => (
              <option key={p} value={p}>
                {p === "tout" ? "Tout l’historique" : p}
              </option>
            ))}
          </select>
        </label>
        {/* Le drapeau voyage avec le formulaire, sinon filtrer par métrique ferait
            retomber discrètement sur le défaut et « perdrait » les refus qu'on regardait. */}
        {filtresUrl.tout && <input type="hidden" name="tout" value="1" />}
        <button type="submit">Filtrer</button>
        <a href={`/api/donnees/export${queryFiltres(filtresUrl)}`}>
          Exporter la sélection en CSV
        </a>
        <a href="/api/donnees/export">Exporter TOUTE la base en CSV</a>
      </form>

      {/* LA COURBE DE LA MÉTRIQUE SÉLECTIONNÉE (Marc, 13/08 : « uniquement des données en
          tableau Excel avec la possibilité de faire des graphs »). Elle apparaît dès qu'une
          métrique NUMÉRIQUE est filtrée — le geste est donc le filtre lui-même, il n'y a pas
          un second réglage à comprendre, et elle se place JUSTE APRÈS le formulaire : on
          choisit, on voit, puis on lit le détail ligne à ligne. */}
      {courbe && (
        <GraphiquesLies
          series={[
            {
              id: `donnees-${filtresUrl.metrique}`,
              titre: libelle(filtresUrl.metrique!),
              points: courbe.points,
              unite: courbe.unite,
              decimales: decimalesPour(courbe.trace.min, courbe.trace.max),
              teinte: 1,
              explication:
                "Même sélection que le tableau ci-dessous, réduite aux relevés chiffrés. Survole pour lire une valeur et son heure, molette ou brosse pour zoomer.",
            },
          ]}
          hauteurCourbe={180}
        />
      )}
      {filtresUrl.metrique && !courbe && (
        <p className="hint">
          Pas de courbe ici : cette sélection ne contient aucune valeur numérique à tracer
          (donnée d’état, position, ou signal refusé par la voiture). Le tableau, lui, reste
          complet.
        </p>
      )}

      {totalSelection === 0 ? (
        <p className="hint">
          Aucune mesure ne correspond à ces filtres.
          {!filtresUrl.tout && (
            <>
              {" "}
              Il existe peut-être des lignes SANS valeur (signaux refusés) :{" "}
              <a href={`/donnees${queryFiltres({ ...filtresUrl, tout: true })}`}>
                les afficher
              </a>
              .
            </>
          )}
        </p>
      ) : (
        <>
          <div className="defilement">
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Date et heure</th>
                  <th scope="col">Donnée</th>
                  <th scope="col">Valeur</th>
                  <th scope="col">Unité</th>
                  {filtresUrl.tout && <th scope="col">Statut</th>}
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {mesures.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDate.format(m.recordedAt)}</td>
                    {/* Le libellé FRANÇAIS d'abord, le code technique en second et en
                        petit : c'est « Charge de la batterie » qu'on cherche dans un
                        tableau, pas « tractionbattery-stateofcharge ». */}
                    <td>
                      {libelle(m.metricType)}
                      {m.signalCode ? <span className="code-discret">{m.signalCode}</span> : null}
                    </td>
                    <td className="nombre">{valeurAffichable(m)}</td>
                    <td>{m.unit ?? "—"}</td>
                    {filtresUrl.tout && <td>{m.signalStatus ?? "—"}</td>}
                    <td>{nomSource(m.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="hint">
            Page {page} sur {pages} — lignes{" "}
            {((page - 1) * TAILLE_PAGE + 1).toLocaleString("fr-CA")} à{" "}
            {Math.min(page * TAILLE_PAGE, totalSelection).toLocaleString("fr-CA")} sur{" "}
            {totalSelection.toLocaleString("fr-CA")}.{" "}
            {page > 1 && (
              <a rel="prev" href={`/donnees${queryFiltres(filtresUrl, page - 1)}`}>
                ← Précédente
              </a>
            )}{" "}
            {page < pages && (
              <a rel="next" href={`/donnees${queryFiltres(filtresUrl, page + 1)}`}>
                Suivante →
              </a>
            )}
            <br />
            L’écran pagine ; l’export CSV, lui, livre TOUTE la sélection d’un coup — c’est
            le chemin « récupérer toutes mes données ». Une position GPS ne s’affiche pas à
            l’écran ; ses coordonnées sont dans l’export.
          </p>
        </>
      )}

      {/* Cadence du poll et livraisons du webhook côte à côte sur PC (`.colonnes-pc`,
          globals.css) : les deux répondent à « les données arrivent-elles ? ». */}
      <div className="colonnes-pc">
        <section>
          <CadencePoll cadence={cadence} />
        </section>

        {/* ── LIVRAISONS RÉCENTES : le rythme d'arrivée, TEST inclus ──────────────────── */}
        {livraisons.length > 0 && (
          <section>
            <h2>Dernières livraisons du webhook</h2>
            <div className="defilement">
              <table className="tableau">
                <thead>
                  <tr>
                    <th scope="col">Reçue</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="nombre">Nouvelles mesures</th>
                  </tr>
                </thead>
                <tbody>
                  {livraisons.map((l) => (
                    <tr key={l.eventId}>
                      <td>{formatDate.format(l.receivedAt)}</td>
                      <td>
                        {l.eventType}
                        {l.eventType.endsWith("_TEST") ? " (simulée, non enregistrée)" : ""}
                      </td>
                      <td className="nombre">{l.snapshotsWritten}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="hint">
              « 0 nouvelle mesure » est le cas normal quand le véhicule n’a pas rafraîchi ses
              données entre deux livraisons. C’est l’absence de livraison pendant des heures
              qui serait un signal de panne.
              {retention > 0
                ? ` Le JSON brut de transport est vidé après ${retention} jours — jamais au-delà de la dernière écriture réussie, et les mesures, elles, sont conservées à vie.`
                : " Le JSON brut de transport est conservé sans limite (WEBHOOK_RAW_RETENTION_JOURS=0)."}
            </p>
          </section>
        )}
      </div>
    </Coquille>
  );
}
