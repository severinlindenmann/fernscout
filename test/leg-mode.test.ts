import { describe, expect, it } from "vitest";
import { chipRedundant, legModeFromEntry, legModeFromRecorded, legPattern, longestSegmentMid, placeChips, withDeclaredLegs } from "@/lib/map/legMode";
import type { MapLine, MapPlace } from "@/lib/map/tripFrame";

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
