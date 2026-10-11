import { describe, expect, it } from "vitest";
import { chipRedundant, legModeFromEntry, legModeFromRecorded, legPattern, longestSegmentMid, placeChips, withDeclaredLegs } from "@/lib/map/legMode";
import { buildTripFrame, linesForRegion, type MapLine, type MapPlace } from "@/lib/map/tripFrame";

const place = (day: number, lat: number, lng: number): MapPlace => ({ day, date: `2026-10-0${day}`, lat, lng, name: `P${day}`, home: false });

describe("leg modes (B-2980)", () => {
  it("folds both vocabularies, never guessing", () => {
    expect(legModeFromRecorded("on_foot")).toBe("walk");
    expect(legModeFromRecorded("plane")).toBe("flight");
    expect(legModeFromRecorded("unknown")).toBeNull();
    expect(legModeFromRecorded("skiing")).toBeNull();
    // a track file stores the entry names
    expect(legModeFromRecorded("walk")).toBe("walk");
    expect(legModeFromRecorded("train")).toBe("train");
    expect(legModeFromEntry("ferry")).toBe("ferry");
    expect(legModeFromEntry("hovercraft")).toBeNull();
  });

  it("maps modes to a small pattern set", () => {
    expect(legPattern("car")).toBe("solid");
    expect(legPattern(null)).toBe("solid");
    expect(legPattern("walk")).toBe("dotted");
    expect(legPattern("bicycle")).toBe("dash");
    expect(chipRedundant("car")).toBe(true);
    expect(chipRedundant("train")).toBe(false);
    expect(legPattern("train")).toBe("hatch");
    expect(legPattern("ferry")).toBe("dashed");
  });

  it("puts the chip on the longest piece", () => {
    const mid = longestSegmentMid([{ lat: 0, lng: 0 }, { lat: 0, lng: 0.01 }, { lat: 0, lng: 0.05 }]);
    expect(mid?.lng).toBeCloseTo(0.03);
  });

  it("drops chips near a stop and thins colliding ones", () => {
    const chips = [{ x: 0, y: 0, data: "a" }, { x: 10, y: 0, data: "b" }, { x: 200, y: 0, data: "c" }, { x: 300, y: 0, data: "d" }];
    const kept = placeChips(chips, [{ x: 300, y: 5 }], 34).map((c) => c.data);
    expect(kept).toEqual(["a", "c"]);
  });

  it("joins days by their own declared mode only where nothing was recorded", () => {
    const places = [place(1, 46.7, 7.6), place(2, 46.7, 7.8), place(3, 46.7, 8.0)];
    const recorded: MapLine = { kind: "recorded", fromDay: 2, toDay: 2, coords: [places[0], places[1]] };
    const out = withDeclaredLegs([recorded], places, new Map([[2, "train"], [3, "ferry"]] as const));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ mode: "train", modeSource: "day" });
    expect(out[1]).toMatchObject({ kind: "photo-join", fromDay: 2, toDay: 3, mode: "ferry", modeSource: "day" });
  });

  it("keeps a recorded mode as recorded", () => {
    const places = [place(1, 46.7, 7.6), place(2, 46.7, 7.8)];
    const recorded: MapLine = { kind: "recorded", fromDay: 2, toDay: 2, coords: [places[0], places[1]], mode: "car", modeSource: "recorded" };
    expect(withDeclaredLegs([recorded], places, new Map([[2, "train"]] as const))[0]).toMatchObject({ mode: "car", modeSource: "recorded" });
  });
});

describe("flights between regions (B-2980)", () => {
  // Shaped after the demo trip: Zurich on days 1-2, a declared flight on day 3 into Bangkok.
  const zurich = place(1, 47.3769, 8.5417);
  const bangkok = { ...place(3, 13.7563, 100.5018), name: "Bangkok" };
  const bangkok2 = { ...place(4, 13.76, 100.51), name: "Bangkok" };
  const frame = buildTripFrame([zurich, bangkok, bangkok2]);

  it("draws one dotted great-circle arc between the regions, overview only", () => {
    const flights = frame.allLines.filter((l) => l.kind === "flight");
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({ fromDay: 1, toDay: 3, overviewOnly: true });
    expect(flights[0].coords.length).toBeGreaterThan(8);
  });

  it("names the flight by the day's own entry, or by the recording, never by distance alone", () => {
    const [arc] = frame.allLines.filter((l) => l.kind === "flight");
    expect(withDeclaredLegs([arc], [zurich, bangkok], new Map([[3, "flight"]] as const))[0]).toMatchObject({ mode: "flight", modeSource: "day" });
    const plane: MapLine = { kind: "recorded", fromDay: 3, toDay: 3, coords: [zurich, bangkok], mode: "flight", modeSource: "recorded" };
    expect(withDeclaredLegs([arc, plane], [zurich, bangkok], new Map())[0]).toMatchObject({ mode: "flight", modeSource: "recorded" });
    // nobody said flight: the arc stays unlabelled, so no chip claims it
    expect(withDeclaredLegs([arc], [zurich, bangkok], new Map())[0].mode).toBeUndefined();
  });

  it("the arc shows only on the whole trip; each region keeps its own lines", () => {
    const [arc] = frame.allLines.filter((l) => l.kind === "flight");
    const mainDays = new Set([3, 4]);
    expect(linesForRegion([arc], mainDays, false)).toEqual([]);
    expect(linesForRegion([arc], mainDays, true)).toEqual([arc]);
  });
});

describe("legend lists the whole trip (B-2980)", () => {
  it("never filters by the selected day, only marks it", async () => {
    const { legendModes } = await import("@/lib/map/legMode");
    const lines = [
      { kind: "recorded", mode: "train" as const, fromDay: 1, toDay: 2 },
      { kind: "recorded", mode: "walk" as const, fromDay: 2, toDay: 3 },
      { kind: "photo-join", mode: "boat" as const, fromDay: 3, toDay: 4 },
      { kind: "flight", mode: "flight" as const, fromDay: 4, toDay: 5 },
      { kind: "gap", mode: "car" as const, fromDay: 5, toDay: 6 },
    ];
    const none = legendModes(lines, null);
    expect(none.map((m) => m.mode)).toEqual(["train", "walk", "boat", "flight"]);
    expect(none.every((m) => !m.selected)).toBe(true);
    const three = legendModes(lines, 3);
    expect(three.map((m) => m.mode)).toEqual(["train", "walk", "boat", "flight"]);
    expect(three.filter((m) => m.selected).map((m) => m.mode)).toEqual(["walk", "boat"]);
  });
});
