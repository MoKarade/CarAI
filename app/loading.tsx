// app/loading.tsx — ce qu'on voit pendant qu'une page se charge (changement d'onglet).
//
// Sans ce fichier, un tap sur un onglet ne montrait rien tant que le serveur n'avait pas
// répondu : on croyait que le tap n'avait pas marché. Next.js affiche ceci tout de suite,
// puis le remplace par la page.

export default function Chargement() {
  return (
    <main>
      <p className="hint" role="status" aria-live="polite">
        Chargement…
      </p>
    </main>
  );
}
