// app/api/cron/smartcar-poll/route.ts — poll PÉRIODIQUE des signaux Smartcar.
//
// ⚠️ Route HORS du middleware d'authentification utilisateur (voir `lib/authGuard.ts`) :
// le planificateur n'a pas de session Google. Elle porte son propre garde, `CRON_SECRET`,
// comparé en temps constant.
//
// ── POURQUOI CETTE ROUTE EXISTE ──────────────────────────────────────────────────────
// Le webhook ne se déclenche que sur CHANGEMENT (`SIGNAL_UPDATED`). Voiture stationnée,
// donnée figée ⇒ aucune livraison pendant des heures, alors que Smartcar, lui, continue
// d'interroger le véhicule. Ce poll comble ce silence en allant chercher l'état courant.
// La déduplication structurelle garantit qu'il ne crée aucun doublon avec le webhook.
//
// ── SUR L'ÉCHEC : RAPPORTÉ, PAS PROPAGÉ ──────────────────────────────────────────────
// `pollerSignaux` ne lève jamais ; la route répond 200 avec le motif dans le corps. Un 500
// récurrent sur un cron finirait par ressembler à une panne de CarAI alors que la cause
// serait en amont (quota, véhicule non connecté). Le motif est dans le corps ET dans les
// journaux — jamais un silence.

import { baseConfiguree } from "@/lib/db";
import { assurerMigrations } from "@/lib/migrations";
import { pollerSignaux } from "@/lib/smartcar/poll";
import { BUDGET_CRON_MS, rejouerJusquAuBout } from "@/lib/smartcar/rejeu";
import { inscrirePassage } from "@/lib/vehicle/pollJournal";
import { synchroniserEntretiens } from "@/lib/smartcar/entretiens";
import { secretValide } from "@/lib/secretPartage";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json(
      { error: "cron désactivé : CRON_SECRET non configuré." },
      { status: 503, headers: NO_STORE },
    );
  }

  const fourni =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret");

  if (!secretValide(fourni, secret)) {
    return Response.json({ error: "non autorisé" }, { status: 401, headers: NO_STORE });
  }

  if (!baseConfiguree()) {
    return Response.json(
      { ok: false, raison: "DATABASE_URL absent." },
      { headers: NO_STORE },
    );
  }

  await assurerMigrations();
  const resultat = await pollerSignaux();

  // Journaliser CHAQUE passage, même celui qui n'écrit rien : « 0 écrit sur 84 reçus » et
  // « 0 reçu » disent des choses opposées, et un journal qui ne trace que les anomalies ne
  // permet pas de distinguer « rien à faire » de « jamais tourné ».
  const detail = resultat.ok
    ? `${resultat.recus} signal(aux) lu(s) (${resultat.succes} SUCCESS, ${resultat.enEchec} en échec), ` +
      `${resultat.ecrits} mesure(s) écrite(s), ${resultat.repetitionsEcartees} refus déjà connu(s) écarté(s)`
    : `échec — ${resultat.raison}`;
  console.log(`[poll] ${detail}`);

  // Trace du passage — y compris celui qui n'écrit rien, et celui qui échoue. C'est ce qui
  // rend un poll SAUTÉ détectable : sans cette ligne, « le cron n'a pas tourné » et « rien
  // n'avait changé » produisent exactement le même silence. Voir `lib/vehicle/cadence.ts`
  // pour la mesure qui a motivé ça (un tiers des passages manquants, trous jusqu'à 101 min).
  await inscrirePassage({
    ok: resultat.ok,
    raison: resultat.ok ? null : (resultat.raison ?? null),
    recus: resultat.recus,
    ecrits: resultat.ecrits,
  });

  // ── RÉPARATION de l'incident du 18/08 (migration 0005) ─────────────────────────────
  // Un lot par passage, curseur en base, et ça s'éteint tout seul une fois la dernière
  // livraison relue. Placé APRÈS le poll et enveloppé d'un try : c'est un rattrapage,
  // il ne doit JAMAIS empêcher le flux vivant d'écrire (leçon DriveAI — une étape
  // secondaire non protégée gèle tout le pipeline).
  try {
    const repare = await rejouerJusquAuBout({ budgetMs: BUDGET_CRON_MS });
    if (repare) console.log(`[reparation] ${repare}`);
  } catch (err) {
    console.error("[reparation] lot impossible — réessaiera au prochain passage", err);
  }

  // ── `[SC-04]` : l'historique d'ENTRETIEN, au plus une fois par jour ───────────────
  // La lecture et l'écriture existaient depuis le début ; il manquait QUI les appelle.
  // Ici plutôt que dans un cron à part : un second déclencheur serait un second endroit
  // qui peut cesser de tirer sans que rien ne le dise — et on vient de mesurer ce que vaut
  // un `schedule` GitHub Actions (6 passages par jour sur 48 demandés).
  //
  // ⚠️ Gardée par un créneau de 24 h EN BASE (`reserverCreneau`), donc le passage aux
  // 15 min ne coûte qu'un appel Smartcar par jour. Et enveloppée, comme la réparation
  // ci-dessus : une étape secondaire ne doit JAMAIS empêcher le flux vivant d'écrire.
  try {
    const entretiens = await synchroniserEntretiens();
    if (entretiens.statut === "ok" && entretiens.nouvelles > 0) {
      console.log(
        `[entretiens] ${entretiens.nouvelles} nouvelle(s) sur ${entretiens.lues} lue(s)`,
      );
    } else if (entretiens.statut === "echec") {
      console.error(`[entretiens] échec — ${entretiens.raison}`);
    }
  } catch (err) {
    console.error("[entretiens] synchro impossible — réessaiera demain", err);
  }

  // Une réponse PAGINÉE se dit : sans ça, un poll qui ne voit que la première page
  // ressemblerait à un poll complet (leçon des bornes de tête).
  if (resultat.totalAnnonce !== null && resultat.totalAnnonce > resultat.recus) {
    console.warn(
      `[poll] réponse PARTIELLE : ${resultat.recus} signaux reçus sur ${resultat.totalAnnonce} annoncés — pagination à traiter.`,
    );
  }

  return Response.json(resultat, { headers: NO_STORE });
}
