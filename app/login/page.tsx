// app/login/page.tsx — seule page publique de l'app (avec l'endpoint du hub).
//
// CarAI ne se connecte plus à Google elle-même (ADR 0001 de Hubperso) : le hub est la
// porte d'entrée unique. Cette page ne propose donc plus de bouton, elle REDIRIGE vers
// `hubperso.com/login` en emportant de quoi revenir.
//
// Le message d'erreur reste HONNÊTE et distingue les cas : une authentification non
// configurée n'est pas un compte refusé, et il faut pouvoir le comprendre sans lire les
// journaux.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { URL_HUB, urlConnexionHub } from "@/lib/connexionHub";
import { isAuthConfigured } from "@/lib/authConfigured";

export const dynamic = "force-dynamic";

// Titre d'onglet à son nom (le layout met déjà « CarAI » partout ailleurs).
export const metadata: Metadata = { title: "Connexion à CarAI" };

/**
 * L'origine de cette app, vue de la requête.
 *
 * Pas une constante : CarAI répond sur son domaine ET sur les préversions Vercel. Coder
 * `carai.hubperso.com` en dur ferait revenir toutes les préversions en production après
 * connexion.
 */
async function origineDeLaRequete(): Promise<string> {
  const h = await headers();
  const hote = h.get("x-forwarded-host") ?? h.get("host") ?? "carai.hubperso.com";
  const protocole = h.get("x-forwarded-proto") ?? "https";
  return `${protocole}://${hote}`;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  const configured = isAuthConfigured();

  // Chemin normal : on ne s'attarde pas, on envoie au hub.
  //
  // ⚠️ Pas de redirection si l'auth n'est PAS configurée : sans `AUTH_SECRET`, CarAI ne
  // saurait pas lire le cookie que le hub lui rendrait. On bouclerait entre les deux apps
  // indéfiniment. Mieux vaut s'arrêter ici et le dire.
  if (!error && configured) {
    redirect(urlConnexionHub(await origineDeLaRequete(), callbackUrl));
  }

  return (
    <main className="login">
      <h1 className="login__title">CarAI</h1>
      <p className="login__subtitle">Connexion</p>

      {!configured && (
        <p className="login__error">
          Authentification non configurée (AUTH_SECRET / AUTHORIZED_EMAIL manquants).
          La redirection vers le hub est retenue exprès : sans ces variables, CarAI ne
          pourrait pas lire la session qu’il lui rendrait, et on tournerait en rond.
        </p>
      )}

      {error && (
        <p className="login__error">
          {/* Les erreurs d'OAuth n'arrivent plus ici — CarAI ne parle plus à Google.
              Ce qui reste possible : une session refusée parce que l'adresse n'est pas
              celle admise. */}
          Session refusée. Ce compte Google n’est pas celui autorisé pour cette app.
        </p>
      )}

      <p>
        <a className="login__btn" href={URL_HUB}>
          Aller au hub
        </a>
      </p>
    </main>
  );
}
