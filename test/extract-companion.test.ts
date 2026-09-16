import { describe, expect, test } from "vitest";
import { suggestCompanion } from "@/lib/extract/companion";
import type { RunManifest } from "@/lib/staging/manifest";

function manifest(days: RunManifest["days"]): RunManifest {
  return {
    version: 1,
    runId: "run-1",
    owner: "alex",
    createdAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-09-05T00:00:00.000Z",
    tripId: null,
    mode: "type",
    state: "telling",
    photos: [],
    days,
  };
}

describe("suggestCompanion", () => {
  test("names the word the person actually wrote, on the real days they wrote it", () => {
    const result = suggestCompanion(
      manifest([
        { date: "2026-06-02", answered: [], words: "We had breakfast with Nora before the market." },
        { date: "2026-06-04", answered: [], words: "Nora wanted to see the temple again." },
      ]),
    );
    expect(result).toEqual({ name: "Nora", dates: ["2026-06-02", "2026-06-04"] });
  });

  test("a name mentioned on only one day is not suggested — one mention proves nothing", () => {
    const result = suggestCompanion(
      manifest([{ date: "2026-06-02", answered: [], words: "We had breakfast with Nora before the market." }]),
    );
    expect(result).toBeNull();
  });

  test("no answers at all suggests nothing, never a placeholder", () => {
    expect(suggestCompanion(manifest([]))).toBeNull();
  });

  test("a place the person named in their own location answer is never offered back as a person", () => {
    const result = suggestCompanion(
      manifest([
        { date: "2026-06-02", answered: [], words: "We walked around Hoi An all afternoon.", location: "Hoi An" },
        { date: "2026-06-03", answered: [], words: "Back in Hoi An for the lanterns.", location: "Hoi An" },
      ]),
    );
    expect(result).toBeNull();
  });

  test("two equally-mentioned candidates are ambiguous and neither is guessed at", () => {
    const result = suggestCompanion(
      manifest([
        { date: "2026-06-01", answered: [], words: "We saw Nora and Severin at the market." },
        { date: "2026-06-02", answered: [], words: "Nora and Severin walked back together." },
      ]),
    );
    expect(result).toBeNull();
  });

  test("a sentence-initial capital is not mistaken for a name", () => {
    const result = suggestCompanion(
      manifest([
        { date: "2026-06-01", answered: [], words: "Wonderful day. Wonderful food too." },
        { date: "2026-06-02", answered: [], words: "Wonderful again, honestly." },
      ]),
    );
    expect(result).toBeNull();
  });
});
