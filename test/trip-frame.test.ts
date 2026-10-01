import { describe, expect, test } from "vitest";
import {
  buildTripFrame,
  framePoints,
  greatCircleArc,
  linesForDay,
  placesForDay,
  type MapPlace,
  type RecordedSegment,
} from "@/lib/map/tripFrame";

/**
 * B2534 — the six trip shapes the ticket names, built from their structure
 * (never a real home's coordinates): home-far (Algarve-like), a road trip, a
 * single town, two regions 700 km apart, a five-region tour and a world
 * trip. See `docs/plans/2026-09-28-trip-maps/README.md`'s "Rules every map
 * follows" for the spec each block below is checking.
 */

function place(day: number, lat: number, lng: number, name: string, home = false): MapPlace {
  return { day, date: `2026-01-${String(day).padStart(2, "0")}`, lat, lng, name, home };
}

describe("home-far: a trip that starts and ends at home", () => {
  // Home (invented coordinates, not a real address) two days either side of
  // five days in a single far region.
  const trip = [
    place(1, 47.4, 8.5, "Zürich", true),
    place(2, 37.02, -8.0, "Faro"),
    place(3, 37.05, -8.25, "Lagos"),
    place(4, 37.1, -8.6, "Sagres"),
    place(5, 37.02, -8.0, "Faro"),
    place(6, 47.4, 8.5, "Zürich", true),
  ];

  test("frames the holiday, never home", () => {
    const frame = buildTripFrame(trip);
    expect(frame.isTour).toBe(false);
    expect(frame.framePlaces.map((p) => p.day)).toEqual([2, 3, 4, 5]);
    expect(frame.framePlaces.some((p) => p.name === "Home")).toBe(false);
  });

  test("a home-zone place is never named by its own name", () => {
    const frame = buildTripFrame(trip);
    const homeInAnyList = [...frame.regions.flatMap((r) => r.places), ...frame.chips.map((c) => c.place)].filter(
      (p) => p.day === 1 || p.day === 6,
    );
    expect(homeInAnyList.length).toBeGreaterThan(0);
    for (const p of homeInAnyList) expect(p.name).toBe("Home");
  });

  test("home is a chip, not part of the frame", () => {
    const frame = buildTripFrame(trip);
    const homeChips = frame.chips.filter((c) => c.kind === "far" && c.place.day === 1);
    expect(homeChips).toHaveLength(1);
    expect(homeChips[0].label).toBe("Home");
    expect(typeof homeChips[0].bearingDeg).toBe("number");
  });

  test("photo-only joins collapse a repeated leg and drop a home-to-home hop", () => {
    const frame = buildTripFrame(trip);
    // Faro appears on day 2 and day 5, and the trip returns through it once
    // more on the way to a second Home leg — every Faro<->Home-adjacent hop
    // collapses, and home-to-home never draws.
    const homeHome = frame.lines.filter((l) => l.fromDay === 1 && l.toDay === 6);
    expect(homeHome).toHaveLength(0);
  });
});

describe("road trip: several towns inside one region, no home data", () => {
  const trip = [
    place(1, 46.116, 8.294, "Domodossola"),
    place(2, 46.561, 8.337, "Grimsel Pass"),
    place(3, 46.730, 8.444, "Susten Pass"),
    place(4, 46.636, 8.594, "Andermatt"),
  ];

  test("one region, whole trip in frame, no chips", () => {
    const frame = buildTripFrame(trip);
    expect(frame.regions).toHaveLength(1);
    expect(frame.isTour).toBe(false);
    expect(frame.framePlaces).toHaveLength(4);
    expect(frame.chips).toHaveLength(0);
  });

  test("photo-only joins connect every day, straight, no duplicate pair", () => {
    const frame = buildTripFrame(trip);
    expect(frame.lines).toHaveLength(3);
    expect(frame.lines.every((l) => l.kind === "photo-join")).toBe(true);
    expect(new Set(frame.lines.map((l) => `${l.fromDay}-${l.toDay}`)).size).toBe(3);
  });
});

describe("one town: every day the same place", () => {
  const trip = [place(1, 51.5, -0.13, "London"), place(2, 51.5, -0.13, "London"), place(3, 51.5, -0.13, "London")];

  test("a single region, no lines drawn between identical points", () => {
    const frame = buildTripFrame(trip);
    expect(frame.regions).toHaveLength(1);
    expect(frame.framePlaces).toHaveLength(3);
    expect(frame.lines).toHaveLength(0);
  });
});

describe("two regions 700 km apart", () => {
  // Zürich-ish and Berlin-ish, roughly 700 km apart, no home concept.
  const trip = [
    place(1, 47.37, 8.54, "Zürich"),
    place(2, 47.36, 8.55, "Zürich"),
    place(3, 47.35, 8.56, "Zürich"),
    place(4, 52.52, 13.40, "Berlin"),
  ];

  test("the larger region frames the map; the smaller is a region chip", () => {
    const frame = buildTripFrame(trip);
    expect(frame.regions).toHaveLength(2);
    expect(frame.isTour).toBe(false);
    expect(frame.framePlaces.every((p) => p.name === "Zürich")).toBe(true);
    expect(frame.chips).toHaveLength(1);
    expect(frame.chips[0].kind).toBe("region");
    expect(frame.chips[0].label).toBe("Berlin");
    expect(frame.chips[0].days).toBe(1);
  });

  test("the leg leaving the shown region is not drawn inside it — a flight chip stands for it", () => {
    const frame = buildTripFrame(trip);
    // The two hops inside Zürich stay; the flight on to Berlin is dropped —
    // the region chip above stands for it instead.
    expect(frame.lines.every((l) => l.fromDay <= 3 && l.toDay <= 3)).toBe(true);
    expect(frame.lines.some((l) => l.toDay === 4 || l.fromDay === 4)).toBe(false);
  });
});

describe("a five-region tour", () => {
  // Five European towns, each pair further than 300 km apart, all inside one
  // continent (max pairwise distance well under the globe threshold).
  const trip = [
    place(1, 47.37, 8.54, "Zürich"),
    place(2, 48.21, 16.37, "Vienna"),
    place(3, 41.9, 12.5, "Rome"),
    place(4, 52.52, 13.4, "Berlin"),
    place(5, 40.42, -3.7, "Madrid"),
  ];

  test("more than three regions ⇒ a tour, shown whole", () => {
    const frame = buildTripFrame(trip);
    expect(frame.regions).toHaveLength(5);
    expect(frame.isTour).toBe(true);
    expect(frame.framePlaces).toHaveLength(5);
    expect(frame.chips).toHaveLength(0); // a tour has no "other region" chips
  });
});

describe("a world trip", () => {
  const trip = [
    place(1, 47.37, 8.54, "Zürich"),
    place(2, 13.75, 100.5, "Bangkok"),
    place(3, -33.87, 151.21, "Sydney"),
    place(4, 40.71, -74.0, "New York"),
  ];

  test("regions on several continents ⇒ a tour", () => {
    const frame = buildTripFrame(trip);
    expect(frame.regions.length).toBeGreaterThan(3);
    expect(frame.isTour).toBe(true);
  });

  test("far-apart legs are great-circle flights, not straight lines", () => {
    const frame = buildTripFrame(trip);
    expect(frame.lines.every((l) => l.kind === "flight")).toBe(true);
    expect(frame.lines.every((l) => l.coords.length > 2)).toBe(true);
  });
});

describe("recorded segments — a tracked trip", () => {
  const trip = [place(1, 46.2, 6.15, "Geneva"), place(2, 46.5, 6.63, "Lausanne")];
  const recorded: RecordedSegment[] = [
    { day: 1, points: [{ lat: 46.2, lng: 6.15 }, { lat: 46.3, lng: 6.3 }] },
    { day: 1, points: [{ lat: 46.3, lng: 6.3 }, { lat: 46.5, lng: 6.63 }], gap: true },
  ];

  test("a tracked trip still draws its flights between far-apart days, not its short joins", () => {
    // A tour, so legs between regions are drawn rather than left to a chip.
    const flown = [
      ...trip,
      place(3, 52.52, 13.4, "Berlin"),
      place(4, 41.9, 12.5, "Rome"),
      place(5, 40.42, -3.7, "Madrid"),
    ];
    const frame = buildTripFrame(flown, recorded);
    const flights = frame.lines.filter((l) => l.kind === "flight");
    expect(flights.map((l) => [l.fromDay, l.toDay])).toEqual([[2, 3], [3, 4], [4, 5]]);
    expect(frame.lines.filter((l) => l.kind !== "flight").map((l) => l.kind).sort()).toEqual(["gap", "recorded"]);
  });

  test("recorded lines keep their own kind, gap included", () => {
    const frame = buildTripFrame(trip, recorded);
    expect(frame.lines.map((l) => l.kind).sort()).toEqual(["gap", "recorded"]);
  });

  test("per-day selection returns only that day's lines and places", () => {
    const frame = buildTripFrame(trip, recorded);
    expect(linesForDay(frame, 1)).toHaveLength(2);
    expect(linesForDay(frame, 2)).toHaveLength(0);
    expect(placesForDay(frame, 1).map((p) => p.name)).toEqual(["Geneva"]);
  });
});

describe("framePoints", () => {
  test("drops a far outlier so a home-far trip frames the holiday, not a continent", () => {
    const points = [
      { lat: 47.4, lng: 8.5 }, // "home" — no flag needed, it's just a lone far point
      { lat: 37.02, lng: -8.0 },
      { lat: 37.05, lng: -8.25 },
      { lat: 37.1, lng: -8.6 },
    ];
    const framed = framePoints(points);
    expect(framed).toHaveLength(3);
    expect(framed).not.toContainEqual(points[0]);
  });

  test("a tour keeps every point", () => {
    const points = [
      { lat: 47.37, lng: 8.54 },
      { lat: 48.21, lng: 16.37 },
      { lat: 41.9, lng: 12.5 },
      { lat: 52.52, lng: 13.4 },
      { lat: 40.42, lng: -3.7 },
    ];
    expect(framePoints(points)).toHaveLength(5);
  });

  test("empty in, empty out", () => {
    expect(framePoints([])).toEqual([]);
  });
});

describe("greatCircleArc", () => {
  test("a zero-length arc is just the two identical points", () => {
    const p = { lat: 10, lng: 10 };
    expect(greatCircleArc(p, p)).toEqual([p, p]);
  });

  test("a long arc has intermediate points between its ends", () => {
    const arc = greatCircleArc({ lat: 0, lng: 0 }, { lat: 0, lng: 90 }, 4);
    expect(arc).toHaveLength(5);
    expect(arc[0].lng).toBeCloseTo(0, 0);
    expect(arc[4].lng).toBeCloseTo(90, 0);
  });
});
