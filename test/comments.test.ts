import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushAfterResponse } from "@/lib/afterResponse";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase } from "@/lib/db";
import { saveSubscription } from "@/lib/push";
import { resetRateLimitsForTests } from "@/lib/rateLimit";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B-2957 — comments under a published day.
 *
 * Who is asking is mocked at the two seams the route reads (`journalReader`,
 * `isOwner`); everything else — the trip gate's day lookup, the store, the
 * rate limit — is the real thing. `sendPush` is a spy so no push service is
 * ever reached.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TRIP = "reise";
const REF = `${OWNER}/${TRIP}`;
const DAY = "lanterns-of-hoi-an";

type Who = { email: string | null; name?: string; guest: boolean; owner: boolean };
let who: Who;
const sendPush = vi.fn();
let pushShouldFail = false;

vi.mock("@/lib/contacts/session", () => ({
  isOwner: async () => who.owner,
  journalReader: async () => ({
    email: who.email,
    contact: who.name ? { name: who.name } : null,
    guest: who.guest,
    close: false,
  }),
}));
vi.mock("@/lib/tripGate", () => ({
  mayReadTrip: async () => true,
  readerLevelFor: async () => "person",
}));
vi.mock("@/lib/push/send", () => ({
  localeForSubscriber: async () => "en",
  sendPush: (...args: unknown[]) => {
    sendPush(...args);
    if (pushShouldFail) throw new Error("push service down");
    return Promise.resolve({ sent: 1, pruned: 0 });
  },
}));

const guestA: Who = { email: "bea@example.test", name: "Bea", guest: true, owner: false };
const guestB: Who = { email: "carl@example.test", name: "Carl", guest: true, owner: false };
const owner: Who = { email: OWNER_EMAIL, guest: false, owner: true };
const stranger: Who = { email: null, guest: false, owner: false };
const identityOnly: Who = { email: "dora@example.test", guest: false, owner: false };

let dir: string;

function writeConfigs(commentsOn = true) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true }, comments: { enabled: commentsOn }, push: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Alex B", nickname: "Alex", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
    }),
  );
  clearConfigCache();
  clearUserCache();
}

function writeDay() {
  writeTripFixture(OWNER, { id: TRIP, title: TRIP, start: "2026-09-01", end: "2026-09-10", status: "current", visibility: "public" });
  const declined: Record<string, string> = {};
  for (const field of ["media", "costs", "coordinates", "weather", "time", "timezone", "countryCode", "transportMode", "tags", "translations", "visibility"]) {
    declined[field] = "n/a for this fixture";
  }
  writeDayFixture(dir, OWNER, TRIP, {
    slug: DAY,
    date: "2026-09-02",
    title: "Lanterns of Hoi An",
    content: "The old town hangs with lanterns.",
    location: "Hoi An",
    country: "Vietnam",
    status: "published",
    declined,
  });
}

type Json = {
  comment: { id: string; author: string; body: string; mine: boolean };
  error?: string;
  retryAfter: number;
  limits: { maxLength: number };
};

async function route() {
  return import("@/app/api/comments/route");
}

const URL_BASE = "https://t.test/api/comments";
function send(method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>) {
  return new Request(URL_BASE, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
    body: JSON.stringify({ trip: REF, day: DAY, ...payload }),
  });
}
const list = (extra = "") => new Request(`${URL_BASE}?trip=${encodeURIComponent(REF)}&day=${DAY}${extra}`);

async function post(as: Who, body: string) {
  who = as;
  const { POST } = await route();
  const response = await POST(send("POST", { body }));
  return { status: response.status, json: (await response.json()) as Json };
}
async function get(as: Who, extra = "") {
  who = as;
  const { GET } = await route();
  const response = await GET(list(extra));
  return { status: response.status, headers: response.headers, text: await response.text() };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-comments-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "comments-test-secret-comments-test-secret";
  sendPush.mockReset();
  pushShouldFail = false;
  who = stranger;
  resetRateLimitsForTests();
  writeConfigs();
  writeDay();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await flushAfterResponse();
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[key];
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("guests write, list, edit and delete", () => {
  test("a guest posts under the invited name, never an email, and it survives a reload", async () => {
    const posted = await post(guestA, "  Lovely lanterns  ");
    expect(posted.status).toBe(201);
    expect(posted.json.comment).toMatchObject({ author: "Bea", body: "Lovely lanterns", mine: true });
    expect(JSON.stringify(posted.json)).not.toContain("example.test");

    const read = await get(guestB);
    const body = JSON.parse(read.text);
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]).toMatchObject({ author: "Bea", mine: false });
    expect(read.text).not.toContain("bea@");
    expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect(read.headers.get("vary")).toBe("Cookie");
  });

  test("the latest 3 by default, all with all=1, with total and limits", async () => {
    for (let n = 1; n <= 5; n++) await post(guestA, `comment ${n}`);
    const short = JSON.parse((await get(guestA)).text);
    expect(short.total).toBe(5);
    expect(short.comments.map((c: { body: string }) => c.body)).toEqual(["comment 3", "comment 4", "comment 5"]);
    expect(short.limits).toMatchObject({ maxLength: 500, shown: 3 });
    const full = JSON.parse((await get(guestA, "&all=1")).text);
    expect(full.comments).toHaveLength(5);
    expect(full.comments[0].body).toBe("comment 1");
  });

  test("an author edits their own comment and it shows as edited", async () => {
    const { json } = await post(guestA, "first");
    const { PATCH } = await route();
    const response = await PATCH(send("PATCH", { id: json.comment.id, body: "second" }));
    expect(response.status).toBe(200);
    const read = JSON.parse((await get(guestA)).text);
    expect(read.comments[0]).toMatchObject({ body: "second", edited: true });
  });

  test("an author deletes their own comment", async () => {
    const { json } = await post(guestA, "gone soon");
    const { DELETE } = await route();
    expect((await DELETE(send("DELETE", { id: json.comment.id }))).status).toBe(200);
    expect(JSON.parse((await get(guestA)).text).total).toBe(0);
  });

  test("a forged edit or delete of another guest's comment is refused and changes nothing", async () => {
    const { json } = await post(guestA, "mine");
    const { PATCH, DELETE } = await route();
    who = guestB;
    expect((await PATCH(send("PATCH", { id: json.comment.id, body: "hijacked" }))).status).toBe(403);
    expect((await DELETE(send("DELETE", { id: json.comment.id }))).status).toBe(403);
    const read = JSON.parse((await get(guestA)).text);
    expect(read.comments[0]).toMatchObject({ body: "mine", mine: true });
    expect(read.comments[0].edited).toBeUndefined();
  });

  test("an author sent by the client is ignored", async () => {
    who = guestA;
    const { POST } = await route();
    const response = await POST(send("POST", { body: "hi", author: "Mallory", email: "mallory@example.test" }));
    expect((await response.json()).comment.author).toBe("Bea");
  });
});

describe("the owner", () => {
  test("posts under their own name, and can delete any comment but not edit it", async () => {
    const mine = await post(owner, "Thanks all");
    expect(mine.json.comment).toMatchObject({ author: "Alex B", mine: true });
    const theirs = await post(guestA, "hello");
    const { PATCH, DELETE } = await route();
    who = owner;
    expect((await PATCH(send("PATCH", { id: theirs.json.comment.id, body: "reworded" }))).status).toBe(403);
    expect((await DELETE(send("DELETE", { id: theirs.json.comment.id }))).status).toBe(200);
    const read = JSON.parse((await get(owner)).text);
    expect(read.isOwner).toBe(true);
    expect(read.comments.map((c: { body: string }) => c.body)).toEqual(["Thanks all"]);
  });
});

describe("who gets nothing", () => {
  test("an uninvited visitor and an identity-only cookie are answered like a missing trip, with no text", async () => {
    await post(guestA, "private words from Bea");
    for (const viewer of [stranger, identityOnly]) {
      const read = await get(viewer);
      expect(read.status).toBe(400);
      expect(JSON.parse(read.text)).toEqual({ error: "unknown_trip" });
      expect(read.text).not.toContain("Bea");
      expect(read.text).not.toContain("private words");
      const attempt = await post(viewer, "let me in");
      expect(attempt.status).toBe(400);
    }
    // And nothing was written by the refused posts.
    expect(JSON.parse((await get(guestA)).text).total).toBe(1);
  });

  test("a journal with comments switched off answers 404 and writes nothing", async () => {
    writeConfigs(false);
    const read = await get(guestA);
    expect(read.status).toBe(404);
    expect((await post(guestA, "hi")).status).toBe(404);
  });

  test("a day that is not published is not commentable", async () => {
    who = guestA;
    const { POST } = await route();
    const response = await POST(send("POST", { day: "no-such-day", body: "hi" }));
    expect(response.status).toBe(400);
  });

  test("story.json carries no comment fields", async () => {
    await post(guestA, "unmistakable-comment-text");
    const { GET } = await import("@/app/at/[user]/story.json/route");
    const response = await GET(new Request(`https://t.test/at/${OWNER}/story.json?trip=${TRIP}`), {
      params: Promise.resolve({ user: OWNER }),
    } as Parameters<typeof GET>[1]);
    const text = await response.text();
    expect(text).not.toContain("unmistakable-comment-text");
    expect(text.toLowerCase()).not.toContain("comment");
  });
});

describe("limits", () => {
  test("500 characters are accepted, 501 refused, empty refused", async () => {
    expect((await post(guestA, "x".repeat(500))).status).toBe(201);
    const tooLong = await post(guestA, "x".repeat(501));
    expect(tooLong.status).toBe(400);
    expect(tooLong.json.error).toBe("bad_body");
    expect(tooLong.json.limits.maxLength).toBe(500);
    expect((await post(guestA, "   ")).status).toBe(400);
  });

  test("a burst of posts is rate limited with a retry-after", async () => {
    let last = { status: 0, json: {} as Json };
    for (let n = 0; n < 12; n++) last = await post(guestA, `burst ${n}`);
    expect(last.status).toBe(429);
    expect(last.json.error).toBe("rate_limited");
    expect(last.json.retryAfter).toBeGreaterThan(0);
  });
});

describe("telling the owner", () => {
  async function ownerDevice() {
    await saveSubscription({
      username: OWNER,
      endpoint: "https://push.example/owner",
      keys: { p256dh: "p", auth: "a" },
      created: "2026-08-01",
      isOwner: true,
    });
    await saveSubscription({
      username: OWNER,
      endpoint: "https://push.example/reader",
      keys: { p256dh: "p", auth: "a" },
      created: "2026-08-01",
    });
  }

  test("one push per guest comment, to the owner's devices only, naming the guest and the day but not the text", async () => {
    await ownerDevice();
    await post(guestA, "a secret comment body");
    await flushAfterResponse();
    expect(sendPush).toHaveBeenCalledTimes(1);
    const call = sendPush.mock.calls[0][0];
    expect(call.subscriptions.map((s: { endpoint: string }) => s.endpoint)).toEqual(["https://push.example/owner"]);
    expect(call.body).toContain("Bea");
    expect(call.body).toContain("Lanterns of Hoi An");
    expect(JSON.stringify(call)).not.toContain("secret comment");
  });

  test("none for the owner's own comment", async () => {
    await ownerDevice();
    await post(owner, "an answer");
    await flushAfterResponse();
    expect(sendPush).not.toHaveBeenCalled();
  });

  test("a failing push never fails the post", async () => {
    await ownerDevice();
    pushShouldFail = true;
    const posted = await post(guestA, "still saved");
    await flushAfterResponse();
    expect(posted.status).toBe(201);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(JSON.parse((await get(guestA)).text).total).toBe(1);
  });
});

describe("B-2957 review fixes", () => {
  test("a trip-link-only reader (a contact with no journal grant) is refused like a stranger", async () => {
    await post(guestA, "for guests only");
    const linkOnly: Who = { email: "eve@example.test", name: "Eve", guest: false, owner: false };
    expect((await get(linkOnly)).status).toBe(400);
    expect((await post(linkOnly, "hello")).status).toBe(400);
  });

  test("a foreign Origin is refused on POST, PATCH and DELETE", async () => {
    who = guestA;
    const { POST, PATCH, DELETE } = await route();
    for (const [fn, method] of [[POST, "POST"], [PATCH, "PATCH"], [DELETE, "DELETE"]] as const) {
      const req = send(method, { body: "x", id: "y" });
      req.headers.set("origin", "https://evil.example");
      const res = await fn(req);
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("foreign_origin");
    }
  });

  test("an unnamed author is called 'A reader' in the owner's push", async () => {
    await saveSubscription({ username: OWNER, endpoint: "https://push.example/o", keys: { p256dh: "p", auth: "a" }, created: "2026-08-01", isOwner: true });
    await post({ ...guestA, name: undefined }, "hi");
    await flushAfterResponse();
    expect(sendPush.mock.calls[0][0].body).toBe("A reader commented on Lanterns of Hoi An");
  });

  test("deleting a trip or a contact removes their comments", async () => {
    await post(guestA, "from Bea");
    const { commentRepo } = await import("@/lib/repos");
    await (await commentRepo()).removeByAuthor(OWNER, guestA.email!);
    expect(JSON.parse((await get(guestB)).text).total).toBe(0);
    await post(guestA, "again");
    const { deleteTrip } = await import("@/lib/deletions");
    await deleteTrip(OWNER, TRIP, OWNER_EMAIL);
    expect((await (await commentRepo()).list(REF, DAY)).total).toBe(0);
  });
});

describe("B-2973 trip rename moves comments", () => {
  test("renameTrip moves comments to the new ref (database store)", async () => {
    await post(guestA, "kept across a rename");
    const { renameTrip } = await import("@/lib/tripRename");
    const { commentRepo } = await import("@/lib/repos");
    expect(await renameTrip(OWNER, TRIP, "renamed-trip")).toEqual({ ok: true, id: "renamed-trip" });
    expect((await (await commentRepo()).list(`${OWNER}/renamed-trip`, DAY)).total).toBe(1);
    expect((await (await commentRepo()).list(REF, DAY)).total).toBe(0);
  });

  test("moveForTrip on the file store", async () => {
    const { fileCommentRepo } = await import("@/lib/repos/commentsFile");
    const repo = fileCommentRepo();
    await repo.add({ tripId: REF, daySlug: DAY, authorEmail: "a@example.test", authorName: "A", body: "hi", createdAt: "2026-01-01T00:00:00Z" } as never);
    await repo.moveForTrip(REF, `${OWNER}/new`);
    expect((await repo.list(`${OWNER}/new`, DAY)).total).toBe(1);
    expect((await repo.list(REF, DAY)).total).toBe(0);
  });
});
