// lib/carteVivante.ts — la carte Google VIVANTE (Maps JavaScript API). PUR, testé.
//
// ══ POURQUOI UNE TROISIÈME API GOOGLE ═══════════════════════════════════════════════════
// Marc, 20/08 : « carte je peux pas zoomer ni me déplacer, inutile ». Les deux produits
// utilisés jusqu'ici ne peuvent pas répondre :
//   • Maps STATIC rend une IMAGE. Elle est nette, elle est honnête, et elle est morte :
//     aucun zoom, aucun déplacement.
//   • Maps EMBED (iframe) est vivante, mais ne sait afficher NI plusieurs marqueurs NI un
//     tracé arbitraire — `place` pose UNE épingle, `directions` calcule UN itinéraire.
// La vue d'ensemble montre des centaines de relevés : il faut l'API JavaScript, la seule
// qui combine « vivante » et « N objets ».
//
// ⚠️ Elle doit être ACTIVÉE à part dans Google Cloud Console (« Maps JavaScript API »),
// exactement comme l'a été « Maps Static API ». Tant que ce n'est pas fait, le chargement
// échoue — et le composant bascule sur la carte interactive de CarAI (tuiles OSM), qui
// zoome et se déplace elle aussi. Aucun chemin ne redonne d'image morte.
//
// ══ CE QUI VIT ICI ══════════════════════════════════════════════════════════════════════
// Ce fichier ne contient QUE du pur : l'URL du SDK et les styles. Le composant client
// (`app/ui/CarteGoogleVivante.tsx`) fait le reste. C'est ce qui rend testable la partie
// qui porte des règles — notamment l'HONNÊTETÉ du tracé.

export interface PointVivant {
  lat: number;
  lng: number;
  /** Texte de survol. Absent quand la source ne nomme pas le point. */
  libelle?: string;
}

/**
 * L'URL du SDK Maps JavaScript.
 *
 * `loading=async` est requis par Google depuis 2023 : sans lui la console avertit et le
 * chargement bloque le rendu. `callback` est obligatoire avec `loading=async` — sans lui
 * le script se charge mais rien ne signale QUAND il est prêt, et l'échec serait un écran
 * vide sans message. `v=weekly` suit les correctifs sans figer une version qui vieillit.
 * Aucune `libraries=` : les marqueurs et polylignes classiques sont dans le noyau, et
 * chaque bibliothèque en plus est du poids téléchargé pour rien.
 * PURE.
 */
export function urlSdkMaps({ cle, callback }: { cle: string; callback: string }): string {
  const p = new URLSearchParams({
    key: cle,
    v: "weekly",
    language: "fr",
    region: "CA",
    loading: "async",
    callback,
  });
  return `https://maps.googleapis.com/maps/api/js?${p.toString()}`;
}

/** Le nom global par lequel le SDK signale qu'il est prêt. Un seul pour toute l'app. */
export const CALLBACK_SDK = "__caraiMapsPret";

/**
 * ⚠️ HONNÊTETÉ DU TRACÉ — même contrat que l'image statique d'avant.
 * Un trait entre deux relevés n'est PAS une route mesurée : la bZ ne publie sa position
 * qu'à l'arrêt. Le trait est donc FIN et SEMI-TRANSPARENT (opacité < 1), jamais un trait
 * plein qui affirmerait un itinéraire que la voiture n'a pas déclaré. Verrouillé par test.
 */
export const TRACE_VIVANTE = {
  strokeColor: "#3b82f6",
  strokeOpacity: 0.6,
  strokeWeight: 3,
} as const;

/**
 * Marqueurs. Un cercle de taille FIXE en pixels (`SymbolPath.CIRCLE` mis à l'échelle),
 * pas un rayon en mètres : un rayon en mètres grossirait au zoom et un nuage de relevés
 * deviendrait une tache. Bleu franc — le fond de carte de Google est clair quel que soit
 * le thème de l'app, et un bleu pâle y disparaît (leçon du 20/08).
 */
export const MARQUEUR_RELEVE = {
  couleur: "#2563eb",
  taille: 5,
  contour: "#ffffff",
  epaisseurContour: 1.5,
} as const;

/** La DERNIÈRE position : plus grosse et d'une autre teinte, pour se distinguer du nuage. */
export const MARQUEUR_DERNIER = {
  couleur: "#f97316",
  taille: 8,
  contour: "#ffffff",
  epaisseurContour: 2,
} as const;

/** Marge en pixels autour des points quand la carte se cadre. */
export const MARGE_CADRAGE = 28;

/**
 * Au-delà, on ne pose pas un marqueur par relevé : le SDK ralentit et le nuage devient
 * illisible. On échantillonne RÉGULIÈREMENT (jamais les N derniers — ça effacerait la
 * moitié ancienne de la période sans le dire), et l'appelant ANNONCE l'échantillonnage.
 */
export const MAX_MARQUEURS = 400;

/**
 * Échantillonne un nuage à `max` points en gardant TOUJOURS le premier et le dernier :
 * le dernier porte le marqueur distinct, le premier ancre le début de la période. PURE.
 */
export function echantillonner<T>(points: ReadonlyArray<T>, max: number): T[] {
  if (max < 2) return points.length > 0 ? [points[points.length - 1]!] : [];
  if (points.length <= max) return [...points];
  const pas = (points.length - 1) / (max - 1);
  const sortie: T[] = [];
  for (let i = 0; i < max; i++) sortie.push(points[Math.round(i * pas)]!);
  return sortie;
}
