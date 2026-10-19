// Route Handler d'Auth.js. Rien à personnaliser au fork — toute la configuration vit
// dans `auth.ts`, et les secrets dans l'environnement.

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
