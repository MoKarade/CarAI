# Le décodeur Draco — d'où viennent ces deux fichiers

Copiés **tels quels** de `node_modules/three/examples/jsm/libs/draco/gltf/`, livrés avec
`three`. Ils décompressent la géométrie de `public/modele/bz.glb`, qui déclare
`KHR_draco_mesh_compression` en extension **requise** : sans eux, le modèle ne s'ouvre pas.

## Pourquoi une copie plutôt qu'un CDN

Une dépendance réseau de plus au moment où l'on regarde sa voiture, sur un hôte que
personne ici ne contrôle. Le dépôt a déjà tranché ça pour les polices (`next/font/google`
retiré chez BatchChef pour la même raison).

## Pourquoi seulement deux fichiers

`DRACOLoader` ne télécharge le troisième (`draco_decoder.js`, 512 Ko de repli asm.js) que
si `typeof WebAssembly !== "object"`. Un navigateur sans WebAssembly ne fait pas tourner
WebGL non plus : la vue 3D lui est de toute façon fermée, et l'écran le dit.

## ⚠️ Ces fichiers DÉRIVENT en silence

Ils ne sont pas régénérés au build : une mise à jour de `three` changerait ceux de
`node_modules` sans toucher ceux-ci, et un décodeur désaccordé de son chargeur échoue
**au chargement du modèle**, pas au build ni aux tests. `tests/decodeurDraco.test.ts`
compare les octets des deux copies et rougit à la première divergence. Pour le
resynchroniser :

    cp node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js public/draco/
    cp node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm     public/draco/
