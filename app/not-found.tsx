// app/not-found.tsx — la page affichée quand une adresse n'existe pas.
//
// Sans ce fichier, Next.js montre sa page 404 en anglais,
// seul écran de l'app qui ne parle pas français. Balises simples (h1, paragraphes, lien) :
// la feuille de style globale les habille déjà dans le thème sombre.

import Link from "next/link";

export default function PageIntrouvable() {
  return (
    <main>
      <h1>Page introuvable</h1>
      <p>Cette adresse n’existe pas, ou elle a changé.</p>
      <p>
        <Link href="/">Retour à l’accueil</Link>
      </p>
    </main>
  );
}
