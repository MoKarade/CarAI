// scripts/preuve-ecran/precharge.cjs — redirige UNIQUEMENT les appels « base Neon » vers la
// base fictive locale. Chargé par `--require` dans le processus de l'app construite, jamais
// importé par le code servi : le build de production ne contient aucune trace de ceci.
//
// Le pilote Neon appelle `https://api.<hôte de DATABASE_URL>/sql`. On ne touche qu'à ce motif,
// et seulement si `PREUVE_BASE_URL` est posée ; tout autre appel passe tel quel.

const cible = process.env.PREUVE_BASE_URL;
if (cible) {
  const fetchOrigine = globalThis.fetch;
  globalThis.fetch = (entree, init) => {
    const url = typeof entree === "string" ? entree : entree instanceof URL ? entree.href : entree.url;
    if (/^https:\/\/api\.[^/]+\/sql$/.test(url)) return fetchOrigine(`${cible}/sql`, init);
    return fetchOrigine(entree, init);
  };
}
