// app/ui/CarteGoogle.tsx — la carte Google (Embed API), choisie par Marc le 17/08.
//
// ══ LE CHOIX, ET CE QU'IL IMPLIQUE ═══════════════════════════════════════════════════
// Deuxième demande explicite de Marc (« je veux google maps comme carte »), tranchée au
// cadrage : **Embed API avec clé** — l'iframe OFFICIEL, gratuit et illimité (« All Maps
// Embed API requests are available at no charge with unlimited usage »).
//
// ⚠️ Conséquence assumée PAR MARC, dite au moment du choix : la position de la voiture
// part vers Google À CHAQUE AFFICHAGE de la page — l'app l'évitait jusqu'ici (le lien
// Maps était un clic). C'est sa voiture, son app privée, sa décision éclairée.
//
// ⚠️ LA CLÉ EST PUBLIQUE PAR CONSTRUCTION : elle vit dans l'URL de l'iframe, donc dans le
// HTML servi. C'est le modèle de l'Embed API — la protection est la RESTRICTION DE
// RÉFÉRENT (la clé ne fonctionne que depuis carai.hubperso.com), pas le secret. Ce n'est
// donc PAS une violation de « jamais de secret côté client » : une clé restreinte par
// référent n'est pas un secret, c'est un identifiant public verrouillé à un domaine.
// La restriction se configure dans Google Cloud Console → Credentials → la clé →
// « Application restrictions : HTTP referrers » → `carai.hubperso.com/*`.
//
// ══ REPLI ═══════════════════════════════════════════════════════════════════════════
// Sans clé configurée (`GOOGLE_MAPS_EMBED_KEY` absente), les appelants gardent la carte
// OSM existante : l'app ne casse jamais parce qu'une variable manque — elle dégrade.

import { planifierItineraire } from "@/lib/itineraire";

/** `null` si la clé n'est pas configurée — l'appelant bascule alors sur la carte OSM. */
export function cleMapsEmbed(env: Record<string, string | undefined> = process.env): string | null {
  const cle = env.GOOGLE_MAPS_EMBED_KEY?.trim();
  return cle || null;
}

/**
 * Carte Google centrée sur un point, avec marqueur (`place` mode).
 *
 * `loading="lazy"` : l'iframe ne charge pas tant qu'il n'approche pas du viewport — sur
 * une page longue, la position ne part vers Google que si la carte est regardée.
 */
export function CarteGoogle({
  lat,
  lng,
  zoom = 15,
  cle,
  titre,
}: {
  lat: number;
  lng: number;
  zoom?: number;
  cle: string;
  titre: string;
}) {
  const src =
    `https://www.google.com/maps/embed/v1/place` +
    `?key=${encodeURIComponent(cle)}` +
    `&q=${lat.toFixed(6)},${lng.toFixed(6)}` +
    `&zoom=${Math.round(zoom)}` +
    `&language=fr`;

  return (
    <iframe
      className="carte-google"
      src={src}
      title={titre}
      loading="lazy"
      allowFullScreen
      referrerPolicy="strict-origin"
    />
  );
}

/**
 * Itinéraire Google entre les relevés d'un trajet (`directions` mode), AVEC sa légende —
 * elle décrit ce que l'iframe affiche, donc elle vit ici et ne peut pas en dériver.
 *
 * ⚠️ HONNÊTETÉ : l'Embed API ne sait PAS dessiner une polyligne arbitraire — elle CALCULE
 * un itinéraire entre les points qu'on lui donne. Ce qui s'affiche est donc « le chemin
 * que Google reconstitue en passant par les relevés réels », PAS la route mesurée (la bZ
 * ne publie sa position qu'à l'arrêt). La légende le dit sous chaque carte.
 *
 * La préparation des points vit dans `lib/itineraire.ts` (pur, testé). Le bug qu'elle
 * corrige (Marc, 17/08 : « je vois que la destination pas le trajet ») : un trajet en
 * BOUCLE donnait origine ≈ destination, et Google n'affichait qu'UNE épingle. Désormais :
 * boucle avec relevé éloigné → itinéraire par ce relevé (l'apex est forcé) ; boucle sans
 * relevé éloigné → l'ENDROIT du trajet (mode `place`) avec l'explication.
 */
export function CarteGoogleItineraire({
  points,
  cle,
  titre,
}: {
  points: ReadonlyArray<{ lat: number; lng: number }>;
  cle: string;
  titre: string;
}) {
  const plan = planifierItineraire(points);
  if (plan === null) return null;
  const fmt = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

  if (plan.mode === "sur-place") {
    const src =
      `https://www.google.com/maps/embed/v1/place` +
      `?key=${encodeURIComponent(cle)}` +
      `&q=${fmt(plan.centre)}` +
      `&zoom=16` +
      `&language=fr`;
    return (
      <>
        <iframe
          className="carte-google carte-google-trajet"
          src={src}
          title={titre}
          loading="lazy"
          allowFullScreen
          referrerPolicy="strict-origin"
        />
        <p className="hint">
          Départ et arrivée au même endroit, sans relevé éloigné entre les deux : il n’y a
          pas d’itinéraire à tracer — voici l’endroit du trajet. (La bZ ne publie sa
          position qu’à l’arrêt.)
        </p>
      </>
    );
  }

  const { origine, destination, etapes } = plan;
  const src =
    `https://www.google.com/maps/embed/v1/directions` +
    `?key=${encodeURIComponent(cle)}` +
    `&origin=${fmt(origine)}` +
    `&destination=${fmt(destination)}` +
    (etapes.length > 0 ? `&waypoints=${encodeURIComponent(etapes.map(fmt).join("|"))}` : "") +
    `&mode=driving&language=fr`;
  const passages = etapes.length + 2;

  return (
    <>
      <iframe
        className="carte-google carte-google-trajet"
        src={src}
        title={titre}
        loading="lazy"
        allowFullScreen
        referrerPolicy="strict-origin"
      />
      <p className="hint">
        Itinéraire <strong>reconstitué par Google</strong> en passant par{" "}
        {passages === points.length
          ? `les ${points.length} relevés réels`
          : `${passages} des ${points.length} relevés réels`}{" "}
        — la route exacte n’est pas enregistrée (la bZ ne publie sa position qu’à l’arrêt).
      </p>
    </>
  );
}
