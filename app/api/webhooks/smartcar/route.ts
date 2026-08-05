// app/api/webhooks/smartcar/route.ts — réception des livraisons Smartcar (Doc 2 §6).
//
// ⚠️ Route HORS du middleware d'authentification utilisateur (voir `lib/authGuard.ts`).
// Elle porte sa propre auth : signature HMAC-SHA256 du corps brut.
//
// ══ TROIS EXIGENCES, DANS CET ORDRE ══════════════════════════════════════════════════
//
// 1. RÉPONDRE AU CHALLENGE AVANT TOUT. Smartcar ne livre AUCUN `VEHICLE_STATE` tant que
//    l'endpoint n'a pas répondu correctement au défi de vérification initial. Un webhook
//    qui échoue là ne produit pas d'erreur visible — juste un silence qu'on prend pour
//    « la voiture n'a rien envoyé ».
//
// 2. VÉRIFIER LA SIGNATURE SUR LE CORPS BRUT. `await request.text()` est lu UNE seule
//    fois, et le JSON est analysé À PARTIR de cette chaîne. Re-sérialiser l'objet
//    changerait les octets (ordre des clés, espaces) et invaliderait le HMAC.
//
// 3. RÉPONDRE 200 VITE. Smartcar retente 6 fois avec backoff puis DÉSACTIVE le webhook
//    (Doc 2 §6.4). Un traitement lent finit donc par couper le flux — en silence.
//
// ── SUR LE « TRAITER DE FAÇON ASYNCHRONE » DU DOC 2 §6.4 ─────────────────────────────
// La recommandation est de répondre 200 immédiatement et d'écrire ensuite. En serverless,
// détacher le travail de la réponse le fait tuer avec l'instance : on aurait un 200 franc
// et zéro donnée écrite — pire que lent. On écrit donc AVANT de répondre. C'est tenable
// ici parce que l'écriture est UNE insertion en lot sur un seul véhicule, à quelques
// livraisons par heure. Si ça devait grossir, la bonne réponse serait une file, pas un
// détachement silencieux.

import {
  HEADER_SIGNATURE,
  lireEvenement,
  livraisonAuthentique,
  reponseChallenge,
} from "@/lib/smartcar/webhook";
import { ingererLivraison } from "@/lib/smartcar/ingest";
import { assurerMigrations } from "@/lib/migrations";
import { baseConfiguree } from "@/lib/db";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request): Promise<Response> {
  const managementToken = process.env.SMARTCAR_MANAGEMENT_TOKEN?.trim();

  // Échec fermé. Sans token de management, la signature ne peut pas être vérifiée — et un
  // webhook non vérifié est une porte ouverte en écriture sur la base. 503 plutôt que 500 :
  // l'intégration est DÉSACTIVÉE, ce n'est pas une panne.
  if (!managementToken) {
    return Response.json(
      { error: "webhook désactivé : SMARTCAR_MANAGEMENT_TOKEN non configuré." },
      { status: 503, headers: NO_STORE },
    );
  }

  // Corps BRUT, lu une seule fois. Tout le reste part de cette chaîne.
  const corpsBrut = await request.text();

  if (
    !livraisonAuthentique({
      corpsBrut,
      signature: request.headers.get(HEADER_SIGNATURE),
      managementToken,
    })
  ) {
    return Response.json(
      { error: "signature invalide" },
      { status: 401, headers: NO_STORE },
    );
  }

  let charge: unknown;
  try {
    charge = corpsBrut ? JSON.parse(corpsBrut) : null;
  } catch {
    return Response.json(
      { error: "corps illisible" },
      { status: 400, headers: NO_STORE },
    );
  }

  const evenement = lireEvenement(charge);

  // 1. Le challenge passe AVANT tout le reste — y compris avant l'état de la base. Sinon un
  //    souci de configuration de base empêcherait la vérification du webhook, donc toute
  //    livraison future, pour une raison sans rapport.
  if (evenement.type === "VERIFY" && evenement.challenge) {
    return Response.json(reponseChallenge(evenement.challenge, managementToken), {
      headers: NO_STORE,
    });
  }

  // Un VEHICLE_ERROR se journalise et ne casse pas le pipeline (Doc 2 §6.3). On répond 200 :
  // la livraison a bien été reçue, c'est l'OEM qui a un problème, pas nous.
  if (evenement.type === "VEHICLE_ERROR") {
    console.error("[smartcar] VEHICLE_ERROR reçu", JSON.stringify(evenement.raw));
    return Response.json({ ok: true, note: "erreur véhicule journalisée" }, { headers: NO_STORE });
  }

  if (!baseConfiguree()) {
    // 200 volontaire : la livraison est valide, c'est CarAI qui n'est pas prêt. Répondre en
    // erreur ferait compter un échec à Smartcar et rapprocherait la désactivation du
    // webhook — on perdrait le flux futur en plus de cette livraison-ci.
    console.error("[smartcar] livraison reçue mais DATABASE_URL absent — donnée perdue.");
    return Response.json(
      { ok: true, note: "base non configurée, donnée non enregistrée" },
      { headers: NO_STORE },
    );
  }

  try {
    await assurerMigrations();
    const { ecrits, dejaTraite } = await ingererLivraison({
      eventId: evenement.eventId,
      eventType: evenement.type,
      signaux: evenement.signaux,
      raw: evenement.raw,
      // La livraison nous apprend l'identifiant du véhicule — plus fiable que d'aller le
      // demander à un endpoint (voir `apprendreVehicleId`).
      vehicleId: evenement.vehicleId,
    });

    // `ecrits: 0` n'est PAS une anomalie : c'est le cas normal quand aucun signal n'a bougé
    // depuis la dernière livraison (la déduplication fait son travail).
    return Response.json({ ok: true, ecrits, dejaTraite }, { headers: NO_STORE });
  } catch (err) {
    console.error("[smartcar] ingestion impossible", err);
    // 500 assumé : Smartcar RETENTERA, et la déduplication rend le rejeu sans risque. C'est
    // le seul cas où réclamer une nouvelle tentative vaut mieux que d'acquitter une perte.
    return Response.json(
      { error: "ingestion impossible" },
      { status: 500, headers: NO_STORE },
    );
  }
}

/** Certains services vérifient l'existence de l'endpoint en GET avant de le configurer. */
export function GET(): Response {
  return Response.json(
    { ok: true, endpoint: "smartcar-webhook", methode: "POST" },
    { headers: NO_STORE },
  );
}
