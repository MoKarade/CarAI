"use client";

// app/reglages/FormulaireLieu.tsx — le formulaire d'ajout d'un lieu de recharge.
//
// Client parce qu'il doit RÉPONDRE : l'ancienne version était une `<form action={...}>`
// serveur qui, en cas de saisie refusée, ne faisait rien et ne disait rien. Marc y a tapé
// une latitude malformée le 21/08 et s'est retrouvé devant un écran immobile, sans moyen
// de savoir pourquoi. `useActionState` rend le message du serveur à l'écran.

import { useActionState } from "react";
import { ChoixLieu, type ReponseAdresse } from "@/app/ui/ChoixLieu";
import type { PointGeo } from "@/lib/vehicle/carte";

interface EtatAjout {
  ok?: string;
  erreur?: string;
}

export function FormulaireLieu({
  centre,
  ajouter,
  chercherAdresse,
}: {
  centre: PointGeo;
  ajouter: (etat: EtatAjout, form: FormData) => Promise<EtatAjout>;
  chercherAdresse: (adresse: string) => Promise<ReponseAdresse>;
}) {
  const [etat, action, enCours] = useActionState(ajouter, {});

  return (
    <form action={action} className="form-lieu">
      <ChoixLieu centre={centre} chercherAdresse={chercherAdresse} />

      <div className="filtres">
        <label>
          Nom <input name="nom" required maxLength={40} placeholder="Boulot" />
        </label>
        <label>
          Facturation{" "}
          <select name="mode" defaultValue="horaire">
            <option value="horaire">à l’heure ($/h)</option>
            <option value="kwh">au kWh ($/kWh)</option>
          </select>
        </label>
        <label>
          Tarif{" "}
          <input
            name="tarif"
            type="number"
            inputMode="decimal"
            step="0.001"
            min={0}
            required
            placeholder="1.00"
          />
        </label>
        <button type="submit" disabled={enCours}>
          {enCours ? "Enregistrement…" : "Ajouter ce lieu"}
        </button>
      </div>

      {/* ⚠️ Le retour de l'action, TOUJOURS affiché — c'est tout l'objet de ce composant.
          `aria-live` pour que le refus soit annoncé et pas seulement montré. */}
      {(etat.erreur || etat.ok) && (
        <p className={`cl-message ${etat.erreur ? "erreur" : "ok"}`} aria-live="polite">
          {etat.erreur ?? etat.ok}
        </p>
      )}
    </form>
  );
}
