import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { addressLookupEndpoints, geocodePlace, lookupAddresses, reversePlace } from "@/lib/addressLookup";
import { clearConfigCache } from "@/lib/config";

/**
 * B399 — the provider is always stubbed here. Nothing in this file, or in
 * `test/address-lookup-route.test.ts`, is allowed to reach the live Photon
 * service: `global.fetch` is mocked in every test, and the whole point is to
 * pin this module's behaviour against a fixed response shape rather than
 * whatever `photon.komoot.io` answers on the day the suite runs.
 */

/** The exact shape the ticket's own live check recorded for
 * "Bahnhofstrasse 12, Zurich" — see the ticket's "What Photon actually
 * answers" section. */
function houseFeature(overrides: Record<string, unknown> = {}) {
  return {
    properties: {
      housenumber: "12",
      street: "Bahnhofstrasse",
      postcode: "8001",
      city: "Zürich",
      state: "Zürich",
      country: "Schweiz",
      countrycode: "CH",
      type: "house",
      ...overrides,
    },
    geometry: { type: "Point", coordinates: [8.54, 47.368] },
  };
}

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-addrlookup-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test" },
      users: { reserved: [] },
      features: { addressLookup: { enabled: true, provider: "photon" } },
    }),
  );
  clearConfigCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.ADDRESS_LOOKUP_API_KEY;
  clearConfigCache();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("lookupAddresses", () => {
  test("a DACH result puts the housenumber after the street", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ features: [houseFeature()] }))),
    );
    const results = await lookupAddresses("Bahnhofstrasse 12 Zurich", "de");
    expect(results).toEqual([{ line1: "Bahnhofstrasse 12", postcode: "8001", city: "Zürich", country: "CH" }]);
  });

  test("a French result puts the housenumber first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              features: [
                houseFeature({
                  housenumber: "112",
                  street: "rue de Maubeuge",
                  postcode: "75010",
                  city: "Paris",
                  countrycode: "FR",
                }),
              ],
            }),
          ),
      ),
    );
    const results = await lookupAddresses("112 rue de Maubeuge Paris", "fr");
    expect(results?.[0].line1).toBe("112 rue de Maubeuge");
  });

  test("a street or city hit is dropped — only type:house is precise enough to post to", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              features: [houseFeature({ type: "street" }), houseFeature({ type: "city" }), houseFeature()],
            }),
          ),
      ),
    );
    const results = await lookupAddresses("Bahnhofstrasse", "de");
    expect(results).toHaveLength(1);
  });

  test("an unsupported locale (hu) asks the provider for en, not hu", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ features: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await lookupAddresses("Bahnhofstrasse", "hu");
    const [target] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(target.searchParams.get("lang")).toBe("en");
  });

  test("a supported locale (fr) is passed straight through", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ features: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await lookupAddresses("rue de Rivoli", "fr");
    const [target] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(target.searchParams.get("lang")).toBe("fr");
  });

  test("a configured key is sent, a photon default is not", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ features: [] })));
    vi.stubGlobal("fetch", fetchMock);
    await lookupAddresses("Bahnhofstrasse", "en");
    let [target] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(target.searchParams.has("key")).toBe(false);

    process.env.ADDRESS_LOOKUP_API_KEY = "secret-key";
    await lookupAddresses("Bahnhofstrasse", "en");
    [target] = fetchMock.mock.calls[1] as unknown as [URL];
    expect(target.searchParams.get("key")).toBe("secret-key");
  });

  test("a provider that refuses answers null — a failure, not zero matches (B639)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    expect(await lookupAddresses("Bahnhofstrasse", "en")).toBeNull();
  });

  test("a provider that times out or throws never surfaces past this module, but still answers null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("boom");
      }),
    );
    await expect(lookupAddresses("Bahnhofstrasse", "en")).resolves.toBeNull();
  });

  test("a provider that answers but has nothing to say is a genuine []", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [] }))));
    expect(await lookupAddresses("Bahnhofstrasse", "en")).toEqual([]);
  });

  test("a building and a shop at the same address (B415) collapse into one result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              // Photon's own shape for this: one feature per OSM object at
              // the address, distinguished only by fields the mapped
              // suggestion drops (`osm_key`/`name`) — see the ticket's own
              // live example.
              features: [
                houseFeature({ osm_key: "building" }),
                houseFeature({ osm_key: "shop", name: "Versace" }),
              ],
            }),
          ),
      ),
    );
    const results = await lookupAddresses("Bahnhofstrasse 12 Zurich", "de");
    expect(results).toEqual([{ line1: "Bahnhofstrasse 12", postcode: "8001", city: "Zürich", country: "CH" }]);
  });
});

/**
 * B710 — `reverseUrl` used to be guessed from `url` unconditionally
 * (`/api/` → `/reverse`), true of Photon and nothing else guaranteed. An
 * instance can now say the real one.
 */
describe("reverseUrl", () => {
  test("defaults to the forward URL's own guess, unchanged", () => {
    expect(addressLookupEndpoints()).toEqual({
      url: "https://photon.komoot.io/api/",
      reverseUrl: "https://photon.komoot.io/reverse",
    });
  });

  describe("geocodePlace", () => {
    test("returns ranked place candidates with the fields a day-entry flow needs", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                features: [
                  {
                    properties: {
                      name: "Hausen",
                      state: "Aargau",
                      country: "Switzerland",
                      countrycode: "ch",
                      type: "village",
                    },
                    geometry: { type: "Point", coordinates: [8.216, 47.463] },
                  },
                ],
              }),
            ),
        ),
      );

      const results = await geocodePlace("Hausen", "de");
      expect(results).toEqual([
        {
          displayName: "Hausen, Aargau, Switzerland",
          country: "Switzerland",
          countryCode: "CH",
          adminRegion: "Aargau",
          lat: 47.463,
          lon: 8.216,
          type: "village",
        },
      ]);
    });

    test("biases the ranking towards nearby context coordinates and includes hints in the query", async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              features: [
                {
                  properties: {
                    name: "Hausen",
                    state: "Bavaria",
                    country: "Germany",
                    countrycode: "de",
                    type: "village",
                  },
                  geometry: { type: "Point", coordinates: [11.0, 48.0] },
                },
                {
                  properties: {
                    name: "Hausen",
                    state: "Aargau",
                    country: "Switzerland",
                    countrycode: "ch",
                    type: "village",
                  },
                  geometry: { type: "Point", coordinates: [8.216, 47.463] },
                },
              ],
            }),
          ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const results = await geocodePlace("Hausen", "de", {
        countryHint: "Switzerland",
        regionHint: "Aargau",
        contextCoordinates: [{ lat: 47.4, lng: 8.2 }],
      });

      expect(results?.map((candidate) => candidate.adminRegion)).toEqual(["Aargau", "Bavaria"]);
      const [target] = fetchMock.mock.calls[0] as unknown as [URL];
      expect(target.searchParams.get("q")).toBe("Hausen, Aargau, Switzerland");
      expect(target.searchParams.get("lat")).toBe("47.4");
      expect(target.searchParams.get("lon")).toBe("8.2");
    });
  });

  test("an instance can point it at a different path", () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "F", url: "https://example.test" },
        users: { reserved: [] },
        features: {
          addressLookup: {
            enabled: true,
            url: "https://geo.example/forward",
            reverseUrl: "https://geo.example/backward",
          },
        },
      }),
    );
    clearConfigCache();

    expect(addressLookupEndpoints()).toEqual({
      url: "https://geo.example/forward",
      reverseUrl: "https://geo.example/backward",
    });
  });

  test("reversePlace fetches the configured reverseUrl, not a guess", async () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "F", url: "https://example.test" },
        users: { reserved: [] },
        features: {
          addressLookup: {
            enabled: true,
            url: "https://geo.example/forward",
            reverseUrl: "https://geo.example/backward",
          },
        },
      }),
    );
    clearConfigCache();

    let requested = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: URL) => {
        requested = target.toString();
        return new Response(JSON.stringify({ features: [{ properties: { city: "Zürich", country: "Schweiz", countrycode: "CH" } }] }));
      }),
    );

    const place = await reversePlace(47.36, 8.54, "de");
    expect(place).toEqual({ location: "Zürich", country: "Schweiz", countryCode: "CH" });
    expect(requested.startsWith("https://geo.example/backward")).toBe(true);
  });
});
