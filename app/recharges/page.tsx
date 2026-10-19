// app/recharges/page.tsx — REDIRECTION vers Activité (étape 2 de la refonte, 17/08).
//
// Les recharges vivent dans le fil mêlé d'Activité ; les tuiles de coûts du mois y sont
// en tête, et la charge EN COURS s'affiche sur l'accueil.
import { redirect } from "next/navigation";

export default function Recharges() {
  redirect("/activite");
}
