// lib/smartcar/management.ts — accès à la Management API Smartcar (webhooks, abonnements).
//
// Cinq opérations, pas une de plus, parce que c'est TOUT ce que la spec expose :
//   GET    /webhooks                 — lister les webhooks
//   GET    /webhooks/{id}            — en lire un
//   GET    /subscriptions            — lister les abonnements
//   POST   /subscriptions            — abonner un véhicule à un webhook
//   DELETE /subscriptions/{id}       — le désabonner
//
// Il n'y a PAS de `POST /webhooks` : un webhook se crée dans le tableau de bord Smartcar.
// Et `WebhookAttributes` ne porte aucun champ d'horaire. Voir l'en-tête de `webhookEtat.ts`
// pour ce que ça implique. Ces deux absences sont vérifiées dans la spec OpenAPI, pas
// supposées — deux endpoints inventés le 17/08 ont coûté assez cher pour que la règle
// devienne : quand la doc n'est pas sous les yeux, on ne code pas l'appel.
//
// ══ AUTHENTIFICATION (corrigé le 17/08/2026 — la première version se trompait) ═══════
// La Management API prend le MÊME jeton M2M que la Vehicle API : celui obtenu via
// `client_credentials` sur `SMARTCAR_CLIENT_ID`/`SMARTCAR_CLIENT_SECRET` (voir `./auth`,
// déjà utilisé par `client.ts` pour parler au véhicule). Ce n'est PAS
// `SMARTCAR_MANAGEMENT_TOKEN` — ce dernier ne sert qu'à signer/vérifier les webhooks
// entrants en HMAC (Doc 2 §6, `webhook.ts`), un usage complètement différent.
//
// La première version de ce fichier utilisait `SMARTCAR_MANAGEMENT_TOKEN` comme Bearer
// token pour interroger l'API — une DÉDUCTION explicitement notée comme telle, qui s'est
// avérée fausse : Smartcar répondait 401 alors que les webhooks livraient parfaitement
// (donc le HMAC, lui, était juste). Deux jetons, deux usages ; les confondre fait échouer
// la LECTURE sans jamais toucher à la RÉCEPTION — ce qui rendait le bug difficile à voir
// depuis les logs Smartcar, qui ne montraient que des livraisons réussies.

import {
  credentialsSmartcar,
  obtenirToken,
  oublierToken,
  ErreurSmartcar,
  type CredentialsSmartcar,
} from "./auth";
import type { Env } from "@/lib/env";
import {
  type SouscriptionSmartcar,
  type WebhookSmartcar,
} from "./webhookEtat";

export const BASE_MANAGEMENT = "https://management.api.smartcar.com/v3";

/** Résultat d'un appel : la donnée, ou un motif LISIBLE. Jamais une exception avalée. */
export type Resultat<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

/** `true` quand les identifiants M2M sont configurés — sans eux, rien n'est interrogeable. */
export function managementConfigure(env: Env = process.env): boolean {
  return credentialsSmartcar(env) !== null;
}

interface OptionsAppel {
  method?: string;
  body?: unknown;
  fetchImpl?: typeof fetch;
  env?: Env;
}

function messageErreurToken(e: unknown): string {
  return e instanceof ErreurSmartcar ? `${e.details.type}: ${e.details.title}` : String(e);
}

/**
 * Appel authentifié à la Management API.
 *
 * Même retry qu'`appelSmartcar` (`client.ts`) sur 401/403 : un token expiré est le seul
 * échec qu'un simple renouvellement corrige. Une seule reprise, jamais une boucle.
 *
 * Le message d'erreur porte le CODE et le `detail` renvoyé par Smartcar : « 401 » seul
 * n'apprend rien, alors que « 401 — The Authorization token is missing or invalid »
 * désigne le remède. Un HTML de passerelle est tronqué mais conservé, pour la même raison.
 */
export async function appelManagement<T = unknown>(
  chemin: string,
  options: OptionsAppel = {},
): Promise<Resultat<{ data: T; status: number }>> {
  const { method = "GET", body, fetchImpl = fetch, env = process.env } = options;
  const credentials: CredentialsSmartcar | null = credentialsSmartcar(env);
  if (!credentials) {
    return { ok: false, erreur: "SMARTCAR_CLIENT_ID / SMARTCAR_CLIENT_SECRET non configurés" };
  }

  const executer = (token: string) =>
    fetchImpl(`${BASE_MANAGEMENT}${chemin}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  let reponse: Response;
  try {
    let token = await obtenirToken({ credentials, fetchImpl });
    reponse = await executer(token);
    if (reponse.status === 401 || reponse.status === 403) {
      oublierToken();
      token = await obtenirToken({ credentials, fetchImpl });
      reponse = await executer(token);
    }
  } catch (e) {
    return { ok: false, erreur: messageErreurToken(e) };
  }

  const brut = await reponse.text();
  let json: unknown = null;
  try {
    json = brut ? JSON.parse(brut) : null;
  } catch {
    json = null;
  }

  if (!reponse.ok) {
    return { ok: false, erreur: `${reponse.status} — ${detailErreur(json) ?? brut.slice(0, 200) ?? "sans détail"}` };
  }

  return { ok: true, valeur: { data: json as T, status: reponse.status } };
}

/** Extrait le `detail` du premier objet d'erreur JSON:API, s'il y en a un. */
export function detailErreur(json: unknown): string | null {
  if (!estObjet(json)) return null;
  const errors = json.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const premier = errors[0];
  if (!estObjet(premier)) return null;
  const detail = premier.detail ?? premier.title ?? premier.code;
  return typeof detail === "string" ? detail : null;
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function texte(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function date(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Codes des signaux d'un tableau de `SignalReference` (`{group, name, code}`). */
function codesSignaux(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => (estObjet(s) ? texte(s.code) : null))
    .filter((c): c is string => c !== null);
}

/**
 * Lit une réponse `WebhookListResponse` — PUR, donc testable sans réseau.
 *
 * Tolérant sur ce qui est absent, strict sur l'identité : un webhook sans `id` n'est pas
 * un webhook dégradé, c'est autre chose, et l'inclure ferait échouer silencieusement toute
 * comparaison d'abonnement ensuite.
 */
export function lireWebhooks(data: unknown): WebhookSmartcar[] {
  if (!estObjet(data) || !Array.isArray(data.data)) return [];
  const sortie: WebhookSmartcar[] = [];
  for (const brut of data.data) {
    if (!estObjet(brut)) continue;
    const id = texte(brut.id);
    if (!id) continue;
    const attrs = estObjet(brut.attributes) ? brut.attributes : {};
    sortie.push({
      id,
      nom: texte(attrs.name) ?? "(sans nom)",
      callbackUri: texte(attrs.callbackUri) ?? "",
      actif: attrs.isEnabled === true,
      autoAbonnement: attrs.autoSubscribe === true,
      declencheurs: codesSignaux(attrs.triggers),
      donnees: codesSignaux(attrs.data),
    });
  }
  return sortie;
}

/**
 * Lit une réponse `WebhookSubscriptionListResponse` — PUR.
 *
 * Les identifiants de webhook et de véhicule vivent dans `relationships`, pas dans
 * `attributes` (`attributes` ne porte qu'un résumé du véhicule : marque, modèle, année).
 * C'est ce que dit le schéma ; s'en écarter donnerait des abonnements « sans webhook »
 * qui ne correspondraient jamais à rien.
 */
export function lireSouscriptions(data: unknown): SouscriptionSmartcar[] {
  if (!estObjet(data) || !Array.isArray(data.data)) return [];
  const sortie: SouscriptionSmartcar[] = [];
  for (const brut of data.data) {
    if (!estObjet(brut)) continue;
    const id = texte(brut.id);
    if (!id) continue;
    const rel = estObjet(brut.relationships) ? brut.relationships : {};
    const meta = estObjet(brut.meta) ? brut.meta : {};
    sortie.push({
      id,
      webhookId: idRelation(rel.webhook),
      vehicleId: idRelation(rel.vehicle),
      creeLe: date(meta.createdAt),
    });
  }
  return sortie;
}

function idRelation(v: unknown): string | null {
  if (!estObjet(v) || !estObjet(v.data)) return null;
  return texte(v.data.id);
}

export async function listerWebhooks(
  options: OptionsAppel = {},
): Promise<Resultat<WebhookSmartcar[]>> {
  const r = await appelManagement("/webhooks?page[size]=100", options);
  return r.ok ? { ok: true, valeur: lireWebhooks(r.valeur.data) } : r;
}

export async function listerSouscriptions(
  filtre: { vehicleId?: string; webhookId?: string } = {},
  options: OptionsAppel = {},
): Promise<Resultat<SouscriptionSmartcar[]>> {
  const params = new URLSearchParams({ "page[size]": "100" });
  if (filtre.vehicleId) params.set("filter[vehicleId]", filtre.vehicleId);
  if (filtre.webhookId) params.set("filter[webhookId]", filtre.webhookId);
  const r = await appelManagement(`/subscriptions?${params.toString()}`, options);
  return r.ok ? { ok: true, valeur: lireSouscriptions(r.valeur.data) } : r;
}

/**
 * Abonne un véhicule à un webhook.
 *
 * ⚠️ **La réponse nominale est un 202 « subscription creation in progress »** — pas un
 * 200. L'abonnement n'existe donc PAS encore quand l'appel revient : annoncer « abonné »
 * sur ce 202 serait exactement l'erreur commise le matin même sur les commandes véhicule
 * (un `FAILURE` dans le corps d'un 202 annoncé comme un succès). Le retour dit ce qui
 * s'est passé — `accepte`, pas `fait` — et l'appelant relit la liste pour confirmer.
 */
export async function souscrireVehicule(
  params: { webhookId: string; userId: string; vehicleId: string },
  options: OptionsAppel = {},
): Promise<Resultat<{ accepte: true; message: string }>> {
  const r = await appelManagement("/subscriptions", {
    ...options,
    method: "POST",
    body: {
      data: {
        attributes: {
          webhookId: params.webhookId,
          userId: params.userId,
          vehicleId: params.vehicleId,
        },
      },
    },
  });
  if (!r.ok) return r;
  const message =
    (estObjet(r.valeur.data) && estObjet(r.valeur.data.meta) && texte(r.valeur.data.meta.message)) ||
    "abonnement accepté";
  return { ok: true, valeur: { accepte: true, message } };
}

export async function desabonner(
  subscriptionId: string,
  options: OptionsAppel = {},
): Promise<Resultat<true>> {
  const r = await appelManagement(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    ...options,
    method: "DELETE",
  });
  return r.ok ? { ok: true, valeur: true } : r;
}
