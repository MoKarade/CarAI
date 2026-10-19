// tests/connexionHub.test.ts — redirection vers le hub et assainissement des URL internes.

import { describe, expect, it } from "vitest";
import { URL_HUB, cheminInterne, urlConnexionHub } from "@/lib/connexionHub";

describe("URL_HUB", () => {
  it("vaut https://hubperso.com quand NEXT_PUBLIC_HUB_URL est absent", () => {
    expect(URL_HUB).toBe("https://hubperso.com");
  });
});

describe("cheminInterne", () => {
  it("rend / quand la valeur est null", () => {
    expect(cheminInterne(null)).toBe("/");
  });

  it("rend / quand la valeur est undefined", () => {
    expect(cheminInterne(undefined)).toBe("/");
  });

  it("rend / quand la valeur est la chaîne vide", () => {
    expect(cheminInterne("")).toBe("/");
  });

  it("rend / quand la valeur ne contient que des espaces", () => {
    expect(cheminInterne("   ")).toBe("/");
  });

  it("conserve un chemin interne simple /activite", () => {
    expect(cheminInterne("/activite")).toBe("/activite");
  });

  it("conserve un chemin interne avec des paramètres /activite?x=1", () => {
    expect(cheminInterne("/activite?x=1")).toBe("/activite?x=1");
  });

  it("rend / pour une URL absolue externe https://evil.com", () => {
    expect(cheminInterne("https://evil.com")).toBe("/");
  });

  it("rend / pour un protocole relatif //evil.com", () => {
    expect(cheminInterne("//evil.com")).toBe("/");
  });

  it("rend / pour un nom de domaine sans slash initial evil.com", () => {
    expect(cheminInterne("evil.com")).toBe("/");
  });
});

describe("urlConnexionHub", () => {
  it("génère une URL commençant par https://hubperso.com/login", () => {
    const url = urlConnexionHub("https://carai.hubperso.com", "/activite");
    expect(url.startsWith("https://hubperso.com/login")).toBe(true);
  });

  it("définit son paramètre callbackUrl vers https://carai.hubperso.com/activite", () => {
    const url = new URL(urlConnexionHub("https://carai.hubperso.com", "/activite"));
    expect(url.searchParams.get("callbackUrl")).toBe("https://carai.hubperso.com/activite");
  });

  it("remplace un retour externe par https://carai.hubperso.com/ dans callbackUrl", () => {
    const url = new URL(urlConnexionHub("https://carai.hubperso.com", "https://evil.com"));
    expect(url.searchParams.get("callbackUrl")).toBe("https://carai.hubperso.com/");
  });

  it("gère l'absence de retour en orientant callbackUrl vers la racine de l'origine", () => {
    const url = new URL(urlConnexionHub("https://carai.hubperso.com", null));
    expect(url.searchParams.get("callbackUrl")).toBe("https://carai.hubperso.com/");
  });
});
