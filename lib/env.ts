// lib/env.ts — type d'environnement INJECTABLE.
//
// `NodeJS.ProcessEnv` exige `NODE_ENV`, ce qui oblige tout test à fabriquer un
// environnement complet pour vérifier une seule variable. Un type structurel rend les
// fonctions de lecture d'environnement testables avec exactement les clés qui les
// concernent — et c'est ce qui permet à ces fonctions de rester PURES et injectables
// plutôt que d'aller lire `process.env` en dur au fond du code.

export type Env = Record<string, string | undefined>;
