"use client";

// app/activite/FormulaireNommerLieu.tsx — « Nommer ce lieu », sur la ligne d'une recharge dont
// le lieu n'est pas reconnu (CarAI#8).
//
// Client parce qu'il doit RÉPONDRE : un refus du serveur (nom déjà pris, tarif sans mode) se
// dit à l'écran, il ne laisse pas un formulaire immobile (même leçon que `FormulaireLieu`).
// La position de la recharge part en champs cachés : elle n'est jamais retapée à la main.

import { useActionState } from "react";
import type { EtatNommage } from "@/app/activite/actions";

export function FormulaireNommerLieu({
  position,
  nommer,
}: {
  position: { lat: number; lng: number };
  nommer: (etat: EtatNommage, form: FormData) => Promise<EtatNommage>;
}) {
  const [etat, action, enCours] = useActionState(nommer, {});

  return (
    <details className="nommer-lieu">
      <summary>Nommer ce lieu</summary>
      <form action={action} className="form-lieu">
        <input type="hidden" name="lat" value={position.lat} />
        <input type="hidden" name="lng" value={position.lng} />
        <label>
          Nom <input name="nom" required maxLength={40} placeholder="Borne du centre" />
        </label>
        <label>
          Tarif (facultatif){" "}
          <input
            name="tarif"
            type="number"
            inputMode="decimal"
            step="0.001"
            min={0}
            placeholder="1.00"
          />
        </label>
        <label>
          Facturation{" "}
          <select name="mode" defaultValue="horaire">
            <option value="horaire">à l’heure ($/h)</option>
            <option value="kwh">au kWh ($/kWh)</option>
          </select>
        </label>
        <button type="submit" disabled={enCours}>
          {enCours ? "Enregistrement…" : "Enregistrer ce lieu"}
        </button>
        <p className="hint">
          Sans tarif, le nom s’affiche et le coût reste une estimation. Le lieu rejoint la liste
          des lieux de Réglages.
        </p>
        {(etat.erreur || etat.ok) && (
          <p className={`cl-message ${etat.erreur ? "erreur" : "ok"}`} aria-live="polite">
            {etat.erreur ?? etat.ok}
          </p>
        )}
      </form>
    </details>
  );
}
