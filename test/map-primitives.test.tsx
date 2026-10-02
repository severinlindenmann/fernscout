// @scans components/map/**
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import StopMarker from "@/components/map/StopMarker";
import ClusterMarker from "@/components/map/ClusterMarker";
import PhotoMarker from "@/components/map/PhotoMarker";
import HereNow from "@/components/map/HereNow";
import RouteLine, { isArcLeg } from "@/components/map/RouteLine";
import PlannedLine from "@/components/map/PlannedLine";
import LegChip from "@/components/map/LegChip";
import type { TransportMode } from "@/lib/types";

/**
 * B2418 (Phase 0, docs/plans/map-redesign.md): the shared marker and line
 * primitives every map restyles onto in Phase 1. Nothing here is wired into
 * a real map yet — these tests are the whole spec until then.
 */

const px = (n: number) => n; // identity scale is enough to check structure

function svg(node: React.ReactElement): string {
  return renderToStaticMarkup(<svg>{node}</svg>);
}

describe("StopMarker", () => {
  test("draws the day-order number and an accessible name", () => {
    const html = svg(<StopMarker x={10} y={10} order={3} ariaLabel="Furka, Switzerland" px={px} />);
    expect(html).toContain(">3<");
    expect(html).toContain('aria-label="Furka, Switzerland"');
  });

  test("unselected is the white-fill/navy-ring pair, never the here-now yellow", () => {
    const html = svg(<StopMarker x={0} y={0} order={1} ariaLabel="a" px={px} />);
    expect(html).toContain("var(--map-stop-fill)");
    expect(html).toContain("var(--map-stop-ring)");
    expect(html).not.toContain("var(--map-here-now)");
  });

  test("selected is a larger navy disc with a white number, never yellow", () => {
    const html = svg(<StopMarker x={0} y={0} order={1} selected ariaLabel="a" px={px} />);
    expect(html).toContain("var(--map-selected-fill)");
    expect(html).toContain("var(--map-selected-number)");
    expect(html).not.toContain("var(--map-here-now)");
    expect(html).not.toContain("var(--map-stop-fill)");
  });

  test("is focusable only when the caller wires up selection", () => {
    const passive = svg(<StopMarker x={0} y={0} order={1} ariaLabel="a" px={px} />);
    expect(passive).not.toContain('role="button"');
    const active = svg(<StopMarker x={0} y={0} order={1} ariaLabel="a" px={px} onSelect={() => {}} />);
    expect(active).toContain('role="button"');
    expect(active).toContain('tabindex="0"');
  });
});

describe("ClusterMarker", () => {
  test("draws the navy disc and the count, with the caller's aria label", () => {
    const html = svg(<ClusterMarker x={0} y={0} count={4} ariaLabel="4 places" px={px} />);
    expect(html).toContain(">4<");
    expect(html).toContain("var(--map-cluster-fill)");
    expect(html).toContain('aria-label="4 places"');
  });
});

describe("PhotoMarker", () => {
  test("takes a resolved src and never fetches one itself", () => {
    const html = svg(
      <PhotoMarker x={0} y={0} src="/media/thumb/1.jpg" order={2} ariaLabel="Furka" px={px} />,
    );
    expect(html).toContain('href="/media/thumb/1.jpg"');
    expect(html).toContain(">2<");
  });
});

describe("HereNow", () => {
  test("is the yellow dot and halo tokens", () => {
    const html = svg(<HereNow x={0} y={0} px={px} />);
    expect(html).toContain("var(--map-here-now)");
    expect(html).toContain("var(--map-here-now-halo)");
  });

  test("is decorative unless the caller names it", () => {
    const decorative = svg(<HereNow x={0} y={0} px={px} />);
    expect(decorative).toContain('aria-hidden="true"');
    const named = svg(<HereNow x={0} y={0} px={px} label="Live now" />);
    expect(named).toContain('aria-label="Live now"');
    expect(named).not.toContain('aria-hidden="true"');
  });
});

describe("RouteLine / isArcLeg (Q1)", () => {
  test.each<[TransportMode, boolean]>([
    ["flight", true],
    ["train", false],
    ["car", false],
    ["walk", false],
    ["boat", false],
    ["bus", false],
    ["ferry", false],
    ["metro", false],
    ["tram", false],
    ["taxi", false],
    ["motorbike", false],
    ["bicycle", false],
  ])("%s arcs only when it is a flight (%s)", (mode, arcs) => {
    expect(isArcLeg(mode)).toBe(arcs);
  });

  test("undefined mode is straight", () => {
    expect(isArcLeg(undefined)).toBe(false);
  });

  test("draws a straight hop for a drive, an arc for a flight, in the trip's accent with a white casing", () => {
    const straight = svg(
      <RouteLine hops={[{ x1: 0, y1: 0, x2: 10, y2: 0, mode: "car" }]} accent="coral" px={px} />,
    );
    expect(straight).toMatch(/d="M0,0 L10,0"/);
    expect(straight).toContain("var(--map-accent-coral)");
    expect(straight).toContain("var(--map-route-casing)");

    const arced = svg(<RouteLine hops={[{ x1: 0, y1: 0, x2: 10, y2: 0, mode: "flight" }]} accent="coral" px={px} />);
    expect(arced).toMatch(/d="M0,0 Q[\d.-]+,[\d.-]+ 10,0"/);
  });

  test("is decorative, not a control", () => {
    const html = svg(<RouteLine hops={[{ x1: 0, y1: 0, x2: 1, y2: 1 }]} accent="navy" px={px} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="button"');
  });
});

describe("PlannedLine", () => {
  test("is navy, dashed, at 60% opacity", () => {
    const html = svg(
      <PlannedLine points={[{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 9, y: 1 }]} px={px} />,
    );
    expect(html).toContain("var(--map-planned-leg)");
    expect(html).toContain('stroke-opacity="0.6"');
    expect(html).toContain("stroke-dasharray");
  });

  test("draws nothing for fewer than two points", () => {
    expect(svg(<PlannedLine points={[{ x: 0, y: 0 }]} px={px} />)).not.toContain("polyline");
  });
});

describe("LegChip", () => {
  test("shows a duration only when one is passed, never computes one", () => {
    const bare = svg(<LegChip x={0} y={0} mode="train" px={px} />);
    expect(bare).not.toContain("<text");

    const withDuration = svg(<LegChip x={0} y={0} mode="train" durationLabel="2h 30m" px={px} />);
    expect(withDuration).toContain(">2h 30m<");
  });

  test("is decorative unless the caller names the leg", () => {
    const bare = svg(<LegChip x={0} y={0} mode="flight" px={px} />);
    expect(bare).toContain('aria-hidden="true"');
    const named = svg(<LegChip x={0} y={0} mode="flight" ariaLabel="Flight to Bangkok" px={px} />);
    expect(named).toContain('aria-label="Flight to Bangkok"');
  });
});

describe("no hex literal in components/map/*.tsx", () => {
  const dir = path.join(process.cwd(), "components", "map");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".tsx"));

  test.each(files)("%s holds no hex colour literal", (file) => {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
