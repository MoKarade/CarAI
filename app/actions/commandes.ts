"use server";

// app/actions/commandes.ts — L'action serveur des commandes véhicule, UNIQUE.
//
// ══ INLINE, SANS RECHARGEMENT (Marc, 18/08) ══════════════════════════════════════════
// « À chaque fois que j'envoie une commande je veux pas que ça refresh la page ni la
// carte. » L'ancienne version redirigeait (`?envoi=`), donc rechargeait TOUT — carte
// comprise. Celle-ci RETOURNE le résultat à la feuille qui l'a demandé : rien d'autre ne
// bouge. Pas de `revalidatePath` non plus — l'état affiché du véhicule vient des MESURES,
// et une commande acceptée n'est pas une mesure (l'état publié ensuite fera foi).
//
// ⚠️ L'ordre des gardes n'est pas décoratif : session → catalogue + confirmation →
// véhicule connecté → envoi. Chacune échoue FERMÉ, et aucune ne dépend de ce que le
// navigateur a bien voulu envoyer. La CONFIRMATION d'une action physique est re-vérifiée
// ICI (`autoriserCommande`) : l'appui long du client est une commodité de saisie — une
// requête fabriquée sans le champ `confirme` est refusée quoi qu'il arrive.
//
// ⚠️ Tout ce qui s'affiche vient de TABLES FERMÉES côté serveur (`MOTIFS_UI`,
// `libelleStatut`, `TON_PAR_STATUT`) ou du journal — jamais d'une chaîne du client.

import { baseConfiguree } from "@/lib/db";
import { CLE_SMARTCAR_USER, CLE_SMARTCAR_VEHICLE, lireConfigTexte } from "@/lib/config";
import { contexteSmartcar } from "@/lib/smartcar/client";
import {
  envoyerCommande,
  normaliserLimiteCharge,
  corpsCommande,
} from "@/lib/smartcar/commands";
import {
  MOTIFS_UI,
  TON_PAR_STATUT,
  autoriserCommande,
  libelleStatut,
} from "@/lib/vehicle/commandes";
import { requireSession } from "@/lib/session";

export interface RetourCommande {
  /** `false` = refusé AVANT l'envoi (garde) ; `true` = envoyé, le statut fait foi. */
  envoye: boolean;
  /** Phrase d'affichage, construite ici — la feuille la rend telle quelle. */
  message: string;
  ton: "ok" | "attention" | "danger";
}

function refus(code: string): RetourCommande {
  return {
    envoye: false,
    message: MOTIFS_UI[code] ?? "Commande refusée.",
    ton: "danger",
  };
}

export async function commanderInline(params: {
  type: string;
  confirme: boolean;
  limite?: number;
}): Promise<RetourCommande> {
  try {
    await requireSession();
  } catch {
    return refus("session");
  }

  // ⚠️ LA garde. `type` vient du client : il ne touche la table des chemins Smartcar
  // qu'une fois reconnu au catalogue, confirmation comprise.
  const verdict = autoriserCommande({
    type: params.type,
    confirme: params.confirme === true,
  });
  if (!verdict.ok) return refus(verdict.code);
  const { commande } = verdict;

  // La limite de charge porte une valeur ; les autres commandes n'ont pas de corps.
  let corps: unknown;
  if (commande.champNumerique) {
    const limite = normaliserLimiteCharge(Number(params.limite));
    if ("erreur" in limite) return refus("limite");
    // Forme exigée par `SetChargeLimitRequest` : { data: { attributes: { percent } } },
    // `percent` ENTIER de 50 à 100 (l'ancien `{ limit: <fraction> }` était une invention).
    corps = corpsCommande({ percent: limite.percent });
  }

  if (!baseConfiguree()) return refus("base");

  const contexte = await contexteSmartcar(() => lireConfigTexte(CLE_SMARTCAR_USER));
  const vehicleId = await lireConfigTexte(CLE_SMARTCAR_VEHICLE);
  if (!contexte || !vehicleId) return refus("deconnecte");

  const resultat = await envoyerCommande({
    contexte,
    vehicleId,
    commande: commande.type,
    corps,
    // Le journal distingue l'origine : quand une commande surprend, « ui » ou « mcp »
    // est la première chose qu'on veut savoir.
    issuedBy: "ui",
  });

  return {
    envoye: true,
    message: `${libelleStatut(resultat.statut)}${resultat.message ? ` — ${resultat.message}` : ""}`,
    ton: TON_PAR_STATUT[resultat.statut] ?? "attention",
  };
}
