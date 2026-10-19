// lib/smartcar/webhookDiagnostic.ts — assemble l'état réel puis délègue le VERDICT au pur.
//
// Une seule responsabilité : aller chercher les trois morceaux (webhooks, abonnements,
// dernière livraison) et les passer à `diagnostiquerWebhooks`. Aucune règle de décision
// ici — elles vivent toutes dans `webhookEtat.ts`, sans réseau ni base, donc testables.
//
// ⚠️ CACHE COURT, ET C'EST STRUCTUREL. `/donnees` se rafraîchit toutes les 30 s tant qu'un
// onglet est ouvert. Sans cache, ce diagnostic ferait deux appels Smartcar toutes les
// 30 secondes pour relire une configuration que Marc modifie une fois par mois — c'est
// exactement le piège que DriveAI a payé (19 polls sur 20 renvoyant des octets
// identiques). La configuration d'un webhook ne bouge qu'à la main : cinq minutes de cache
// ne coûtent aucune fraîcheur.
//
// ⚠️ Une PANNE n'est JAMAIS mise en cache — un échec doit rester observable et le prochain
// appel doit réessayer. Et le cache est de PROCESS : vide au démarrage à froid, non
// partagé entre instances. Taux de succès partiel, ce qui reste tout bénéfice.

import { CLE_SMARTCAR_USER, CLE_SMARTCAR_VEHICLE, lireConfigTexte } from "@/lib/config";
import { derniereLivraison } from "@/lib/smartcar/ingest";
import {
  listerSouscriptions,
  listerWebhooks,
  managementConfigure,
  souscrireVehicule,
} from "@/lib/smartcar/management";
import {
  callbackAttendu,
  diagnostiquerWebhooks,
  type SouscriptionSmartcar,
  type Verdict,
  type WebhookSmartcar,
} from "@/lib/smartcar/webhookEtat";

export const CACHE_MS = 5 * 60_000;

interface Cache {
  expire: number;
  webhooks: WebhookSmartcar[];
  souscriptions: SouscriptionSmartcar[];
}

let cache: Cache | null = null;

/** Force la relecture au prochain appel. À utiliser après toute écriture (abonnement). */
export function invaliderCache(): void {
  cache = null;
}

interface LectureApi {
  webhooks: WebhookSmartcar[] | null;
  souscriptions: SouscriptionSmartcar[] | null;
  erreur: string | null;
}

async function lireApi(maintenant: number): Promise<LectureApi> {
  if (cache && cache.expire > maintenant) {
    return { webhooks: cache.webhooks, souscriptions: cache.souscriptions, erreur: null };
  }

  const [rw, rs] = await Promise.all([listerWebhooks(), listerSouscriptions()]);
  if (!rw.ok) return { webhooks: null, souscriptions: null, erreur: rw.erreur };
  if (!rs.ok) return { webhooks: null, souscriptions: null, erreur: rs.erreur };

  cache = { expire: maintenant + CACHE_MS, webhooks: rw.valeur, souscriptions: rs.valeur };
  return { webhooks: rw.valeur, souscriptions: rs.valeur, erreur: null };
}

/**
 * Le verdict complet sur l'état du webhook, prêt à afficher.
 *
 * Ne lève jamais : une panne de lecture devient un verdict `illisible` qui DIT qu'il ne
 * sait rien, plutôt qu'une page en erreur ou — bien pire — un silence rassurant.
 */
export async function etatWebhook(origineRequete: string): Promise<Verdict> {
  const maintenant = new Date();
  const attendu = callbackAttendu(process.env, origineRequete);

  if (!managementConfigure()) {
    return diagnostiquerWebhooks({
      webhooks: null,
      souscriptions: null,
      vehicleId: null,
      callbackAttendu: attendu,
      derniereLivraison: null,
      maintenant,
    });
  }

  const [api, vehicleId, derniere] = await Promise.all([
    lireApi(maintenant.getTime()),
    lireConfigTexte(CLE_SMARTCAR_VEHICLE).catch(() => null),
    derniereLivraison().catch(() => null),
  ]);

  return diagnostiquerWebhooks({
    webhooks: api.webhooks,
    souscriptions: api.souscriptions,
    vehicleId,
    callbackAttendu: attendu,
    derniereLivraison: derniere,
    maintenant,
    erreurLecture: api.erreur,
  });
}

/**
 * Codes de retour — pas des messages.
 *
 * ⚠️ Le message affiché se choisit à l'ARRIVÉE dans une table fixe (`MESSAGES_ABONNEMENT`).
 * Recopier le texte de Smartcar dans la query string laisserait afficher n'importe quelle
 * phrase en trafiquant l'URL ; c'est le patron déjà retenu pour les commandes véhicule.
 */
export type CodeAbonnement = "accepte" | "rien" | "deconnecte" | "refus_401" | "refus_409" | "refus_autre";

/** Classe un refus Smartcar par son code HTTP, lu au DÉBUT du message d'erreur. */
export function classerRefus(erreur: string): CodeAbonnement {
  if (erreur.startsWith("401") || erreur.startsWith("403")) return "refus_401";
  if (erreur.startsWith("409")) return "refus_409";
  return "refus_autre";
}

/**
 * Abonne le véhicule au webhook CarAI — la seule écriture que l'API permette ici.
 *
 * ⚠️ Smartcar répond **202 « subscription creation in progress »** : l'abonnement n'existe
 * pas encore au retour de l'appel. Le code rendu est donc `accepte`, jamais `abonne`, et
 * le cache est invalidé pour que le prochain affichage constate l'état RÉEL plutôt que de
 * répéter la promesse. Même piège que les commandes véhicule le matin même, où un
 * `FAILURE` niché dans un 202 avait été annoncé comme un succès.
 */
export async function abonnerVehicule(origineRequete: string): Promise<CodeAbonnement> {
  const verdict = await etatWebhook(origineRequete);
  if (!verdict.corrigibleIci || !verdict.webhook) return "rien";

  const [userId, vehicleId] = await Promise.all([
    lireConfigTexte(CLE_SMARTCAR_USER),
    lireConfigTexte(CLE_SMARTCAR_VEHICLE),
  ]);
  if (!userId || !vehicleId) return "deconnecte";

  const r = await souscrireVehicule({ webhookId: verdict.webhook.id, userId, vehicleId });
  invaliderCache();

  if (r.ok) return "accepte";
  // Le détail complet reste côté serveur : il sert au diagnostic, pas à l'affichage.
  console.error("[webhook] abonnement refusé", r.erreur);
  return classerRefus(r.erreur);
}
