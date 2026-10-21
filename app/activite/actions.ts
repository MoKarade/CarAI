"use server";

// app/activite/actions.ts — les Server Actions de l'écran Activité.
//
// ⚠️ Une Server Action est un point d'entrée POST à part entière : la protection de la page ne
// s'étend pas à elle. `requireSession()` est revérifiée ICI (CarAI#8), avant toute lecture ou
// écriture de la config.

import { revalidatePath } from "next/cache";
import { CLE_LIEUX, ecrireConfig, lireLieux } from "@/lib/config";
import { assurerMigrations } from "@/lib/migrations";
import { requireSession } from "@/lib/session";
import { ajouterLieuNomme } from "@/lib/vehicle/nommerLieu";

/** Ce que le geste répond — jamais un silence : le refus se dit. */
export interface EtatNommage {
  ok?: string;
  erreur?: string;
}

/**
 * Nomme le lieu d'une recharge inconnue : ajoute un lieu à la liste de Réglages, à la
 * position de la recharge. Les recharges au même endroit, passées comme à venir, prennent ce
 * nom ; un tarif saisi les chiffre (CarAI#8).
 */
export async function nommerLieuRecharge(
  _etat: EtatNommage,
  form: FormData,
): Promise<EtatNommage> {
  await requireSession();
  await assurerMigrations();

  const brut = String(form.get("tarif") ?? "").trim().replace(",", ".");
  const resultat = ajouterLieuNomme(await lireLieux(), {
    nom: String(form.get("nom") ?? ""),
    lat: Number(form.get("lat")),
    lng: Number(form.get("lng")),
    mode: String(form.get("mode") ?? ""),
    tarif: brut === "" ? null : Number(brut),
  });
  if (!resultat.ok) return { erreur: resultat.erreur };

  await ecrireConfig(CLE_LIEUX, resultat.lieux);
  for (const chemin of ["/activite", "/reglages", "/recharges", "/"]) revalidatePath(chemin);
  return { ok: resultat.message };
}
