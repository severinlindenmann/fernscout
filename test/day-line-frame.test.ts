import { describe, expect, it } from "vitest";
import { lineFrame } from "@/components/studio/location/DayLineMap";

const WORLD: [[number, number], [number, number]] = [
  [-180, -85.0511],
  [180, 85.0511],
];

describe("lineFrame (B2576)", () => {
  it("frames a small line, not the world file it is drawn on", () => {
    const [[w, s], [e, n]] = lineFrame(
      [
        [47.0, 8.0],
        [47.2, 8.4],
      ],
      WORLD,
    );
    [w, s, e, n].forEach((v, i) => expect(v).toBeCloseTo([8.0, 47.0, 8.4, 47.2][i]));
  });

  it("keeps a minimum span for a line that barely moved", () => {
    const [[w], [e]] = lineFrame([[47, 8]], WORLD);
    expect(e - w).toBeCloseTo(0.01);
  });

  it("falls back to the region bounds when there is no line", () => {
    expect(lineFrame([], WORLD)).toBe(WORLD);
  });
});
