// public/sw.js — service worker MINIMAL, et volontairement inutile au réseau.
//
// Pourquoi il existe : les navigateurs Chromium exigent un service worker enregistré pour
// proposer « Installer l'application » sur PC et Android. iOS s'en passe et n'a besoin que
// du manifeste et de l'apple-touch-icon.
//
// Pourquoi il ne MET RIEN EN CACHE. CarAI affiche l'état d'un véhicule — charge, autonomie,
// odomètre — et c'est précisément le genre de chiffre qu'il ne faut jamais servir périmé :
// une charge de 80 % affichée alors qu'elle est à 12 % ferait prendre la route. Un service
// worker qui sert du cache est la pire machine à ça, parce qu'elle survit au rechargement.
// Aucun `caches.put`, aucun `caches.match`, aucun mode hors-ligne : sans réseau, l'app ne
// s'ouvre pas. C'est le bon compromis, et il est cohérent avec le reste de l'app, qui
// affiche déjà `dataAsOf` pour que la fraîcheur réelle soit visible.
//
// `skipWaiting` + `clients.claim` : un nouveau déploiement remplace immédiatement l'ancien
// worker, sans attendre la fermeture des onglets.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Un gestionnaire `fetch` est REQUIS pour l'installabilité, mais il laisse tout passer :
// pas de `respondWith`, donc le navigateur applique son comportement réseau normal.
self.addEventListener("fetch", () => {});
