// app/commandes/page.tsx — REDIRECTION vers l'accueil (étape 2 de la refonte, 17/08).
//
// L'écran Commandes a disparu (choix de Marc au cadrage) : la voiture se pilote par son
// SCHÉMA sur l'accueil (cadenas, prise, limite de charge dans la feuille Charge), et le
// journal des commandes vit dans Réglages. Les gardes serveur n'ont pas bougé — elles
// vivent dans app/actions/commandes.ts, partagées depuis le premier jour de la refonte.
import { redirect } from "next/navigation";

export default function Commandes() {
  redirect("/");
}
