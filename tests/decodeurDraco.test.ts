// tests/decodeurDraco.test.ts — le décodeur servi est-il celui de la version installée ?
//
// ⚠️ POURQUOI CE TEST EXISTE. `public/draco/` est une COPIE de fichiers que `three` livre
// dans `node_modules`. Personne ne la régénère : une mise à jour de `three` changerait
// l'original sans toucher la copie, et un décodeur désaccordé de son chargeur n'échoue ni
// au build ni ici — il échoue **chez Marc, au moment d'ouvrir la voiture**. Le seul endroit
// où cette dérive peut rougir, c'est un test qui compare les octets.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = "node_modules/three/examples/jsm/libs/draco/gltf";
const SERVI = "public/draco";

/** Les fichiers que `DRACOLoader` télécharge sur le chemin WebAssembly. */
const FICHIERS = ["draco_wasm_wrapper.js", "draco_decoder.wasm"] as const;

function empreinte(chemin: string): string {
  return createHash("sha256").update(readFileSync(resolve(process.cwd(), chemin))).digest("hex");
}

describe("le décodeur Draco servi", () => {
  it.each(FICHIERS)("%s est identique à celui de three installé", (fichier) => {
    const source = `${SOURCE}/${fichier}`;
    // Anti-vacuité : sans la source, l'égalité serait « rien = rien ».
    expect(existsSync(resolve(process.cwd(), source))).toBe(true);
    expect(empreinte(`${SERVI}/${fichier}`)).toBe(empreinte(source));
  });

  it("ne sert QUE ce que le chargeur demande — pas le repli asm.js de 512 Ko", () => {
    expect(existsSync(resolve(process.cwd(), `${SERVI}/draco_decoder.js`))).toBe(false);
  });

  it("sert un wasm non vide", () => {
    const wasm = readFileSync(resolve(process.cwd(), `${SERVI}/draco_decoder.wasm`));
    expect(wasm.byteLength).toBeGreaterThan(50_000);
    // Le nombre magique d'un module WebAssembly : \0asm.
    expect(wasm.subarray(0, 4).toString("binary")).toBe("\0asm");
  });
});

describe("le modèle servi", () => {
  const glb = () => readFileSync(resolve(process.cwd(), "public/modele/bz.glb"));

  it("est bien un glTF binaire", () => {
    expect(glb().subarray(0, 4).toString("ascii")).toBe("glTF");
  });

  // ⚠️ C'est CE fichier qui rend le décodeur obligatoire. Le jour où le modèle serait
  // ré-exporté sans compression, ce test dirait quoi retirer — et à l'inverse, un modèle
  // qui exigerait une extension de PLUS ne s'ouvrirait pas en silence.
  it("exige exactement les extensions que le chargeur sait servir", () => {
    const b = glb();
    const json = JSON.parse(b.toString("utf8", 20, 20 + b.readUInt32LE(12)));
    expect(new Set(json.extensionsRequired)).toEqual(
      new Set(["EXT_texture_webp", "KHR_draco_mesh_compression", "KHR_texture_transform"]),
    );
  });
});
