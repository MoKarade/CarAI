"use client";

// app/reglages/FormulaireReglages.tsx — l'enveloppe du formulaire de bail.
//
// Pourquoi un composant client : l'action serveur `enregistrer` prend (état précédent,
// formulaire) et renvoie un état. Branchée directement sur `<form action>`, elle recevait
// le formulaire à la place de l'état précédent et sa réponse était jetée : sauvegarde
// muette. `useActionState` fournit le bon couple et garde la réponse pour l'afficher.

import { useActionState, type ReactNode } from "react";

export interface EtatFormulaire {
  statut: "vierge" | "ok" | "erreur";
  messages: string[];
}

const ETAT_INITIAL: EtatFormulaire = { statut: "vierge", messages: [] };

/** Le retour du serveur, vert si c'est enregistré, rouge sinon. Rien avant le premier envoi. */
export function RetourEnregistrement({ etat }: { etat: EtatFormulaire }) {
  if (etat.statut === "vierge") return null;
  return (
    <div className={`cl-message ${etat.statut}`} role="status">
      {etat.messages.map((m) => (
        <p key={m}>{m}</p>
      ))}
    </div>
  );
}

export function FormulaireReglages({
  action,
  className,
  children,
}: {
  className?: string;
  action: (etat: EtatFormulaire, form: FormData) => Promise<EtatFormulaire>;
  children?: ReactNode;
}) {
  const [etat, envoyer, enCours] = useActionState(action, ETAT_INITIAL);
  return (
    <form action={envoyer} className={className}>
      {children}
      <button type="submit" disabled={enCours}>
        {enCours ? "Enregistrement…" : "Enregistrer"}
      </button>
      <RetourEnregistrement etat={etat} />
    </form>
  );
}
