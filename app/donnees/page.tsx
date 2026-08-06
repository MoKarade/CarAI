// app/donnees/page.tsx — inventaire de ce que la base contient, signal par signal.
//
// Existe pour répondre à UNE question qu'aucun tableau de bord ne sait poser : « est-ce
// qu'il MANQUE quelque chose ? ». L'accueil montre les dernières valeurs — une métrique
// jamais reçue n'y laisse aucune trace. Ici, la base est comparée à la liste des signaux
// que la bZ a confirmés (`SIGNAUX_CONFIRMES_BZ`) et chaque absence est NOMMÉE.
//
// Server Component derrière le middleware d'auth (aucune exclusion ajoutée au matcher) +
// revérification de session ici même — le patron de l'écosystème. La position GPS n'est
// PAS affichée sur cette page : l'inventaire parle de comptes et de dates, pas de valeurs
// sensibles.
//
// ⚠️ Comme l'accueil : ne JAMAIS rendre un 500. Panne classée → écran honnête.

import Link from "next/link";
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
import { formaterAge, libelle, nomSource } from "@/lib/vehicle/state";
import { NonAutorise, requireSession } from "@/lib/session";
import { derniereEcritureReussie, retentionRawJours } from "@/lib/smartcar/ingest";
import { SIGNAUX_CONFIRMES_BZ, metriquePourSignal } from "@/lib/smartcar/signals";

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
        {children}
        <p className="hint">
          <Link href="/">← Retour au tableau de bord</Link>
        </p>
      </div>
    </main>
  );
}

export default async function Donnees() {
  try {
    await requireSession();
  } catch (err) {
    if (err instanceof NonAutorise) redirect("/login");
    throw err;
  }

  if (!baseConfiguree()) {
    return (
      <Coquille titre="Inventaire des données">
        <p className="lead">
          DATABASE_URL est absent : aucune donnée ne peut être lue ni enregistrée.
        </p>
      </Coquille>
    );
  }

  let inventaire: LigneInventaire[];
  let livraisons: LigneLivraison[];
  let derniereEcriture: Date | null;
  try {
    await assurerMigrations();
    [inventaire, livraisons, derniereEcriture] = await Promise.all([
      inventaireMesures(),
      journalLivraisons(30),
      derniereEcritureReussie(),
    ]);
  } catch (err) {
    console.error("[donnees] lecture impossible", err);
    return (
      <Coquille titre="Inventaire des données">
        <p className="lead">{messagePanne(classerPanne(err))}</p>
      </Coquille>
    );
  }

  const couverture = bilanCouverture(inventaire);
  const maintenant = Date.now();
  const totalMesures = inventaire.reduce((somme, l) => somme + l.nbMesures, 0);
  const retention = retentionRawJours();

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
    <Coquille titre="Inventaire des données">
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
