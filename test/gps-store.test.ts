import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendFixes, gpsDir, readRange, thin, MIN_METRES, MIN_SECONDS } from "@/lib/gps/store";
import type { Fix } from "@/importers/gps/schema";

/**
 * B665 — the private half.
 *
 * The store holds somebody's whole location history, so the tests that matter
 * most here are the ones about what it does *not* do: appear in an export,
 * appear in the app's import graph, or grow every time the same file is
 * imported twice.
 */

const USER = "ana";
let dir: string;

const at = (minutes: number, lat: number, lon: number): Fix => ({
  t: Date.UTC(2026, 5, 1, 8, 0, 0) + minutes * 60_000,
  lat,
  lon,
});

/** Roughly a kilometre north, at these latitudes. */
const KM = 0.009;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-gps-"));
  process.env.CONTENT_DIR = dir;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTENT_DIR;
});

describe("thinning", () => {
  test("keeps a fix five minutes apart, or 250 metres apart, and no other", () => {
    const kept = thin([
      at(0, 47, 8),
      // One minute later and thirty metres on: neither rule met.
      at(1, 47 + KM * 0.03, 8),
      // Still inside five minutes, but now a kilometre away — a motorway, and
      // the reason the distance rule exists at all.
      at(2, 47 + KM, 8),
      // Standing still, but six minutes have passed.
      at(8, 47 + KM, 8),
    ]);
    expect(kept.map((f) => [f.lat, f.lon])).toEqual([
      [47, 8],
      [47 + KM, 8],
      [47 + KM, 8],
    ]);
  });

  test("no two kept fixes are within both five minutes and 250 metres", () => {
    // A dense hour of a phone jittering on a table, plus a drive.
    const dense: Fix[] = [];
    for (let i = 0; i < 240; i++) dense.push(at(i / 4, 47 + i * 0.0004, 8));
    const kept = thin(dense);
    for (let i = 1; i < kept.length; i++) {
      const seconds = (kept[i].t - kept[i - 1].t) / 1000;
      const metres =
        Math.hypot(kept[i].lat - kept[i - 1].lat, kept[i].lon - kept[i - 1].lon) * 111_320;
      expect(seconds >= MIN_SECONDS || metres >= MIN_METRES).toBe(true);
    }
  });

  test("one second holds one position, however far apart the export claims", () => {
    // Google ends an activity and starts the next segment at the same instant,
    // hundreds of metres apart. Kept, that pair survives the distance rule and
    // makes the *next* import's copy of it survive too — 1,191 positions of
    // growth per re-import, found against a real ten-month export.
    const kept = thin([at(0, 47, 8), at(0, 47 + KM * 5, 8)]);
    expect(kept).toHaveLength(1);
  });
});

describe("the store on disk", () => {
  test("writes a file per month, in UTC", () => {
    appendFixes(USER, [
      { t: Date.parse("2026-06-30T23:00:00Z"), lat: 47, lon: 8 },
      { t: Date.parse("2026-07-01T01:00:00Z"), lat: 47.5, lon: 8 },
    ]);
    expect(fs.readdirSync(gpsDir(USER)).sort()).toEqual(["2026-06.jsonl", "2026-07.jsonl"]);
  });

  test("importing the same fixes twice changes nothing", () => {
    const fixes = [at(0, 47, 8), at(6, 47.1, 8), at(20, 47.2, 8)];
    const first = appendFixes(USER, fixes);
    const before = fs.readFileSync(path.join(gpsDir(USER), "2026-06.jsonl"), "utf8");
    const second = appendFixes(USER, fixes);
    expect(second.after).toBe(first.after);
    expect(fs.readFileSync(path.join(gpsDir(USER), "2026-06.jsonl"), "utf8")).toBe(before);
  });

  test("thins across the seam between two imports", () => {
    appendFixes(USER, [at(0, 47, 8)]);
    // A minute later and fifty metres on. Thinned against what is already
    // there, not only against its own file.
    appendFixes(USER, [at(1, 47 + KM * 0.05, 8)]);
    expect(readRange(USER, 0, Date.now() + 1e10)).toHaveLength(1);
  });

  test("reads back only the range asked for", () => {
    appendFixes(USER, [
      { t: Date.parse("2026-05-01T12:00:00Z"), lat: 47, lon: 8 },
      { t: Date.parse("2026-06-15T12:00:00Z"), lat: 48, lon: 8 },
      { t: Date.parse("2026-07-20T12:00:00Z"), lat: 49, lon: 8 },
    ]);
    const june = readRange(USER, Date.parse("2026-06-01T00:00:00Z"), Date.parse("2026-06-30T23:59:59Z"));
    expect(june.map((f) => f.lat)).toEqual([48]);
  });

  test("a journal with no history reads as nothing, not as an error", () => {
    expect(readRange("nobody", 0, Date.now())).toEqual([]);
  });
});

describe("the rules that keep it private", () => {
  test("nothing under app/ imports the store or the derivation", () => {
    // Structural, like `test/postcard-orders.test.ts`'s guard on `sendOrder`.
    // There is no route that reads a position, and this is what keeps it that
    // way: what the site draws is the derived `track.json`, never this.
    //
    // Since B671 there are routes that *write* into the store, and they reach
    // it through `lib/gps/api.ts` — one module that owns what an import is and
    // hands back counts rather than coordinates. That indirection is the point
    // of this assertion surviving the API: a route that imported `./store`
    // directly could answer `readRange` straight down the wire.
    const hits: string[] = [];
    const walk = (root: string) => {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf8");
          if (/from "@\/lib\/gps\/(store|enrich)"/.test(source))
            hits.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), "app"));
    expect(hits).toEqual([]);
  });

  /**
   * B1495 — the same assertion for the sync manifest, which is the second
   * thing that walks a journal's folder and could therefore be the first
   * thing in this codebase able to hand back a coordinate.
   *
   * The ticket's first decision asked for this to be mechanism rather than a
   * sentence somebody later disagrees with, and both halves are needed. The
   * import graph is the *structural* half: `lib/sync/manifest.ts` reaching
   * into `lib/gps/` would be a route away from a position, since the manifest
   * is served over HTTP to whoever holds an owner token — and those sit in
   * agent scrollbacks. The built manifest is the *behavioural* half: a walk
   * that simply forgot to exclude the folder would pass the import check and
   * still list every month of somebody's history by name.
   */
  test("the sync manifest module does not reach the gps store", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib", "sync", "manifest.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/from "\.\.?\/gps\//);
    expect(source).not.toMatch(/from "@\/lib\/gps\//);
  });

  test("a manifest of a journal with a position history names neither the folder nor a fix", async () => {
    const trip = path.join(dir, USER, "trips", "algarve");
    fs.mkdirSync(path.join(trip, "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, USER, "config.json"),
      JSON.stringify({
        title: "A", owner: { name: "A B", nickname: "A" }, defaultLocale: "en",
        locales: ["en"], baseCurrency: "CHF", displayCurrencies: ["CHF"], units: "metric",
      }),
    );
    fs.writeFileSync(
      path.join(trip, "trip.md"),
      ['---', 'id: algarve', 'title: "A"', 'start: "2026-06-22"', 'end: "2026-06-24"',
        "status: past", "visibility: public", "---", ""].join("\n"),
    );
    // The derived line is what a laptop copy gets; the history it came from
    // is what it must never get.
    fs.writeFileSync(path.join(trip, "track.json"), JSON.stringify({ segments: [] }));
    appendFixes(USER, [{ t: Date.parse("2026-06-22T09:00:00Z"), lat: 47.38564, lon: 8.21819 }]);

    const { clearUserCache } = await import("@/lib/users");
    clearUserCache();
    const { buildManifest, clearSyncHashCache } = await import("@/lib/sync/manifest");
    clearSyncHashCache();
    const manifest = buildManifest(USER);
    const serialised = JSON.stringify(manifest);

    // It found the journal at all — otherwise the assertions below pass on an
    // empty manifest and prove nothing.
    expect(manifest.files.map((f) => f.path)).toContain("trips/algarve/trip.md");
    expect(serialised).not.toContain("gps/");
    expect(serialised).not.toContain("2026-06.jsonl");
    // The coordinate itself, in case a path ever changes shape.
    expect(serialised).not.toContain("47.38564");

    // And `track.json` is out too — derived server-side from the history
    // above, so syncing it up at the thing that derives it is a conflict with
    // nothing on either side worth keeping (B1495 decision 3).
    expect(manifest.files.map((f) => f.path)).not.toContain("trips/algarve/track.json");
  });

  test("no route reads a file the manifest refuses", async () => {
    const { inSync, resolveSyncPath } = await import("@/lib/sync/manifest");
    // The listing and the file door ask one predicate, so these cannot drift.
    for (const refused of [
      "gps/2026-06.jsonl",
      "gps/exclude.json",
      "trips/algarve/originals/01.jpg",
      "trips/algarve/track.json",
      // Shouted, because the filesystem under this is usually
      // case-insensitive: on APFS these resolve to the real files, so a
      // case-sensitive check would exclude them from the listing and then
      // serve them to anybody who asked in capitals.
      "GPS/2026-06.jsonl",
      "Gps/2026-06.jsonl",
      "trips/algarve/ORIGINALS/01.jpg",
      "trips/algarve/Originals/01.jpg",
      "trips/algarve/TRACK.json",
      "postcards/a.pdf",
      "photobooks/b.pdf",
      "trips/algarve/.ingest.json",
      ".fernscout-sync.json",
      "../other/config.json",
      "trips/../../etc/passwd",
    ]) {
      expect(inSync(refused)).toBe(false);
      expect(resolveSyncPath(USER, refused)).toBeNull();
    }
    for (const allowed of [
      "config.json",
      "trips/algarve/trip.md",
      "trips/algarve/entries/2026-06-22-a.md",
      "trips/algarve/media/a-day/01.jpg",
      "trips/algarve/costs.md",
      "inbox/media/a3f1c2-sunset.jpg",
      "inbox/media/a3f1c2-sunset.jpg.meta.json",
    ]) {
      expect(inSync(allowed)).toBe(true);
    }
  });

  test.each(["all", "open-to-link"] as const)(
    "a real %s export zip holds the trip's track and nothing from gps/",
    async (scope) => {
      // Built rather than reasoned about: `/<user>/export.zip` is a plain GET
      // for the open-to-link scope, so "the walk cannot reach it" is a claim
      // worth proving against actual archive entries.
      const trip = path.join(dir, USER, "trips", "algarve");
      fs.mkdirSync(trip, { recursive: true });
      fs.writeFileSync(
        path.join(dir, USER, "config.json"),
        JSON.stringify({
          title: "A", owner: { name: "A B", nickname: "A" }, defaultLocale: "en",
          locales: ["en"], baseCurrency: "CHF", displayCurrencies: ["CHF"], units: "metric",
        }),
      );
      fs.writeFileSync(
        path.join(trip, "trip.md"),
        ['---', 'id: algarve', 'title: "A"', 'start: "2026-06-22"', 'end: "2026-06-24"',
          "status: past", "visibility: public", "---", ""].join("\n"),
      );
      fs.writeFileSync(path.join(trip, "track.json"), JSON.stringify({ segments: [] }));
      appendFixes(USER, [{ t: Date.parse("2026-06-22T09:00:00Z"), lat: 47.38564, lon: 8.21819 }]);

      const { clearUserCache } = await import("@/lib/users");
      const { clearConfigCache } = await import("@/lib/config");
      clearUserCache();
      clearConfigCache();
      const { buildUserExportZipBuffer } = await import("@/lib/exportZip");
      const zip = (await buildUserExportZipBuffer(USER, scope)).toString("latin1");

      expect(zip).toContain("trips/algarve/track.json");
      expect(zip).not.toContain("gps/");
      // The coordinate itself, in case a path ever changes shape.
      expect(zip).not.toContain("47.38564");
    },
  );
});
