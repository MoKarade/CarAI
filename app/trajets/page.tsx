// app/trajets/page.tsx — REDIRECTION vers Activité (étape 2 de la refonte, 17/08).
//
// Trajets et Recharges ont fusionné en UN fil mêlé (choix de Marc au cadrage). L'URL
// survit — signets, liens du hub, habitudes — mais l'écran vit dans /activite.
import { redirect } from "next/navigation";

export default function Trajets() {
  redirect("/activite");
}
