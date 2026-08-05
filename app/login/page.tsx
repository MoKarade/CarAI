// app/login/page.tsx — seule page publique de l'app (avec l'endpoint du hub).
//
// Le message d'erreur est HONNÊTE et distingue les cas : un compte refusé n'est pas une
// panne, et l'utilisateur doit pouvoir le comprendre sans lire les journaux.

import { signIn } from "@/auth";
import { isAuthConfigured } from "@/lib/authConfigured";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  AccessDenied:
    "Ce compte Google n'est pas autorisé. Cette app est privée et n'admet qu'une seule adresse.",
  Configuration:
    "Configuration d'authentification incomplète côté serveur. Rien n'est servi tant qu'elle ne l'est pas.",
  Verification: "Lien de connexion expiré ou déjà utilisé. Réessaie.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  const configured = isAuthConfigured();
  const message = error ? (MESSAGES[error] ?? "Connexion impossible. Réessaie.") : null;

  return (
    <main className="login">
      <h1 className="login__title">Connexion</h1>

      {!configured && (
        <p className="login__error">
          Authentification non configurée (AUTH_SECRET / AUTHORIZED_EMAIL manquants).
          Le bouton reste inactif : mieux vaut ne rien servir que servir sans garde.
        </p>
      )}

      {message && <p className="login__error">{message}</p>}

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: callbackUrl || "/" });
        }}
      >
        <button type="submit" className="login__btn" disabled={!configured}>
          Continuer avec Google
        </button>
      </form>
    </main>
  );
}
