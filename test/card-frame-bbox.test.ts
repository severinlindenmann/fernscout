import { expect, test } from "vitest";
import { frameRoute } from "@/lib/mapFrame";
import { frameBboxWithin } from "@/lib/map/cardSvg";

// B2565: a card asks for tiles over what it shows, not the region file's
// whole box — from the region's box the zoom was the region's and the tile
// cap ran out on its west edge; with one world file (B2566) every card would
// have been drawn at world scale.
const kyotoRegion = [135.3856, 34.8324, 136.0608, 35.1504] as const;

test("a day card's tile box is its own frame, inside the region", () => {
  const frame = frameRoute([{ lat: 34.967, lng: 135.7727 }]);
  const [west, south, east, north] = frameBboxWithin(frame, kyotoRegion)!;
  expect(west).toBeLessThan(135.7727);
  expect(east).toBeGreaterThan(135.7727);
  expect(south).toBeLessThan(34.967);
  expect(north).toBeGreaterThan(34.967);
  expect(east - west).toBeLessThan(0.3);
});

test("inside a whole-world file the box is still the card's own", () => {
  const frame = frameRoute([{ lat: 34.967, lng: 135.7727 }]);
  const [west, , east] = frameBboxWithin(frame, [-180, -85, 180, 85])!;
  expect(east - west).toBeLessThan(0.3);
});

test("a frame outside the region gets no tile box", () => {
  const frame = frameRoute([{ lat: -33.87, lng: 151.21 }]);
  expect(frameBboxWithin(frame, kyotoRegion)).toBeNull();
});
