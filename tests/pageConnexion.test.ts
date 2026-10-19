// La page de connexion doit s'appeler CarAI : le titre visible ET le titre d'onglet.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const configure = vi.hoisted(() => ({ valeur: true }));

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));
vi.mock("@/lib/authConfigured", () => ({
  isAuthConfigured: () => configure.valeur,
}));

import LoginPage, { metadata } from "@/app/login/page";

async function rendre(searchParams: { error?: string }) {
  const element = await LoginPage({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element);
}

describe("page de connexion", () => {
  beforeEach(() => {
    configure.valeur = true;
  });

  it("le titre d'onglet dit CarAI", () => {
    expect(String(metadata.title)).toContain("CarAI");
  });

  it("cas auth non configurée : le titre visible dit CarAI", async () => {
    configure.valeur = false;
    const html = await rendre({});
    expect(html).toMatch(/<h1[^>]*>CarAI<\/h1>/);
    expect(html).toContain("Connexion");
    expect(html).toContain("Authentification non configurée");
  });

  it("cas session refusée : le titre visible dit CarAI", async () => {
    const html = await rendre({ error: "x" });
    expect(html).toMatch(/<h1[^>]*>CarAI<\/h1>/);
    expect(html).toContain("Session refusée");
  });
});
