// app/donnees/page.tsx — l'onglet « Base de données » : TOUT ce que la base contient.
//
// Trois questions, trois sections, dans cet ordre :
//   1. « Est-ce qu'il MANQUE quelque chose ? » — la base comparée aux 15 signaux confirmés
//      (`SIGNAUX_CONFIRMES_BZ`), chaque absence NOMMÉE. Un tableau de bord ne sait montrer
//      que ce qui existe ; ici on montre aussi ce qui n'arrive pas.
//   2. « Qu'est-ce qu'on a, au juste ? » — les dernières mesures INDIVIDUELLES (fenêtre
//      récente bornée) et l'agrégat par métrique (comptes, première/dernière).
//   3. « Est-ce que ça arrive encore ? » — le journal des livraisons, et l'alerte « les
//      livraisons arrivent mais rien ne s'écrit ».
//
// « En live » : `RafraichissementAuto` re-rend ce Server Component toutes les 30 s avec
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
  valeurAffichable,
  type Periode,
} from "@/lib/vehicle/mesures";
import type { VehicleSnapshot } from "@/lib/db/schema";
import { formaterAge, libelle, nomSource } from "@/lib/vehicle/state";
import { NonAutorise, requireSession } from "@/lib/session";
import { derniereEcritureReussie, retentionRawJours } from "@/lib/smartcar/ingest";
import { SIGNAUX_CONFIRMES_BZ, metriquePourSignal } from "@/lib/smartcar/signals";
import { Onglets } from "@/app/ui/Onglets";
import { RafraichissementAuto } from "./rafraichissement";

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
      <div className="card card-large">
        <p className="eyebrow">hubperso.com · CarAI</p>
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
  filtres: { metrique: string | null; source: string | null; periode: string },
  page?: number,
): string {
  const q = new URLSearchParams();
  if (filtres.metrique) q.set("metrique", filtres.metrique);
  if (filtres.source) q.set("source", filtres.source);
  if (filtres.periode !== "tout") q.set("periode", filtres.periode);
  if (page && page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `?${s}` : "";
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
          DATABASE_URL est absent : aucune donnée ne peut être lue ni enregistrée.
        </p>
      </Coquille>
    );
  }

  // ── Filtres du tableau, lus de l'URL (form GET : lisible, partageable, sans JS) ─────
  const params = await searchParams;
  const filtresUrl = {
    metrique: texteParam(params, "metrique"),
    source: texteParam(params, "source"),
    periode: (texteParam(params, "periode") ?? "tout") as string,
  };
  const pageBrute = Number(texteParam(params, "page") ?? "1");
  const page = Number.isInteger(pageBrute) && pageBrute >= 1 ? pageBrute : 1;
  const instantRequete = new Date();

  let inventaire: LigneInventaire[];
  let livraisons: LigneLivraison[];
  let derniereEcriture: Date | null;
  let mesures: VehicleSnapshot[];
  let totalSelection: number;
  try {
    await assurerMigrations();
    let selection: Awaited<ReturnType<typeof listerMesures>>;
    [inventaire, livraisons, derniereEcriture, selection] = await Promise.all([
      inventaireMesures(),
      journalLivraisons(30),
      derniereEcritureReussie(),
      listerMesures({
        filtres: {
          metricType: filtresUrl.metrique,
          source: filtresUrl.source,
          depuis: depuisPourPeriode(filtresUrl.periode, instantRequete),
        },
        limite: TAILLE_PAGE,
        offset: (page - 1) * TAILLE_PAGE,
      }),
    ]);
    mesures = selection.lignes;
    totalSelection = selection.total;
  } catch (err) {
    console.error("[donnees] lecture impossible", err);
    return (
      <Coquille titre="Base de données">
        <p className="lead">{messagePanne(classerPanne(err))}</p>
      </Coquille>
    );
  }

  const couverture = bilanCouverture(inventaire);
  const maintenant = Date.now();
  const totalMesures = inventaire.reduce((somme, l) => somme + l.nbMesures, 0);
  const retention = retentionRawJours();
  const pages = Math.max(1, Math.ceil(totalSelection / TAILLE_PAGE));
  const metriquesConnues = [...new Set(inventaire.map((l) => l.metricType))].sort();
  const sourcesConnues = [...new Set(inventaire.map((l) => l.source))].sort();

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
      {inventaire.length > 0 && (
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
                {inventaire.map((l) => (
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
          </p>
        </>
      )}

      {/* ── LE TABLEAU : toutes les mesures, filtrables, paginées, exportables ──────── */}
      <h2>Mesures ({totalSelection.toLocaleString("fr-CA")} dans la sélection)</h2>

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
        <button type="submit">Filtrer</button>
        <a href={`/api/donnees/export${queryFiltres(filtresUrl)}`}>
          Exporter la sélection en CSV
        </a>
        <a href="/api/donnees/export">Exporter TOUTE la base en CSV</a>
      </form>

      {mesures.length === 0 ? (
        <p className="hint">Aucune mesure ne correspond à ces filtres.</p>
      ) : (
        <>
          <div className="defilement">
            <table className="tableau">
              <thead>
                <tr>
                  <th scope="col">Mesurée</th>
                  <th scope="col">Métrique</th>
                  <th scope="col">Valeur</th>
                  <th scope="col">Unité</th>
                  <th scope="col">Statut</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {mesures.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDate.format(m.recordedAt)}</td>
                    <td>
                      {libelle(m.metricType)}
                      {m.signalCode ? (
                        <>
                          {" "}
                          <code>{m.signalCode}</code>
                        </>
                      ) : null}
                    </td>
                    <td className="nombre">{valeurAffichable(m)}</td>
                    <td>{m.unit ?? "—"}</td>
                    <td>{m.signalStatus ?? "—"}</td>
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
              <a href={`/donnees${queryFiltres(filtresUrl, page - 1)}`}>← Précédente</a>
            )}{" "}
            {page < pages && (
              <a href={`/donnees${queryFiltres(filtresUrl, page + 1)}`}>Suivante →</a>
            )}
            <br />
            L’écran pagine ; l’export CSV, lui, livre TOUTE la sélection d’un coup — c’est
            le chemin « récupérer toutes mes données ». Une position GPS ne s’affiche pas à
            l’écran ; ses coordonnées sont dans l’export.
          </p>
        </>
      )}

      {/* ── LIVRAISONS RÉCENTES : le rythme d'arrivée, TEST inclus ──────────────────── */}
      {livraisons.length > 0 && (
        <>
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
        </>
      )}
    </Coquille>
  );
}
