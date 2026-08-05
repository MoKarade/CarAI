// app/page.tsx — tableau de bord CarAI.
//
// Server Component : la base et les jetons restent côté serveur, rien ne part au navigateur
// (règle de l'écosystème). La session est revérifiée ici même, en défense en profondeur.
//
// ── CE QUE CET ÉCRAN REFUSE DE FAIRE ─────────────────────────────────────────────────
// Afficher un chiffre qu'il n'a pas. Pas de « 0 % » quand aucune mesure n'est arrivée, pas
// de pourcentage quand l'unité ne permet pas de trancher, pas de valeur sans sa source ni
// son âge. Une donnée du module Toyota est TOUJOURS étiquetée comme telle (Doc 3 §6.1) —
// elle vient d'une source non officielle, et confondre les deux serait leur prêter la même
// fiabilité.

import { collecterInstantane } from "@/lib/vehicle/instantane";
import { lireEtatVehicule, formaterValeur, libelle, nomSource } from "@/lib/vehicle/state";
import { resumerBail } from "@/lib/vehicle/lease";
import { baseConfiguree } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { SEUIL_SILENCE_HEURES } from "@/lib/hubSummary";

export const dynamic = "force-dynamic";

function age(minutes: number): string {
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${Math.round(minutes)} min`;
  const heures = minutes / 60;
  if (heures < 24) return `il y a ${Math.round(heures)} h`;
  return `il y a ${Math.round(heures / 24)} j`;
}

export default async function Home() {
  await requireSession();

  if (!baseConfiguree()) {
    return (
      <main className="shell">
        <div className="card">
          <p className="eyebrow">CarAI</p>
          <h1>Base de données non configurée</h1>
          <p className="lead">
            <code>DATABASE_URL</code> est absent. Aucune donnée ne peut être lue ni
            enregistrée tant que la base Neon n’est pas branchée.
          </p>
          <p className="hint">
            Ce n’est pas « pas encore de données » : c’est une configuration manquante.
          </p>
        </div>
      </main>
    );
  }

  const maintenant = new Date();
  const [instantane, etat] = await Promise.all([
    collecterInstantane(maintenant),
    lireEtatVehicule(maintenant),
  ]);

  if (instantane.panne) {
    return (
      <main className="shell">
        <div className="card">
          <p className="eyebrow">CarAI</p>
          <h1>CarAI ne peut pas lire ses données</h1>
          <p className="lead">{instantane.panne}</p>
          <p className="hint">
            Une panne, pas une absence de données — les dernières valeurs connues ne sont
            volontairement pas affichées, elles auraient l’air à jour.
          </p>
        </div>
      </main>
    );
  }

  const silencieux =
    instantane.silenceWebhookHeures !== null &&
    instantane.silenceWebhookHeures >= SEUIL_SILENCE_HEURES;

  return (
    <main className="shell">
      <div className="card">
        <p className="eyebrow">hubperso.com · CarAI</p>
        <h1>Toyota bZ</h1>

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
                Aucune donnée reçue depuis{" "}
                {Math.floor(instantane.silenceWebhookHeures!)} h. Le webhook Smartcar est
                peut-être désactivé — il se coupe après six échecs de livraison, sans rien
                signaler.
              </p>
            )}

            <ul className="mesures">
              {etat.mesures.map((m) => (
                <li key={`${m.metricType}-${m.source}`}>
                  <span className="libelle">{libelle(m.metricType)}</span>
                  <span className="valeur">{formaterValeur(m)}</span>
                  <span className="meta">
                    {nomSource(m.source)} · {age(m.ageMinutes)}
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
      </div>
    </main>
  );
}
