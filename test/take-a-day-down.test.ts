import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * B980 round 3 — the other half of "correct or take down", from the day.
 *
 * `EditDay` could edit a day and could not take it off the site, which is
 * what B1013 found and relabelled the tile over rather than build. This pins
 * the two owner-cookie doors round 3 adds: `.../unpublish`, which flips one
 * update back to a draft, and `.../visibility`, which is the trip's own
 * `visibility`/`listed` — both gated exactly like `edit/route.ts` beside them
 * (`test/edit-the-day.test.ts`): a bearer token, trip-scoped or not, is
 * refused before the owner is even asked about, and somebody who is not the
 * owner writes nothing.
 */

const OWNER = "alex";
const TRIP = "edit-trip";
const SLUG = "a-day";

let dir: string;
let isOwnerMock: ReturnType<typeof vi.fn>;

vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

const entryFile = () =>
  path.join(dir, OWNER, "trips", TRIP, "entries", `2026-09-02-${SLUG}.md`);
const tripFile = () => path.join(dir, OWNER, "trips", TRIP, "trip.md");

function writeJournal() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  clearConfigCache();

  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Notebook",
      tagline: "one slow loop",
      owner: { name: "Alex B", nickname: "Alex", email: "alex@example.test" },
      startLocation: "Zurich",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );

  const root = path.join(dir, OWNER, "trips", TRIP);
  fs.mkdirSync(path.join(root, "entries"), { recursive: true });
  fs.writeFileSync(
    tripFile(),
    [
      "---",
      `id: "${TRIP}"`,
      `title: "${TRIP}"`,
      'start: "2026-09-01"',
      'end: "2026-09-10"',
      'status: "current"',
      'visibility: "private"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    entryFile(),
    [
      "---",
      'title: "A day"',
      'date: "2026-09-02"',
      'location: "Somewhere"',
      'country: "Nowhere"',
      "---",
      "",
      "Something happened.",
      "",
    ].join("\n"),
  );
}

async function unpublishRoute() {
  return import("@/app/[user]/trips/[trip]/day/[slug]/unpublish/route");
}

async function visibilityRoute() {
  return import("@/app/[user]/trips/[trip]/visibility/route");
}

function unpublishReq(headers: Record<string, string> = {}) {
  return new Request(`https://t.test/${OWNER}/trips/${TRIP}/day/${SLUG}/unpublish`, {
    method: "POST",
    headers,
  });
}

function visibilityReq(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://t.test/${OWNER}/trips/${TRIP}/visibility`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const dayParams = { params: Promise.resolve({ user: OWNER, trip: TRIP, slug: SLUG }) };
const tripParams = { params: Promise.resolve({ user: OWNER, trip: TRIP }) };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-take-down-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  writeJournal();
  clearUserCache();

  const session = await import("@/lib/contacts/session");
  isOwnerMock = vi.mocked(session.isOwner);
  isOwnerMock.mockReset();
  isOwnerMock.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("the owner's own take-down door", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about — including a trip-scoped one", async () => {
    const { POST } = await unpublishRoute();
    const response = await POST(unpublishReq({ authorization: "Bearer write:trip:edit-trip" }), dayParams);
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(entryFile(), "utf8")).not.toContain("status:");
  });

  test("somebody who is not the owner writes nothing", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { POST } = await unpublishRoute();
    const response = await POST(unpublishReq(), dayParams);
    expect(response.status).toBe(403);
    expect(fs.readFileSync(entryFile(), "utf8")).not.toContain("status:");
  });

  test("flips the day to draft", async () => {
    const { POST } = await unpublishRoute();
    const response = await POST(unpublishReq(), dayParams);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; status: string };
    expect(body.status).toBe("draft");
    expect(fs.readFileSync(entryFile(), "utf8")).toContain("status: draft");
  });

  test("taking it down twice is refused rather than shrugged off", async () => {
    const { POST } = await unpublishRoute();
    await POST(unpublishReq(), dayParams);
    const again = await POST(unpublishReq(), dayParams);
    expect(again.status).toBe(409);
  });

  test("an unknown day is a 404", async () => {
    const { POST } = await unpublishRoute();
    const response = await POST(unpublishReq(), {
      params: Promise.resolve({ user: OWNER, trip: TRIP, slug: "nope" }),
    });
    expect(response.status).toBe(404);
  });
});

describe("the owner's own trip-visibility door", { shuffle: false }, () => {
  test("a bearer token is refused before the owner is even asked about", async () => {
    const { PATCH } = await visibilityRoute();
    const response = await PATCH(
      visibilityReq({ visibility: "guest" }, { authorization: "Bearer x" }),
      tripParams,
    );
    expect(response.status).toBe(403);
    expect(isOwnerMock).not.toHaveBeenCalled();
    expect(fs.readFileSync(tripFile(), "utf8")).toContain('visibility: "private"');
  });

  test("somebody who is not the owner writes nothing", async () => {
    isOwnerMock.mockResolvedValue(false);
    const { PATCH } = await visibilityRoute();
    const response = await PATCH(visibilityReq({ visibility: "guest" }), tripParams);
    expect(response.status).toBe(403);
    expect(fs.readFileSync(tripFile(), "utf8")).toContain('visibility: "private"');
  });

  test("writes visibility and listed to trip.md", async () => {
    const { PATCH } = await visibilityRoute();
    const response = await PATCH(
      visibilityReq({ visibility: "public", listed: true }),
      tripParams,
    );
    expect(response.status).toBe(200);
    const written = fs.readFileSync(tripFile(), "utf8");
    expect(written).toContain("visibility: public");
    expect(written).not.toContain("listed: false");
  });

  test("listed: true on a trip that is not public is refused, same as over the API", async () => {
    const { PATCH } = await visibilityRoute();
    const response = await PATCH(visibilityReq({ listed: true }), tripParams);
    expect(response.status).toBe(400);
    expect(fs.readFileSync(tripFile(), "utf8")).toContain('visibility: "private"');
  });
});
