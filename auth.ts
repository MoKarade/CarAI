// auth.ts
//
// Auth.js (NextAuth v5) — UNE SEULE adresse Google admise (`AUTHORIZED_EMAIL`). C'est le
// patron commun de toutes les apps privées de l'écosystème : elles affichent des données
// personnelles réelles, donc elles sont derrière un login, et l'allowlist est une adresse
// unique — pas de rôles, pas de comptes multiples, rien à gérer.
//
// Session en JWT : pas de base de données requise pour l'auth. Les identifiants OAuth et
// le secret viennent TOUS de l'environnement, jamais du code (cf. `.env.example`).
//
// AU FORK : rien à changer ici. Configurer les variables d'environnement suffit.

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAuthorizedEmail } from "@/lib/authorized";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  // Requis en local/self-hosted (sinon Auth.js lève UntrustedHost). Sans risque : les
  // redirect URIs sont verrouillés côté Google — un host forgé ne matcherait aucun
  // callback autorisé. Sur Vercel c'est de toute façon le comportement par défaut.
  trustHost: true,
  pages: {
    signIn: "/login",
    // Le refus d'un compte non autorisé est une ERREUR côté Auth.js : on la rend par
    // /login, qui lit `?error=` et affiche un message honnête plutôt qu'une page brute.
    error: "/login",
  },
  callbacks: {
    // Seule l'adresse autorisée obtient une session. `false` → Auth.js refuse et
    // redirige vers /login?error=AccessDenied. Aucune session n'est créée.
    signIn({ user }) {
      return isAuthorizedEmail(user?.email, process.env.AUTHORIZED_EMAIL);
    },
  },
});
