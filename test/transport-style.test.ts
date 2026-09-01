import { describe, expect, test } from "vitest";
import { TRANSPORT_STYLE, dashFor } from "@/lib/transport";
import type { TransportMode } from "@/lib/types";

/**
 * How a leg says which way it was travelled.
 *
 * B78. Four of the seven modes had no dash at all, so train, bus, motorbike
 * and car differed only in hue — the one distinction some readers cannot make.
 * And the dashes that did exist were lengths in *viewBox units*, which B46
 * broke by making the frame the size of the trip: over the Alps a frame is 4.6
 * units wide, so a 10-unit dash was twice the width of the map.
 */

const modes = Object.keys(TRANSPORT_STYLE) as TransportMode[];

/** What a reader can tell apart about a line without naming its colour. */
function shape(mode: TransportMode): string {
  const style = TRANSPORT_STYLE[mode];
  return `${style.dash ? style.dash.join(",") : "solid"}|${style.bow}`;
}

describe("every mode is more than a colour", () => {
  test("no two modes share both dash and curvature", () => {
    const seen = new Map<string, TransportMode>();
    for (const mode of modes) {
      const key = shape(mode);
      const clash = seen.get(key);
      expect(
        clash,
        `${mode} and ${clash} are drawn identically — colour would be the only difference`,
      ).toBeUndefined();
      seen.set(key, mode);
    }
  });

  test("every mode has a colour and a curvature", () => {
    for (const mode of modes) {
      expect(TRANSPORT_STYLE[mode].color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof TRANSPORT_STYLE[mode].bow).toBe("number");
      expect(TRANSPORT_STYLE[mode].bow).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("the shapes mean what they say", () => {
  test("a flight arcs hardest; a walk does not arc at all", () => {
    for (const mode of modes) {
      if (mode === "flight") continue;
      expect(TRANSPORT_STYLE.flight.bow).toBeGreaterThan(TRANSPORT_STYLE[mode].bow);
    }
    expect(TRANSPORT_STYLE.walk.bow).toBe(0);
  });

  test("a railway is fixed, so it is the solid one", () => {
    expect(TRANSPORT_STYLE.train.dash).toBeUndefined();
  });

  test("road modes are near enough straight", () => {
    for (const mode of ["bus", "car", "motorbike", "walk"] as const) {
      expect(TRANSPORT_STYLE[mode].bow).toBeLessThan(0.05);
    }
  });

  test("dashes shorten as the vehicle gets smaller", () => {
    expect(TRANSPORT_STYLE.bus.dash![0]).toBeGreaterThan(TRANSPORT_STYLE.car.dash![0]);
    expect(TRANSPORT_STYLE.car.dash![0]).toBeGreaterThan(TRANSPORT_STYLE.motorbike.dash![0]);
  });
});

describe("dashes survive a map the size of a valley", () => {
  /**
   * The failure this replaces: on a 4.6-unit frame drawn 900 pixels wide, one
   * pixel is 0.005 units, so a dash written as "10 7" viewBox units was twice
   * the width of the map and the leg rendered as one solid stroke.
   */
  const px = (pixels: number) => (pixels * 4.636) / 900;

  test("a dashed leg on a tiny frame has many dashes in it, not one", () => {
    for (const mode of modes) {
      const pattern = dashFor(TRANSPORT_STYLE[mode], px);
      if (!pattern) continue;
      const [dash, gap] = pattern.split(" ").map(Number);
      // The leg is at most the width of the frame; a pattern longer than a
      // fraction of that is the bug.
      expect(dash + gap).toBeLessThan(4.636 / 8);
      expect(dash).toBeGreaterThan(0);
    }
  });

  test("solid stays solid", () => {
    expect(dashFor(TRANSPORT_STYLE.train, px)).toBeUndefined();
  });
});
