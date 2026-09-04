import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import { basemapFor, basemapProblem, clearBasemapCache } from "@/lib/basemap";
import { frameRoute } from "@/lib/mapFrame";
import { GET as health } from "@/app/api/health/route";

/**
 * B179 — one failed read of the basemap bundle used to blank every map on the
 * instance until somebody restarted the process.
 *
 * `bundle()` read `lib/mapdata/basemap.json.gz` once and cached whatever came
 * back, including the failure: `cached = null` in a bare `catch`. Null is a
 * *supported* answer — a checkout that never ran `npm run build:mapdata` draws
 * maps without a basemap under them, deliberately — so the failure was
 * indistinguishable from the state the software is designed to survive, and
 * nothing logged it. The file is 6.7 MB gzipped and 25 MB parsed, the largest
 * single allocation the server makes, so an interrupted read or a `RangeError`
 * under memory pressure is not a thought experiment: it was first noticed as
 * three map assertions silently *skipping* in one vitest run out of three.
 *
 * These are the two halves the task asks for: a fault is retried and said out
 * loud, and absence stays silent.
 */

/** alps-2024's four stops — the same route the rest of the map tests frame. */
const ALPS = [
  { lat: 46.1161, lng: 8.2939 },
  { lat: 46.5614, lng: 8.3372 },
  { lat: 46.7297, lng: 8.4444 },
  { lat: 46.6364, lng: 8.5942 },
];

const frame = () => frameRoute(ALPS);

/** Every read of the bundle fails; everything else on disk still works. */
function breakBundleReads(error: NodeJS.ErrnoException) {
  const real = fs.readFileSync.bind(fs);
  return vi.spyOn(fs, "readFileSync").mockImplementation(((file: unknown, ...rest: unknown[]) => {
    if (typeof file === "string" && file.endsWith("basemap.json.gz")) throw error;
    return (real as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof fs.readFileSync);
}

function ioError(code: string, message: string): NodeJS.ErrnoException {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

/** How many times the bundle itself was read through a given spy. */
function bundleReads(spy: ReturnType<typeof breakBundleReads>): number {
  return spy.mock.calls.filter(
    (call) => typeof call[0] === "string" && call[0].endsWith("basemap.json.gz"),
  ).length;
}

/** Every `[basemap]` line written to a mocked `console.warn`. */
function warnings(): string[] {
  return vi
    .mocked(console.warn)
    .mock.calls.map((call) => String(call[0]))
    .filter((line) => line.startsWith("[basemap]"));
}

describe("a basemap bundle that will not read", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    clearBasemapCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearBasemapCache();
  });

  test("is not cached as 'no basemap': the next call reads again", () => {
    const spy = breakBundleReads(ioError("EIO", "EIO: i/o error, read"));

    expect(basemapFor(frame())).toBeNull();
    expect(bundleReads(spy)).toBe(1);

    // The whole bug in one assertion. Before B179 this stayed at 1 for the
    // life of the process, and every map on the instance drew blank with it.
    expect(basemapFor(frame())).toBeNull();
    expect(bundleReads(spy)).toBe(2);
  });

  test("recovers by itself once the file reads again", () => {
    const spy = breakBundleReads(ioError("EIO", "EIO: i/o error, read"));
    expect(basemapFor(frame())).toBeNull();
    expect(basemapProblem()).toMatch(/EIO/);

    // No `clearBasemapCache()`: the point is that the *successful* read clears
    // the fault, not that the test seam does.
    spy.mockRestore();
    expect(basemapFor(frame())).not.toBeNull();
    expect(basemapProblem()).toBeNull();
  });

  test("says so once per distinct fault, not once per map", () => {
    breakBundleReads(ioError("EIO", "EIO: i/o error, read"));
    basemapFor(frame());
    basemapFor(frame());

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toMatch(/every map on this instance draws without/);
  });

  test("stops hammering a file that is never going to read", () => {
    const spy = breakBundleReads(ioError("EIO", "EIO: i/o error, read"));
    for (let i = 0; i < 8; i++) expect(basemapFor(frame())).toBeNull();
    // Retried eagerly a bounded number of times, then backed off: a corrupt
    // file must not cost a 6.7 MB read and a 25 MB parse on every page render.
    expect(bundleReads(spy)).toBeLessThanOrEqual(3);
    expect(bundleReads(spy)).toBeGreaterThan(1);
    // Backed off, still reported. This is what /api/health reads.
    expect(basemapProblem()).toMatch(/EIO/);
  });

  test("a bundle nobody built is absent, not broken — and stays silent", () => {
    const spy = breakBundleReads(ioError("ENOENT", "ENOENT: no such file or directory"));

    expect(basemapFor(frame())).toBeNull();
    expect(basemapFor(frame())).toBeNull();

    // Read once and remembered: this is the supported state a checkout that
    // skipped `npm run build:mapdata` is in, and it is not a fault.
    expect(bundleReads(spy)).toBe(1);
    expect(basemapProblem()).toBeNull();
    expect(warnings()).toEqual([]);
  });
});

describe("/api/health on the basemap", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearBasemapCache();
  });

  test("says ok when the bundle reads", async () => {
    clearBasemapCache();
    expect(basemapFor(frame())).not.toBeNull();

    const body = await (await health(new Request("https://example.test/api/health"))).json();
    expect(body.basemap).toEqual({ ok: true });
  });

  test("reports a bundle it could not read, without failing the instance", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    breakBundleReads(ioError("EACCES", "EACCES: permission denied, open"));
    clearBasemapCache();
    expect(basemapFor(frame())).toBeNull();

    const response = await health(new Request("https://example.test/api/health"));
    const body = await response.json();

    expect(body.basemap.ok).toBe(false);
    // Anonymously the fault has a code and no path — B234, whose own test
    // asserts the full message comes back with a HEALTH_TOKEN.
    expect(body.basemap.code).toBe("unreadable");
    expect(body.basemap.error).toBeUndefined();
    // A map with no borders under it is not a reason to take the instance out
    // of a load balancer — the same call `backup` makes.
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.content.ok).toBe(true);
  });
});
