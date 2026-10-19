// tests/carte.test.ts — projection Web Mercator et composition de la carte à tuiles.
//
// De la géométrie, donc vérifiable exactement. Ce qui se joue ici : si la projection est
// fausse d'un cheveu, le tracé passe À CÔTÉ des rues — et une carte où le trajet longe la
// route sans la suivre est pire qu'une absence de carte, parce qu'elle a l'air juste.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  composerVue,
  projeter,
  zoomPourCadrer,
  MAX_TUILES,
  TAILLE_TUILE,
  LARGEUR_DEFAUT,
  HAUTEUR_DEFAUT,
  ZOOM_MAX,
  ZOOM_MIN, recalerDecalage } from "@/lib/vehicle/carte";

describe("projeter — Web Mercator", () => {
  it("place l'origine (0°, 0°) au centre exact du monde", () => {
    const n = TAILLE_TUILE * 2 ** 4;
    const p = projeter({ lat: 0, lng: 0 }, 4);
    expect(p.x).toBeCloseTo(n / 2, 6);
    expect(p.y).toBeCloseTo(n / 2, 6);
  });

  // ⚠️ Valeurs MESURÉES contre la formule slippy-map officielle
  // (`(1 − asinh(tan φ)/π)/2 × 2^z`), pas devinées : une première version de ce test
  // portait des nombres approximatifs et aurait « prouvé » une projection fausse.
  // Vérifié aussi sur Londres (51,5 ; −0,12) au zoom 12 → 2046,6347 / 1362,1598.
  it("tombe sur les MÊMES tuiles que le référentiel OSM", () => {
    const p = projeter({ lat: 46.8139, lng: -71.208 }, 10);
    expect(p.x / TAILLE_TUILE).toBeCloseTo(309.4528, 3);
    expect(p.y / TAILLE_TUILE).toBeCloseTo(360.9425, 3);

    const londres = projeter({ lat: 51.5, lng: -0.12 }, 12);
    expect(londres.x / TAILLE_TUILE).toBeCloseTo(2046.6347, 3);
    expect(londres.y / TAILLE_TUILE).toBeCloseTo(1362.1598, 3);
  });

  it("le nord est en HAUT : une latitude plus grande donne un y plus petit", () => {
    const nord = projeter({ lat: 47, lng: -71.2 }, 12);
    const sud = projeter({ lat: 46, lng: -71.2 }, 12);
    expect(nord.y).toBeLessThan(sud.y);
  });

  // ⚠️ Mercator n'est PAS linéaire en latitude. Une projection naïve (mise à l'échelle
  // proportionnelle) décalerait le tracé par rapport aux rues — d'autant plus qu'on monte.
  it("n'est PAS linéaire en latitude — c'est tout l'objet de la formule", () => {
    const y0 = projeter({ lat: 0, lng: 0 }, 10).y;
    const y30 = projeter({ lat: 30, lng: 0 }, 10).y;
    const y60 = projeter({ lat: 60, lng: 0 }, 10).y;
    // Si c'était linéaire, les deux écarts seraient ÉGAUX (ratio 1). Mesuré : 22 918 px
    // contre 32 028 px, soit 1,397 — c'est cet étirement vers les pôles qui décalerait le
    // tracé si on projetait naïvement.
    const ratio = Math.abs(y60 - y30) / Math.abs(y30 - y0);
    expect(ratio).toBeCloseTo(1.397, 2);
  });

  it("borne aux pôles au lieu de diverger vers l'infini", () => {
    for (const lat of [90, -90, 89.9]) {
      const p = projeter({ lat, lng: 0 }, 5);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });

  it("doubler le zoom double les coordonnées monde", () => {
    const a = projeter({ lat: 46.8, lng: -71.2 }, 10);
    const b = projeter({ lat: 46.8, lng: -71.2 }, 11);
    expect(b.x).toBeCloseTo(a.x * 2, 4);
    expect(b.y).toBeCloseTo(a.y * 2, 4);
  });
});

describe("zoomPourCadrer", () => {
  it("choisit le zoom le plus DÉTAILLÉ qui contient encore tout le trajet", () => {
    const points = [
      { lat: 46.75, lng: -71.3 },
      { lat: 46.85, lng: -71.1 },
    ];
    const zoom = zoomPourCadrer(points, 640, 420);

    // À ce zoom, ça tient.
    const p = points.map((pt) => projeter(pt, zoom));
    expect(Math.max(...p.map((q) => q.x)) - Math.min(...p.map((q) => q.x))).toBeLessThanOrEqual(640 - 64);

    // Au zoom juste au-dessus, ça ne tiendrait plus — c'est ce qui prouve qu'on a pris le
    // plus détaillé possible et pas simplement un zoom prudent.
    const plusFin = points.map((pt) => projeter(pt, zoom + 1));
    const largeurPlusFin =
      Math.max(...plusFin.map((q) => q.x)) - Math.min(...plusFin.map((q) => q.x));
    const hauteurPlusFin =
      Math.max(...plusFin.map((q) => q.y)) - Math.min(...plusFin.map((q) => q.y));
    expect(largeurPlusFin > 640 - 64 || hauteurPlusFin > 420 - 64).toBe(true);
  });

  it("monte au zoom maximal sur un point unique — rien à cadrer", () => {
    expect(zoomPourCadrer([{ lat: 46.8, lng: -71.2 }], 640, 420)).toBe(ZOOM_MAX);
  });

  it("descend au minimum sur un trajet à l'échelle du globe", () => {
    const zoom = zoomPourCadrer(
      [
        { lat: 60, lng: -170 },
        { lat: -60, lng: 170 },
      ],
      640,
      420,
    );
    expect(zoom).toBe(ZOOM_MIN);
  });
});

describe("composerVue", () => {
  const trajet = [
    { lat: 46.8, lng: -71.25 },
    { lat: 46.82, lng: -71.22 },
    { lat: 46.84, lng: -71.2 },
  ];

  it("rend null sans point — jamais un cadre vide qui aurait l'air cassé", () => {
    expect(composerVue({ points: [] })).toBeNull();
  });

  it("couvre TOUT le cadre de tuiles, sans bande vide au bord", () => {
    const vue = composerVue({ points: trajet, largeur: 640, hauteur: 420 })!;

    // Chaque coin du cadre doit tomber dans une tuile posée.
    const coins: Array<[number, number]> = [
      [0, 0],
      [639, 0],
      [0, 419],
      [639, 419],
    ];
    for (const [cx, cy] of coins) {
      const couvert = vue.tuiles.some(
        (t) =>
          cx >= t.gauche && cx < t.gauche + TAILLE_TUILE &&
          cy >= t.haut && cy < t.haut + TAILLE_TUILE,
      );
      expect(couvert, `le coin ${cx},${cy} n'est couvert par aucune tuile`).toBe(true);
    }
  });

  it("CENTRE le trajet : le tracé reste dans le cadre", () => {
    const vue = composerVue({ points: trajet, largeur: 640, hauteur: 420 })!;
    for (const m of vue.marqueurs) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(640);
      expect(m.y).toBeGreaterThanOrEqual(0);
      expect(m.y).toBeLessThanOrEqual(420);
    }
  });

  it("garde l'ORDRE départ → arrivée dans les marqueurs", () => {
    const vue = composerVue({ points: trajet, largeur: 640, hauteur: 420 })!;
    expect(vue.marqueurs).toHaveLength(3);
    // Le trajet va vers le nord-est : x croît, y décroît.
    expect(vue.marqueurs[2]!.x).toBeGreaterThan(vue.marqueurs[0]!.x);
    expect(vue.marqueurs[2]!.y).toBeLessThan(vue.marqueurs[0]!.y);
  });

  it("compose des URL de tuile au format OSM", () => {
    const vue = composerVue({ points: trajet, zoom: 12 })!;
    for (const t of vue.tuiles) {
      expect(t.url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/12\/\d+\/\d+\.png$/);
    }
  });

  // ⚠️ OSM est un service BÉNÉVOLE dont la politique interdit le téléchargement en masse.
  it("BORNE le nombre de tuiles demandées", () => {
    const vue = composerVue({ points: trajet, largeur: 4000, hauteur: 4000, zoom: 16 })!;
    expect(vue.nbTuiles).toBeLessThanOrEqual(MAX_TUILES);
  });

  // La taille de composition par DÉFAUT est celle que toutes les pages utilisent : si elle
  // dépassait le plafond, chaque carte tronquerait ses tuiles (bandes grises) — la carte
  // serait cassée partout sans qu'un seul test ne la vise.
  it("la taille par DÉFAUT tient largement sous le plafond de tuiles", () => {
    const vue = composerVue({ points: trajet })!;
    expect(vue.largeur).toBe(LARGEUR_DEFAUT);
    expect(vue.hauteur).toBe(HAUTEUR_DEFAUT);
    // Au pire 6 colonnes × 4 rangées à 1280×620 : on veut de la marge, pas y être collé.
    expect(vue.nbTuiles).toBeLessThanOrEqual(24);
    expect(vue.nbTuiles).toBeLessThan(MAX_TUILES);
  });

  // ⚠️ Tripwire. Composée à 640, la carte était AGRANDIE ×2 dans `.carte-large` (84 rem) :
  // des tuiles raster de 256 px étirées sur 512, donc FLOUES — la moitié du « la carte
  // marche pas » du 13/08. Redescendre cette constante ramènerait le défaut sans rien
  // casser d'autre, donc rien ne le signalerait.
  it("compose assez large pour ne pas être agrandie dans la carte", () => {
    expect(LARGEUR_DEFAUT).toBeGreaterThanOrEqual(1024);
  });

  // Les tuiles doivent PAVER le cadre : leur largeur en pourcentage est dérivée de
  // `vue.largeur` côté composant, et un décalage laisserait des bandes vides au bord.
  it("les tuiles pavent le cadre de bout en bout, sans trou", () => {
    const vue = composerVue({ points: trajet, largeur: 800, hauteur: 500, zoom: 13 })!;
    const gauches = [...new Set(vue.tuiles.map((t) => t.gauche))].sort((a, b) => a - b);
    // La première commence AVANT ou SUR le bord gauche…
    expect(gauches[0]).toBeLessThanOrEqual(0);
    // …la dernière dépasse le bord droit, sinon il manquerait une bande…
    expect(gauches[gauches.length - 1]! + TAILLE_TUILE).toBeGreaterThanOrEqual(800);
    // …et elles se suivent exactement d'une tuile, sans saut.
    for (let i = 1; i < gauches.length; i += 1) {
      expect(gauches[i]! - gauches[i - 1]!).toBe(TAILLE_TUILE);
    }
  });

  it("respecte le zoom demandé, borné aux limites du service", () => {
    expect(composerVue({ points: trajet, zoom: 14 })!.zoom).toBe(14);
    // Au-delà de 19, les tuiles n'existent pas — elles arriveraient en gris.
    expect(composerVue({ points: trajet, zoom: 99 })!.zoom).toBe(ZOOM_MAX);
    expect(composerVue({ points: trajet, zoom: -5 })!.zoom).toBe(ZOOM_MIN);
  });

  it("ne demande jamais une tuile hors du monde en Y, et boucle en X", () => {
    // Près de l'antiméridien : les tuiles doivent revenir de l'autre côté, pas être
    // demandées avec un index négatif (404 gris).
    const vue = composerVue({
      points: [{ lat: 0, lng: 179.99 }],
      largeur: 640,
      hauteur: 420,
      zoom: 3,
    })!;
    const n = 2 ** 3;
    for (const t of vue.tuiles) {
      const [, x, y] = t.cle.split("/").map(Number);
      expect(x!).toBeGreaterThanOrEqual(0);
      expect(x!).toBeLessThan(n);
      expect(y!).toBeGreaterThanOrEqual(0);
      expect(y!).toBeLessThan(n);
    }
  });
});

// ⚠️ TRIPWIRE DE COLLISION DE CLASSE. Les tuiles OSM portaient `className="tuile"` ; la
// refonte du 13/08 a ensuite introduit une règle GLOBALE `.tuile` (rembourrage, bordure,
// coins arrondis) pour les tuiles du tableau de bord. Les deux se sont rencontrées en
// silence : chaque tuile de carte a reçu un rembourrage, donc une gouttière — « carte
// toujours tronquée ». Ni le typecheck, ni le lint, ni les tests ne voient une collision
// de CSS, et la capture ne la montrait pas non plus (tuiles bloquées, donc vides).
//
// Deux verrous ici, parce que le nom vit dans DEUX fichiers qui ne se parlent pas :
describe("le nom de classe des tuiles de carte", () => {
  // ⚠️ Le verrou couvre TOUS les composants qui posent des tuiles, pas seulement le
  // premier. `CarteInteractive.tsx` est arrivé le 14/08 avec `className="tuile"` — le nom
  // d'AVANT la refonte : il réintroduisait la gouttière que ce tripwire existe pour
  // empêcher, sans que rien ne le signale, puisque le test ne lisait qu'un seul fichier.
  // Un garde qui ne regarde qu'un exemplaire d'une classe de fichiers a un trou par
  // construction : il faut l'ouvrir sur la famille entière.
  const composants = ["app/ui/Carte.tsx", "app/ui/CarteInteractive.tsx"];
  const css = readFileSync("app/globals.css", "utf8");

  it.each(composants)("%s n'utilise pas `tuile` — ce nom est celui du tableau de bord", (f) => {
    const composant = readFileSync(f, "utf8");
    expect(composant).not.toMatch(/className="tuile"/);
    expect(composant).toMatch(/className="tuile-osm"/);
  });

  // ⚠️ SECOND VERROU SUR LA MÊME FAMILLE DE FICHIERS, et il vient d'un vrai bug.
  //
  // La largeur d'une tuile se pose EN LIGNE, dérivée de `vue.largeur` — jamais en CSS.
  // `CarteInteractive.tsx` est arrivée le 14/08 sans elle : chaque tuile s'affichait à ses
  // 256 px naturels quelle que soit la largeur du cadre, la grille ne pavait plus, et la
  // carte était cassée à l'écran (« la carte marche pas », Marc, 17/08).
  //
  // Le tripwire du NOM DE CLASSE existait déjà et n'a rien vu : il vérifiait le nom, pas le
  // placement. Une famille de fichiers a autant de trous que de propriétés non verrouillées
  // — vérifier une seule d'entre elles donne l'illusion d'être couvert.
  it.each(composants)("%s dérive la largeur des tuiles de vue.largeur", (f) => {
    const composant = readFileSync(f, "utf8");
    expect(
      composant,
      "sans width dérivé de vue.largeur, les tuiles gardent leur taille naturelle et la carte se disloque",
    ).toMatch(/width:\s*`\$\{\(TAILLE_TUILE \/ vue\.largeur\) \* 100\}%`/);
  });

  it("est le MÊME des deux côtés — un renommage à moitié fait casse le placement", () => {
    // Le sélecteur CSS doit exister, sinon les tuiles perdent leur positionnement absolu
    // et s'empilent les unes sous les autres.
    expect(css).toMatch(/\.carte-cadre \.tuile-osm/);
  });
});

// ── Déplacement et zoom ancré (ajoutés le 14/08 : « je veux pouvoir zoomer, cliquer ») ──

describe("decalage du cadre", () => {
  const points = [
    { lat: 46.81, lng: -71.21 },
    { lat: 46.82, lng: -71.19 },
  ];

  it("déplace le contenu DANS le sens du doigt", () => {
    const sans = composerVue({ points, zoom: 14 })!;
    const avec = composerVue({ points, zoom: 14, decalage: { x: 100, y: 0 } })!;
    // Glisser vers la droite (+x) doit faire avancer les marqueurs vers la droite.
    expect(avec.marqueurs[0]!.x).toBeCloseTo(sans.marqueurs[0]!.x + 100, 1);
  });

  it("déplace aussi les tuiles, sinon le fond et le tracé se désolidarisent", () => {
    const sans = composerVue({ points, zoom: 14 })!;
    const avec = composerVue({ points, zoom: 14, decalage: { x: 0, y: 60 } })!;
    // Apparier par CLÉ, pas par index : décaler change QUELLES tuiles entrent dans le
    // cadre, donc `tuiles[0]` n'est pas la même des deux côtés.
    const reference = sans.tuiles.find((t) => avec.tuiles.some((u) => u.cle === t.cle));
    expect(reference).toBeDefined();
    const deplacee = avec.tuiles.find((t) => t.cle === reference!.cle)!;
    expect(deplacee.haut).toBeCloseTo(reference!.haut + 60, 1);
  });

  it("un décalage nul rend exactement la vue centrée", () => {
    expect(composerVue({ points, zoom: 14, decalage: { x: 0, y: 0 } })).toEqual(
      composerVue({ points, zoom: 14 }),
    );
  });
});

describe("recalerDecalage", () => {
  // La propriété qui compte : zoomer au CENTRE ne déplace pas la carte.
  it("ne bouge rien quand on zoome au centre", () => {
    expect(recalerDecalage({ decalage: 0, taille: 640, position: 320, dz: 1 })).toBe(0);
    expect(recalerDecalage({ decalage: 0, taille: 640, position: 320, dz: -1 })).toBe(0);
  });

  it("garde un point de bord sous le curseur", () => {
    const taille = 640;
    const position = 0; // bord gauche
    const decalage = 0;
    // Origine avant : centre − taille/2 − décalage. Le point de bord est à `origine + 0`.
    // Après un zoom ×2, ce même point du monde doit retomber à la position 0.
    const apres = recalerDecalage({ decalage, taille, position, dz: 1 });
    // Formule attendue : (s−1)(taille/2 − position) = 1 × 320 = 320.
    expect(apres).toBe(320);
  });

  it("est réversible : zoomer puis dézoomer au même point revient au départ", () => {
    const taille = 640;
    const position = 210;
    const avant = 45;
    const zoome = recalerDecalage({ decalage: avant, taille, position, dz: 1 });
    const revenu = recalerDecalage({ decalage: zoome, taille, position, dz: -1 });
    expect(revenu).toBeCloseTo(avant, 9);
  });
});
