import fs from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Navigation, Plane } from "lucide-react";
import { SlideMap, safeBox, visibleWindow, cameraFor, projectCamera } from "@/components/SlideShow";
import { frameRoute } from "@/lib/mapFrame";
import { project } from "@/lib/mapProjection";
import type { PlaceView as SlideMapPlace } from "@/components/WorldMap";
import type { PlaceEntry, TransportMode } from "@/lib/types";

/**
 * B268. `SlideMap` projects `places` through `project()` directly rather than
 * through `lib/mapFrame.ts`, which is where the `isPlottable` guard B265 added
 * lives — a day without coordinates reached this map the same way it reached
 * the other three before that fix, `NaN` into every attribute it touches.
 */

function place(location: string, lat: number, lng: number, mode?: TransportMode): SlideMapPlace {
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
    entries: [
      {
        slug: location.toLowerCase(),
        date: "2024-09-12",
        transport: mode ? { mode } : undefined,
      } as unknown as PlaceEntry,
    ],
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
    // Each located stop is one `StopMarker` — one <circle> — since B2424
    // dropped the yellow pulsing ring the active stop used to draw on top
    // of its own marker (Paper's "selection is never yellow" rule; the
    // active stop is now the marker's own larger navy "selected" state
    // instead of a second shape).
    expect(circles).toBe(alps.length);
  });

  test("a list with nothing located still renders — the world's centre, not NaN", () => {
    const html = render([unlocated], 0);
    expect(html).not.toContain("NaN");
  });
});

/**
 * B2424. Every size on `SlideMap` is now drawn through a `px()` that divides
 * by the current per-leg zoom (`frameRoute`'s own sizing, undone back into
 * this map's raw, uniform-scale world) rather than a fixed `ZOOM = 3.4` —
 * see the class doc comment. A marker or route stroke written in a raw map
 * unit came out huge at the tight zoom a short leg like `alps-2024`'s passes
 * now reaches; these tests catch that regression by reading the actual
 * attribute values back out of the render rather than trusting the source.
 */
describe("per-leg framing (B2424)", () => {
  /** The selected stop's own `<circle r="…">` — `StopMarker`'s "selected"
   * shape, present exactly once per render since only one stop is ever
   * active. */
  function selectedRadius(html: string): number {
    const m = html.match(/r="([\d.]+)" fill="var\(--map-selected-fill\)"/);
    if (!m) throw new Error("no selected StopMarker found");
    return Number(m[1]);
  }

  test("frames a short leg tighter than a long one", () => {
    // ~1.3 km apart — inside `alps-2024`'s own scale.
    const shortLeg = [place("Grimsel", 46.5614, 8.3372), place("Nearby", 46.57, 8.34)];
    // Zurich to Bangkok — a leg frameRoute pads generously either way.
    const longLeg = [place("Zurich", 47.3769, 8.5417), place("Bangkok", 13.7563, 100.5018)];
    const shortHtml = render(shortLeg, 1, true);
    const longHtml = render(longLeg, 1, true);
    // px(n) = n / zoom: a tighter frame is a *larger* zoom, so the same
    // marker radius comes out as a *smaller* raw-unit number — it is drawn
    // the same size on screen once the camera's own scale multiplies it
    // back up. A fixed ZOOM would give these the identical value.
    expect(selectedRadius(shortHtml)).toBeLessThan(selectedRadius(longHtml));
  });

  test("a single dwelled-on stop still gets a town-scale frame, not the fixed old zoom", () => {
    // Standing still (not travelling) frames just the one active place —
    // `MIN_SPAN_KM`'s floor in `frameRoute`, not `frameRoute([from, to])`.
    const html = render(alps, 1, false);
    expect(html).not.toContain("NaN");
    expect(selectedRadius(html)).toBeGreaterThan(0);
  });

  /**
   * Review of the first cut: fitting a leg into the *whole* viewBox left a
   * stop under the title block or the transport controls, because the
   * show's own chrome permanently covers a fixed fraction of every side but
   * the right one. `cameraFor` fits the frame into `safeBox()` instead —
   * checked here on the maths directly (`cameraFor`/`projectCamera`), which
   * is what the render actually uses, rather than parsing rendered
   * coordinates back out of an SVG whose camera transform doesn't even
   * appear in server-rendered markup (`motion.g`'s `animate` never does).
   *
   * Checked at both a desktop and a phone container size — a second review
   * round found a first cut of `safeBox` measured against the nominal
   * 1000×500 viewBox rather than what `preserveAspectRatio="xMidYMid
   * slice"` actually shows for a narrow container, which crops the width
   * axis down hard on a portrait phone and put a stop's own label off the
   * edge of what was actually visible even though the maths said it was
   * inside the (wrong) box.
   */
  test.each([
    ["a 16:9 desktop frame", 1280, 720],
    ["a portrait phone", 390, 844],
  ])("both ends of a leg land inside the safe box on %s", (_label, width, height) => {
    const legs = [
      // A short leg, at alps-2024's own scale.
      [{ lat: 46.5614, lng: 8.3372 }, { lat: 46.7297, lng: 8.4444 }],
      // A long, transcontinental leg.
      [{ lat: 47.3769, lng: 8.5417 }, { lat: 13.7563, lng: 100.5018 }],
      // Standing still — a single-point "leg".
      [{ lat: 46.5614, lng: 8.3372 }],
    ];
    for (const points of legs) {
      const frame = frameRoute(points);
      const camera = cameraFor(frame, width, height);
      const safe = safeBox(visibleWindow(width, height));
      for (const p of points) {
        const [px, py] = project(p.lat, p.lng);
        const [x, y] = projectCamera(camera, px, py);
        expect(x).toBeGreaterThanOrEqual(safe.left);
        expect(x).toBeLessThanOrEqual(safe.right);
        expect(y).toBeGreaterThanOrEqual(safe.top);
        expect(y).toBeLessThanOrEqual(safe.bottom);
      }
    }
  });
});

describe("the vehicle marker (B2424)", () => {
  /** The first `<path>`/`<polygon>` inside a rendered lucide icon — enough
   * to tell two glyphs apart regardless of the size or colour props drawn
   * around it. */
  function glyph(icon: ReactElement): string {
    const html = renderToStaticMarkup(icon);
    const m = html.match(/<(?:path|polygon)[^>]*(?:d|points)="([^"]+)"/);
    if (!m) throw new Error("icon rendered no path/polygon");
    return m[1];
  }
  const planeGlyph = glyph(<Plane />);
  const navigationGlyph = glyph(<Navigation />);

  test("draws the transport icon when a leg has a recorded mode", () => {
    const withFlight = [place("A", 46.1, 8.2, "flight"), place("B", 46.11, 8.21, "flight")];
    const html = render(withFlight, 1, true);
    expect(html).toContain(planeGlyph);
    expect(html).not.toContain(navigationGlyph);
  });

  test("falls back to a direction arrow, not a plane, when no mode is recorded", () => {
    const noMode = [place("A", 46.1, 8.2), place("B", 46.11, 8.21)];
    const html = render(noMode, 1, true);
    expect(html).toContain(navigationGlyph);
    expect(html).not.toContain(planeGlyph);
  });
});

test("the active stop's own marker is never yellow (docs/plans/map-redesign.md §1, Paper)", () => {
  // Travelling *and* stopped: the vehicle glyph legitimately borrows the
  // `--map-here-now` yellow (it is a moving position indicator, not a
  // selection) — this checks the `StopMarker`s themselves, not the whole
  // render, so that legitimate use doesn't make the assertion meaningless.
  for (const travelling of [true, false]) {
    const html = render(alps, 1, travelling);
    const markers = [...html.matchAll(/<circle[^>]*fill="([^"]+)"[^>]*stroke="var\(--map-stop-ring\)"/g)];
    expect(markers.length).toBeGreaterThan(0);
    for (const [, fill] of markers) expect(fill).not.toBe("var(--map-here-now)");
  }
});

describe("no hex literal in SlideMap (docs/plans/map-redesign.md §3, Phase 1 item 1)", () => {
  test("components/SlideShow.tsx holds no hex colour literal", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "components", "SlideShow.tsx"), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
