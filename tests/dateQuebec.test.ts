// tests/dateQuebec.test.ts — les dates du tableau de purge sont à l'heure du Québec
// (carte 9 du 15/10) : avant, `toISOString()` les montrait en UTC, 4 h d'avance l'été.

import { describe, expect, it } from "vitest";
import { dateHeureQuebec } from "@/lib/vehicle/dateQuebec";

describe("dateHeureQuebec", () => {
  it("en été, retranche 4 h à l'UTC", () => {
    expect(dateHeureQuebec(new Date("2026-08-12T14:03:00Z"))).toBe("12 août, 10 h 03");
  });

  it("en hiver, retranche 5 h à l'UTC", () => {
    expect(dateHeureQuebec(new Date("2026-01-05T14:03:00Z"))).toBe("5 janvier, 9 h 03");
  });

  it("change de jour quand l'UTC a déjà basculé", () => {
    expect(dateHeureQuebec(new Date("2026-08-13T02:30:00Z"))).toBe("12 août, 22 h 30");
  });

  it("minuit local s'écrit 0 h", () => {
    expect(dateHeureQuebec(new Date("2026-08-12T04:05:00Z"))).toBe("12 août, 0 h 05");
  });
});
