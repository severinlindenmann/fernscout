import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST } from "@/app/api/v1/geocode/route";
import { openAgentSession } from "@/lib/auth";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { clearUserCache } from "@/lib/users";

let dir: string;
const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const SECOND_OWNER = "bea";
const SECOND_OWNER_EMAIL = "bea@example.test";

function writeUserConfig(username: string, email: string, addressLookup: Record<string, unknown>) {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: username,
      tagline: "t",
      owner: { name: `${username} Example`, nickname: username, email },
      baseCurrency: "CHF",
      features: { addressLookup },
    }),
  );
}

function writeConfigs(addressLookup: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: {
        auth: { enabled: true },
        addressLookup,
      },
    }),
  );
  writeUserConfig(OWNER, OWNER_EMAIL, addressLookup);
  writeUserConfig(SECOND_OWNER, SECOND_OWNER_EMAIL, addressLookup);
  clearConfigCache();
  clearUserCache();
}

async function token(username = OWNER, email = OWNER_EMAIL): Promise<string> {
  return (await openAgentSession(username, email)).token;
}

async function call(token: string, body: unknown, ip = "203.0.113.90") {
  const headers = new Headers({
    "content-type": "application/json",
    "accept-language": "de-CH,de;q=0.9,en;q=0.8",
    "x-forwarded-for": ip,
  });
  headers.set("authorization", ["Bearer", token].join(" "));
  const response = await POST(
    new Request("https://t.test/api/v1/geocode", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, body: parsed, retryAfter: response.headers.get("Retry-After") };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-geocode-route-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "geocode-route-test-secret-geocode-route";
  writeConfigs({ enabled: true, provider: "photon" });
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/v1/geocode", () => {
  test("returns ranked candidates and biases the provider query with trip context", async () => {
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
                geometry: { type: "Point", coordinates: [11, 48] },
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

    const response = await call(await token(), {
      query: "Hausen",
      countryHint: "Switzerland",
      regionHint: "Aargau",
      contextCoordinates: [{ lat: 47.4, lng: 8.2 }],
    });

    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([
      {
        displayName: "Hausen, Aargau, Switzerland",
        country: "Switzerland",
        countryCode: "CH",
        adminRegion: "Aargau",
        lat: 47.463,
        lon: 8.216,
        type: "village",
      },
      {
        displayName: "Hausen, Bavaria, Germany",
        country: "Germany",
        countryCode: "DE",
        adminRegion: "Bavaria",
        lat: 48,
        lon: 11,
        type: "village",
      },
    ]);

    const [target] = fetchMock.mock.calls[0] as unknown as [URL];
    expect(target.searchParams.get("q")).toBe("Hausen, Aargau, Switzerland");
    expect(target.searchParams.get("lat")).toBe("47.4");
    expect(target.searchParams.get("lon")).toBe("8.2");
    expect(target.searchParams.get("lang")).toBe("de");
  });

  test("returns 200 with an empty list when nothing matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [] }))));
    const response = await call(await token(), { query: "No Such Place" }, "203.0.113.92");
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([]);
  });

  test("refuses an invalid body before asking the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await call(await token(), {
      query: "ab",
      contextCoordinates: [{ lat: 200, lng: 8.2 }],
    }, "203.0.113.93");

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("answers 404 when the journal has place lookup switched off", async () => {
    writeConfigs({ enabled: false, provider: "photon" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await call(await token(), { query: "Hausen" }, "203.0.113.94");

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("address_lookup_disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("surfaces provider failures as 502, distinct from no matches", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
    const response = await call(await token(), { query: "Hausen" }, "203.0.113.94");
    expect(response.status).toBe(502);
    expect(response.body.error).toBe("provider_unavailable");
  });

  test("rate-limits repeated lookups to one per second", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [] }))));
    const accessToken = await token();
    expect((await call(accessToken, { query: "Hausen" }, "203.0.113.91")).status).toBe(200);
    const limited = await call(accessToken, { query: "Hausen" }, "203.0.113.91");
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe("too_many_requests");
    expect(limited.retryAfter).toBeTruthy();
  });

  test("keeps one journal's rate limit from consuming another's behind the same IP", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [] }))));
    const first = await token();
    const second = await token(SECOND_OWNER, SECOND_OWNER_EMAIL);
    expect((await call(first, { query: "Hausen" }, "203.0.113.95")).status).toBe(200);
    expect((await call(second, { query: "Hausen" }, "203.0.113.95")).status).toBe(200);
  });
});
