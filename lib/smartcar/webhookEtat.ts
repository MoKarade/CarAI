// lib/smartcar/webhookEtat.ts — LECTURE et DIAGNOSTIC de l'état des webhooks Smartcar.
//
// ══ POURQUOI CE MODULE EXISTE ═══════════════════════════════════════════════════════
// « Parfois les infos sont en retard, parfois je ne les reçois pas du tout » (Marc,
// 17/08/2026). Deux moitiés à ce problème. Le poll qui comble les silences a la sienne
// (`lib/vehicle/cadence.ts` : détecter les passages sautés). Celle-ci est l'autre : quand
// le webhook lui-même est MORT, plus rien n'arrive et RIEN NE LE DIT.
//
// Le cadrage (Doc 2 §6.4) l'annonçait noir sur blanc : si l'endpoint ne répond pas 2xx,
// « Smartcar retente 6 fois avec backoff exponentiel, puis DÉSACTIVE automatiquement le
// webhook ». Autrement dit une panne de quelques heures côté CarAI (déploiement raté,
// base indisponible, Vercel en carafe) coupe le flux DE FAÇON PERMANENTE, longtemps après
// que la cause a disparu. `/donnees` disait déjà « vérifier la souscription du webhook
// côté Smartcar » — une phrase qu'aucun code n'exécutait, à faire à la main dans un
// tableau de bord qu'on n'ouvre jamais.
//
// ══ CE QUE L'API PERMET, ET CE QU'ELLE NE PERMET PAS ════════════════════════════════
// Vérifié dans la spec OpenAPI de la Management API (collée par Marc le 17/08/2026), pas
// de mémoire — deux inventions d'endpoints le même jour ont suffi à retenir la leçon.
//
// EXISTE : `GET /webhooks`, `GET /webhooks/{id}`, `GET /subscriptions`,
//          `POST /subscriptions`, `DELETE /subscriptions/{id}`.
// N'EXISTE PAS : `POST /webhooks`. Et `WebhookAttributes` n'a AUCUN champ d'horaire —
//          ses champs requis sont exactement `name`, `callbackUri`, `isEnabled`,
//          `triggers`, `data`, `errorCallbackUri`, `autoSubscribe`.
//
// ⇒ **Un webhook ne se CRÉE pas et son horaire ne se CONFIGURE pas par l'API.** Ça se fait
//   dans le tableau de bord Smartcar. Ce que le code peut faire — et fait ici — c'est
//   CONSTATER l'état réel, ABONNER le véhicule, et DIRE ce qui manque.
//
// ⚠️ Le TYPE de webhook (programmé vs événementiel) n'est pas un champ non plus. On le
// DÉDUIT de `triggers` : un webhook événementiel liste les signaux qui le déclenchent, un
// webhook programmé n'a rien à déclencher. C'est une LECTURE, pas une donnée — elle est
// étiquetée comme telle partout où elle s'affiche, et elle ne sert qu'à nuancer la
// sévérité d'un silence, jamais à affirmer un horaire.

/** Un webhook tel que la Management API le décrit. */
export interface WebhookSmartcar {
  id: string;
  nom: string;
  callbackUri: string;
  /** `isEnabled`. Passe à `false` tout seul après 6 livraisons en échec (Doc 2 §6.4). */
  actif: boolean;
  /** `autoSubscribe` — abonne automatiquement les nouveaux véhicules. */
  autoAbonnement: boolean;
  /** Codes des signaux qui DÉCLENCHENT une livraison. Vide ⇒ probablement programmé. */
  declencheurs: string[];
  /** Codes des signaux INCLUS dans la charge utile. */
  donnees: string[];
}

/** Un abonnement véhicule ↔ webhook. */
export interface SouscriptionSmartcar {
  id: string;
  webhookId: string | null;
  vehicleId: string | null;
  creeLe: Date | null;
}

/**
 * Lecture DÉDUITE du type de webhook — jamais un champ de l'API.
 * `inconnu` quand le webhook lui-même n'a pas pu être identifié.
 */
export type TypeWebhook = "programme" | "evenementiel" | "inconnu";

export type CodeDiagnostic =
  | "sans_jeton"
  | "illisible"
  | "aucun_webhook"
  | "aucun_pour_carai"
  | "autre_hote"
  | "desactive"
  | "non_souscrit"
  | "muet"
  | "ok";

export type Gravite = "panne" | "attention" | "ok";

export interface Verdict {
  code: CodeDiagnostic;
  gravite: Gravite;
  /** Une phrase : l'état, pas le remède. */
  titre: string;
  /** Pourquoi c'est ainsi, et ce que ça coûte. */
  explication: string;
  /** Le geste suivant. `null` quand il n'y a rien à faire. */
  action: string | null;
  /** `true` quand CarAI peut le corriger lui-même (bouton « Abonner le véhicule »). */
  corrigibleIci: boolean;
  webhook: WebhookSmartcar | null;
  souscription: SouscriptionSmartcar | null;
  type: TypeWebhook;
}

/**
 * Silence au-delà duquel un webhook PROGRAMMÉ est considéré mort.
 *
 * Volontairement large : l'API ne publie AUCUN champ d'horaire (vérifié dans la spec), on
 * ne peut donc pas dériver ce seuil de la fréquence réelle. Six heures ne dénoncent pas un
 * webhook horaire qui a sauté un tour, et attrapent un webhook désactivé.
 */
export const SEUIL_MUET_MINUTES = 6 * 60;

/**
 * Silence au-delà duquel un webhook ÉVÉNEMENTIEL mérite un mot — beaucoup plus long.
 *
 * Un webhook événementiel se déclenche sur un CHANGEMENT. Voiture stationnée trois jours ⇒
 * zéro livraison, et RIEN N'EST CASSÉ (constat du 11/08, cf. `poll.ts`). Crier à la panne
 * dans ce cas serait la meilleure façon d'apprendre à ignorer l'alerte.
 */
export const SEUIL_MUET_EVENEMENTIEL_MINUTES = 72 * 60;

/**
 * Vue minimale de l'environnement dont dépend le calcul du callback.
 *
 * La signature d'index n'est pas décorative : sans elle, TypeScript refuse `process.env`
 * (« aucune propriété en commun » — la détection des types faibles). Nommer seulement ce
 * qu'on lit reste préférable à `NodeJS.ProcessEnv`, qui laisserait ce module lire
 * n'importe quelle variable.
 */
export interface EnvCallback {
  SMARTCAR_REDIRECT_URI?: string | undefined;
  [cle: string]: string | undefined;
}

/** Chemin de la route qui reçoit les livraisons. Une seule définition, ici. */
export const CHEMIN_CALLBACK = "/api/webhooks/smartcar";

/**
 * URL de callback que CETTE instance attend — PUR.
 *
 * L'origine de la requête ne suffit PAS : ouvrir le diagnostic depuis une URL de
 * préévisualisation Vercel ferait conclure « le webhook livre ailleurs » alors que tout va
 * bien en production. L'origine canonique est donc préférée quand elle est connue, et
 * `SMARTCAR_REDIRECT_URI` la porte déjà (c'est l'URL que Smartcar rappelle après le
 * Connect — elle ne peut pas être une préévisualisation, sinon le Connect casserait).
 */
export function callbackAttendu(env: EnvCallback, origineRequete: string): string {
  const declaree = env.SMARTCAR_REDIRECT_URI?.trim();
  if (declaree) {
    try {
      return `${new URL(declaree).origin}${CHEMIN_CALLBACK}`;
    } catch {
      // URL déclarée illisible : on retombe sur l'origine de la requête plutôt que de
      // lever. Un diagnostic ne doit jamais planter la page qu'il informe.
    }
  }
  return `${origineRequete.replace(/\/+$/, "")}${CHEMIN_CALLBACK}`;
}

/** Normalise une URL pour la comparaison : hôte en minuscules, pas de barre finale. */
function normaliserUri(uri: string): { hote: string; chemin: string } | null {
  try {
    const u = new URL(uri);
    return {
      hote: u.host.toLowerCase(),
      chemin: u.pathname.replace(/\/+$/, "").toLowerCase() || "/",
    };
  } catch {
    return null;
  }
}

/**
 * Le webhook pointe-t-il vers CETTE instance de CarAI ?
 *
 * Trois réponses, pas deux. « Même chemin, autre hôte » est un cas RÉEL et pernicieux : un
 * webhook resté braqué sur une URL de préévisualisation Vercel livre parfaitement — à un
 * déploiement mort. Le confondre avec « aucun webhook » enverrait Marc en créer un second.
 */
export function comparerCallback(
  uriWebhook: string,
  uriAttendue: string,
): "exact" | "autre_hote" | "different" {
  const a = normaliserUri(uriWebhook);
  const b = normaliserUri(uriAttendue);
  if (!a || !b) return "different";
  if (a.hote === b.hote && a.chemin === b.chemin) return "exact";
  if (a.chemin === b.chemin) return "autre_hote";
  return "different";
}

/** Déduit le type d'un webhook de la présence de déclencheurs. Voir l'avertissement en tête. */
export function deduireType(webhook: WebhookSmartcar | null): TypeWebhook {
  if (!webhook) return "inconnu";
  return webhook.declencheurs.length === 0 ? "programme" : "evenementiel";
}

function formaterDuree(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = minutes / 60;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${Math.round(h / 24)} jours`;
}

export interface EntreeDiagnostic {
  /** `null` = le jeton de management manque : on n'a même pas pu demander. */
  webhooks: WebhookSmartcar[] | null;
  /** `null` = la liste des abonnements n'a pas pu être lue. */
  souscriptions: SouscriptionSmartcar[] | null;
  /** `null` tant que le Connect n'a pas eu lieu. */
  vehicleId: string | null;
  /** URL de callback attendue par CETTE instance. */
  callbackAttendu: string;
  /** Dernière livraison reçue, tous webhooks confondus. */
  derniereLivraison: Date | null;
  maintenant: Date;
  /** Motif LISIBLE quand l'appel a échoué — jamais avalé. */
  erreurLecture?: string | null;
}

/**
 * Le diagnostic complet, PUR : mêmes entrées ⇒ même verdict, testable sans réseau.
 *
 * L'ordre des cas est un ordre d'ACTION, pas de gravité théorique : on renvoie toujours le
 * premier obstacle qui empêche les suivants d'avoir un sens. Diagnostiquer un silence
 * quand le véhicule n'est même pas abonné n'apprendrait rien à personne.
 */
export function diagnostiquerWebhooks(entree: EntreeDiagnostic): Verdict {
  const {
    webhooks,
    souscriptions,
    vehicleId,
    callbackAttendu,
    derniereLivraison,
    maintenant,
    erreurLecture,
  } = entree;

  const base = {
    webhook: null,
    souscription: null,
    type: "inconnu" as TypeWebhook,
    corrigibleIci: false,
  };

  if (webhooks === null) {
    return erreurLecture
      ? {
          ...base,
          code: "illisible",
          gravite: "attention",
          titre: "L’état des webhooks n’a pas pu être lu.",
          explication: `Smartcar a refusé la demande : ${erreurLecture}. Tant que cette lecture échoue, CarAI ne peut ni confirmer ni infirmer que le webhook est vivant — ce panneau ne dit donc RIEN de l’état réel.`,
          action:
            "Vérifier SMARTCAR_CLIENT_ID et SMARTCAR_CLIENT_SECRET (les identifiants M2M qui authentifient la Management API — un jeton distinct de SMARTCAR_MANAGEMENT_TOKEN, qui ne sert qu’à vérifier les livraisons entrantes).",
        }
      : {
          ...base,
          code: "sans_jeton",
          gravite: "attention",
          titre: "SMARTCAR_CLIENT_ID / SMARTCAR_CLIENT_SECRET ne sont pas configurés.",
          explication:
            "Sans ces identifiants, CarAI ne peut pas obtenir de jeton pour interroger la Management API — ce panneau reste aveugle. C’est indépendant de SMARTCAR_MANAGEMENT_TOKEN (qui vérifie les livraisons entrantes) : l’un peut manquer sans affecter l’autre.",
          action: "Poser SMARTCAR_CLIENT_ID et SMARTCAR_CLIENT_SECRET dans les variables d’environnement Vercel.",
        };
  }

  if (webhooks.length === 0) {
    return {
      ...base,
      code: "aucun_webhook",
      gravite: "panne",
      titre: "Aucun webhook n’existe dans le compte Smartcar.",
      explication:
        "Rien n’est poussé vers CarAI : tout ce qui arrive en base vient du poll périodique, qui ne tourne qu’aux 30 min et saute des passages. C’est la cause la plus complète possible de « je ne reçois pas les infos ».",
      action: `Créer le webhook dans le tableau de bord Smartcar (l’API ne le permet pas : il n’existe pas de POST /webhooks). Callback : ${callbackAttendu}`,
    };
  }

  const exacts = webhooks.filter((w) => comparerCallback(w.callbackUri, callbackAttendu) === "exact");
  const webhook = exacts.find((w) => w.actif) ?? exacts[0] ?? null;

  if (!webhook) {
    const ailleurs = webhooks.filter(
      (w) => comparerCallback(w.callbackUri, callbackAttendu) === "autre_hote",
    );
    if (ailleurs.length > 0) {
      const cible = ailleurs[0]!;
      return {
        ...base,
        webhook: cible,
        type: deduireType(cible),
        code: "autre_hote",
        gravite: "panne",
        titre: "Le webhook livre à une AUTRE adresse que celle-ci.",
        explication: `Le webhook « ${cible.nom} » pointe vers ${cible.callbackUri}, alors que cette instance attend ${callbackAttendu}. Même chemin, autre hôte : les livraisons partent bien, elles arrivent ailleurs. Vu de Smartcar tout va bien, et c’est ce qui rend le cas difficile à voir.`,
        action: "Corriger l’URL de callback du webhook dans le tableau de bord Smartcar.",
      };
    }
    return {
      ...base,
      code: "aucun_pour_carai",
      gravite: "panne",
      titre: `${webhooks.length} webhook${webhooks.length > 1 ? "s existent" : " existe"}, aucun ne pointe vers CarAI.`,
      explication: `Les callbacks déclarés sont : ${webhooks.map((w) => w.callbackUri).join(", ")}. Aucun ne correspond à ${callbackAttendu} — CarAI ne recevra donc jamais rien par ce chemin.`,
      action: `Pointer un webhook vers ${callbackAttendu}, ou en créer un dans le tableau de bord Smartcar.`,
    };
  }

  const type = deduireType(webhook);
  const souscription =
    souscriptions?.find(
      (s) => s.webhookId === webhook.id && (vehicleId === null || s.vehicleId === vehicleId),
    ) ?? null;

  if (!webhook.actif) {
    return {
      ...base,
      webhook,
      type,
      code: "desactive",
      gravite: "panne",
      titre: "Le webhook existe mais il est DÉSACTIVÉ.",
      explication:
        "Smartcar désactive un webhook de lui-même après six livraisons en échec consécutives. Une panne passagère de CarAI (déploiement raté, base indisponible) suffit donc à couper le flux DÉFINITIVEMENT, longtemps après que la cause a disparu — et rien ne le signale : c’est un interrupteur qui reste baissé.",
      action:
        "Réactiver le webhook dans le tableau de bord Smartcar (l’API ne l’expose pas en écriture).",
    };
  }

  if (vehicleId === null) {
    return {
      ...base,
      webhook,
      type,
      code: "non_souscrit",
      gravite: "attention",
      titre: "Le webhook est en place, mais aucun véhicule n’est connecté à CarAI.",
      explication:
        "Sans identifiant de véhicule, il n’y a rien à abonner. Le webhook attend, correctement configuré, une voiture qui n’a pas encore été connectée.",
      action: "Lancer le Connect Smartcar depuis les réglages.",
    };
  }

  if (!souscription) {
    return {
      ...base,
      webhook,
      type,
      code: "non_souscrit",
      gravite: "panne",
      titre: "Le véhicule n’est PAS abonné à ce webhook.",
      explication: `Le webhook « ${webhook.nom} » est actif et pointe au bon endroit, mais aucun abonnement ne relie ce véhicule à ce webhook. Un webhook sans abonné ne livre rien : tout est en place et rien ne circule.${webhook.autoAbonnement ? " (Le webhook est en abonnement automatique — un véhicule connecté AVANT que ce réglage soit posé n’est pas rattrapé pour autant.)" : ""}`,
      action: "Abonner le véhicule — CarAI peut le faire lui-même.",
      corrigibleIci: true,
    };
  }

  const silenceMin =
    derniereLivraison === null
      ? Number.POSITIVE_INFINITY
      : (maintenant.getTime() - derniereLivraison.getTime()) / 60_000;
  const seuil = type === "programme" ? SEUIL_MUET_MINUTES : SEUIL_MUET_EVENEMENTIEL_MINUTES;

  if (silenceMin > seuil) {
    const depuis =
      derniereLivraison === null
        ? "Aucune livraison n’a JAMAIS été reçue"
        : `Aucune livraison depuis ${formaterDuree(silenceMin)}`;
    return {
      webhook,
      souscription,
      type,
      corrigibleIci: false,
      code: "muet",
      gravite: type === "programme" ? "panne" : "attention",
      titre: `${depuis}, alors que tout est configuré.`,
      explication:
        type === "programme"
          ? "Ce webhook n’a aucun déclencheur : il devrait donc livrer sur un horaire, indépendamment de ce que fait la voiture. Un silence de cette durée n’est pas explicable par un stationnement — quelque chose ne livre pas. (La fréquence exacte n’est pas lisible par l’API : elle ne figure dans aucun champ du schéma.)"
          : "Ce webhook se déclenche sur des CHANGEMENTS de signaux. Voiture stationnée, aucun signal ne bouge, aucune livraison ne part — et rien n’est cassé. Ce silence n’est donc pas une preuve de panne ; il le devient s’il persiste alors que la voiture a roulé ou chargé.",
      action:
        type === "programme"
          ? "Vérifier dans le tableau de bord Smartcar que le webhook livre bien (onglet des livraisons) et que l’endpoint répond 2xx."
          : "Rien à faire si la voiture n’a pas bougé. Sinon, vérifier les livraisons côté Smartcar.",
    };
  }

  return {
    webhook,
    souscription,
    type,
    corrigibleIci: false,
    code: "ok",
    gravite: "ok",
    titre: "Le webhook est actif, le véhicule y est abonné, et les livraisons arrivent.",
    explication:
      derniereLivraison === null
        ? "Tout est en place."
        : `Dernière livraison il y a ${formaterDuree(silenceMin)}.${type === "evenementiel" ? " Webhook événementiel : les silences pendant les stationnements sont normaux, c’est le poll qui les comble." : ""}`,
    action: null,
  };
}
