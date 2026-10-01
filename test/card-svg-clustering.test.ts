import { describe, expect, test, vi } from "vitest";
import { tripCardSvg } from "@/lib/map/cardSvg";
import type { MapPlace } from "@/lib/map/tripFrame";

/**
 * B2639 — the preview card's own clutter fixes: overlapping day discs merge
 * into one pill with a count (never a false day range), and a trip with
 * many stops shows at most a handful of place labels, always including the
 * first and last day.
 */

vi.mock("@/lib/map/cardCache", () => ({
  readCachedCardSvg: () => null,
  writeCachedCardSvg: () => {},
}));

describe("cardSvg clustering and label cap", () => {
  test("overlapping days merge into one pill with a count, never a day range", async () => {
    const places: MapPlace[] = [
      { day: 1, date: "2026-01-01", lat: 10, lng: 10, name: "Basel" },
      { day: 2, date: "2026-01-02", lat: 10, lng: 10, name: "Basel" },
      { day: 3, date: "2026-01-03", lat: 10, lng: 10, name: "Basel" },
      // Close enough to stay in the same region (so it is not framed out as
      // a chip) but far enough in projected pixels to stay its own marker.
      { day: 4, date: "2026-01-04", lat: 10.5, lng: 10.5, name: "Zurich" },
    ];
    const card = await tripCardSvg("example", "b2639-merge-test", places, [], "light");
    expect(card).not.toBeNull();
    const svg = card!.svg;
    // One merged pill for the three Basel days, one plain circle for the
    // lone Zurich day — never three overlapping circles.
    expect(svg.match(/<circle/g)?.length ?? 0).toBe(1);
    expect(svg).toContain(">3<");
    expect(svg).toContain("3 days");
    expect(svg).not.toMatch(/>1[-–]3</);
    expect(svg).not.toContain(">1–3 Tage<");
  });

  test("at most four place labels, always including the trip's first and last day", async () => {
    const places: MapPlace[] = Array.from({ length: 6 }, (_, i) => ({
      day: i + 1,
      date: `2026-02-${String(i + 1).padStart(2, "0")}`,
      // Spread along one line, close enough (≤ ~170 km end to end) to stay
      // one region, far enough apart in projected pixels not to collide.
      lat: i * 0.3,
      lng: i * 0.3,
      name: `Town${i + 1}`,
    }));
    const card = await tripCardSvg("example", "b2639-label-cap-test", places, [], "light");
    expect(card).not.toBeNull();
    const svg = card!.svg;
    const shownNames = places.filter((p) => svg.includes(`>${p.name}<`));
    expect(shownNames.length).toBeLessThanOrEqual(4);
    expect(svg).toContain(">Town1<");
    expect(svg).toContain(">Town6<");
  });

  test("the preview card draws no region chip", async () => {
    // A far-off place the region rule would otherwise chip ("Basel +1") —
    // B2639 drops chip rendering from this card entirely.
    const places: MapPlace[] = [
      { day: 1, date: "2026-03-01", lat: 10, lng: 10, name: "Basel" },
      { day: 2, date: "2026-03-02", lat: 10.1, lng: 10.1, name: "Basel" },
      { day: 3, date: "2026-03-03", lat: 47.5, lng: 7.6, name: "Elsewhere" },
    ];
    const card = await tripCardSvg("example", "b2639-no-chip-test", places, [], "light");
    expect(card).not.toBeNull();
    expect(card!.svg).not.toContain("+1");
  });
});
