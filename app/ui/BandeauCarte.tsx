// app/ui/BandeauCarte.tsx — la ligne sous une carte Google, qui porte le clic droit de LIA.
//
// Une carte Google garde le clic droit pour elle : l'iframe d'une autre origine (Embed) et la
// carte de l'API JavaScript le consomment, LIA ne peut pas le relayer (Marc, 28/10/2026 : bandeau
// sous la carte, option A). Le bandeau est un élément de la page : un clic droit dessus ouvre le
// menu de LIA, qui sait de quelle carte il s'agit grâce à `data-lia-genre`.

import type { ReactNode } from "react";

export function BandeauCarte({ genre, children }: { genre: string; children: ReactNode }) {
  return (
    <p className="hint bandeau-carte" data-lia-genre={genre}>
      {children}
    </p>
  );
}
