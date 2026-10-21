// app/reglages/lieux.tsx — les lieux de recharge de Marc, et leur tarif.
//
// Marc, 13/08/2026 : « un tarif horaire à un endroit, le prix d'Hydro à la maison ».
//
// ══ POURQUOI CET ÉCRAN EXISTE PLUTÔT QU'UNE CONSTANTE DANS LE CODE ═══════════════════
//
// ⚠️ Le dépôt CarAI est PUBLIC. L'adresse du domicile de Marc et celle de son employeur ne
// peuvent entrer dans aucun fichier versionné — c'est le garde-fou n°1 de JobAI, appliqué
// ici. Écrire ces coordonnées en dur aurait été plus rapide et les aurait publiées sur
// GitHub. Elles vivent donc en BASE, saisies ici, comme les termes du bail.
//
// C'est aussi ce qui rend la fonctionnalité utile ailleurs : une borne publique dont Marc
// enregistre le tarif une fois devient exacte pour toutes ses recharges suivantes — l'app
// APPREND au lieu de deviner.

import { revalidatePath } from "next/cache";
import { CLE_LIEUX, SchemaLieux, ecrireConfig, lireLieux, type Lieu } from "@/lib/config";
import { pointDeLAdresse } from "@/lib/geocodage";
import { requireSession } from "@/lib/session";
import { BoutonRetirerLieu } from "@/app/reglages/BoutonRetirerLieu";
import { FormulaireLieu } from "@/app/reglages/FormulaireLieu";
import type { ReponseAdresse } from "@/app/ui/ChoixLieu";
import { historiquePositions } from "@/lib/vehicle/position";

/** Ce que l'ajout répond — jamais rien, jamais un silence. */
export interface EtatAjout {
  ok?: string;
  erreur?: string;
}

/**
 * Ajoute un lieu.
 *
 * ⚠️ `requireSession()` ICI, pas seulement dans la page : une Server Action est un point
 * d'entrée POST à part entière. Et la validation passe par le SCHÉMA (`SchemaLieux`), donc
 * une latitude de 999 ou un rayon de 400 km sont refusés avant d'atteindre la base.
 */
async function ajouterLieu(_etat: EtatAjout, form: FormData): Promise<EtatAjout> {
  "use server";
  await requireSession();

  const candidat = {
    nom: String(form.get("nom") ?? "").trim(),
    lat: Number(form.get("lat")),
    lng: Number(form.get("lng")),
    rayonM: Number(form.get("rayonM") || 120),
    mode: String(form.get("mode") ?? "horaire"),
    tarif: Number(form.get("tarif")),
  };

  // ⚠️ Le point doit être DÉSIGNÉ, pas deviné. Un formulaire envoyé sans coordonnées est le
  // cas le plus probable (on remplit le nom et le tarif, on oublie de taper la carte) : le
  // dire vaut mieux que laisser le schéma refuser un `NaN` avec un message obscur.
  if (!Number.isFinite(candidat.lat) || !Number.isFinite(candidat.lng)) {
    return { erreur: "Pose d’abord le lieu sur la carte, ou cherche son adresse." };
  }

  const existants = await lireLieux();
  const valide = SchemaLieux.safeParse([...existants, candidat]);
  // Une saisie invalide ne modifie RIEN — mieux vaut ne rien enregistrer qu'un lieu à
  // moitié bon qui apparierait des recharges au mauvais tarif. Mais le refus se DIT :
  // silencieux, il laissait Marc devant un formulaire qui ne réagit pas (vécu le 21/08,
  // avec une latitude tapée à la main que le schéma refusait sans un mot).
  if (!valide.success) {
    const premier = valide.error.issues[0];
    return { erreur: premier ? `Refusé : ${premier.message}` : "Saisie refusée." };
  }

  await ecrireConfig(CLE_LIEUX, valide.data);
  revalidatePath("/reglages");
  revalidatePath("/recharges");
  return { ok: `« ${candidat.nom} » enregistré.` };
}

/** Cherche le point d'une adresse. La clé de géocodage reste SERVEUR — elle ne descend
 *  jamais au navigateur, contrairement à celle de la carte Google intégrée. */
async function chercherAdresse(adresse: string): Promise<ReponseAdresse> {
  "use server";
  await requireSession();

  const r = await pointDeLAdresse(adresse);
  if (r.ok) return { ok: true, lat: r.lat, lng: r.lng, libelle: r.libelle };
  const messages = {
    "sans-cle": "La recherche d’adresse n’est pas disponible, pose le lieu sur la carte.",
    introuvable: "Adresse introuvable — vérifie l’orthographe, ou pose le lieu sur la carte.",
    panne: "Google n’a pas répondu. Réessaie dans un instant : l’adresse est peut-être bonne.",
  } as const;
  return { ok: false, message: messages[r.raison] };
}

/** Retire un lieu par son NOM — l'index changerait sous une suppression concurrente. */
async function retirerLieu(form: FormData): Promise<void> {
  "use server";
  await requireSession();

  const nom = String(form.get("nom") ?? "");
  const restants = (await lireLieux()).filter((l) => l.nom !== nom);
  await ecrireConfig(CLE_LIEUX, restants);
  revalidatePath("/reglages");
  revalidatePath("/recharges");
}

export async function LieuxDeRecharge() {
  let lieux: Lieu[] = [];
  // La carte s'ouvre là où la voiture s'est garée en dernier : dans l'immense majorité des
  // cas, c'est précisément le lieu qu'on veut enregistrer. À défaut, le centre de Québec —
  // jamais 0,0, qui est un point valide au large de l'Afrique et enverrait la carte dans
  // le golfe de Guinée (le dépôt a déjà eu à purger ce genre de coordonnée de sa base).
  let centre = { lat: 46.8139, lng: -71.208 };
  try {
    const positions = await historiquePositions({ limite: 1 });
    const derniere = positions[positions.length - 1];
    if (derniere) centre = { lat: derniere.lat, lng: derniere.lng };
  } catch (err) {
    console.error("[reglages] dernière position illisible", err);
  }
  try {
    lieux = await lireLieux();
  } catch (err) {
    // Un souci de config ne doit pas vider l'écran des réglages du bail.
    console.error("[reglages] lecture des lieux impossible", err);
  }

  return (
    <section className="lieux">
      <h2>Lieux de recharge</h2>
      <p className="hint">
        Un lieu enregistré rend ses recharges <strong>exactes</strong> au lieu d’estimées.
        Ces coordonnées restent en base — elles ne partent jamais sur GitHub.
      </p>

      {lieux.length === 0 ? (
        <p className="hint">Aucun lieu enregistré.</p>
      ) : (
        <ul className="liste-lieux">
          {lieux.map((l) => (
            <li key={l.nom}>
              <span className="lieu-nom">{l.nom}</span>
              <span className="lieu-tarif">
                {l.tarif === undefined
                  ? "sans tarif"
                  : l.mode === "horaire"
                    ? `${l.tarif.toFixed(2)} $/h`
                    : `${l.tarif.toFixed(3)} $/kWh`}
              </span>
              <span className="meta">rayon {l.rayonM} m</span>
              <form action={retirerLieu}>
                <input type="hidden" name="nom" value={l.nom} />
                <BoutonRetirerLieu />
              </form>
            </li>
          ))}
        </ul>
      )}

      <FormulaireLieu
        centre={centre}
        ajouter={ajouterLieu}
        chercherAdresse={chercherAdresse}
      />

    </section>
  );
}
