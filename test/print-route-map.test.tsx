import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PrintRouteMap, { printLegend, type PrintStop } from "@/components/map/PrintRouteMap";

/**
 * B2431 (Phase 4, docs/plans/map-redesign.md §3): the print route map the
 * private photobook and postcards adopt behind `@paid/*`. No browser here —
 * `renderToStaticMarkup`, the same seam `test/print-route-map.test.tsx`'s own
 * sibling map tests already prove their primitives with.
 */

const STOPS: PrintStop[] = [
  { key: "a", day: 1, date: "2024-06-01", location: "Locarno", country: "Switzerland", lat: 46.1707, lng: 8.7943 },
  {
    key: "b",
    day: 5,
    date: "2024-06-05",
    location: "Bangkok",
    country: "Thailand",
    lat: 13.7563,
    lng: 100.5018,
    transport: { mode: "flight", from: "Locarno", to: "Bangkok" },
  },
  { key: "c", day: 10, date: "2024-06-10", location: "Chiang Mai", country: "Thailand", lat: 18.7883, lng: 98.9853 },
];

function render(stops: PrintStop[] = STOPS) {
  return renderToStaticMarkup(<PrintRouteMap stops={stops} width={600} height={400} />);
}

describe("PrintRouteMap", () => {
  test("renders without a browser and draws every stop", () => {
    const html = render();
    expect(html).toContain("<svg");
    expect(html).toContain("Locarno");
    expect(html).toContain("Bangkok");
    expect(html).toContain("Chiang Mai");
  });

  test("stops are numbered in day order", () => {
    const html = render();
    expect(html.indexOf(">1<")).toBeGreaterThan(-1);
    expect(html.indexOf(">1<")).toBeLessThan(html.indexOf(">2<"));
    expect(html.indexOf(">2<")).toBeLessThan(html.indexOf(">3<"));
  });

  test("printLegend exposes the same order as plain data", () => {
    expect(printLegend(STOPS)).toEqual([
      { order: 1, location: "Locarno", country: "Switzerland" },
      { order: 2, location: "Bangkok", country: "Thailand" },
      { order: 3, location: "Chiang Mai", country: "Thailand" },
    ]);
  });

  test("the flight leg is an arc (a Q command), the other leg is straight", () => {
    const html = render();
    expect(html).toMatch(/<path d="M[\d.-]+,[\d.-]+ Q/);
    expect(html).toMatch(/<path d="M[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+"/);
  });

  test("draws a scale bar", () => {
    const html = render();
    expect(html).toMatch(/≈ \d+(\.\d+)? ?(m|km)/);
  });

  test("draws a north arrow with the locale's own abbreviation", () => {
    expect(render()).toContain(">N<");
    const hu = renderToStaticMarkup(<PrintRouteMap stops={STOPS} width={600} height={400} locale="hu" />);
    expect(hu).toContain(">É<");
  });

  test("renders a numbered legend list, without a doubled browser counter", () => {
    const html = render();
    expect(html).toMatch(/<li>1\. Locarno, Switzerland<\/li>/);
    // `<ol>` would add its own "1." beside this component's own — B2431's
    // check-a-drawing render caught exactly that doubling.
    expect(html).not.toContain("<ol");
  });

  test("no interactive control markup — a print frame is never panned", () => {
    const html = render();
    expect(html).not.toContain("role=\"button\"");
    expect(html).not.toContain("onclick");
  });

  test("has an explicit pixel width and height, not a percentage", () => {
    const html = render();
    expect(html).toContain('width="600"');
    expect(html).toContain('height="400"');
  });
});

describe("PrintRouteMap colour source", () => {
  const COMPONENT = fs.readFileSync(
    path.join(process.cwd(), "components", "map", "PrintRouteMap.tsx"),
    "utf8",
  );
  const PALETTE = fs.readFileSync(path.join(process.cwd(), "lib", "map", "printPalette.ts"), "utf8");

  test("PrintRouteMap.tsx holds no hex literal itself", () => {
    expect(COMPONENT).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  test("lib/map/printPalette.ts is the one file with hex, and it documents that", () => {
    expect(PALETTE).toMatch(/#[0-9a-fA-F]{6}/);
    expect(PALETTE).toMatch(/hardcodes a hex|hex literal/i);
  });
});
