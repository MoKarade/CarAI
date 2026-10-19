"use client";

// app/ui/CarteGoogleVivante.tsx — la carte Google qu'on peut ZOOMER et DÉPLACER.
//
// Marc, 20/08 : « carte je peux pas zoomer ni me déplacer, inutile ». L'image Maps Static
// était nette et honnête, mais morte. Voir `lib/carteVivante.ts` pour le pourquoi du choix
// d'API ; ici, la mécanique.
//
// ══ LE REPLI EST INTERACTIF LUI AUSSI ═══════════════════════════════════════════════════
// Si le SDK ne charge pas — « Maps JavaScript API » pas encore activée pour la clé, clé
// refusée, réseau coupé — on rend `children`, qui est la carte interactive de CarAI
// (tuiles OpenStreetMap). Elle zoome et se déplace aussi. AUCUN chemin ne redonne une
// image figée : c'était le défaut signalé, il ne doit pas pouvoir revenir par la porte du
// repli. Et l'échec se DIT à l'écran, avec le geste exact qui le corrige.
//
// ⚠️ `gm_authFailure` est le SEUL signal que Google donne quand la clé est refusée : le
// script se charge normalement (200), la carte se construit, et l'affichage part en
// filigrane « for development purposes only » sans qu'aucune promesse ne rejette. Sans ce
// crochet, l'échec serait invisible côté code.

import { useEffect, useRef, useState } from "react";
import {
  CALLBACK_SDK,
  MARGE_CADRAGE,
  MARQUEUR_DERNIER,
  MARQUEUR_RELEVE,
  MAX_MARQUEURS,
  TRACE_VIVANTE,
  echantillonner,
  urlSdkMaps,
  type PointVivant,
} from "@/lib/carteVivante";

// ── Le peu de l'API Google qu'on touche, décrit à la main ────────────────────────────────
// Plutôt que d'ajouter `@types/google.maps` (un paquet de plusieurs milliers de lignes pour
// six appels), on déclare la surface RÉELLEMENT utilisée. Elle est petite, donc vérifiable.
interface LatLngLitteral {
  lat: number;
  lng: number;
}
interface Bornes {
  extend(p: LatLngLitteral): void;
  isEmpty(): boolean;
}
interface CarteGoogle {
  fitBounds(b: Bornes, marge?: number): void;
  setCenter(p: LatLngLitteral): void;
  setZoom(z: number): void;
}
interface Effacable {
  setMap(carte: CarteGoogle | null): void;
}
interface ApiMaps {
  Map: new (hote: HTMLElement, options: Record<string, unknown>) => CarteGoogle;
  LatLngBounds: new () => Bornes;
  Marker: new (options: Record<string, unknown>) => Effacable;
  Polyline: new (options: Record<string, unknown>) => Effacable;
  SymbolPath: { CIRCLE: unknown };
}

declare global {
  interface Window {
    google?: { maps?: ApiMaps };
    [CALLBACK_SDK]?: () => void;
    gm_authFailure?: () => void;
  }
}

/**
 * Pourquoi le repli s'est déclenché. ⚠️ Sans cette distinction, l'écran dit « Google n'a
 * pas répondu » et Marc ne peut pas savoir si c'est SON geste qui manque (API pas activée)
 * ou MON code qui échoue — deux causes opposées, deux corrections opposées. Un outil de
 * diagnostic qui ne distingue pas ses cas ne diagnostique rien (leçon JobAI).
 */
export type RaisonRepli = "cle-refusee" | "script-bloque" | "delai" | "sdk-vide";

/** Une seule tentative de chargement pour toute la page, quel que soit le nombre de cartes. */
let chargement: Promise<ApiMaps> | null = null;
/** Google n'appelle `gm_authFailure` qu'APRÈS le chargement : les cartes déjà bâties
    doivent l'apprendre, d'où ce petit registre plutôt qu'un état local. */
const auRefus = new Set<(raison: RaisonRepli) => void>();

const DELAI_MS = 10_000;

class EchecSdk extends Error {
  constructor(readonly raison: RaisonRepli) {
    super(raison);
  }
}

function chargerSdk(cle: string): Promise<ApiMaps> {
  if (chargement) return chargement;
  chargement = new Promise<ApiMaps>((resoudre, rejeter) => {
    const deja = window.google?.maps;
    if (deja) return resoudre(deja);

    const minuteur = setTimeout(() => rejeter(new EchecSdk("delai")), DELAI_MS);
    window[CALLBACK_SDK] = () => {
      clearTimeout(minuteur);
      const api = window.google?.maps;
      if (api) resoudre(api);
      else rejeter(new EchecSdk("sdk-vide"));
    };
    window.gm_authFailure = () => {
      for (const prevenir of auRefus) prevenir("cle-refusee");
    };

    const script = document.createElement("script");
    script.src = urlSdkMaps({ cle, callback: CALLBACK_SDK });
    script.async = true;
    script.onerror = () => {
      clearTimeout(minuteur);
      rejeter(new EchecSdk("script-bloque"));
    };
    document.head.appendChild(script);
  });
  // Une tentative ratée ne doit pas empoisonner un futur remontage (retour sur l'onglet).
  chargement.catch(() => {
    chargement = null;
  });
  return chargement;
}

export function CarteGoogleVivante({
  points,
  trajets = [],
  marquerDerniere = false,
  cle,
  legende,
  children,
}: {
  /** Les relevés à pointer. Le dernier du tableau est « la dernière position ». */
  points: ReadonlyArray<PointVivant>;
  /** Chemins à tracer (un par trajet). Vide pour un NUAGE : on ne relie pas des arrêts. */
  trajets?: ReadonlyArray<ReadonlyArray<LatLngLitteral>>;
  marquerDerniere?: boolean;
  cle: string;
  legende: React.ReactNode;
  /** La carte interactive de CarAI — montrée si Google ne répond pas. */
  children: React.ReactNode;
}) {
  const hote = useRef<HTMLDivElement | null>(null);
  const [etat, setEtat] = useState<"chargement" | "prete" | "echec">("chargement");
  const [raison, setRaison] = useState<RaisonRepli | null>(null);

  useEffect(() => {
    let vivant = true;
    const poses: Effacable[] = [];
    const refuse = (pourquoi: RaisonRepli) => {
      if (!vivant) return;
      setRaison(pourquoi);
      setEtat("echec");
    };
    auRefus.add(refuse);

    chargerSdk(cle)
      .then((maps) => {
        if (!vivant || !hote.current) return;
        const carte = new maps.Map(hote.current, {
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          // Le geste attendu sur une page qui défile : la molette NUE fait défiler la
          // page, Ctrl/⌘ + molette zoome. Même règle que les graphiques (leçon du 20/08) —
          // une carte qui capture la molette rend la page infranchissable au milieu.
          gestureHandling: "cooperative",
        });

        const bornes = new maps.LatLngBounds();
        for (const t of trajets) {
          if (t.length < 2) continue;
          const chemin = t.map((p) => ({ lat: p.lat, lng: p.lng }));
          poses.push(new maps.Polyline({ ...TRACE_VIVANTE, path: chemin, map: carte }));
        }

        const montres = echantillonner(points, MAX_MARQUEURS);
        const dernier = montres.length - 1;
        montres.forEach((p, i) => {
          const style = marquerDerniere && i === dernier ? MARQUEUR_DERNIER : MARQUEUR_RELEVE;
          poses.push(
            new maps.Marker({
              position: { lat: p.lat, lng: p.lng },
              map: carte,
              title: p.libelle,
              icon: {
                path: maps.SymbolPath.CIRCLE,
                scale: style.taille,
                fillColor: style.couleur,
                fillOpacity: 1,
                strokeColor: style.contour,
                strokeWeight: style.epaisseurContour,
              },
            }),
          );
        });

        for (const p of points) bornes.extend({ lat: p.lat, lng: p.lng });
        for (const t of trajets) for (const p of t) bornes.extend({ lat: p.lat, lng: p.lng });
        if (bornes.isEmpty()) {
          // Rien à cadrer : plutôt que de laisser Google choisir le milieu du Pacifique.
          const seul = points[0];
          if (seul) {
            carte.setCenter({ lat: seul.lat, lng: seul.lng });
            carte.setZoom(14);
          }
        } else {
          carte.fitBounds(bornes, MARGE_CADRAGE);
        }
        setEtat("prete");
      })
      .catch((err: unknown) => {
        if (!vivant) return;
        setRaison(err instanceof EchecSdk ? err.raison : "script-bloque");
        setEtat("echec");
      });

    return () => {
      vivant = false;
      auRefus.delete(refuse);
      for (const objet of poses) objet.setMap(null);
    };
  }, [points, trajets, marquerDerniere, cle]);

  if (etat === "echec") {
    return (
      <>
        {children}
        <p className="hint">
          Carte Google indisponible, carte de secours affichée (mêmes positions, elle zoome
          aussi).
        </p>
        <details className="hint">
          <summary>Pourquoi ?</summary>
          {raison === "cle-refusee" ? (
            <>
              Google a <strong>refusé la clé</strong> pour cette carte. C’est le cas normal
              tant que <strong>« Maps JavaScript API »</strong> n’est pas activée dans
              Google Cloud Console — produit séparé de « Maps Static API ». Vérifier aussi
              les <em>restrictions d’API</em> de la clé : si elle est limitée à une liste,
              y ajouter Maps JavaScript API.
            </>
          ) : raison === "script-bloque" ? (
            <>
              Le script Google n’a pas pu être chargé (réseau, bloqueur de contenu ou
              extension). Rien à changer dans Google Cloud.
            </>
          ) : raison === "delai" ? (
            <>Google n’a pas répondu dans les dix secondes. Un rechargement peut suffire.</>
          ) : (
            <>Le SDK Google s’est chargé sans se déclarer prêt — anomalie de son côté.</>
          )}
        </details>
      </>
    );
  }

  return (
    <>
      <div
        ref={hote}
        className="carte-google carte-google-vivante"
        role="application"
        aria-label="Zone parcourue — carte interactive"
      />
      {etat === "chargement" && <p className="hint">Chargement de la carte…</p>}
      {legende}
    </>
  );
}
