// app/analyse/page.tsx — l'onglet Analyse : l'état VIVANT des signaux + les courbes.
//
// Demandes de Marc (06/08/2026) : « liste-moi toutes celles qui marchent pas et surtout
// toutes celles qui marchent, au maximum en live » puis « un onglet d'analyse de toutes
// les données ».
//
//   1. ÉTAT DES SIGNAUX — trois listes calculées de la base à chaque rendu : fonctionne
//      (dernière ligne SUCCESS avec valeur), refusé (dernier statut d'échec, motif
//      affiché), sans valeur (SUCCESS vide). Une bascule OEM se voit au prochain
//      rafraîchissement — personne ne retranscrit de liste à la main.
//   2. GRAPHIQUES — séries numériques rendues en SVG côté SERVEUR : aucune bibliothèque,
//      aucun octet de données brutes envoyé au navigateur au-delà du dessin. Axe Y calé
//      sur min/max réels (étiquetés) ; période via le même sélecteur que /donnees.
//
// « Live » : RafraichissementAuto re-rend le tout aux 30 s. Le plafond de fraîcheur reste
// le véhicule (rafraîchi aux ~20 min par Toyota) et la cadence du webhook.
//
// Server Component derrière le middleware + requireSession. Jamais de 500 : panne classée.

import { redirect } from "next/navigation";
import { baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { classerPanne, messagePanne } from "@/lib/panne";
import {
  SERIES_ANALYSE,
  classerSignal,
  etatDesSignaux,
  serieNumerique,
  sousEchantillonner,
  traceSvg,
  type EtatSignal,
  type TraceSvg,
} from "@/lib/vehicle/analyse";
import { PERIODES, depuisPourPeriode, periodeValide, type Periode } from "@/lib/vehicle/mesures";
import { formaterAge, libelle, nomSource } from "@/lib/vehicle/state";
import { NonAutorise, requireSession } from "@/lib/session";
import { Onglets } from "@/app/ui/Onglets";
import { RafraichissementAuto } from "@/app/donnees/rafraichissement";

export const dynamic = "force-dynamic";

function Coquille({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <main className="shell">
      <div className="card card-large">
        <p className="eyebrow">hubperso.com · CarAI</p>
        <h1>{titre}</h1>
        <Onglets actif="/analyse" />
        {children}
      </div>
    </main>
  );
}

function Graphique({
  titre,
  trace,
  unite,
  decimales,
  nbPoints,
}: {
  titre: string;
  trace: TraceSvg;
  unite: string | null;
  decimales: number;
  nbPoints: number;
}) {
  const fmt = (v: number) => v.toFixed(decimales) + (unite ? ` ${unite}` : "");
  return (
    <figure className="graphique">
      <figcaption>
        <strong>{titre}</strong>{" "}
        <span className="meta">
          {fmt(trace.min)} – {fmt(trace.max)} · {nbPoints} mesures ·{" "}
          {formaterAge((Date.now() - trace.dernier.getTime()) / 60_000)}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${trace.largeur} ${trace.hauteur}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${titre}, de ${fmt(trace.min)} à ${fmt(trace.max)}`}
      >
        <polyline points={trace.polyline} fill="none" strokeWidth="2" stroke="currentColor" />
      </svg>
    </figure>
  );
}

function LigneSignal({ etat }: { etat: EtatSignal }) {
  return (
    <li>
      <span className="libelle">
        {libelle(etat.metricType)} <code>{etat.signalCode}</code>
      </span>
      <span className="valeur">{etat.dernierStatut ?? "—"}</span>
      <span className="meta">
        {nomSource(etat.source)} · {etat.nbMesures.toLocaleString("fr-CA")} mesure(s) ·{" "}
        {formaterAge((Date.now() - etat.derniereMesure.getTime()) / 60_000)}
      </span>
    </li>
  );
}

export default async function Analyse({
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
      <Coquille titre="Analyse">
        <p className="lead">
          DATABASE_URL est absent : aucune donnée ne peut être lue ni analysée.
        </p>
      </Coquille>
    );
  }

  const params = await searchParams;
  const brut = params.periode;
  const periode = periodeValide(Array.isArray(brut) ? brut[0] : brut) as string;
  const depuis = depuisPourPeriode(periode, new Date());

  let signaux: EtatSignal[];
  let graphiques: Array<{
    metricType: string;
    decimales: number;
    unite: string | null;
    nbPoints: number;
    trace: TraceSvg;
  }>;
  try {
    await assurerMigrations();
    const [etats, series] = await Promise.all([
      etatDesSignaux(),
      Promise.all(
        SERIES_ANALYSE.map(async (s) => {
          const { points, unite } = await serieNumerique(s.metricType, { depuis });
          const trace = traceSvg(sousEchantillonner(points));
          return trace
            ? { ...s, unite, nbPoints: points.length, trace }
            : null;
        }),
      ),
    ]);
    signaux = etats;
    // Une série vide n'affiche RIEN plutôt qu'un graphique vide qui aurait l'air cassé —
    // la liste des signaux au-dessus dit déjà ce qui n'arrive pas.
    graphiques = series.filter((s): s is NonNullable<typeof s> => s !== null);
  } catch (err) {
    console.error("[analyse] lecture impossible", err);
    return (
      <Coquille titre="Analyse">
        <p className="lead">{messagePanne(classerPanne(err))}</p>
      </Coquille>
    );
  }

  const fonctionnent = signaux.filter((s) => classerSignal(s) === "fonctionne");
  const refuses = signaux.filter((s) => classerSignal(s) === "refuse");
  const sansValeur = signaux.filter((s) => classerSignal(s) === "sans_valeur");

  return (
    <Coquille titre="Analyse">
      <RafraichissementAuto />

      {signaux.length === 0 && (
        <p className="lead">Aucune donnée en base pour l’instant — rien à analyser.</p>
      )}

      {/* ── CE QUI MARCHE / CE QUI NE MARCHE PAS — vivant, depuis la base ───────────── */}
      {signaux.length > 0 && (
        <>
          <h2>
            Signaux qui fonctionnent ({fonctionnent.length}
            {signaux.length > 0 ? ` sur ${signaux.length} observés` : ""})
          </h2>
          <ul className="mesures">
            {fonctionnent.map((s) => (
              <LigneSignal key={s.signalCode} etat={s} />
            ))}
          </ul>

          {refuses.length > 0 && (
            <>
              <h2>Signaux refusés par le véhicule ({refuses.length})</h2>
              <p className="hint">
                Le motif vient de la source : `ERROR` avec type `COMPATIBILITY` = la bZ ne
                sait pas fournir ce signal (à retirer de la souscription si ça dure),
                `PERMISSION` = débloquable par un re-Connect avec le bon scope.
              </p>
              <ul className="mesures">
                {refuses.map((s) => (
                  <LigneSignal key={s.signalCode} etat={s} />
                ))}
              </ul>
            </>
          )}

          {sansValeur.length > 0 && (
            <>
              <h2>Réponses sans valeur ({sansValeur.length})</h2>
              <p className="hint">
                La source a répondu `SUCCESS` sans donnée exploitable la dernière fois — ni
                un refus, ni une mesure. À surveiller : si ça persiste, le signal ne sert
                à rien.
              </p>
              <ul className="mesures">
                {sansValeur.map((s) => (
                  <LigneSignal key={s.signalCode} etat={s} />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {/* ── GRAPHIQUES ──────────────────────────────────────────────────────────────── */}
      {signaux.length > 0 && (
        <>
          <h2>Courbes</h2>
          <form method="get" className="filtres">
            <label>
              Période{" "}
              <select name="periode" defaultValue={periode}>
                {(Object.keys(PERIODES) as Periode[]).map((p) => (
                  <option key={p} value={p}>
                    {p === "tout" ? "Tout l’historique" : p}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Tracer</button>
          </form>

          {graphiques.length === 0 ? (
            <p className="hint">
              Aucune série numérique sur cette période — élargis la fenêtre, ou attends
              les prochaines livraisons (le véhicule pousse aux ~20 minutes).
            </p>
          ) : (
            graphiques.map((g) => (
              <Graphique
                key={g.metricType}
                titre={libelle(g.metricType)}
                trace={g.trace}
                unite={g.unite}
                decimales={g.decimales}
                nbPoints={g.nbPoints}
              />
            ))
          )}
          <p className="hint">
            Courbes rendues côté serveur (SVG), axe calé sur le min–max réel de la
            période. Les métriques à valeur structurée (pneus, portières, minuteries)
            auront leur extraction dédiée dans une prochaine itération.
          </p>
        </>
      )}
    </Coquille>
  );
}
