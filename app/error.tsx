"use client";

// app/error.tsx — la page affichée quand une page plante de façon imprévue.
//
// Sans ce fichier, Next.js montre son écran d'erreur en anglais. Ici : une phrase claire et
// un bouton « Réessayer » qui relance l'affichage. Le texte technique de l'erreur n'est
// JAMAIS montré (il va aux journaux du serveur). Balises simples : la feuille de style
// globale les habille déjà dans le thème sombre. L'erreur part à Sentry (éteint sans DSN, aucune
// donnée personnelle : lib/sentryConfig.ts) ; l'écran, lui, n'en montre rien.

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function ErreurGenerale({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main>
      <h1>Quelque chose n’a pas marché</h1>
      <p>La page n’a pas pu s’afficher. Tes données ne sont pas touchées.</p>
      <p>
        <button type="button" onClick={() => reset()}>
          Réessayer
        </button>
      </p>
    </main>
  );
}
