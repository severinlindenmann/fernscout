import { describe, expect, test } from "vitest";
import { dayAnchors } from "@/lib/map/routeAnchors";
import type { Day, Entry } from "@/lib/types";

const e = (lat?: number, lng?: number) => ({ slug: "s", lat, lng }) as unknown as Entry;
const day = (date: string, entry: Entry) => ({ date, entries: [entry], lead: entry }) as Day;

describe("dayAnchors (B-2980)", () => {
  const line: [number, number][] = [
    [46.0, 7.0],
    [46.1, 7.1],
    [46.2, 7.2],
    [46.9, 7.9],
  ];
  test("a day with no position gets the recorded point nearest the centroid of its points", () => {
    const m = dayAnchors([day("2026-10-03", e())], [{ date: "2026-10-03", points: line }]);
    expect(m.get("2026-10-03")).toMatchObject({ lat: 46.2, lng: 7.2 });
  });
  test("a day that has a position, or no recording, gets nothing", () => {
    const m = dayAnchors(
      [day("2026-10-01", e(46.5, 7.5)), day("2026-10-02", e())],
      [{ date: "2026-10-01", points: line }],
    );
    expect(m.size).toBe(0);
  });
});
