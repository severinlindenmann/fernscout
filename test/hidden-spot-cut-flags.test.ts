import { describe, expect, test } from "vitest";
import { splitOutHiddenSpots } from "@/lib/gps/track";
import { recordedSegmentsFor } from "@/lib/map/recordedSegments";

// ~1.1 km between rows of 0.01 degrees latitude; the spot sits on the middle segment.
const seg = (lat: number) => ({ day: "2026-10-01", from: "2026-10-01T08:00:00.000Z", points: [[lat, 7], [lat + 0.0005, 7.0005]] as [number, number][] });
const spot = { id: "s", lat: 46.01, lon: 7, radiusM: 300 };

describe("hidden spots in served tracks", () => {
  test("a segment cut away entirely still marks its neighbours, so nothing bridges across the spot", () => {
    const out = splitOutHiddenSpots([seg(46.0), seg(46.01), seg(46.0105)], [spot]);
    expect(out).toHaveLength(1);
    expect(out[0].cutAfter).toBe(true);
    const next = splitOutHiddenSpots([seg(46.0), seg(46.01), seg(46.02)], [spot]);
    expect(next).toHaveLength(2);
    expect(next[0].cutAfter).toBe(true);
    expect(next[1].cutBefore).toBe(true);
    const gaps = recordedSegmentsFor(next.map((s) => ({ date: s.day, points: s.points, cutBefore: s.cutBefore, cutAfter: s.cutAfter })), new Map([["2026-10-01", 1]]));
    expect(gaps.filter((s) => s.gap)).toHaveLength(0);
  });
});
