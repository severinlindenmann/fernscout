import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { GET } from "@/app/api/address-lookup/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * `/api/address-lookup` — B399's own abuse surface.
 *
 * The provider is always stubbed (see `test/address-lookup.test.ts`'s own
 * note); this file is about the route's own refusals — the capability off,
 * a query outside the length bounds, and a flood from one address — none of
 * which need a real answer from anywhere.
 */

const OWNER = "ana";
let dir: string;

function writeConfigs(addressLookup: Record<string, unknown>) {
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Ana's journal",
      tagline: "t",
      owner: { name: "Ana B", nickname: "Ana" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { addressLookup },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { addressLookup },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

function request(query: Record<string, string>, ip = "203.0.113.50") {
  const params = new URLSearchParams({ user: OWNER, ...query });
  return GET(
    new Request(`https://example.test/api/address-lookup?${params}`, {
      headers: { "x-forwarded-for": ip },
    }),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-addrlookup-route-"));
  process.env.CONTENT_DIR = dir;
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the capability", () => {
  test("off: 404, and nothing is fetched", async () => {
    writeConfigs({ enabled: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await request({ q: "Bahnhofstrasse" });
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("on: the provider is asked, and its answer comes back", async () => {
    writeConfigs({ enabled: true, provider: "photon" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              features: [
                {
                  properties: {
                    housenumber: "12",
                    street: "Bahnhofstrasse",
                    postcode: "8001",
                    city: "Zürich",
                    countrycode: "CH",
                    type: "house",
                  },
                },
              ],
            }),
          ),
      ),
    );
    const response = await request({ q: "Bahn" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: unknown[] };
    expect(body.results).toEqual([
      { line1: "Bahnhofstrasse 12", postcode: "8001", city: "Zürich", country: "CH" },
    ]);
  });
});

describe("query length", () => {
  beforeEach(() => writeConfigs({ enabled: true, provider: "photon" }));

  test("below the floor is refused before the provider is ever asked", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await request({ q: "ab" });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("above the ceiling is refused the same way", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await request({ q: "a".repeat(300) });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the rate limit", () => {
  beforeEach(() => writeConfigs({ enabled: true, provider: "photon" }));

  test("a flood from one address is cut off with a Retry-After", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [] }))));
    const ip = "203.0.113.77";
    let lastStatus = 0;
    for (let i = 0; i < 40; i++) {
      lastStatus = (await request({ q: `query${i}` }, ip)).status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});
