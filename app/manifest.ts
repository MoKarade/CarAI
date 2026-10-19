import type { MetadataRoute } from "next";

/**
 * Manifeste d'application web — c'est lui qui rend CarAI INSTALLABLE (téléphone et PC).
 *
 * Servi par Next sur `/manifest.webmanifest`. Aucune ressource externe : les icônes sont
 * dans `public/`, générées depuis `app/icon.svg` (l'éclair de recharge de l'app).
 *
 * ⚠️ ACCESSIBLE SANS SESSION, ET C'EST NÉCESSAIRE. Le navigateur récupère le manifeste
 * SANS cookies ; derrière le garde, il recevrait la redirection vers `/login` et l'app
 * cesserait d'être installable — en silence, sans erreur nulle part. `isPublicPath` le
 * laisse déjà passer (règle « dernier segment avec une extension »). Un test le verrouille.
 *
 * Ce manifeste ne contient AUCUNE donnée du véhicule : ni position, ni odomètre, ni
 * charge. C'est un fichier de présentation.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // [PWA-ANDROID] `id` FIXE l'identité de l'installation. Sans lui, l'identité EST le
    // `start_url` : le jour où il change, Android ne met pas à jour l'app installée — il en
    // installe une DEUXIÈME, et la première reste sur l'écran d'accueil sans jamais bouger.
    // La valeur est celle du `start_url` ACTUEL, donc c'est un no-op aujourd'hui : le but est
    // d'épingler ce qui était implicite.
    id: "/",
    // [PWA-ANDROID] Un lien venu d'ailleurs (le hub, une notification) RÉUTILISE la fenêtre
    // déjà ouverte au lieu d'en empiler une seconde. `focus-existing` a été écarté : il
    // ramène la fenêtre au premier plan SANS naviguer, donc en ignorant l'URL demandée.
    launch_handler: { client_mode: "navigate-existing" },
    name: "CarAI",
    short_name: "CarAI",
    description: "Suivi du véhicule électrique — charge, autonomie, odomètre, bail.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    // Thème sombre ASSUMÉ (décision Marc, refonte constructeur du 17/08) : le `--fond`
    // de globals.css, en hexadécimal depuis CarAI#217 (tests/theme.test.ts compare les deux).
    // L'écran de lancement de l'app installée est donc sombre lui aussi — plus de flash blanc
    // au démarrage.
    background_color: "#060911",
    theme_color: "#060911",
    lang: "fr-CA",
    dir: "ltr",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Variante MASKABLE : Android rogne selon la forme du lanceur (cercle, goutte…).
      // Sans elle, le cercle de l'éclair se fait couper sur les bords.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
