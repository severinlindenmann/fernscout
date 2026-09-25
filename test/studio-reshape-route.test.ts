import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B1832 — the owner-cookie door onto move/split/merge
 * (`app/api/web/[user]/studio/reshape/route.ts`). Same shape the other
 * `/api/web` proxies already pin (`test/web-cookie-proxies.test.ts`): a
 * bearer token is refused before the owner is even asked about, and
 * somebody who is not the owner writes nothing.
 */

const OWNER = "alex";

let dir: string;
let isOwnerMock: ReturnType<typeof vi.fn>;

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

function req(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = Promise.resolve({ user: OWNER });

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-studio-reshape-route-"));
  process.env.CONTENT_DIR = dir;
  clearUserCache();
  isOwnerMock = (await import("@/lib/contacts/session")).isOwner as unknown as ReturnType<typeof vi.fn>;
  isOwnerMock.mockResolvedValue(true);

  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  clearConfigCache();
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      visibility: "public",
      features: {},
    }),
  );

  writeTripFixture(OWNER, { id: "alps", title: "Round the Alps", start: "2026-01-01", end: "2026-01-10", status: "past", visibility: "public" });
  writeDayFixture(dir, OWNER, "alps", { slug: "arrival", date: "2026-01-02", title: "Arrival", status: "draft", content: "x" });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("/api/web/{user}/studio/reshape", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    const { POST } = await import("@/app/api/web/[user]/studio/reshape/route");
    const response = await POST(
      req("https://t.test/api/web/alex/studio/reshape", "POST", { op: "merge" }, { authorization: "Bearer x" }),
      { params },
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
  });

  test("somebody who is not the owner writes nothing", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { POST } = await import("@/app/api/web/[user]/studio/reshape/route");
    const response = await POST(
      req("https://t.test/api/web/alex/studio/reshape", "POST", {
        op: "move",
        fromTripId: "alps",
        slug: "arrival",
        toTripId: "alps",
        date: "2026-01-05",
      }),
      { params },
    );
    expect(response.status).toBe(403);
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-01-02-arrival.json"))).toBe(true);
  });

  test("GET ?slug= answers the day's own detail, real content, no invention", async () => {
    const { GET } = await import("@/app/api/web/[user]/studio/reshape/route");
    const response = await GET(req("https://t.test/api/web/alex/studio/reshape?slug=arrival", "GET"), { params });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { tripId: string; content: string; published: boolean };
    expect(json.tripId).toBe("alps");
    expect(json.content).toBe("x");
    expect(json.published).toBe(false);
  });

  test("GET ?sweep=1 answers the reference sweep", async () => {
    const { GET } = await import("@/app/api/web/[user]/studio/reshape/route");
    const response = await GET(
      req("https://t.test/api/web/alex/studio/reshape?sweep=1&tripId=alps&slug=arrival", "GET"),
      { params },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).rows).toEqual([]);
  });

  test("POST op=move actually moves the day, through the cookie door", async () => {
    const { POST } = await import("@/app/api/web/[user]/studio/reshape/route");
    const response = await POST(
      req("https://t.test/api/web/alex/studio/reshape", "POST", {
        op: "move",
        fromTripId: "alps",
        slug: "arrival",
        toTripId: "alps",
        date: "2026-01-06",
      }),
      { params },
    );
    expect(response.status).toBe(200);
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-01-02-arrival.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-01-06-arrival.json"))).toBe(true);
  });

  test("POST op=split refuses an unnamed second half, and writes nothing", async () => {
    const { POST } = await import("@/app/api/web/[user]/studio/reshape/route");
    const response = await POST(
      req("https://t.test/api/web/alex/studio/reshape", "POST", {
        op: "split",
        tripId: "alps",
        slug: "arrival",
        photoCutIndex: 0,
        firstContent: "a",
        secondTitle: "",
        secondContent: "b",
      }),
      { params },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("title_required");
  });

  test("POST op=merge refuses across trips", async () => {
    writeTripFixture(OWNER, { id: "kyoto", title: "Kyoto", start: "2026-06-01", end: "2026-06-10", status: "past", visibility: "public" });
    writeDayFixture(dir, OWNER, "kyoto", { slug: "temples", date: "2026-06-02", title: "Temples", content: "y" });
    const { POST } = await import("@/app/api/web/[user]/studio/reshape/route");
    const response = await POST(
      req("https://t.test/api/web/alex/studio/reshape", "POST", {
        op: "merge",
        tripIdA: "alps",
        slugA: "arrival",
        tripIdB: "kyoto",
        slugB: "temples",
      }),
      { params },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("cross_trip");
  });
});
