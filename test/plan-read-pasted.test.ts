import { describe, expect, test } from "vitest";
import { parsePastedText, readMapsUrl } from "@/lib/plan/readPasted";

/**
 * The pure classification table — B2010.
 *
 * No filesystem, no network: `parsePastedText` only decides *what kind of
 * thing* was pasted. Resolving a Maps link or reverse-geocoding a coordinate
 * happens in the route, which is what keeps this table fast and exhaustive.
 */
describe("parsePastedText", () => {
  test.each([
    ["https://maps.app.goo.gl/xyz123", { kind: "url", url: "https://maps.app.goo.gl/xyz123" }],
    [
      "check this out: https://maps.app.goo.gl/xyz123 thanks",
      { kind: "url", url: "https://maps.app.goo.gl/xyz123" },
    ],
    ["https://example.com/some-blog-post", { kind: "url", url: "https://example.com/some-blog-post" }],
    // The exact URL the acceptance line names — a host outside the Maps
    // allow-list, with a Maps-shaped `@lat,lng` in its own path. This must
    // stay a plain URL, never coordinates, however maps-like the path looks.
    ["http://evil.example/@1,2", { kind: "url", url: "http://evil.example/@1,2" }],
    ["46.9480, 7.4474", { kind: "coordinates", lat: 46.948, lng: 7.4474 }],
    ["46.9480 7.4474", { kind: "coordinates", lat: 46.948, lng: 7.4474 }],
    ["-33.8688, 151.2093", { kind: "coordinates", lat: -33.8688, lng: 151.2093 }],
    [
      "1640 flights zürich bangkok",
      { kind: "cost", amount: 1640, label: "flights zürich bangkok", category: "flights" },
    ],
    [
      "89.50 CHF hostel zürich",
      { kind: "cost", amount: 89.5, currency: "CHF", label: "CHF hostel zürich", category: "accommodation" },
    ],
    ["12 taxi to the airport", { kind: "cost", amount: 12, label: "taxi to the airport", category: "transport" }],
    ["Hotel Schweizerhof", { kind: "place-query", q: "Hotel Schweizerhof" }],
  ] satisfies [string, Record<string, unknown>][])("%s", (input, expected) => {
    expect(parsePastedText(input)).toEqual(expected);
  });

  describe("malformed input", () => {
    test("out-of-range coordinates fall back to place-query", () => {
      // 200/200 is outside both ranges — not a URL, not a leading-number cost
      // (no label follows), so the honest answer is "ask the type-ahead".
      expect(parsePastedText("200, 200")).toEqual({ kind: "place-query", q: "200, 200" });
    });

    test("a bare number with no label is not a cost", () => {
      expect(parsePastedText("1640")).toEqual({ kind: "place-query", q: "1640" });
    });

    test("empty text is a place-query with an empty q", () => {
      expect(parsePastedText("   ")).toEqual({ kind: "place-query", q: "" });
    });
  });
});

/**
 * B2086 — the hint promises a Maps link works; these are the real shapes a
 * person copies from Google and Apple Maps, read to a place without a fetch.
 */
describe("Maps URLs become a place with coordinates", () => {
  test.each([
    [
      "https://www.google.com/maps/place/Dogo+Onsen/@33.8517,132.7864,17z",
      { kind: "place", lat: 33.8517, lng: 132.7864, name: "Dogo Onsen" },
    ],
    [
      // The form a maps.app.goo.gl short link resolves to: the pin (!3d/!4d)
      // wins over the map centre (@).
      "https://www.google.com/maps/place/Matsuyama+Castle/@33.84,132.76,15z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d33.8456!4d132.7656",
      { kind: "place", lat: 33.8456, lng: 132.7656, name: "Matsuyama Castle" },
    ],
    ["https://maps.google.com/maps?q=33.8517,132.7864", { kind: "place", lat: 33.8517, lng: 132.7864 }],
    ["https://maps.apple.com/?ll=33.85,132.78", { kind: "place", lat: 33.85, lng: 132.78 }],
    [
      "https://maps.apple.com/?ll=33.85,132.78&q=Dogo%20Onsen",
      { kind: "place", lat: 33.85, lng: 132.78, name: "Dogo Onsen" },
    ],
    ["https://maps.apple.com/?q=33.85,132.78", { kind: "place", lat: 33.85, lng: 132.78 }],
  ] satisfies [string, Record<string, unknown>][])("%s", (input, expected) => {
    expect(parsePastedText(input)).toEqual(expected);
  });

  test("a short link carries no coordinates and stays a link for the route to follow", () => {
    expect(readMapsUrl(new URL("https://maps.app.goo.gl/xyz123"))).toBeNull();
  });

  test("a Maps-shaped path on another host is never read", () => {
    expect(readMapsUrl(new URL("https://evil.example/maps/place/X/@1,2,3z"))).toBeNull();
  });
});
