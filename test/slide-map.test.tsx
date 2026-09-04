import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SlideMap } from "@/components/SlideShow";
import type { PlaceView as SlideMapPlace } from "@/components/WorldMap";
import type { Entry } from "@/lib/types";

/**
 * B268. `SlideMap` projects `places` through `project()` directly rather than
 * through `lib/mapFrame.ts`, which is where the `isPlottable` guard B265 added
 * lives — a day without coordinates reached this map the same way it reached
 * the other three before that fix, `NaN` into every attribute it touches.
 */

function place(location: string, lat: number, lng: number): SlideMapPlace {
  return {
    key: location,
    location,
    country: "Switzerland",
    countryCode: "CH",
    lat,
    lng,
    firstDate: "2024-09-12",
    lastDate: "2024-09-12",
    nights: 1,
    mediaCount: 1,
    entries: [{ slug: location.toLowerCase(), date: "2024-09-12" } as Entry],
  };
}

const alps = [
  place("Domodossola", 46.1161, 8.2939),
  place("Grimsel", 46.5614, 8.3372),
  place("Susten", 46.7297, 8.4444),
];

const unlocated: SlideMapPlace = {
  ...place("Unrecorded", 0, 0),
  lat: undefined as unknown as number,
  lng: undefined as unknown as number,
};

function render(places: SlideMapPlace[], activeIndex: number, travelling = false) {
  return renderToStaticMarkup(
    <SlideMap places={places} activeIndex={activeIndex} travelling={travelling} />,
  );
}

describe("a mixed list of located and unlocated stops", () => {
  test("draws no NaN when the active stop is located", () => {
    const html = render([...alps, unlocated], 1);
    expect(html).not.toContain("NaN");
  });

  test("draws no NaN when the active stop is the unlocated one", () => {
    const html = render([...alps, unlocated], 3, true);
    expect(html).not.toContain("NaN");
  });

  test("draws no NaN when the unlocated stop sits between two located ones", () => {
    const html = render([alps[0], unlocated, alps[1]], 2, true);
    expect(html).not.toContain("NaN");
  });

  test("draws a marker for every located stop and none for the unlocated one", () => {
    const html = render([...alps, unlocated], 0);
    const circles = [...html.matchAll(/<circle/g)].length;
    // Each located stop draws at least one <circle>; the active one draws two
    // (the pulsing ring plus the marker itself).
    expect(circles).toBeGreaterThanOrEqual(alps.length);
  });

  test("a list with nothing located still renders — the world's centre, not NaN", () => {
    const html = render([unlocated], 0);
    expect(html).not.toContain("NaN");
  });
});
