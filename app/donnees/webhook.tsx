// app/donnees/webhook.tsx — le panneau « le webhook est-il vivant ? ».
//
// Ce panneau répond à la moitié de la question de Marc que le poll ne couvre pas. Le poll
// détecte ses propres passages sautés ; personne ne surveillait le CANAL PRINCIPAL. Or
// Smartcar désactive un webhook tout seul après six livraisons en échec (Doc 2 §6.4) : le
// flux peut être coupé DÉFINITIVEMENT sans qu'aucun écran ne devienne rouge.
//
// Le verdict vient d'une fonction PURE (`diagnostiquerWebhooks`) ; ce fichier ne fait que
// l'habiller. Aucune règle de décision ici — sinon elle échapperait aux tests.
//
// ⚠️ Rien de secret ne sort : ni le jeton de management, ni l'identifiant de véhicule. Ce
// qui s'affiche, ce sont des noms de webhook, une URL de callback (publique par nature :
// c'est l'adresse que Smartcar appelle) et des dates.

import type { Verdict } from "@/lib/smartcar/webhookEtat";

/** Messages de retour d'action. FIXES : un message affiché ne se fabrique pas depuis l'URL. */
export const MESSAGES_ABONNEMENT: Readonly<Record<string, string>> = {
  accepte:
    "Smartcar a ACCEPTÉ la demande (202, création en cours). Ce n’est pas encore un abonnement actif — l’état ci-dessous le dira dans une minute.",
  rien: "Rien à abonner : ce n’est pas ce qui bloque.",
  session: "Session expirée — reconnecte-toi.",
  deconnecte: "Véhicule non connecté à Smartcar : lance le Connect d’abord.",
  refus_401:
    "Smartcar a refusé l’abonnement (401) : le jeton de management est invalide ou n’a pas le droit d’écrire.",
  refus_409:
    "Smartcar a répondu 409 : un abonnement existe déjà pour ce couple véhicule/webhook. Si l’état ci-dessous dit encore « non abonné », c’est que l’abonnement pointe ailleurs.",
  refus_autre: "Smartcar a refusé l’abonnement. L’état relu ci-dessous montre la situation réelle.",
};

const CLASSE_GRAVITE: Readonly<Record<Verdict["gravite"], string>> = {
  panne: "alerte",
  attention: "avertissement",
  ok: "ok",
};

const LIBELLE_TYPE: Readonly<Record<Verdict["type"], string>> = {
  programme: "programmé (déduit : aucun déclencheur déclaré)",
  evenementiel: "événementiel (déduit : des signaux déclencheurs sont déclarés)",
  inconnu: "indéterminé",
};

function dateCourte(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("fr-CA", { dateStyle: "medium", timeStyle: "short" });
}

export function PanneauWebhook({
  verdict,
  message,
  abonner,
}: {
  verdict: Verdict;
  message: string | null;
  /** Server Action. Rendue seulement quand CarAI peut réellement corriger. */
  abonner: (form: FormData) => void;
}) {
  const { webhook, souscription } = verdict;

  return (
    <section className="webhook-etat">
      <h2>Canal principal — le webhook Smartcar</h2>

      {message && (
        <p className="lead" role="status">
          {message}
        </p>
      )}

      <p className={`verdict ${verdict.gravite === "ok" ? "ok" : verdict.gravite === "panne" ? "alerte" : "neutre"}`}>
        {verdict.titre}
      </p>
      <p className="webhook-explication">{verdict.explication}</p>

      {verdict.action && (
        <p className="webhook-action" role={verdict.gravite === "panne" ? "alert" : "status"}>
          <strong>À faire :</strong> {verdict.action}
        </p>
      )}

      {verdict.corrigibleIci && (
        <form action={abonner} className="webhook-form">
          <button type="submit">Abonner le véhicule à ce webhook</button>
          <span className="meta">
            Seule écriture que l’API expose ici. La création d’un webhook et son horaire se
            font dans le tableau de bord Smartcar — il n’existe pas de <code>POST /webhooks</code>.
          </span>
        </form>
      )}

      {webhook && (
        <ul className={`alertes webhook-faits`}>
          <li className={CLASSE_GRAVITE[verdict.gravite] === "ok" ? "" : CLASSE_GRAVITE[verdict.gravite]}>
            <span className="titre">{webhook.nom}</span>
            <span className="meta">
              Livre à <code>{webhook.callbackUri}</code> · {webhook.actif ? "actif" : "DÉSACTIVÉ"} ·
              type {LIBELLE_TYPE[verdict.type]}
            </span>
            <span className="meta">
              {webhook.donnees.length} signal{webhook.donnees.length > 1 ? "aux" : ""} dans la charge
              utile
              {webhook.declencheurs.length > 0
                ? ` · ${webhook.declencheurs.length} déclencheur${webhook.declencheurs.length > 1 ? "s" : ""}`
                : " · aucun déclencheur"}
              {webhook.autoAbonnement ? " · abonnement automatique des nouveaux véhicules" : ""}
            </span>
            <span className="meta">
              Abonnement de ce véhicule :{" "}
              {souscription ? `oui, depuis le ${dateCourte(souscription.creeLe)}` : "non"}
            </span>
          </li>
        </ul>
      )}

      <p className="meta webhook-note">
        La FRÉQUENCE d’un webhook programmé n’est lisible nulle part par l’API — le schéma
        Smartcar ne porte aucun champ d’horaire. CarAI ne peut donc pas vérifier qu’un
        webhook livre « toutes les heures » : il constate seulement qu’il livre, ou qu’il
        s’est tu.
      </p>
    </section>
  );
}
