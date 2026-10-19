// auth.ts
//
// Auth.js (NextAuth v5) SANS fournisseur. CarAI lit, elle n'émet plus.
//
// Depuis l'ADR 0001 de Hubperso, le hub est la porte d'entrée unique de l'écosystème :
// CarAI ne parle plus à Google, elle déchiffre le cookie de session posé sur
// `.hubperso.com`.
//
// ⚠️ `AUTHORIZED_EMAIL` N'EST PAS UNE ALLOWLIST. Depuis l'étape 2 de la même ADR, c'est le
// PROPRIÉTAIRE : il entre toujours, et sans réseau, pour qu'une panne du hub ne l'enferme
// pas dehors de sa propre app. Toute autre adresse passe par `aAccesHub` (voir le callback
// `jwt` plus bas, qui porte le détail) : la liste vit dans la table `acces` du hub et se
// gère depuis `hubperso.com/administration`.
//
// Session en JWT : pas de base de données requise pour l'auth. Le secret vient de
// l'environnement, jamais du code (cf. `.env.example`).
//
// AU FORK, hors du hub : il faut RÉINTRODUIRE un fournisseur Google ici et remettre le
// callback `signIn`. Cette app ne sait plus se connecter seule, c'est délibéré.

import NextAuth from "next-auth";
import { isAuthorizedEmail } from "@/lib/authorized";
import { aAccesHub } from "@/lib/accesHub";
import { cookiesSessionPartagee } from "@/lib/sessionPartagee";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // ── AUCUN FOURNISSEUR, ET C'EST LE POINT ────────────────────────────────────────
  // CarAI ne fabrique plus de session : elle LIT celle que le hub a posée sur
  // `.hubperso.com` (ADR 0001). Le `client_secret` Google n'existe plus dans cet
  // environnement — une copie de moins à faire tourner le jour d'un incident.
  //
  // Auth.js reste indispensable pour autant : c'est lui qui déchiffre le cookie et
  // expose `auth()` au garde. Les routes `/api/auth/*` continuent de servir la session
  // et la DÉCONNEXION — laquelle vaut désormais pour toutes les apps, le cookie étant
  // partagé.
  providers: [],
  session: { strategy: "jwt" },
  // ── CONNEXION UNIQUE ENTRE LES APPS DU HUB ───────────────────────────────────────
  // Avec `AUTH_COOKIE_DOMAIN=.hubperso.com`, le cookie de session est déclaré sur le
  // domaine parent : le navigateur l'envoie à TOUS les sous-domaines. Combiné à un
  // `AUTH_SECRET` IDENTIQUE dans chaque app (le JWT est chiffré avec — sans le même
  // secret, l'app reçoit le cookie mais n'en tire rien), se connecter à une app vaut
  // pour toutes. Corollaire assumé : une DÉCONNEXION vaut aussi pour toutes.
  //
  // Variable non définie (local, préversions) ⇒ comportement natif, cookie limité à
  // l'hôte. Voir `lib/sessionPartagee.ts`.
  cookies: cookiesSessionPartagee(process.env.AUTH_COOKIE_DOMAIN),
  // Requis en local/self-hosted (sinon Auth.js lève UntrustedHost). Sans aucun risque
  // désormais : CarAI n'a plus de flux OAuth à détourner, elle ne fait que déchiffrer.
  trustHost: true,
  // `/login` n'est plus une porte mais un couloir : elle redirige vers le hub. Le garde
  // continue d'y envoyer les visiteurs sans session, et Auth.js y renvoie ses erreurs —
  // la page s'y arrête alors pour les DIRE, au lieu de rediriger et de boucler.
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    // ⚠️ LE SEUL CONTRÔLE D'ACCÈS QUI RESTE, ET IL TOURNE À CHAQUE LECTURE.
    //
    // Il n'y a plus de callback `signIn` : aucune connexion ne se fait ici, donc il ne
    // tournerait jamais — le garder donnerait l'illusion d'un contrôle. Tout repose
    // maintenant sur `jwt`, qui suit la DONNÉE et non la connexion.
    //
    // Sans lui, CarAI accepterait sans broncher n'importe quelle session posée sur
    // `.hubperso.com` par une autre app. Les apps partagent aujourd'hui la même
    // AUTHORIZED_EMAIL, mais c'est une coïncidence de configuration, pas une garantie.
    //
    // DEUX ÉTAGES, PAS UN SEUL. `isAuthorizedEmail` reste le premier : Marc entre sans
    // jamais dépendre du hub — sinon un hub injoignable l'enfermerait dehors de sa propre
    // app. Pour toute autre adresse, `aAccesHub` interroge la table `acces` du hub
    // (étape 2 de l'ADR 0001) : c'est là, et seulement là, que vit désormais la liste de
    // qui d'autre a le droit d'entrer.
    //
    // Renvoyer `null` INVALIDE la session (Auth.js v5) : la middleware redirige vers
    // /login, aucune donnée n'est rendue.
    async jwt({ token, user }) {
      // `user` reste dans la signature bien qu'aucune connexion locale ne le fournisse :
      // Auth.js le passe encore si une session naît par un chemin qu'on n'a pas prévu.
      if (user?.email) token.email = user.email;
      if (isAuthorizedEmail(token.email, process.env.AUTHORIZED_EMAIL)) return token;
      if (!(await aAccesHub(token.email))) return null;
      return token;
    },
  },
});
