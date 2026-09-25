import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

// Same guard every other v2 test in this area uses: every call here
// authenticates with a bearer token, never a cookie.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * POST .../days/{slug}/{move,split,merge} — B1903, v2's own door onto
 * lib/studio/reshapeDay.ts's three transactional writers.
 */

const OWNER_EMAIL = "alex@example.test";
const OWNER = "alex";
const OTHER_EMAIL = "quinn@example.test";
const OTHER = "quinn";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.5.${calls % 250}`, ...extra };
}

async function token(user: string, email: string): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(user, email, "agent");
  const result = await verifyCode(user, email, code, "agent");
  if (!result.ok) throw new Error("no token");
  return result.token;
}

type Body = Record<string, unknown> & { error?: string; message?: string };

async function call(
  route: string,
  routeParams: Record<string, string>,
  opts: { token?: string; body?: unknown; dryRun?: boolean } = {},
) {
  const mod = (await import(route)) as Record<string, (req: Request, ctx: unknown) => Promise<Response>>;
  const handler = mod.POST;
  const u = new URL("https://example.test/x");
  if (opts.dryRun !== undefined) u.searchParams.set("dryRun", String(opts.dryRun));
  const response = await handler(
    new Request(u, {
      method: "POST",
      headers: headers(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    { params: Promise.resolve(routeParams) },
  );
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Body };
}

const MOVE = "@/app/api/v2/[user]/trips/[trip]/days/[slug]/move/route";
const SPLIT = "@/app/api/v2/[user]/trips/[trip]/days/[slug]/split/route";
const MERGE = "@/app/api/v2/[user]/trips/[trip]/days/[slug]/merge/route";

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-reshape-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "aa".repeat(32);
  process.env.CONTACTS_ENCRYPTION_KEY = "bb".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");

  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  for (const [username, email, title] of [
    [OWNER, OWNER_EMAIL, "Alex's Journal"],
    [OTHER, OTHER_EMAIL, "Quinn's Journal"],
  ] as const) {
    const created = createJournal({ username, title, ownerEmail: email, ownerName: title, ownerNickname: username });
    if (!created.ok) throw new Error(created.message);
  }

  writeTripFixture(OWNER, { id: "alps", title: "Round the Alps", start: "2026-01-01", end: "2026-01-20", status: "past", visibility: "public" });
  writeTripFixture(OWNER, { id: "kyoto", title: "Kyoto", start: "2026-06-01", end: "2026-06-10", status: "past", visibility: "public" });
  writeTripFixture(OTHER, { id: "secret-trip", title: "Quinn's Trip", start: "2026-03-01", end: "2026-03-10", status: "past", visibility: "public" });
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST .../days/{slug}/move", () => {
  test("same-trip date-only move: the address does not change", async () => {
    writeDayFixture(dir, OWNER, "alps", { slug: "arrival", date: "2026-01-02", title: "Arrival", status: "draft", content: "x" });
    const bearer = await token(OWNER, OWNER_EMAIL);
    const { status, body } = await call(MOVE, { user: OWNER, trip: "alps", slug: "2026-01-02-arrival" }, {
      token: bearer,
      body: { toTripId: "alps", date: "2026-01-09" },
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.tripId).toBe("alps");
    expect(body.slug).toBe("2026-01-09-arrival");
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-01-02-arrival.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-01-09-arrival.json"))).toBe(true);
  });

  test("cross-trip move: the day's media folder actually relocates, not a re-upload", async () => {
    writeDayFixture(dir, OWNER, "alps", {
      slug: "summit",
      date: "2026-01-03",
      title: "Summit",
      status: "draft",
      content: "x",
      media: [{ src: "/media/alps/summit/photo.jpg" }],
    });
    const mediaDir = path.join(dir, OWNER, "trips", "alps", "media", "summit");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "photo.jpg"), "the-original-bytes");

    const bearer = await token(OWNER, OWNER_EMAIL);
    const { status, body } = await call(MOVE, { user: OWNER, trip: "alps", slug: "2026-01-03-summit" }, {
      token: bearer,
      body: { toTripId: "kyoto", date: "2026-06-03" },
    });
    expect(status, JSON.stringify(body)).toBe(200);

    // The SAME bytes, moved — not a new upload.
    const newMediaFile = path.join(dir, OWNER, "trips", "kyoto", "media", "summit", "photo.jpg");
    expect(fs.readFileSync(newMediaFile, "utf8")).toBe("the-original-bytes");
    expect(fs.existsSync(path.join(mediaDir, "photo.jpg"))).toBe(false);
  });

  test("a path-traversal toTripId is refused by the schema before anything runs, and Quinn's journal is untouched", async () => {
    writeDayFixture(dir, OWNER, "alps", { slug: "evening", date: "2026-01-05", title: "Evening", status: "draft", content: "x" });
    const before = fs.readdirSync(path.join(dir, OTHER, "trips", "secret-trip", "entries"), { withFileTypes: false }).sort();

    const bearer = await token(OWNER, OWNER_EMAIL);
    const { status, body } = await call(MOVE, { user: OWNER, trip: "alps", slug: "2026-01-05-evening" }, {
      token: bearer,
      body: { toTripId: "../quinn/trips/secret-trip", date: "2026-01-06" },
    });
    expect(status, JSON.stringify(body)).toBe(400);
    expect(body.error).toBe("invalid_request");

    const after = fs.readdirSync(path.join(dir, OTHER, "trips", "secret-trip", "entries"), { withFileTypes: false }).sort();
    expect(after).toEqual(before);
    // The victim's day stayed exactly where it was too.
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-01-05-evening.json"))).toBe(true);
  });

  test("a path-traversal fromTripId (the URL's own {trip} segment, called directly as B1892 was) is refused, nothing leaves Alex's journal", async () => {
    const beforeQuinn = fs.readdirSync(path.join(dir, OTHER, "trips", "secret-trip", "entries")).sort();
    const bearer = await token(OWNER, OWNER_EMAIL);
    // A test harness can hand the route handler any `params` object,
    // exactly the shape a request whose router matching were bypassed
    // would produce — the same worst case B1892's own reproduction used.
    const { status, body } = await call(MOVE, { user: OWNER, trip: "../quinn/trips/secret-trip", slug: "2026-01-05-evening" }, {
      token: bearer,
      body: { toTripId: "alps", date: "2026-01-07" },
    });
    expect(status, JSON.stringify(body)).toBe(404);
    expect(body.error).toBe("unknown_trip");
    const afterQuinn = fs.readdirSync(path.join(dir, OTHER, "trips", "secret-trip", "entries")).sort();
    expect(afterQuinn).toEqual(beforeQuinn);
  });

  test("a non-owner bearer token is refused", async () => {
    const bearer = await token(OTHER, OTHER_EMAIL);
    const { status, body } = await call(MOVE, { user: OWNER, trip: "alps", slug: "2026-01-05-evening" }, {
      token: bearer,
      body: { toTripId: "alps", date: "2026-01-08" },
    });
    expect(status).toBe(403);
    expect(body.error).toBe("out_of_scope");
  });

  test("dryRun writes nothing", async () => {
    const before = fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-02-01-preview.json"));
    expect(before).toBe(false);
    writeDayFixture(dir, OWNER, "alps", { slug: "preview", date: "2026-01-10", title: "Preview", status: "draft", content: "x" });
    const bearer = await token(OWNER, OWNER_EMAIL);
    const { status, body } = await call(MOVE, { user: OWNER, trip: "alps", slug: "2026-01-10-preview" }, {
      token: bearer,
      body: { toTripId: "alps", date: "2026-02-01" },
      dryRun: true,
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-02-01-preview.json"))).toBe(false);
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-01-10-preview.json"))).toBe(true);
  });

  test("dryRun's addressChanged only claims true for a cross-trip move of an already-published day", async () => {
    writeDayFixture(dir, OWNER, "alps", { slug: "draft-cross", date: "2026-01-16", title: "Draft Cross", status: "draft", content: "x" });
    const bearer = await token(OWNER, OWNER_EMAIL);
    const draftPreview = await call(MOVE, { user: OWNER, trip: "alps", slug: "2026-01-16-draft-cross" }, {
      token: bearer,
      body: { toTripId: "kyoto", date: "2026-06-09" },
      dryRun: true,
    });
    expect(draftPreview.body.addressChanged).toBe(false);

    writeDayFixture(dir, OWNER, "alps", { slug: "published-cross", date: "2026-01-17", title: "Published Cross", status: "published", content: "x" });
    const publishedPreview = await call(MOVE, { user: OWNER, trip: "alps", slug: "2026-01-17-published-cross" }, {
      token: bearer,
      body: { toTripId: "kyoto", date: "2026-06-10" },
      dryRun: true,
    });
    expect(publishedPreview.body.addressChanged).toBe(true);
  });
});

describe("POST .../days/{slug}/split", () => {
  test("splits photographs and words into a new draft half, on the same date", async () => {
    writeDayFixture(dir, OWNER, "alps", {
      slug: "long-day",
      date: "2026-01-11",
      title: "Long Day",
      status: "draft",
      content: "morning words",
      media: [{ src: "/media/alps/long-day/a.jpg" }, { src: "/media/alps/long-day/b.jpg" }],
    });
    const bearer = await token(OWNER, OWNER_EMAIL);
    const { status, body } = await call(SPLIT, { user: OWNER, trip: "alps", slug: "2026-01-11-long-day" }, {
      token: bearer,
      body: { photoCutIndex: 1, firstContent: "morning words", secondTitle: "Afternoon", secondContent: "afternoon words" },
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.firstSlug).toBe("2026-01-11-long-day");
    expect(body.secondSlug).toBe("2026-01-11-afternoon");
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-01-11-afternoon.json"))).toBe(true);
  });

  test("refuses an unnamed second half, and writes nothing", async () => {
    writeDayFixture(dir, OWNER, "alps", { slug: "quiet-day", date: "2026-01-12", title: "Quiet", status: "draft", content: "x" });
    const bearer = await token(OWNER, OWNER_EMAIL);
    const { status, body } = await call(SPLIT, { user: OWNER, trip: "alps", slug: "2026-01-12-quiet-day" }, {
      token: bearer,
      body: { photoCutIndex: 0, firstContent: "a", secondTitle: "", secondContent: "b" },
    });
    expect(status).toBe(409);
    expect(body.error).toBe("title_required");
  });
});

describe("POST .../days/{slug}/merge", () => {
  test("joins two updates on the same trip; the earlier survives under its own slug", async () => {
    writeDayFixture(dir, OWNER, "alps", { slug: "one", date: "2026-01-13", title: "One", status: "draft", content: "first" });
    writeDayFixture(dir, OWNER, "alps", { slug: "two", date: "2026-01-14", title: "Two", status: "draft", content: "second" });
    const bearer = await token(OWNER, OWNER_EMAIL);
    const { status, body } = await call(MERGE, { user: OWNER, trip: "alps", slug: "2026-01-13-one" }, {
      token: bearer,
      body: { withSlug: "2026-01-14-two" },
    });
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.slug).toBe("2026-01-13-one");
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "alps", "entries", "2026-01-14-two.json"))).toBe(false);
  });

  test("refuses across trips, matching the studio's own door — writes nothing", async () => {
    writeDayFixture(dir, OWNER, "alps", { slug: "alps-day", date: "2026-01-15", title: "Alps Day", status: "draft", content: "x" });
    writeDayFixture(dir, OWNER, "kyoto", { slug: "kyoto-day", date: "2026-06-05", title: "Kyoto Day", status: "draft", content: "y" });
    const bearer = await token(OWNER, OWNER_EMAIL);
    const { status, body } = await call(MERGE, { user: OWNER, trip: "alps", slug: "2026-01-15-alps-day" }, {
      token: bearer,
      body: { withTripId: "kyoto", withSlug: "2026-06-05-kyoto-day" },
    });
    expect(status).toBe(409);
    expect(body.error).toBe("cross_trip");
    expect(fs.existsSync(path.join(dir, OWNER, "trips", "kyoto", "entries", "2026-06-05-kyoto-day.json"))).toBe(true);
  });

  test("withSlug naming a day on a different trip than the URL's own, with withTripId omitted, is just not found there", async () => {
    const bearer = await token(OWNER, OWNER_EMAIL);
    const { status, body } = await call(MERGE, { user: OWNER, trip: "alps", slug: "2026-01-15-alps-day" }, {
      token: bearer,
      body: { withSlug: "2026-06-05-kyoto-day" },
    });
    expect(status).toBe(404);
    expect(body.error).toBe("unknown_day");
  });

  test("a path-traversal withTripId is refused by the schema, Quinn's journal untouched", async () => {
    const before = fs.readdirSync(path.join(dir, OTHER, "trips", "secret-trip", "entries")).sort();
    const bearer = await token(OWNER, OWNER_EMAIL);
    const { status, body } = await call(MERGE, { user: OWNER, trip: "alps", slug: "2026-01-15-alps-day" }, {
      token: bearer,
      body: { withTripId: "../quinn/trips/secret-trip", withSlug: "2026-01-15-alps-day" },
    });
    expect(status, JSON.stringify(body)).toBe(400);
    expect(body.error).toBe("invalid_request");
    const after = fs.readdirSync(path.join(dir, OTHER, "trips", "secret-trip", "entries")).sort();
    expect(after).toEqual(before);
  });
});
