import { describe, expect, test } from "vitest";
import { buildLifetimeViews, type VisitedCountry } from "@/lib/lifetimeMapViews";

/**
 * B2491, decisions 2–4. Server-side view computation for the lifetime map's
 * continent switch — kept out of the component itself so a frame and its
 * basemap can be computed once per request rather than once per client.
 */

const ZURICH = { lat: 47.3769, lng: 8.5417 };
const BANGKOK = { lat: 13.7563, lng: 100.5018 };
const LISBON = { lat: 38.7223, lng: -9.1393 };

describe("buildLifetimeViews", () => {
  test("a one-continent journal gets 'Alle' and nothing else — no continent buttons", () => {
    const visited: VisitedCountry[] = [
      { code: "CH", continent: "Europe", subregion: "Western Europe" },
    ];
    const points = new Map([["CH", [ZURICH]]]);
    const { views, continents } = buildLifetimeViews(visited, points, new Map());
    expect(views.map((v) => v.id)).toEqual(["all"]);
    expect(continents.length).toBeLessThan(2);
  });

  test("a single visited country gives a single-country frame", () => {
    const visited: VisitedCountry[] = [
      { code: "CH", continent: "Europe", subregion: "Western Europe" },
    ];
    const points = new Map([["CH", [ZURICH]]]);
    const { views } = buildLifetimeViews(visited, points, new Map());
    const all = views.find((v) => v.id === "all")!;
    // ~10% padding and a 6° floor on one point — nowhere near a continent.
    expect(all.frame.w).toBeLessThan(100); // a whole-world frame is 1000 wide
  });

  test("two continents each with ≥1 visited country get continent buttons, sorted by count", () => {
    const visited: VisitedCountry[] = [
      { code: "CH", continent: "Europe", subregion: "Western Europe" },
      { code: "PT", continent: "Europe", subregion: "Southern Europe" },
      { code: "TH", continent: "Asia", subregion: "South-Eastern Asia" },
    ];
    const points = new Map([
      ["CH", [ZURICH]],
      ["PT", [LISBON]],
      ["TH", [BANGKOK]],
    ]);
    const { views, continents } = buildLifetimeViews(visited, points, new Map());
    expect(continents.map((c) => c.continent)).toEqual(["Europe", "Asia"]);
    expect(views.some((v) => v.kind === "continent" && v.continent === "Europe")).toBe(true);
    expect(views.some((v) => v.kind === "continent" && v.continent === "Asia")).toBe(true);
  });

  test("a continent with visited countries in only one area gets no area buttons", () => {
    const visited: VisitedCountry[] = [
      { code: "CH", continent: "Europe", subregion: "Western Europe" },
      { code: "TH", continent: "Asia", subregion: "South-Eastern Asia" },
    ];
    const points = new Map([
      ["CH", [ZURICH]],
      ["TH", [BANGKOK]],
    ]);
    const { continents } = buildLifetimeViews(visited, points, new Map());
    const europe = continents.find((c) => c.continent === "Europe")!;
    expect(europe.areas).toEqual([]);
  });

  test("a continent spanning ≥2 areas gets area buttons", () => {
    const visited: VisitedCountry[] = [
      { code: "CH", continent: "Europe", subregion: "Western Europe" },
      { code: "PT", continent: "Europe", subregion: "Southern Europe" },
      { code: "TH", continent: "Asia", subregion: "South-Eastern Asia" },
    ];
    const points = new Map([
      ["CH", [ZURICH]],
      ["PT", [LISBON]],
      ["TH", [BANGKOK]],
    ]);
    const { views, continents } = buildLifetimeViews(visited, points, new Map());
    const europe = continents.find((c) => c.continent === "Europe")!;
    expect(europe.areas.map((a) => a.subregion).sort()).toEqual(["Southern Europe", "Western Europe"]);
    expect(views.some((v) => v.kind === "area" && v.subregion === "Southern Europe")).toBe(true);
  });

  test("a teaser-only country (no real stops) falls back to its corner points", () => {
    const visited: VisitedCountry[] = [
      { code: "CH", continent: "Europe", subregion: "Western Europe" },
    ];
    const corners = new Map([
      [
        "CH",
        [
          { lat: 45.8, lng: 6.0 },
          { lat: 47.8, lng: 6.0 },
          { lat: 45.8, lng: 10.5 },
          { lat: 47.8, lng: 10.5 },
        ],
      ],
    ]);
    const { views } = buildLifetimeViews(visited, new Map(), corners);
    const all = views.find((v) => v.id === "all")!;
    // The country's corners, not nothing — a frame still gets built.
    expect(all.frame.w).toBeGreaterThan(0);
  });
});
