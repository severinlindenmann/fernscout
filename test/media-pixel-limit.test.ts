import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { craftedPng, paintJpeg } from "./support/pictures";
import { writeDayFixture } from "./fixtures/content";

/**
 * B1554 — the API upload path never populated `longestEdge`, so the
 * `imageEdge` check in `lib/validate/media.ts` was dead code on this door:
 * only `npm run ingest` ever fed it a real value. Worse, nothing capped the
 * pixels sharp would decode either, so a small file claiming an enormous
 * image paid for the full decode before anything refused it.
 *
 * `decodeSource` is spied on to prove the second half: a refused upload never
 * reaches it at all.
 */
vi.mock("@/lib/ingest/image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ingest/image")>();
  return { ...actual, decodeSource: vi.fn(actual.decodeSource) };
});

const { decodeSource } = await import("@/lib/ingest/image");
const { storeUploads } = await import("@/lib/api/media");

let dir: string;
const REF = "alex/asia-2026";
const tripPath = () => path.join(dir, "alex", "trips", "asia-2026");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-pixel-limit-"));
  process.env.CONTENT_DIR = dir;
  delete process.env.MEDIA_ORIGINALS_DIR;
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "F", url: "https://e.test", defaultUser: "alex" }, users: {}, features: {} }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex", tagline: "t", owner: { name: "A B", nickname: "A" },
      startLocation: "X", defaultLocale: "en", locales: ["en"], baseCurrency: "CHF",
      displayCurrencies: ["CHF"], units: "metric", features: {},
      // A narrow edge, so a photograph cheap enough to paint in a test still
      // exceeds it — the mechanism under test is the same one a real
      // instance's `imageEdge` config drives.
      media: { imageEdge: 200 },
    }),
  );
  clearConfigCache();
  clearUserCache();
  writeDayFixture(dir, "alex", "asia-2026", {
    slug: "day-one",
    date: "2026-01-01",
    title: "day-one",
    location: "Hoi An",
    country: "Vietnam",
    content: "Words.",
  });
  vi.mocked(decodeSource).mockClear();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the imageEdge limit on the network path", () => {
  test("an ordinary photograph within the edge is stored", async () => {
    const result = await storeUploads(REF, "day-one", [
      { filename: "small.jpg", bytes: await paintJpeg(150, 100) },
    ]);
    expect(result.ok).toBe(true);
  });

  test("a photograph over the configured edge is refused, not decoded", async () => {
    const result = await storeUploads(REF, "day-one", [
      { filename: "big.jpg", bytes: await paintJpeg(400, 300) },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems).toContainEqual(
      expect.objectContaining({ field: "big.jpg.dimensions" }),
    );
    // Refused before the decode loop, which is where a real pixel bomb's cost
    // would otherwise be paid.
    expect(decodeSource).not.toHaveBeenCalled();
  });

  test("a crafted file claiming more pixels than this server will ever decode is refused before decode, and says 'more than' rather than a number nobody measured", async () => {
    // A small PNG whose header alone declares an enormous image — the header
    // read (sharp's own `limitInputPixels`) is what has to catch this, since
    // decoding it for real is exactly the cost being avoided. 20000×20000 is
    // also past sharp's own (much larger) default ceiling, so even the
    // unlimited re-read this refusal takes can't answer with real numbers —
    // "more than 64 MP" is the honest answer, not an invented one.
    const bomb = craftedPng(20000, 20000);
    const result = await storeUploads(REF, "day-one", [{ filename: "bomb.png", bytes: bomb }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems).toContainEqual({
      field: "bomb.png.pixels",
      got: "more than 64 MP",
      expected: "at most 64 MP",
    });
    expect(decodeSource).not.toHaveBeenCalled();
  });

  // B2179 round 2 — the edge check alone (`imageEdge`) missed this shape: a
  // 9000×9000 image has an edge under the real `IMAGE_MAX_EDGE` (12000) but
  // is 81 megapixels, over the separate, hard `IMAGE_MAX_PIXELS` (64,000,000)
  // ceiling. The previous fix fabricated `limits.imageEdge + 1` here, which
  // for this journal's narrowed `imageEdge: 200` would have (falsely) said
  // "201px" on the wrong axis entirely — real width, height and megapixel
  // count now, off a second, still-header-only, unlimited read.
  test("a 9000×9000 (81 MP) image is refused on pixel count, with its real dimensions — not a fabricated edge", async () => {
    const bomb = craftedPng(9000, 9000);
    const result = await storeUploads(REF, "day-one", [{ filename: "wall.png", bytes: bomb }]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.problems).toContainEqual({
      field: "wall.png.pixels",
      got: "9000×9000 (81 MP)",
      expected: "at most 64 MP",
    });
    expect(result.problems.some((p) => p.field === "wall.png.dimensions")).toBe(false);
    expect(decodeSource).not.toHaveBeenCalled();
  });
});
