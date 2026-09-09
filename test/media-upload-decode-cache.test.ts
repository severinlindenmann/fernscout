import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { paintJpeg } from "./support/pictures";

/**
 * B720 — a decode of a photograph already on the day used to happen again on
 * every upload request to it. One request per file, which is the normal shape
 * since B683's two-phase queue, made the nth upload decode n−1 pictures
 * again: a batch of forty paid for roughly 40² decodes rather than 40.
 *
 * `decodeSource` is spied on rather than timed: a call count is
 * deterministic, a stopwatch is not, and "decoded once, not N times" is
 * exactly the property that matters here.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-upload-cache-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(tripPath(), "entries"), { recursive: true });
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
    }),
  );
  clearConfigCache();
  clearUserCache();
  fs.writeFileSync(
    path.join(tripPath(), "entries", "2026-01-01-day-one.md"),
    ['---', 'title: "Day one"', 'date: "2026-01-01"', 'location: "Hoi An"', 'country: "Vietnam"', '---', '', 'Words.', ''].join("\n"),
  );
  vi.mocked(decodeSource).mockClear();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("dayFingerprints, cached across requests (B720)", () => {
  test("one file per request, forty times over, decodes each photograph a bounded number of times", async () => {
    const BATCH = 10; // Ten distinct photographs, one request each — the wizard's normal shape.
    for (let i = 0; i < BATCH; i++) {
      const result = await storeUploads(REF, "day-one", [
        { filename: `p${i}.jpg`, bytes: await paintJpeg(300, 200, i) },
      ]);
      expect(result.ok, JSON.stringify(result)).toBe(true);
    }

    // O(n²) would be 0+1+2+...+9 = 45 decodes of *existing* pictures alone,
    // on top of one decode per upload for the arriving file itself (in
    // storeUploads, not dayFingerprints) — 45 is the number this guards
    // against. Bounded means at most a small constant per file, not growing
    // with how many came before it: a cache hit is a stat, not a decode.
    expect(decodeSource).toHaveBeenCalledTimes(BATCH);
  });

  test("a second request after the first still decodes only the new file", async () => {
    await storeUploads(REF, "day-one", [{ filename: "a.jpg", bytes: await paintJpeg(300, 200, 1) }]);
    vi.mocked(decodeSource).mockClear();

    await storeUploads(REF, "day-one", [{ filename: "b.jpg", bytes: await paintJpeg(300, 200, 2) }]);

    // Without the cache this decodes `a.jpg` (already on the day) plus `b.jpg`
    // (arriving) — two calls. With it, `a.jpg`'s fingerprint is already known.
    expect(decodeSource).toHaveBeenCalledTimes(1);
  });
});
