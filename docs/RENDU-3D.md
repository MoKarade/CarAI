# Passer du dessin au vrai rendu 3D de la bZ

> Plan demandé par Marc le 20/08 : « pour le vrai rendu 3D je veux une bonne façon de faire
> que ce soit beau visuellement ».

## 1. Où le rendu se fait — et la correction du 20/08

⚠️ **Une première version de ce document affirmait que le rendu devait se faire sur le PC
de Marc.** C'était faux, et l'erreur mérite d'être nommée : j'avais conclu « je ne peux pas
faire de 3D » à partir de « je ne peux pas récupérer le fichier ». Deux problèmes
différents, dont un seul était réel.

**Le rendu 3D tourne dans cet environnement.** Vérifié, pas supposé : three.js installé
depuis npm, `GLTFLoader` chargé, WebGL rendu par Chromium headless (`--use-angle=swiftshader`),
caméra orthographique, fond transparent, éclairage à trois sources. La capture de preuve a
été produite avant d'écrire cette ligne.

Ce qui bloquait vraiment, c'était le TRANSPORT du fichier :

| Canal | État | Pourquoi |
|---|---|---|
| Sketchfab, Google Drive en direct | ❌ | domaines bloqués par le proxy réseau |
| L'outil Drive | ❌ | il rend le fichier **encodé en texte** : 81 Mo → ~110 Mo de contexte |
| **`git clone`** | ✅ | **écrit sur le DISQUE, sans passer par le contexte** |

C'est la distinction qui débloque tout : 81 Mo n'est pas trop gros pour git, c'était trop
gros pour un transfert *par texte*. Le modèle arrive donc par un dépôt GitHub.

L'app, elle, ne reçoit toujours qu'un PNG — et ça reste le bon choix indépendamment du
réseau : embarquer un modèle glTF et un moteur 3D dans le navigateur pour afficher une vue
fixe coûterait des centaines de Ko à chaque visite, pour un résultat identique.

⚠️ **Le dépôt est privé, mais le privé ne donne pas de licence.** Le modèle est sous
Creative Commons : l'attribution de son auteur part avec l'image, dans `public/` et ici.

## 2. La vue : de dessus, et pourquoi

Marc a envoyé cinq rendus. Le 3/4 avant est le plus beau — c'est l'angle des applications
constructeur. La vue de dessus est retenue quand même, pour une raison qui n'est pas
esthétique :

**Elle est la seule où les quatre roues, les quatre portières et le hayon existent chacun à
leur place.** Dix informations doivent se poser sur la carrosserie, dont quatre pressions
qui ne veulent rien dire si on ne voit pas SUR QUELLE roue elles sont. En 3/4, deux roues
sur quatre sont cachées : les pressions devraient repartir dans un plan séparé, et on
perdrait précisément ce que Marc a demandé.

> Si la vue de dessus déçoit à l'usage, l'alternative existe et elle est chiffrable : hero
> en 3/4 pour la beauté + mini-plan de dessus pour les pressions. C'est un choix produit
> (deux images à regarder au lieu d'une), pas une limite technique.

## 2 bis. Comment le modèle arrive ici

Par un dépôt GitHub, cloné sur le disque. Deux chemins selon l'outillage de Marc :

- **Avec GitHub Desktop ou git** : dépôt privé (`bz-modele` par exemple), le `.glb` dedans,
  poussé tel quel. 81 Mo passent — la limite GitHub est de 100 Mo par fichier, avec un
  simple avertissement au-delà de 50.
- **Sans rien installer** : passer le `.glb` dans **gltf.report** (navigateur), appliquer la
  compression de textures et Draco, télécharger le résultat — il tombe largement sous les
  25 Mo du glisser-déposer de l'interface GitHub. Le détail perdu est celui de l'intérieur,
  dont une vue de dessus n'a aucun usage.

Le dépôt est jetable : une fois le PNG produit et commité dans CarAI, il peut disparaître.

## 3. Les réglages du rendu

Faits ici, dans le script de rendu — donc reproductibles et ajustables sans rien redemander
à Marc. C'est le principal gain par rapport à une capture d'écran, où chacun de ces points
est figé au moment du clic.

1. **Caméra ORTHOGRAPHIQUE.** Zéro perspective — c'est ce qu'une capture d'écran ne peut
   pas donner. Sans elle, les flancs « tombent », les roues arrière paraissent plus
   étroites que les avant, et les quatre pastilles de pression se décalent de la roue
   qu'elles désignent. C'est l'argument décisif du rendu sur la capture.
2. **Fond transparent d'origine** (`alpha: true`), donc aucun détourage et aucun artefact
   de contour.
3. **Résolution choisie**, pas subie : on rend large et on réduit une fois.
4. **Éclairage réglé pour le thème sombre** : une lumière d'ambiance froide, une clé, et un
   contre-jour qui détache le pavillon noir du fond — le risque nommé en §5.
5. **Pas d'ombre cuite dans le PNG.** L'ombre est recréée en CSS pour suivre le thème.
6. **Capot vers le haut**, voiture centrée — l'orientation de toutes les ancres.

## 4. Le reste de la chaîne

1. **Recadrage** sur la boîte englobante de la voiture, marges symétriques.
2. **Réduction** à ~700 px de large, PNG optimisé. Cible : **moins de 150 Ko**.
3. **Socle** : ombre douce et halo dessinés DERRIÈRE l'image, en SVG/CSS — jamais dans le
   fichier, pour rester théma-dépendants.
4. **Attribution** de la licence dans `public/` et `HANDOVER.md`.
5. **Recalage des dix ancres** sur les vraies proportions, vérifié au banc Chromium
   (`lib/vehicle/pointsVoiture.ts` — c'est un réglage de nombres, pas une refonte : c'est
   exactement pour ça que les ancres sont en pourcentage).
6. **Calques d'état** : les contours des quatre roues et des quatre portières deviennent des
   formes SVG posées sur la photo, avec les MÊMES classes CSS qu'aujourd'hui — donc les
   mêmes règles d'honnêteté (pas de mesure ⇒ gris pointillé, jamais vert).

## 5. Le risque principal, nommé d'avance

**Le toit de la bZ est noir, et l'app est sombre.** Sur la vue de dessus, le pavillon occupe
la moitié de la surface : posé sur un fond sombre, il disparaît, et les deux pastilles qui
s'y trouvent (verrou, ouvrants) perdent leur support visuel.

Trois remèdes, dans cet ordre :

1. **Un contre-jour dans la scène 3D** — c'est le remède que la capture d'écran ne
   permettait pas : une lumière rasante depuis l'arrière détache le pavillon du fond dans le
   rendu lui-même, plutôt que de rattraper après coup. Plus un halo clair derrière la
   voiture côté app. Mesuré au banc avant livraison.
2. Si ça ne suffit pas : éclaircissement LOCAL de la zone du toit dans le PNG. C'est un
   traitement d'image, pas un mensonge sur une donnée.
3. En dernier recours : déplacer verrou et ouvrants vers le capot et le hayon, qui sont
   clairs. Les ancres sont faites pour ça.

C'est la même méthode que pour tout le reste de cet écran : **on mesure le rendu, on ne le
suppose pas.** Les trois défauts corrigés le 20/08 (cadre de 171 px, pastilles qui se
recouvraient, roues plus criardes que les valeurs) ont tous été trouvés par le banc, aucun
par la lecture du code.
