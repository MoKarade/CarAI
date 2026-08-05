// Page d'accueil minimale et honnête : l'app démarre « en construction ».
// Au fork, remplace-la par ta vraie interface.

export default function Home() {
  return (
    <main className="shell">
      <div className="card">
        <p className="eyebrow">hubperso.com</p>
        <h1>App Template</h1>
        <p className="lead">
          Squelette prêt à forker. L’endpoint <code>/hub/summary</code> est déjà branché sur
          le hub (contrat v1) et renvoie un état « en construction » tant que le moteur
          n’est pas actif.
        </p>
        <p className="hint">
          Remplace ce contenu par ta vraie interface, et le <code>buildingSummary</code> de{" "}
          <code>app/hub/summary/route.ts</code> par tes vraies données quand elles existent.
        </p>
      </div>
    </main>
  );
}
