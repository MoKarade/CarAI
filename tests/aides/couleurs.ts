// tests/aides/couleurs.ts — les deux mesures de couleur dont les gardes de la feuille ont besoin.
//
// Extrait quand un SECOND fichier de garde (`groupesAccueil.test.ts`) a eu besoin de la même
// mesure que `theme.test.ts` (CarAI#217) : recopier dix lignes de colorimétrie, c'est le plus sûr
// moyen d'avoir deux formules dont une seule est juste. PURES, sans lecture de fichier.

function lineaire(canal: number): number {
  const x = canal / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

function canaux(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** Clarté OKLab d'un `#rrggbb`, en points de 0 à 100 (la même échelle que `oklch(21.5% …)`). */
export function clarteOklab(hex: string): number {
  const [r, g, b] = canaux(hex).map(lineaire) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 100 * (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s);
}

/** Contraste WCAG 2.x de deux `#rrggbb` (1 à 21). */
export function contraste(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, bl] = canaux(hex).map(lineaire) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [clair = 0, sombre = 0] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (clair + 0.05) / (sombre + 0.05);
}
