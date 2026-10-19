// tests/enTetesSecurite.test.ts — les en-têtes de sécurité, `[SEC-01]`.
//
// ⚠️ CarAI n'en portait AUCUN jusqu'au 17/09/2026, alors qu'elle sert sur Internet la
// position du véhicule, son kilométrage et les habitudes de charge de Marc. Ce qui est
// verrouillé ici, dans l'ordre d'importance :
//   1. les cinq en-têtes ENFORCÉS existent et gardent leur sens ;
//   2. la CSP reste en Report-Only — c'est une DÉCISION, pas un oubli, et l'enforcer sans
//      l'avoir observée couperait l'app de ses propres ressources EN SILENCE ;
//   3. et surtout : tout domaine que l'app CHARGE est déclaré dans la CSP. Sans ce
//      troisième point, les deux premiers sont décoratifs — le jour où quelqu'un ajoute
//      une ressource externe, la CSP passerait en enforcé en la coupant.

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EN_TETES_SECURITE } from "../next.config.mjs";
import { sansCommentairesJsx } from "./aides/controles";

/**
 * Une URL https du code, et le délimiteur de `href` qui la précède s'il y en a un.
 *
 * ⚠️ `href=` peut être suivi de PLUSIEURS délimiteurs (`href={\`…\`}`, `href={'…'}`) :
 * le quantificateur est `*`, pas `?`. Mon premier jet n'en acceptait qu'un et classait le
 * lien d'attribution OpenStreetMap comme une ressource chargée. Défini UNE fois : le motif
 * vivait à deux endroits de ce fichier, et c'est exactement ainsi qu'une règle diverge.
 */
const MOTIF_URL = /(href=["'{`\s]*)?https:\/\/([a-z0-9.-]+\.[a-z]{2,})/g;

/** Les domaines CHARGÉS d'un bout de code — les liens sont écartés. PURE. */
function domainesCharges(code: string): string[] {
  MOTIF_URL.lastIndex = 0;
  return [...code.matchAll(MOTIF_URL)].filter((m) => !m[1]).map((m) => m[2]!);
}

const valeur = (cle: string): string | undefined =>
  EN_TETES_SECURITE.find((h) => h.key === cle)?.value;

describe("les cinq en-têtes ENFORCÉS", () => {
  it("sont tous présents", () => {
    for (const cle of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(valeur(cle), `en-tête « ${cle} » absent`).toBeTruthy();
    }
  });

  it("HSTS couvre les sous-domaines — le hub et les apps vivent tous sous hubperso.com", () => {
    expect(valeur("Strict-Transport-Security")).toContain("includeSubDomains");
  });

  it("refuse d'être embarquée dans une iframe", () => {
    expect(valeur("X-Frame-Options")).toBe("DENY");
    expect(valeur("Content-Security-Policy-Report-Only")).toContain("frame-ancestors 'none'");
  });

  // ⚠️ Vérifié plutôt que supposé : l'app ne demande jamais la position du NAVIGATEUR,
  // elle lit celle de la voiture. Si ça changeait, cette ligne couperait la fonctionnalité
  // sans rien dire — d'où la garde jumelle juste en dessous.
  it("coupe la géolocalisation du navigateur, que l'app n'utilise pas", () => {
    expect(valeur("Permissions-Policy")).toContain("geolocation=()");
  });

  it("et l'app ne l'utilise toujours pas", () => {
    const sources = ["app", "lib"]
      .flatMap((d) => fichiersSource(d))
      .map((f) => sansCommentairesJsx(readFileSync(f, "utf8")));
    expect(sources.length).toBeGreaterThan(20); // anti-vacuité : le scan a bien lu le dépôt
    for (const code of sources) {
      expect(code).not.toContain("navigator.geolocation");
    }
  });
});

// ⚠️ Discrimination mesurée le 17/09, et elle n'est pas de une pour une : basculer la CSP
// en enforcé fait rougir QUATRE cas, mais trois tombent parce que la clé Report-Only n'est
// plus trouvée, pas parce qu'ils observent la bascule. Le seul cas discriminant est celui
// ci-dessous. Retirer un en-tête enforcé : 2 rouges. Retirer les tuiles de la CSP : 2
// rouges, dont le scan — c'est la garde qui compte, celle qui empêche d'enforcer une CSP
// qui couperait la carte.
describe("la CSP est OBSERVÉE, pas appliquée — et c'est délibéré", () => {
  it("s'appelle Report-Only", () => {
    expect(valeur("Content-Security-Policy-Report-Only")).toBeTruthy();
    // ⚠️ Si cette assertion tombe un jour, ce n'est pas forcément une régression : c'est
    // peut-être qu'on a enforcé la CSP après l'avoir observée. Dans ce cas, relire la
    // marche à suivre dans `next.config.mjs` et INVERSER ce test plutôt que le supprimer —
    // ce qu'il défend, c'est qu'on ne bascule pas par accident.
    expect(valeur("Content-Security-Policy")).toBeUndefined();
  });
});

// ══ LA GARDE QUI COMPTE ═════════════════════════════════════════════════════════════
// Une CSP ne casse pas bruyamment : elle coupe une ressource et l'écran se vide. Ce test
// DÉRIVE du code les domaines réellement chargés et exige qu'ils soient déclarés — une
// liste écrite à la main serait fausse au premier ajout.
describe("tout domaine CHARGÉ par l'app est déclaré dans la CSP", () => {
  it("les tuiles de carte et l'iframe Maps sont autorisées", () => {
    const csp = valeur("Content-Security-Policy-Report-Only")!;
    expect(csp).toContain("tile.openstreetmap.org");
    expect(csp).toContain("https://www.google.com");
  });

  // ⚠️ Premier jet de cette garde : elle a sorti `compatibility.api.smartcar.com` et
  // `connect.smartcar.com` comme des manquements. C'étaient des FAUX POSITIFS — les deux
  // vivent dans des modules SERVEUR (`lib/smartcar/client.ts`, `lib/smartcar/connect.ts`),
  // et la CSP ne gouverne QUE ce que le navigateur charge : un `fetch` serveur et une
  // redirection de navigation lui échappent. Plutôt qu'une liste d'exceptions écrite à la
  // main — qui serait fausse au premier ajout et se lirait comme un détail déjà tranché —
  // le test PROUVE le caractère serveur : un domaine non déclaré est toléré seulement si
  // aucun fichier rendu au navigateur ne le nomme.
  it("aucun TROISIÈME domaine chargé n'a été ajouté sans passer par la CSP", () => {
    const csp = valeur("Content-Security-Policy-Report-Only")!;
    const fichiers = ["app", "lib"].flatMap((d) => fichiersSource(d));
    expect(fichiers.length).toBeGreaterThan(20); // anti-vacuité : le scan a lu le dépôt

    /** Domaine → les fichiers qui le nomment. */
    const parDomaine = new Map<string, string[]>();
    for (const f of fichiers) {
      const code = sansCommentairesJsx(readFileSync(f, "utf8"));
      // Une URL derrière `href=` est une NAVIGATION : la CSP ne la gouverne pas.
      for (const d of domainesCharges(code)) {
        parDomaine.set(d, [...(parDomaine.get(d) ?? []), f]);
      }
    }
    expect(parDomaine.size).toBeGreaterThan(1); // anti-vacuité : le motif trouve bien des URL

    const coupables: string[] = [];
    for (const [domaine, sites] of parDomaine) {
      if (csp.includes(domaine) || domaine.endsWith("hubperso.com")) continue;
      const vusParLeNavigateur = sites.filter((f) => renduAuNavigateur(f));
      if (vusParLeNavigateur.length > 0) {
        coupables.push(`${domaine} (${vusParLeNavigateur.join(", ")})`);
      }
    }
    expect(
      coupables,
      `ces domaines sont chargés par le NAVIGATEUR sans être déclarés dans la CSP : ${coupables.join(" · ")}`,
    ).toEqual([]);
  });
});

describe("le motif du scan reconnaît les trois formes de href du dépôt", () => {
  // ⚠️ Cette garde existe parce que le motif s'est trompé : il ne connaissait pas
  // `href="…"` et a signalé le lien d'attribution OpenStreetMap comme une ressource
  // chargée. Un scan qui sur-compte fait perdre confiance aussi sûrement qu'un scan qui
  // rate — il pousse à ajouter des exceptions jusqu'à ce qu'il ne détecte plus rien.
  it("écarte un lien, quelle que soit sa forme", () => {
    expect(domainesCharges('<a href="https://exemple.test/x">')).toEqual([]);
    expect(domainesCharges("<a href={`https://exemple.test/${x}`}>")).toEqual([]);
    expect(domainesCharges("<a href={'https://exemple.test/x'}>")).toEqual([]);
  });

  it("retient bien une ressource chargée", () => {
    expect(domainesCharges('<img src="https://tuiles.test/1.png">')).toEqual(["tuiles.test"]);
    expect(domainesCharges('const base = "https://api.test/v3";')).toEqual(["api.test"]);
  });
});

function fichiersSource(racine: string): string[] {
  const out: string[] = [];
  const marcher = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) marcher(p);
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
  };
  marcher(racine);
  return out;
}

/**
 * Ce fichier peut-il faire CHARGER quelque chose par le navigateur ? PURE.
 *
 * ⚠️ Le critère n'est pas « où vit le fichier » mais « son contenu atteint-il le DOM ».
 * Un composant marqué `"use client"` s'exécute dans le navigateur ; `app/ui/` ne contient
 * que des composants rendus ; et `lib/vehicle/carte.ts` fabrique les URL de tuiles que la
 * carte pose dans un `src`, donc il compte même s'il est pur et sans JSX. Les modules de
 * `lib/smartcar/` qui appellent l'API, eux, ne posent jamais rien dans une page.
 */
function renduAuNavigateur(fichier: string): boolean {
  if (fichier.startsWith("app/ui/")) return true;
  if (fichier === "lib/vehicle/carte.ts") return true;
  return readFileSync(fichier, "utf8").slice(0, 200).includes('"use client"');
}
