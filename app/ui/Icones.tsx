// app/ui/Icones.tsx — le jeu d'icônes de CarAI, dessiné une fois, utilisé partout.
//
// Refonte « style constructeur » (Marc, 17/08/2026) : icônes SVG fines, monochromes,
// tracées au trait — JAMAIS d'emoji (son choix explicite au cadrage : « colle au style
// sobre »). Elles héritent de `currentColor` : la couleur vient du contexte, ce qui les
// fait suivre les états (ok / attention / danger) sans qu'aucune icône ne porte de teinte.
//
// Toutes sur la même grille 24×24, même épaisseur de trait (1.8), bouts ronds. Une icône
// qui dévie de la grille se voit immédiatement à côté des autres — c'est l'uniformité qui
// fait le rendu « produit fini », pas le dessin individuel.
//
// `aria-hidden` par défaut : une icône ACCOMPAGNE toujours un libellé texte, elle ne le
// remplace jamais (a11y). Le libellé peut être visuellement compact (pastille), mais il
// existe dans le DOM.

import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement> & { taille?: number };

function Socle({ taille = 20, children, ...reste }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={taille}
      height={taille}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...reste}
    >
      {children}
    </svg>
  );
}

/** Éclair — charge, énergie. Le motif de l'icône de l'app. */
export function IcoEclair(p: Props) {
  return (
    <Socle {...p}>
      <path d="M13 2 5 13.5h5.5L11 22l8-11.5h-5.5L13 2Z" />
    </Socle>
  );
}

/** Batterie avec niveau — l'état de charge. `niveau` de 0 à 1 remplit le corps. */
export function IcoBatterie({ niveau, ...p }: Props & { niveau?: number }) {
  const n = niveau === undefined ? null : Math.max(0, Math.min(1, niveau));
  return (
    <Socle {...p}>
      <rect x="2" y="7.5" width="17" height="9" rx="2" />
      <path d="M22 10.5v3" />
      {n !== null && n > 0.02 && (
        <rect x="4" y="9.5" width={13 * n} height="5" rx="1" fill="currentColor" stroke="none" />
      )}
    </Socle>
  );
}

/** Cadenas fermé. */
export function IcoVerrou(p: Props) {
  return (
    <Socle {...p}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </Socle>
  );
}

/** Cadenas ouvert — l'anse détachée du corps. */
export function IcoVerrouOuvert(p: Props) {
  return (
    <Socle {...p}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 7.6-1.8" />
    </Socle>
  );
}

/** Épingle de position. */
export function IcoPosition(p: Props) {
  return (
    <Socle {...p}>
      <path d="M12 21.5s-7-6.2-7-11.3a7 7 0 0 1 14 0c0 5.1-7 11.3-7 11.3Z" />
      <circle cx="12" cy="10" r="2.6" />
    </Socle>
  );
}

/** Compteur / autonomie — cadran avec aiguille. */
export function IcoCompteur(p: Props) {
  return (
    <Socle {...p}>
      <path d="M4.5 19a9 9 0 1 1 15 0" />
      <path d="M12 13.5 15.5 9" />
      <circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none" />
    </Socle>
  );
}

/** Horloge — fraîcheur d'une donnée. */
export function IcoHorloge(p: Props) {
  return (
    <Socle {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Socle>
  );
}

/** Triangle d'avertissement. */
export function IcoAttention(p: Props) {
  return (
    <Socle {...p}>
      <path d="M12 3.5 22 20H2L12 3.5Z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </Socle>
  );
}

/** Coche — état confirmé. */
export function IcoCoche(p: Props) {
  return (
    <Socle {...p}>
      <path d="m4.5 12.5 5 5L19.5 7" />
    </Socle>
  );
}

/** Tilde géant — valeur ESTIMÉE, jamais mesurée. Le marqueur d'honnêteté du produit. */
export function IcoEstime(p: Props) {
  return (
    <Socle {...p}>
      <path d="M4 13.5c2.2-3.4 4.6-3.4 6.8-.9 2.2 2.5 4.6 2.5 6.8-.9" />
    </Socle>
  );
}

/** ⓘ — ouvre l'explication complète. */
export function IcoInfo(p: Props) {
  return (
    <Socle {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </Socle>
  );
}

/** Maison — accueil. */
export function IcoAccueil(p: Props) {
  return (
    <Socle {...p}>
      <path d="m3.5 10.5 8.5-7 8.5 7" />
      <path d="M5.5 9v11h13V9" />
    </Socle>
  );
}

/** Itinéraire — activité (trajets + recharges). */
export function IcoActivite(p: Props) {
  return (
    <Socle {...p}>
      <circle cx="6" cy="18.5" r="2.5" />
      <circle cx="18" cy="5.5" r="2.5" />
      <path d="M8.5 18.5H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5" strokeDasharray="0.1 3.4" />
    </Socle>
  );
}

/** Courbe qui monte — tendances. */
export function IcoTendances(p: Props) {
  return (
    <Socle {...p}>
      <path d="M3.5 20.5V4" />
      <path d="M3.5 20.5H20" />
      <path d="m6.5 15.5 4-5 3.5 2.5 5-6.5" />
    </Socle>
  );
}

/** Engrenage — réglages. */
export function IcoReglages(p: Props) {
  return (
    <Socle {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.7M12 18.5v2.7M21.2 12h-2.7M5.5 12H2.8M18.5 5.5l-1.9 1.9M7.4 16.6l-1.9 1.9M18.5 18.5l-1.9-1.9M7.4 7.4 5.5 5.5" />
    </Socle>
  );
}

/** Base de données — l'écran technique. */
export function IcoBase(p: Props) {
  return (
    <Socle {...p}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="3" />
      <path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13" />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </Socle>
  );
}

/** Prise de charge — l'action « charger » sur le schéma. */
export function IcoPrise(p: Props) {
  return (
    <Socle {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="9.2" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="9.2" cy="14.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.8" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </Socle>
  );
}

/** Flèche de navigation vers un détail. */
export function IcoChevron(p: Props) {
  return (
    <Socle {...p}>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </Socle>
  );
}

/** Voiture de profil — l'objet du produit. */
export function IcoVoiture(p: Props) {
  return (
    <Socle {...p}>
      <path d="M3.5 16.5V13l1.8-4.4A2 2 0 0 1 7.2 7.5h9.6a2 2 0 0 1 1.9 1.1L20.5 13v3.5" />
      <path d="M3.5 13h17" />
      <circle cx="7.5" cy="16.5" r="1.9" />
      <circle cx="16.5" cy="16.5" r="1.9" />
    </Socle>
  );
}

// ── ILLUSTRATIONS ───────────────────────────────────────────────────────────────────────
//
// Marc, 20/08 : « pour charge je veux genre une image ou un logo électrique, un le plug
// qu'on branche, que ce soit visuel ». Les icônes de 20 px ci-dessus ACCOMPAGNENT un
// libellé ; ce qu'il demande ici, c'est le contraire — un objet qu'on regarde d'abord.
//
// Même grammaire quand même (trait, `currentColor`, aucune image externe, aucun emoji —
// son choix du 17/08 tient) mais à une taille d'illustration, avec des aplats. Le dépôt
// est PUBLIC et l'app n'embarque aucun asset : tout est dessiné ici.

/** Les quatre états que l'illustration sait montrer — mêmes noms que `statutDeCharge`. */
export type EtatPrise = "en-charge" | "branchee-en-attente" | "debranchee" | "inconnu";

/**
 * Le connecteur de charge, avec son câble. Branché et parcouru d'un éclair quand ça charge,
 * branché et inerte en attente, écarté du socle quand c'est débranché, pointillé si on ne
 * sait pas. La couleur vient du contexte (`currentColor`) : c'est le bandeau qui la donne.
 */
export function IllustrationCharge({
  etat,
  taille = 64,
}: {
  etat: EtatPrise;
  taille?: number;
}) {
  const branche = etat === "en-charge" || etat === "branchee-en-attente";
  // Débranché : le connecteur recule et le câble se détend — l'écart SE VOIT, c'est
  // l'information. Inconnu : rien n'est affirmé, tout est en pointillé.
  const decalage = branche ? 0 : 5;
  const pointille = etat === "inconnu" ? "3 3" : undefined;

  return (
    <svg
      viewBox="0 0 64 48"
      width={taille}
      height={(taille * 48) / 64}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`illu-charge illu-${etat}`}
    >
      {/* Le socle : la trappe de charge de la voiture. */}
      <rect x="2.5" y="12" width="16" height="24" rx="4" strokeDasharray={pointille} />
      <circle cx="10.5" cy="20" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="10.5" cy="28" r="1.6" fill="currentColor" stroke="none" />

      {/* Le connecteur, décalé quand il n'est pas branché. */}
      <g transform={`translate(${decalage} 0)`}>
        <rect
          x="21"
          y="15"
          width="14"
          height="18"
          rx="3.5"
          strokeDasharray={pointille}
          fill="currentColor"
          fillOpacity={branche ? 0.16 : 0.06}
        />
        {/* Les broches qui entrent dans le socle : elles ne se dessinent QUE branché —
            sinon l'image montrerait un contact qui n'existe pas. */}
        {branche && (
          <>
            <path d="M21 21h-3.2" />
            <path d="M21 27h-3.2" />
          </>
        )}
        {/* Le câble, tendu vers la borne. */}
        <path
          d={branche ? "M35 24h9c5 0 8 3 8 8v6" : "M35 24h7c6 0 9 4 9 9v5"}
          strokeDasharray={pointille}
        />
        <circle cx="52" cy="41" r="3" strokeDasharray={pointille} />
      </g>

      {/* L'éclair : PLEIN et animé seulement quand ça charge vraiment. En attente il reste
          un contour — la différence entre « branchée » et « en charge » se lit d'un coup. */}
      {(etat === "en-charge" || etat === "branchee-en-attente") && (
        <path
          d="M29.5 7 24 15.5h4.2L27.5 22l5.8-8.5h-4.2L29.5 7Z"
          fill={etat === "en-charge" ? "currentColor" : "none"}
          fillOpacity={etat === "en-charge" ? 1 : 0}
          strokeWidth={1.6}
          className={etat === "en-charge" ? "illu-eclair-actif" : undefined}
        />
      )}
    </svg>
  );
}

/** Route sinueuse — les kilomètres parcourus. */
export function IcoRoute(p: Props) {
  return (
    <Socle {...p}>
      <path d="M8 21c0-4 4-4 4-9s-4-5-4-9" />
      <path d="M16 3v3M16 10.5v3M16 18v3" />
    </Socle>
  );
}

/** Calendrier — une fenêtre de temps (le mois, la période). */
export function IcoCalendrier(p: Props) {
  return (
    <Socle {...p}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Socle>
  );
}

/** Jauge à aiguille — une part consommée d'un budget. */
export function IcoJauge(p: Props) {
  return (
    <Socle {...p}>
      <path d="M3.5 18a8.5 8.5 0 0 1 17 0" />
      <path d="m12 18 4.5-6" />
      <circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </Socle>
  );
}

/** Pièce — un coût. */
export function IcoPiece(p: Props) {
  return (
    <Socle {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M14.5 9.8c-.6-.8-1.6-1.2-2.6-1.2-1.4 0-2.4.8-2.4 1.9 0 2.6 5.2 1.4 5.2 4 0 1.2-1.1 2-2.6 2-1.1 0-2.1-.4-2.7-1.2" />
    </Socle>
  );
}

/** Courbe qui monte — un graphique, une tendance. */
export function IcoCourbe(p: Props) {
  return (
    <Socle {...p}>
      <path d="M3.5 20.5V4" />
      <path d="M3.5 20.5H21" />
      <path d="m6.5 16 4-4.5 3.5 2.5 5.5-6.5" />
    </Socle>
  );
}
