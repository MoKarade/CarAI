import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { secretValide } from "@/lib/secretPartage";

const ROUTES = [
  "app/api/cron/smartcar-poll/route.ts",
  "app/api/cron/toyota-poll/route.ts",
  "app/api/webhooks/toyota-otp/route.ts",
];

describe("secretValide", () => {
  it("accepte le bon secret", () => {
    expect(secretValide("s3cret", "s3cret")).toBe(true);
  });

  it("refuse un mauvais secret, y compris de longueur différente", () => {
    expect(secretValide("autre", "s3cret")).toBe(false);
    expect(secretValide("s3cret-et-plus", "s3cret")).toBe(false);
    expect(secretValide("s3", "s3cret")).toBe(false);
  });

  it("refuse l'absence de secret et le secret vide", () => {
    expect(secretValide(null, "s3cret")).toBe(false);
    expect(secretValide("", "s3cret")).toBe(false);
  });
});

describe("garde des routes hors session", () => {
  it("secretValide n'est défini qu'une fois, dans lib/secretPartage.ts", () => {
    for (const route of ROUTES) {
      const source = readFileSync(route, "utf8");
      expect(source, `${route} ne doit plus recopier la fonction`).not.toMatch(
        /function\s+secretValide/,
      );
      expect(source, `${route} doit importer la fonction commune`).toMatch(
        /import\s*\{\s*secretValide\s*\}\s*from\s*"@\/lib\/secretPartage"/,
      );
      expect(source, `${route} n'a plus besoin de node:crypto`).not.toMatch(/timingSafeEqual/);
    }
  });

  it("chaque route garde 503 (désactivé) et 401 (refusé)", () => {
    for (const route of ROUTES) {
      const source = readFileSync(route, "utf8");
      expect(source, route).toMatch(/status: 503/);
      expect(source, route).toMatch(/status: 401/);
    }
  });
});
