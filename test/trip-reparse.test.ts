import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { getMalformedTrips, getTrips } from "@/lib/trips";

/**
 * `JSON.parse` throwing on a broken `trip.json` (B1598 — used to be
 * `matter()`, which memoized a parse *by raw content* in a module-level
 * object and wrote that cache entry *before* it parsed, not after: a call
 * that threw left a half-built, non-throwing result sitting under the
 * failing text's key, so the next call with byte-identical content got that
 * stale object back — an empty `data` and the whole raw file folded into
 * `content` — instead of the same parse failure repeating. `JSON.parse` has
 * no such cache, so this file's own property — a broken trip.json stays
 * reported as broken across a forced re-parse of the whole journal — holds
 * for a different, simpler reason now: there is nothing left to go stale).
 *
 * `tripsSignature` is a fingerprint across *every* trip folder in the
 * journal, so editing any trip's `trip.json` invalidates the whole cache and
 * forces every trip — including a still-broken one — to be re-parsed. Kept
 * as a regression pin: the property that mattered before B1598 (no stale
 * gray-matter cache entry survives a re-parse) still has to hold for
 * whatever `readTrip` does with a broken file.
 */

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"u"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

const GOOD = (id: string) =>
  JSON.stringify({
    id,
    title: "A Trip",
    dates: { from: "2024-01-01", to: "2024-01-09" },
    visibility: "public",
  });

// Malformed JSON rather than malformed markdown (B1630): `getTrip` reads
// `trip.json` exclusively now (lib/trips.ts).
const BROKEN = "{ this is not json";

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-reparse-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "u"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;
  return dir;
}

function writeTrip(dir: string, folder: string, body: string): void {
  fs.mkdirSync(path.join(dir, "u", "trips", folder), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "trips", folder, "trip.json"), body);
}

/** Silences the `[trips]` warnings these fixtures deliberately provoke. */
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  warn.mockRestore();
});

describe("getMalformedTrips across a forced re-parse", () => {
  test("a trip.md that failed to parse once is still malformed after a sibling trip changes", () => {
    const dir = journal();
    writeTrip(dir, "broken-2024", BROKEN);
    writeTrip(dir, "asia-2023", GOOD("asia-2023"));

    // First read: the broken trip fails to parse and is reported as
    // "unparseable". This also primes gray-matter's own module-level cache
    // with a half-built, non-throwing entry keyed on the broken file's exact
    // bytes — `data: {}`, the whole raw file folded into `content`.
    let bad = getMalformedTrips("u");
    expect(bad.map((b) => b.folder)).toEqual(["broken-2024"]);
    expect(bad[0].reason).toBe("unparseable");
    expect(getTrips("u").map((t) => t.id)).toEqual(["asia-2023"]);

    // Change a *different* trip's trip.json — its size changes, so
    // `tripsSignature` changes and the whole journal, including the still
    // -broken trip whose bytes never moved, is forced through `readTrip`
    // again.
    writeTrip(
      dir,
      "asia-2023",
      JSON.stringify({
        id: "asia-2023",
        title: "A Trip",
        dates: { from: "2024-01-01", to: "2024-01-09" },
        visibility: "public",
        intro: "more content",
      }),
    );

    // The broken trip's bytes are unchanged. Without clearing gray-matter's
    // cache in the catch branch, this second parse hits the stale cache entry
    // from the first failure instead of throwing again: `matter()` returns
    // `data: {}` rather than raising, `readTrip` never reaches its `catch`,
    // and the folder is refused for a different, wrong reason — "no id" —
    // rather than the same unparseable file it always was. Still reported
    // (nothing here builds a `Trip` from it, since an empty `data` has no
    // `id` either), but the owner is told the wrong thing, and a fix that
    // instead let the folder through as a `Trip` would fail this the same
    // way.
    bad = getMalformedTrips("u");
    expect(bad.map((b) => b.folder)).toEqual(["broken-2024"]);
    expect(bad[0].reason).toBe("unparseable");
    expect(getTrips("u").map((t) => t.id)).toEqual(["asia-2023"]);
  });
});
