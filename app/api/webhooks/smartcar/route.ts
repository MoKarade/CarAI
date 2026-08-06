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
  challengeBienForme,
  estSimulee,
  lireEvenement,
  livraisonAuthentique,
  reponseChallenge,
  resumerErreursVehicule,
} from "@/lib/smartcar/webhook";
import { ingererLivraison, tracerLivraisonErreur } from "@/lib/smartcar/ingest";
import {
  codesDesSignaux,
  nombreDeSignaux,
  resumerStatutsSignaux,
} from "@/lib/smartcar/signals";
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

  // ══ 1. LE CHALLENGE PASSE AVANT LA VÉRIFICATION DE SIGNATURE ═══════════════════════
  //
  // L'événement de vérification n'est PAS signé — le handler de référence de Smartcar y
  // répond sans rien vérifier. Exiger une signature ici renvoyait 401 et faisait échouer
  // la vérification du webhook (vécu le 05/08/2026 : « verification request responded
  // with a non-2xx status: 401 »). Or tant que la vérification échoue, Smartcar ne livre
  // AUCUNE donnée : l'ordre de ces deux blocs décide si le flux existe ou non.
  //
  // ⚠️ Répondre à un challenge revient à SIGNER une chaîne fournie par l'appelant. Sans
  // garde, l'endpoint deviendrait un oracle : composer le corps d'une fausse livraison,
  // le faire signer en le présentant comme un challenge, puis le renvoyer avec cette
  // signature. `challengeBienForme` l'interdit — on ne signe que des chaînes
  // `challenge_…` alphanumériques, structurellement incapables d'être un corps JSON.
  //
  // Ce bloc passe aussi avant l'état de la base : un souci de configuration ne doit pas
  // empêcher la vérification du webhook, donc toute livraison future, sans rapport.
  if (evenement.type === "VERIFY") {
    if (!evenement.challenge || !challengeBienForme(evenement.challenge)) {
      console.error("[smartcar] challenge absent ou de forme inattendue — refusé.");
      return Response.json(
        { error: "challenge absent ou invalide" },
        { status: 400, headers: NO_STORE },
      );
    }
    return Response.json(reponseChallenge(evenement.challenge, managementToken), {
      headers: NO_STORE,
    });
  }

  // ══ 2. TOUT LE RESTE EXIGE UNE SIGNATURE VALIDE ════════════════════════════════════
  // Les livraisons de DONNÉES, elles, sont signées — et rien ne s'écrit en base sans que
  // cette signature soit vérifiée sur le corps BRUT.
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

  // Un VEHICLE_ERROR se journalise et ne casse pas le pipeline (Doc 2 §6.3). On répond 200 :
  // la livraison a bien été reçue, c'est l'OEM qui a un problème, pas nous.
  if (evenement.type === "VEHICLE_ERROR") {
    // Résumé LISIBLE d'abord : un VEHICLE_ERROR dit quels signaux le véhicule refuse, et
    // donc quoi retirer de la souscription. Le JSON brut suit — lui seul contient tout.
    for (const ligne of resumerErreursVehicule(evenement.raw)) {
      console.error(`[smartcar] ${ligne}`);
    }
    console.error("[smartcar] VEHICLE_ERROR brut", JSON.stringify(evenement.raw));

    // Trace PERSISTANTE en plus des logs : « quels signaux le véhicule refuse, et depuis
    // quand » est l'information qui explique un trou dans une série des mois plus tard —
    // les logs Vercel, eux, seront partis. Jamais bloquant : la réponse reste 200 quoi
    // qu'il arrive, un souci de base ne doit pas compter comme un échec de livraison.
    if (baseConfiguree()) {
      try {
        await assurerMigrations();
        await tracerLivraisonErreur({ eventId: evenement.eventId, raw: evenement.raw });
      } catch (err) {
        console.error("[smartcar] trace du VEHICLE_ERROR impossible", err);
      }
    }
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
    const { ecrits, dejaTraite, ignoree } = await ingererLivraison({
      eventId: evenement.eventId,
      eventType: evenement.type,
      signaux: evenement.signaux,
      raw: evenement.raw,
      // La livraison nous apprend l'identifiant du véhicule — plus fiable que d'aller le
      // demander à un endpoint (voir `apprendreVehicleId`).
      vehicleId: evenement.vehicleId,
      // Les données de TEST sont tracées mais jamais enregistrées : un odomètre fictif
      // fausserait la projection du bail. Voir `ingererLivraison`.
      simulee: estSimulee(evenement),
    });

    // ── JOURNALISER CHAQUE LIVRAISON, PAS SEULEMENT LES ANOMALIES ──────────────────
    // Sans cette ligne, « tout va bien » et « rien n'arrive » laissent la MÊME trace :
    // aucune. Impossible alors de répondre à « est-ce qu'on reçoit bien tout ? » autrement
    // qu'en devinant (leçon JobAI : « 0/0 » et « 0/11 » disent des choses opposées).
    //
    // `ecrits: 0` sur `recus: 11` est le cas NORMAL quand rien n'a bougé depuis la
    // livraison précédente — la déduplication fait son travail. C'est `recus: 0` qui
    // serait anormal.
    // Les CODES, pas seulement le compte : « 11 reçus » ne dit pas si les absents sont
    // ceux qu'on attendait. Les noms de signaux ne portent aucune VALEUR (pas de GPS, pas
    // de kilométrage) — ils peuvent vivre dans un journal.
    //
    // `recus` = compte BRUT via la MÊME coercition que le chemin d'écriture
    // (`nombreDeSignaux`). Compter `length` seulement sur un tableau affichait « 0 reçu »
    // — le signal d'alarme par excellence — pour une charge en objet indexé pourtant
    // écrite normalement, avec un delta « sans code lisible » négatif en prime. Un signal
    // illisible (sans code) reste visible comme écart POSITIF entre reçus et codes.
    const recus = nombreDeSignaux(evenement.signaux);
    const codes = codesDesSignaux(evenement.signaux);
    const statuts = resumerStatutsSignaux(evenement.signaux);
    console.log(
      `[smartcar] livraison ${evenement.eventId ?? "sans-id"} : ${recus} signal(aux) reçu(s), ` +
        `${ecrits} enregistré(s)${dejaTraite ? " (déjà traitée)" : ""}${ignoree ? " (simulée, ignorée)" : ""}.` +
        (codes.length > 0 ? ` Codes : ${codes.join(", ")}` : "") +
        (recus !== codes.length ? ` (${recus - codes.length} sans code lisible)` : ""),
    );
    // La ventilation des STATUTS sur une ligne dédiée : c'est la réponse vivante à
    // « lesquels marchent ? », lisible sans requête SQL. Les refus portent leur motif.
    if (statuts.enEchec.length > 0) {
      console.warn(
        `[smartcar] statuts : ${statuts.succes.length} SUCCESS ; ${statuts.enEchec.length} en échec — ` +
          statuts.enEchec.map((e) => `${e.code}(${e.statut})`).join(", "),
      );
    }

    return Response.json(
      { ok: true, recus, ecrits, dejaTraite, ignoree },
      { headers: NO_STORE },
    );
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
