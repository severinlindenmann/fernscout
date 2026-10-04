import { describe, expect, test, vi } from "vitest";
import { dayCardSvg, tripCardSvg } from "@/lib/map/cardSvg";
import type { MapPlace } from "@/lib/map/tripFrame";

/**
 * B-2913 — Safari sizes an `<img>` SVG from its viewBox when the root has no
 * width/height. A street-level day's viewBox is a fraction of a degree, so
 * WebKit rounded it to 0×0 and drew a broken image. The root must carry an
 * explicit size in the viewBox's own proportions.
 */

vi.mock("@/lib/map/cardCache", () => ({
  readCachedCardSvg: () => null,
  writeCachedCardSvg: () => {},
}));

function rootSize(svg: string) {
  const root = svg.slice(0, svg.indexOf(">"));
  const num = (name: string) => Number(root.match(new RegExp(` ${name}="([^"]+)"`))?.[1]);
  const [, , vw, vh] = (root.match(/viewBox="([^"]+)"/)?.[1] ?? "").split(" ").map(Number);
  return { width: num("width"), height: num("height"), vw, vh };
}

const places: MapPlace[] = [
  { day: 1, date: "2026-06-03", lat: 39.7392, lng: -104.9903, name: "Denver" },
  { day: 2, date: "2026-06-04", lat: 38.5733, lng: -109.5498, name: "Moab" },
];

describe("card.svg intrinsic size", () => {
  test.each([
    ["trip card", () => tripCardSvg("example", "b2913-size-test", places, [], "light")],
    ["one-place day card", () => dayCardSvg("example", "b2913-size-test", places, [], 1, "dark")],
  ])("%s root has width and height in the viewBox's ratio", async (_, render) => {
    const card = await render();
    expect(card).not.toBeNull();
    const { width, height, vw, vh } = rootSize(card!.svg);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(Math.abs(width / height - vw / vh)).toBeLessThan(0.02);
  });
});
