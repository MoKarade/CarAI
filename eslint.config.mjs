// Flat config natif : eslint-config-next 16 exporte ses configurations au format flat
// (`eslint-config-next/core-web-vitals`, `/typescript`) — plus de FlatCompat ni de
// @eslint/eslintrc, qui ne sait pas relire la config 16 (plantage « circular structure »,
// vécu sur JobAI #30 et ici, Dependabot #147). Toutes les règles d'avant sont conservées, plus
// celles du React Compiler apportées par eslint-plugin-react-hooks 7. eslint reste en 9 :
// eslint-plugin-react, embarqué ici, plante sur eslint 10 (cf. .github/dependabot.yml).
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  // `next lint` ignorait ces dossiers implicitement ; l'ESLint CLI, non. Sans cette
  // liste, `eslint .` scanne node_modules et .next et rend des milliers de faux positifs.
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // ⚠️ Du code TIERS servi tel quel (le décodeur Draco livré avec `three`, copié depuis
      // `node_modules` — voir `public/draco/PROVENANCE.md`). Minifié et généré : ESLint y
      // trouve six erreurs et cent trente avertissements qu'on ne corrigera jamais, parce
      // que la seule réponse juste est de ne PAS le modifier. Un lint qui rougit sur du code
      // qu'on n'écrit pas est un lint qu'on cesse de lire.
      "public/**",
    ],
  },
  ...nextVitals,
  ...nextTs,
  // Un paramètre préfixé `_` est DÉLIBÉRÉMENT ignoré, et c'est parfois le sujet même du
  // code : `metriquePourSignal(code, _groupe)` accepte le groupe et refuse de s'en servir
  // (un repli par groupe faisait collider deux signaux sur la même métrique). Ses tests le
  // passent exprès pour prouver qu'il n'a aucun effet — la signature doit donc le garder.
  // Sans cette règle, ce cas laissait un avertissement permanent, et un lint qui avertit
  // toujours est un lint qu'on cesse de lire.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
];

export default eslintConfig;
