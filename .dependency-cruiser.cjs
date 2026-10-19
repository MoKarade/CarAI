// Règles d'architecture (porte qualité de l'Atelier, S6) — même jeu que le pilote BatchChef.
// But : que la structure décrite dans le CLAUDE.md reste VRAIE à mesure que le code grandit.
// Cliquet : le nombre de violations au jour de la mise en place est figé dans qualite/seuils.json
// (architecture.violations) ; il peut baisser, jamais monter.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "pas-de-cycle",
      comment: "Deux modules qui s'importent mutuellement : l'ordre de chargement devient fragile.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "pas-d-import-introuvable",
      comment: "Un import qui ne se résout vers rien casse au build ou, pire, à l'exécution.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "prod-sans-dependance-de-dev",
      comment: "Le code servi ne doit pas dépendre d'un paquet de développement (absent en production).",
      severity: "error",
      from: { path: "^(app|lib|components)/", pathNot: "\\.test\\.tsx?$" },
      to: { dependencyTypes: ["npm-dev"], dependencyTypesNot: ["type-only"] },
    },
    {
      name: "lib-n-importe-pas-l-interface",
      comment: "lib/ est la logique ; elle ne doit connaître ni les routes (app/) ni les composants.",
      severity: "error",
      from: { path: "^lib/" },
      to: { path: "^(app|components)/" },
    },
    {
      name: "composants-sans-base-de-donnees",
      comment: "Un composant d'affichage ne parle pas directement à la base : il passe par lib/ (actions, requêtes).",
      severity: "error",
      from: { path: "^components/" },
      to: { path: "^lib/db/" },
    },
    {
      name: "tests-hors-du-code-servi",
      comment: "Le code servi n'importe jamais un test.",
      severity: "error",
      from: { path: "^(app|lib|components)/" },
      to: { path: "^tests/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^(\\.next|node_modules|coverage|reports|drizzle)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { exportsFields: ["exports"], conditionNames: ["import", "require", "node", "default", "types"] },
  },
};
