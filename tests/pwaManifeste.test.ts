// tests/pwaManifeste.test.ts — l'app doit être INSTALLABLE sur Android, et le rester.
//
// ══ POURQUOI CE TEST EXISTE ══════════════════════════════════════════════════════════
//
// Marc, 18/09/2026 : « je veux que toutes les applications soient installables sur le
// téléphone et que lorsque j'ouvre depuis le hub ça ouvre l'application installée ». Android.
//
// Le défaut qui a lancé le lot vivait chez FinanceAI : son manifeste ne déclarait qu'une icône
// SVG, et Chrome — qui fabrique un WebAPK à l'installation — exige une icône RASTER d'au moins
// 192 px. Sans elle, « Installer l'application » n'apparaît JAMAIS, et rien ne le dit : l'app
// s'ouvre parfaitement dans un onglet. Mesuré sur les sept dépôts du parc, FinanceAI était le
// seul dans cet état — mais rien n'empêchait un autre d'y tomber au prochain lot d'icônes.
//
// ⚠️ CE QUE CE TEST LIT, ET QU'UN COUP D'ŒIL AU MANIFESTE NE LIT PAS : `sizes` est une
// DÉCLARATION, pas une mesure. Un manifeste qui annonce 512×512 en servant un PNG de 192 est
// faux, et Chrome croit le FICHIER. Les dimensions sont donc relues dans l'en-tête IHDR du PNG
// (13 octets après la signature, aucun outil requis).
//
// ⚠️ CE QU'IL NE PROUVE PAS : que le téléphone propose vraiment l'installation, ni qu'un lien
// du hub bascule vers l'app installée. Ça dépend de la version de Chrome, de l'installation
// réelle et d'un réglage système. Aucune infrastructure ici ne peut l'observer — c'est le
// téléphone de Marc qui tranche, et c'est dit plutôt que suggéré par la présence d'un test.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import manifeste from "../app/manifest";

const RACINE = join(__dirname, "..");
const m = manifeste();
const icones = m.icons ?? [];
const aPourRole = (i: { purpose?: string }, role: string) => (i.purpose ?? "any").split(/\s+/).includes(role);
const chemin = (src: string) => join(RACINE, "public", src.replace(/^\//, ""));

/** Dimensions RÉELLES d'un PNG, lues dans son IHDR. */
function dimensionsPng(p: string): { largeur: number; hauteur: number } {
  const buf = readFileSync(p);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(signature)) throw new Error(`${p} n'est pas un PNG`);
  return { largeur: buf.readUInt32BE(16), hauteur: buf.readUInt32BE(20) };
}

describe("[PWA-ANDROID] le manifeste rend l'app installable", () => {
  it("déclare `display: standalone` et un `scope`", () => {
    expect(m.display).toBe("standalone");
    expect(m.scope).toBeTruthy();
  });

  it("fixe son `id` — sinon un changement de `start_url` installe une SECONDE app", () => {
    expect(m.id).toBeTruthy();
  });

  it("demande `navigate-existing` — un lien réutilise la fenêtre ouverte", () => {
    expect(m.launch_handler?.client_mode).toBe("navigate-existing");
  });

  it("déclare une icône raster ≥ 192 px, et une maskable ≥ 512 DISTINCTE, MESURÉES dans les fichiers", () => {
    const any = icones.filter((i) => aPourRole(i, "any") && dimensionsPng(chemin(i.src)).largeur >= 192);
    expect(any.length, "aucune icône « any » de 192 px ou plus : Chrome refuse le WebAPK").toBeGreaterThan(0);

    const maskable = icones.find((i) => aPourRole(i, "maskable") && dimensionsPng(chemin(i.src)).largeur >= 512);
    expect(maskable, "aucune maskable de 512 px ou plus").toBeDefined();
    // Une icône non conçue pour le masque, réutilisée comme maskable, se fait rogner les bords
    // par l'icône adaptative d'Android : elle s'affiche, simplement coupée.
    expect(any.map((i) => i.src)).not.toContain(maskable!.src);
  });

  it("annonce des tailles que les fichiers ont VRAIMENT — Chrome croit le fichier, pas le champ", () => {
    expect(icones.length).toBeGreaterThan(0);
    for (const i of icones) {
      if (i.type !== "image/png") continue;
      const attendu = Number((i.sizes ?? "").split("x")[0]);
      const { largeur, hauteur } = dimensionsPng(chemin(i.src));
      expect(largeur, `${i.src} : le manifeste annonce ${i.sizes}, le fichier fait ${largeur}x${hauteur}`).toBe(attendu);
      expect(hauteur).toBe(attendu);
    }
  });
});
