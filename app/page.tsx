// app/page.tsx — tableau de bord CarAI.
//
// Server Component : la base et les jetons restent côté serveur, rien ne part au navigateur
// (règle de l'écosystème). La session est revérifiée ici même, en défense en profondeur.
//
// ⚠️ CETTE PAGE NE DOIT JAMAIS RENDRE UN 500. Vécu le 05/08/2026 au tout premier
// chargement : la lecture de `vehicle_snapshots` partait EN PARALLÈLE des migrations et
// gagnait la course sur une base vierge, donnant « Application error: a server-side
// exception has occurred » — un écran qui n'apprend rien et fait chercher au mauvais
// endroit. Tout passe désormais par `collecter()`, qui séquence et n'échoue jamais vers
// l'appelant.
//
// ── CE QUE CET ÉCRAN REFUSE DE FAIRE ─────────────────────────────────────────────────
// Afficher un chiffre qu'il n'a pas. Pas de « 0 % » quand aucune mesure n'est arrivée, pas
// de pourcentage quand l'unité ne permet pas de trancher, pas de valeur sans sa source ni
// son âge. Une donnée du module Toyota est TOUJOURS étiquetée comme telle (Doc 3 §6.1) —
// elle vient d'une source non officielle, et confondre les deux serait leur prêter la même
// fiabilité.

import { redirect } from "next/navigation";
import { collecter } from "@/lib/vehicle/instantane";
import { Onglets } from "@/app/ui/Onglets";
import { formaterAge, formaterValeur, libelle, nomSource } from "@/lib/vehicle/state";
import { resumerBail } from "@/lib/vehicle/lease";
import { messagePanne } from "@/lib/panne";
import { NonAutorise, requireSession } from "@/lib/session";
import { SEUIL_SILENCE_HEURES } from "@/lib/hubSummary";

export const dynamic = "force-dynamic";

function Coquille({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <main className="shell">
      <div className="card">
        <p className="eyebrow">hubperso.com · CarAI</p>
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
    // Une session absente n'est pas une erreur d'application : c'est une redirection.
    // Laisser remonter `NonAutorise` afficherait la page d'erreur générique de Next.
    if (err instanceof NonAutorise) redirect("/login");
    throw err;
  }

  const maintenant = new Date();
  const { instantane, etat, typePanne, messagePanne: detail } = await collecter(maintenant);

  if (typePanne) {
    return (
      <Coquille titre="CarAI ne peut pas lire ses données">
        <p className="lead">{messagePanne(typePanne)}</p>
        <p className="hint">
          Une panne, pas une absence de données — les dernières valeurs connues ne sont
          volontairement pas affichées, elles auraient l’air à jour.
          {detail ? <> <br /> <code>{detail}</code></> : null}
        </p>
      </Coquille>
    );
  }

  const silencieux =
    instantane.silenceWebhookHeures !== null &&
    instantane.silenceWebhookHeures >= SEUIL_SILENCE_HEURES;

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
          {silencieux && (
            <p className="lead" role="status">
              Aucune donnée reçue depuis {Math.floor(instantane.silenceWebhookHeures!)} h. Le
              webhook Smartcar est peut-être désactivé — il se coupe après six échecs de
              livraison, sans rien signaler.
            </p>
          )}

          <ul className="mesures">
            {etat.mesures.map((m) => (
              <li key={`${m.metricType}-${m.source}`}>
                <span className="libelle">{libelle(m.metricType)}</span>
                <span className="valeur">{formaterValeur(m)}</span>
                <span className="meta">
                  {nomSource(m.source)} · {formaterAge(m.ageMinutes)}
                  {m.locationType === "real_time" ? " · temps réel" : ""}
                  {m.locationType === "last_parked" ? " · dernier stationnement" : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {instantane.bail && (
        <p className="hint">
          <strong>Bail :</strong> {resumerBail(instantane.bail)}
          {instantane.bail.limites.length > 0 && (
            <>
              <br />
              {instantane.bail.limites.join(" ")}
            </>
          )}
        </p>
      )}

      {instantane.toyotaDesactive && (
        <p className="hint">
          Source Toyota non officielle désactivée automatiquement. CarAI continue de
          fonctionner sur Smartcar seul.
        </p>
      )}

    </Coquille>
  );
}
