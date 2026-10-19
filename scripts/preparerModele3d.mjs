// scripts/preparerModele3d.mjs — la recette du modèle 3D livré, pour qu'elle ne soit pas
// qu'un souvenir.
//
// ══ CE QU'IL FAIT, ET POURQUOI IL EXISTE ═════════════════════════════════════════════
//
// `public/modele/bz.glb` n'est pas le fichier d'origine : celui-ci pèse **81,7 Mo** et
// contient bien plus qu'une voiture. Ce script est l'étape 1 de la recette qui produit les
// 6 Mo livrés, et il est ici pour qu'on puisse la rejouer — un asset préparé une fois à la
// main est un asset que personne ne saura refaire quand la source changera.
//
// ══ LA RECETTE COMPLÈTE, DEUX ÉTAPES ═════════════════════════════════════════════════
//
//   node scripts/preparerModele3d.mjs <source.glb> /tmp/filtre.glb
//   npx --yes @gltf-transform/cli optimize /tmp/filtre.glb public/modele/bz.glb \
//       --compress draco --texture-compress webp --texture-size 1024 \
//       --simplify true --simplify-error 0.001
//
// ⚠️ Ce script a besoin de `@gltf-transform/core` et `@gltf-transform/extensions`, qui ne
// sont PAS des dépendances de CarAI et n'ont pas à l'être : ils ne servent qu'à préparer un
// asset, jamais à le servir. `npx --yes --package=@gltf-transform/core
// --package=@gltf-transform/extensions node scripts/preparerModele3d.mjs …` suffit.
//
// ══ CE QUE LA RECETTE A DONNÉ, MESURÉ LE 18/09/2026 ══════════════════════════════════
//
//   81,67 Mo · 2 071 673 triangles · 213 meshes   →   6,05 Mo · 773 056 tri · 12 meshes
//
// soit **−92,6 %**, sans perte visible (l'erreur de simplification est à 0,001). Et les
// dimensions du résultat concordent avec la bZ4X du catalogue à 0,02 % sur la longueur —
// c'est ce qui prouve que rien d'essentiel n'a été emporté.
//
// ⚠️ **La fusion des maillages (`join`, actif par défaut) est VOULUE.** Sans elle le
// fichier pèse 6,94 Mo et garde 211 maillages, donc 211 appels de rendu — mauvais sur un
// téléphone. On ne perd rien en les fusionnant : les pièces n'étaient DÉJÀ pas séparables
// (les quatre roues partagent un maillage à la source), ce que `lib/vehicle/ancresVoiture.ts`
// explique en détail.
//
// ══ CE QUE CE FICHIER-CI RETIRE ══════════════════════════════════════════════════════
//
// Retire du modèle tout ce qui n'est pas LA VOITURE : les accessoires de scène
// (kayak, skis, vélo, galerie Thule) et les nuanciers de sellerie posés à côté d'elle.
// Sans ce passage, la boîte englobante fait 583 cm de large au lieu de 212 — la caméra ne
// sait plus cadrer, et Marc voit un kayak à côté de son auto.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";

const ACCESSOIRES = /KAYAK|SKIS?\d*|BIKE|THULE|STRAP|FOOTBALL/i;
// La bZ4X fait 186 cm de large (1 unité = 1 cm) : elle s'étend de −104 à +104 sur X.
// Tout ce qui est centré au-delà est posé À CÔTÉ d'elle — mesuré : 47 meshes, 3 % des
// triangles, portant des tissus, du cuir, des ceintures et des étiquettes, c'est-à-dire
// les nuanciers de sellerie d'un configurateur.
const X_HORS_VOITURE = 150;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const racine = doc.getRoot();

const vises = new Set(racine.listMaterials().filter((m) => ACCESSOIRES.test(m.getName() ?? "")));
let parMateriau = 0;
let parPosition = 0;

for (const mesh of racine.listMeshes()) {
  // Centre du mesh sur l'axe de la largeur.
  let min = Infinity;
  let max = -Infinity;
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION");
    if (!pos) continue;
    min = Math.min(min, pos.getMinNormalized([0, 0, 0])[0]);
    max = Math.max(max, pos.getMaxNormalized([0, 0, 0])[0]);
  }
  const centre = (min + max) / 2;
  const horsVoiture = Number.isFinite(centre) && Math.abs(centre) > X_HORS_VOITURE;

  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    if (horsVoiture || (mat && vises.has(mat))) {
      if (horsVoiture) parPosition++;
      else parMateriau++;
      mesh.removePrimitive(prim);
      prim.dispose();
    }
  }
  if (mesh.listPrimitives().length === 0) mesh.dispose();
}
console.log(`retirées — accessoires : ${parMateriau} · hors voiture : ${parPosition}`);
await io.write(process.argv[3], doc);
