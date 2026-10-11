import { describe, expect, test } from "vitest";
import { boundsFor, previewKind, stillBounds, type StillData } from "@/lib/map/tripStill";

const still: StillData = {
  places: [
    { day: 1, date: "2026-01-01", lat: 47, lng: 8, name: "A" },
    { day: 2, date: "2026-01-02", lat: 47.2, lng: 8.3, name: "B" },
  ],
  recorded: [],
  file: { url: "/api/maps/x.pmtiles", bounds: [[0, 0], [1, 1]] },
  aspect: 1.5,
};

describe("previewKind", () => {
  test("the SVG until WebGL is proven, and again when tiles fail", () => {
    expect(previewKind(still, null, false)).toBe("svg");
    expect(previewKind(still, false, false)).toBe("svg");
    expect(previewKind(still, true, true)).toBe("svg");
    expect(previewKind(null, true, false)).toBe("svg");
    expect(previewKind(still, true, false)).toBe("still");
  });
});

describe("stillBounds", () => {
  test("frames the places, padded and inside the poles", () => {
    const [[w, s], [e, n]] = stillBounds(still);
    expect(w).toBeLessThan(8);
    expect(e).toBeGreaterThan(8.3);
    expect(s).toBeLessThan(47);
    expect(n).toBeGreaterThan(47.2);
    const [, [, top]] = boundsFor([{ lat: 89, lng: 0 }]);
    expect(top).toBe(85);
  });
});
