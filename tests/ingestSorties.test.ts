import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  publier: vi.fn(),
  lignes: [] as Array<{ id: number }>,
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => doubles.lignes,
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/sortiesMemoryAI", () => ({
  publierSorties: doubles.publier,
}));

import { insererSnapshots } from "@/lib/smartcar/ingest";
import type { NouveauSnapshot } from "@/lib/db/schema";

const LIGNES = [
  { source: "smartcar", metricType: "battery_soc" },
] as NouveauSnapshot[];

describe("insererSnapshots et la publication des sorties", () => {
  beforeEach(() => {
    doubles.lignes = [{ id: 1 }, { id: 2 }];
    doubles.publier.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("rend le nombre écrit malgré une exception de publication", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    doubles.publier.mockRejectedValue(new Error("erreur fictive"));

    await expect(insererSnapshots(LIGNES)).resolves.toBe(2);
  });

  it("rend le nombre écrit si la publication dépasse son budget de 4 s", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    doubles.publier.mockImplementation(() => new Promise<void>(() => {}));

    const insertion = insererSnapshots(LIGNES);
    await vi.advanceTimersByTimeAsync(4_000);

    await expect(insertion).resolves.toBe(2);
  });

  it("permet au rejeu de désactiver la publication", async () => {
    await expect(insererSnapshots(LIGNES, { publier: false })).resolves.toBe(2);
    expect(doubles.publier).not.toHaveBeenCalled();
  });
});
