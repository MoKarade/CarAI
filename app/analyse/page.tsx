// app/analyse/page.tsx — REDIRECTION vers Tendances (étape 2 de la refonte, 17/08).
import { redirect } from "next/navigation";

export default function Analyse() {
  redirect("/tendances");
}
