// tests/connecteurMcp.test.ts — le générateur de jeton ne doit jamais devenir un canal.
//
// L'écran Réglages propose un jeton MCP pour que Marc n'ait pas à lancer une commande.
// Sa PROPRIÉTÉ de sécurité tient en une phrase : le jeton est tiré dans le navigateur et
// n'en sort pas. C'est exactement le genre d'invariant qu'une session ultérieure casse
// sans y penser — « tant qu'à faire, enregistrons-le pour l'afficher plus tard » — et rien
// dans le typecheck ni dans le rendu ne s'en apercevrait.
//
// Ces tests lisent la SOURCE. C'est assumé : ce qu'on vérifie n'est pas un résultat de
// calcul, c'est l'ABSENCE d'un chemin de fuite. Un test de rendu ne prouverait pas
// l'absence, il prouverait juste que le cas testé ne fuit pas.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const racine = process.cwd();
const composant = readFileSync(join(racine, "app/reglages/connecteurMcp.tsx"), "utf8");
const page = readFileSync(join(racine, "app/reglages/page.tsx"), "utf8");

describe("générateur de jeton MCP", () => {
  it("tire le jeton avec une source cryptographique, pas Math.random", () => {
    expect(composant).toContain("crypto.getRandomValues");
    // `Math.random` n'est pas un générateur cryptographique : ses sorties sont prédictibles
    // à partir de quelques échantillons. Sur un jeton d'authentification, c'est une faille.
    expect(composant).not.toMatch(/Math\.random/);
  });

  it("produit au moins 128 bits d'entropie pour CHACUNE des deux clés", () => {
    // Deux clés, deux rôles — et la faible des deux fixe le niveau de sécurité réel. Les
    // vérifier séparément empêche qu'on en rétrécisse une « parce qu'elle se recopie à la
    // main » sans que rien ne tombe.
    for (const nom of ["OCTETS_SIGNATURE", "OCTETS_ACCES"]) {
      const m = composant.match(new RegExp(`const ${nom} = (\\d+)`));
      expect(m, `${nom} doit être une constante nommée`).not.toBeNull();
      expect(Number(m![1]) * 8, `${nom} est trop courte`).toBeGreaterThanOrEqual(128);
    }
  });

  it("encode en base64url — un `+` deviendrait une espace dans `?jeton=`", () => {
    // Le jeton voyage dans une URL. Un `+` y est décodé comme une espace : le jeton
    // collé cesserait de correspondre, sans qu'aucun message ne dise pourquoi.
    expect(composant).toMatch(/replace\(\/\\\+\/g, "-"\)/);
    expect(composant).toMatch(/replace\(\/\\\/\/g, "_"\)/);
    expect(composant).toMatch(/replace\(\/=\+\$\/, ""\)/);
  });

  it("n'envoie le jeton nulle part et ne le persiste pas", () => {
    // Toute sortie du navigateur, ou toute écriture qui survit au rechargement, casserait
    // la promesse faite à l'écran (« il n'est envoyé nulle part et n'est pas conservé »).
    for (const fuite of ["fetch(", "localStorage", "sessionStorage", "document.cookie"]) {
      expect(composant, `le jeton ne doit pas passer par ${fuite}`).not.toContain(fuite);
    }
    // `useState` et rien d'autre : la valeur meurt avec la page.
    expect(composant).toContain("useState");
  });
});

describe("page Réglages", () => {
  it("ne publie qu'un BOOLÉEN sur la config MCP, jamais une clé", () => {
    // `lireEnvMcp() !== null` est ce qui empêche une valeur de traverser la frontière
    // serveur→client : la comparaison produit un booléen, jamais la clé elle-même.
    expect(page).toMatch(/const mcpConfigure = lireEnvMcp\(\) !== null/);
    // Aucune clé ne doit être lue directement dans la page — ce serait le premier pas
    // vers un passage en prop, donc vers le navigateur.
    for (const cle of ["MCP_SIGNING_KEY", "MCP_ACCESS_KEY", "MCP_TOKEN"]) {
      expect(page, `${cle} n'a rien à faire dans la page`).not.toContain(`process.env.${cle}`);
    }
  });

  it("dérive l'origine de la requête au lieu de la coder en dur", () => {
    // Une URL figée enverrait Marc brancher son connecteur sur la production alors qu'il
    // regarde une préversion — le piège déjà rencontré sur app/login/page.tsx.
    expect(page).toContain('enTetes.get("x-forwarded-host")');
    expect(page).toMatch(/const origine = /);
  });
});
