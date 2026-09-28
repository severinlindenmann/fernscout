import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { deriveTrack } from "@/lib/gps/enrich";
import { namedStretchLabels, writeTrack, writeTail } from "@/lib/gps/track";
import type { Fix } from "@/importers/gps/schema";

/**
 * B2539, D8 C — the owner can hide a spot, hide a stretch, and name a
 * stretch. Pure `deriveTrack` behaviour, the same level `test/gps-track.test.ts`
 * exercises private zones at: no HTTP, no filesystem, one function in, one
 * `Track` out.
 */

const on = (day: string, hour: number, minute: number, lat: number, lon: number): Fix => ({
  t: Date.parse(`${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`),
  lat,
  lon,
});

const DATES = { start: "2026-06-22", end: "2026-06-22" };

describe("hidden spots (D8 C)", () => {
  test("drops every fix inside the circle, and cuts the line there", () => {
    const spot = { id: "s1", lat: 37.1, lon: -8.5, radiusM: 200 };
    const track = deriveTrack(
      [
        on("2026-06-22", 8, 0, 37.1, -8.5),
        on("2026-06-22", 8, 5, 37.1001, -8.5001),
        on("2026-06-22", 9, 0, 37.5, -8.9),
        on("2026-06-22", 9, 5, 37.6, -9.0),
      ],
      { ...DATES, hiddenSpots: [spot] },
    );
    const points = track.segments.flatMap((s) => s.points);
    expect(points).toEqual([
      [37.5, -8.9],
      [37.6, -9.0],
    ]);
  });

  test("with no hidden spots, a fix at the same coordinates is kept", () => {
    const track = deriveTrack(
      [
        on("2026-06-22", 8, 0, 37.1, -8.5),
        on("2026-06-22", 8, 5, 37.1001, -8.5001),
      ],
      DATES,
    );
    expect(track.segments.flatMap((s) => s.points)).toHaveLength(2);
  });
});

describe("hidden stretches (D8 C)", () => {
  test("drops every fix in the time range, and cuts the line there", () => {
    const stretch = { id: "h1", from: "2026-06-22T14:00:00Z", to: "2026-06-22T16:00:00Z" };
    const track = deriveTrack(
      [
        on("2026-06-22", 13, 0, 37.0, -8.0),
        on("2026-06-22", 13, 5, 37.01, -8.01),
        on("2026-06-22", 15, 0, 37.5, -8.5), // inside the hidden stretch
        on("2026-06-22", 18, 0, 38.0, -9.0),
        on("2026-06-22", 18, 5, 38.01, -9.01),
      ],
      { ...DATES, hiddenStretches: [stretch] },
    );
    const points = track.segments.flatMap((s) => s.points);
    expect(points).not.toContainEqual([37.5, -8.5]);
    expect(points).toEqual([
      [37.0, -8.0],
      [37.01, -8.01],
      [38.0, -9.0],
      [38.01, -9.01],
    ]);
  });
});

describe("named stretches (D8 C) — the Algarve boat trip", () => {
  test("computes a label at the fix nearest the stretch's own middle instant", () => {
    const boatTrip = { id: "n1", from: "2026-06-22T10:00:00Z", to: "2026-06-22T12:00:00Z", label: "Boat trip · dolphins" };
    const track = deriveTrack(
      [
        on("2026-06-22", 9, 55, 37.0, -8.9), // just before the stretch
        on("2026-06-22", 10, 5, 37.05, -8.85), // inside, near the start
        on("2026-06-22", 11, 0, 37.1, -8.8), // inside, nearest the midpoint (11:00)
        on("2026-06-22", 11, 55, 37.15, -8.75), // inside, near the end
        on("2026-06-22", 12, 5, 37.2, -8.7), // just after
      ],
      // toleranceM: 0 — this is a label-placement test, not a simplification
      // one; Douglas–Peucker's default 50 m tolerance would otherwise thin
      // out the near-collinear point this test checks for.
      { ...DATES, namedStretches: [boatTrip], toleranceM: 0 },
    );
    expect(track.labels).toEqual([
      { id: "n1", label: "Boat trip · dolphins", day: "2026-06-22", point: [37.1, -8.8] },
    ]);
    // Naming does not hide — every fix, including the ones inside the
    // stretch, still reaches the line.
    const points = track.segments.flatMap((s) => s.points);
    expect(points).toContainEqual([37.1, -8.8]);
  });

  test("a named stretch with no fixes in range gets no label", () => {
    const empty = { id: "n2", from: "2026-06-22T20:00:00Z", to: "2026-06-22T21:00:00Z", label: "Nothing here" };
    const track = deriveTrack([on("2026-06-22", 8, 0, 37.0, -8.0), on("2026-06-22", 8, 5, 37.01, -8.01)], {
      ...DATES,
      namedStretches: [empty],
    });
    expect(track.labels).toBeUndefined();
  });

  test("a hidden spot inside a named stretch's range keeps the label off the hidden fix, even when it is the fix closest to the stretch's own middle", () => {
    const spot = { id: "s1", lat: 37.1, lon: -8.8, radiusM: 200 };
    const namedOverSpot = { id: "n3", from: "2026-06-22T10:00:00Z", to: "2026-06-22T12:00:00Z", label: "Overlap" };
    const track = deriveTrack(
      [
        // Exactly the stretch's own midpoint (11:00) — and inside the hidden
        // spot. Without the spot this would be the label's point.
        on("2026-06-22", 11, 0, 37.1, -8.8),
        // Further from the midpoint, but not hidden — this is the only
        // candidate left once the spot cuts the closer one.
        on("2026-06-22", 10, 10, 37.3, -8.6),
      ],
      { ...DATES, hiddenSpots: [spot], namedStretches: [namedOverSpot] },
    );
    expect(track.labels).toEqual([{ id: "n3", label: "Overlap", day: "2026-06-22", point: [37.3, -8.6] }]);
  });
});

describe("namedStretchLabels (D8 C) — the reader-safe door onto a stretch's own label", () => {
  const USER = "ana";
  const TRIP = "algarve";
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-labels-"));
    process.env.CONTENT_DIR = dir;
    fs.mkdirSync(path.join(dir, USER, "trips", TRIP), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.CONTENT_DIR;
  });

  test("a label on a visible date comes back; one on a date this reader cannot see does not", () => {
    writeTrack(USER, TRIP, {
      generated: new Date().toISOString(),
      segments: [{ from: "2026-06-22T10:00:00.000Z", day: "2026-06-22", points: [[37.1, -8.8], [37.2, -8.7]] }],
      labels: [
        { id: "n1", label: "Boat trip · dolphins", day: "2026-06-22", point: [37.1, -8.8] },
        // A day this reader's own visibleDates set (below) does not include.
        { id: "n2", label: "Not this reader's", day: "2026-06-23", point: [37.3, -8.6] },
      ],
    });
    const labels = namedStretchLabels(USER, TRIP, new Set(["2026-06-22"]));
    expect(labels).toEqual([{ id: "n1", label: "Boat trip · dolphins", day: "2026-06-22", point: [37.1, -8.8] }]);
  });

  test("a live tail's own label is included only when live is asked for, and only while the tail is fresh", () => {
    writeTail(USER, TRIP, {
      generated: new Date().toISOString(),
      segments: [{ from: new Date().toISOString(), day: "2026-06-22", points: [[1, 1], [2, 2]] }],
      labels: [{ id: "t1", label: "Just now", day: "2026-06-22", point: [1, 1] }],
    });
    const visible = new Set(["2026-06-22"]);
    expect(namedStretchLabels(USER, TRIP, visible)).toEqual([]);
    expect(namedStretchLabels(USER, TRIP, visible, true)).toEqual([
      { id: "t1", label: "Just now", day: "2026-06-22", point: [1, 1] },
    ]);

    // A stale tail (generated over 24h ago) is refused even with live: true —
    // the same freshness rule readerTrack's own live branch uses.
    writeTail(USER, TRIP, {
      generated: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      segments: [{ from: new Date().toISOString(), day: "2026-06-22", points: [[1, 1], [2, 2]] }],
      labels: [{ id: "t1", label: "Just now", day: "2026-06-22", point: [1, 1] }],
    });
    expect(namedStretchLabels(USER, TRIP, visible, true)).toEqual([]);
  });
});
