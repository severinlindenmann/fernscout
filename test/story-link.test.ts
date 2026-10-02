import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * "Ask to read along" — B2665 round 2. A standing, journal-wide guest
 * invite the owner turns on from the share screen, built on the same
 * `contact_invites` table and `/j/<code>` request flow every other guest
 * link uses: holding it is still not access, and pausing it is reversible.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
  }),
  headers: async () => new Headers(),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const GUEST_TRIP = "iceland-2026";
let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.0.${calls % 250}`, ...extra };
}

function post(url: string, body: unknown, extra: Record<string, string> = {}) {
  return new Request(`https://example.test${url}`, { method: "POST", headers: headers(extra), body: JSON.stringify(body) });
}
function get(url: string, extra: Record<string, string> = {}) {
  return new Request(`https://example.test${url}`, { headers: headers(extra) });
}

async function signInOwner(): Promise<void> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "guest");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "guest");
  if (!result.ok) throw new Error("no owner cookie");
  jar.cookies = { fs_session: result.token };
}

type StoryState = { status: string; url?: string; inviteId?: string };

async function storyGet(): Promise<{ status: number; body: StoryState }> {
  const { GET } = await import("@/app/api/web/[user]/story-link/route");
  const res = await GET(get(`/api/web/${OWNER}/story-link`), { params: Promise.resolve({ user: OWNER }) });
  return { status: res.status, body: (await res.json()) as StoryState };
}
async function storyPost(action: string, extra: Record<string, string> = {}): Promise<{ status: number; body: StoryState }> {
  const { POST } = await import("@/app/api/web/[user]/story-link/route");
  const res = await POST(post(`/api/web/${OWNER}/story-link`, { action }, extra), { params: Promise.resolve({ user: OWNER }) });
  return { status: res.status, body: (await res.json()) as StoryState };
}

function mails(to: string): string[] {
  const mailDir = path.join(dir, "mail", OWNER);
  if (!fs.existsSync(mailDir)) return [];
  return fs
    .readdirSync(mailDir)
    .map((f) => fs.readFileSync(path.join(mailDir, f), "utf8"))
    .filter((eml) => eml.includes(`To: ${to}`))
    .map((eml) =>
      [...eml.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/g)]
        .map((m) => Buffer.from(m[1].replace(/\s+/g, ""), "base64").toString("utf8"))
        .join("\n"),
    );
}
const lastCode = (text: string) => text.match(/(?<![#\w])(\d{6})(?!\w)/)?.[1] ?? "";
const codeMailed = (to: string) => lastCode(mails(to).at(-1) ?? "");

async function joinStep(code: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/j/[code]/step/route");
  const res = await POST(post(`/j/${code}/step`, body), { params: Promise.resolve({ code }) });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-story-link-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "ab".repeat(32);
  process.env.SESSION_SECRET = "cd".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  writeTripFixture(OWNER, {
    id: GUEST_TRIP,
    title: "Iceland 2026",
    start: "2026-08-25",
    end: "2026-08-26",
    status: "past",
    visibility: "guest",
  });
  writeDayFixture(dir, OWNER, GUEST_TRIP, { slug: "arrival", date: "2026-08-25", status: "published" });

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

beforeEach(async () => {
  const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
  resetRateLimitsForTests();
  jar.cookies = {};
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Deterministic id, same owner across every describe below — wiped before
 * each test so one test's state (live/paused) never leaks into the next. */
async function resetStoryLink(): Promise<void> {
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  await db.deleteFrom("contact_invites").where("owner_id", "=", OWNER).where("id", "=", `story-${OWNER}`).execute();
  await db.deleteFrom("reader_groups").where("owner_id", "=", OWNER).where("name", "=", "From my stories").execute();
}

describe("storyLinkState / ensureStoryLink / pause / resume", () => {
  beforeEach(resetStoryLink);

  test("none until ensured, then live, then idempotent", async () => {
    const { storyLinkState, ensureStoryLink } = await import("@/lib/contacts/storyLink");
    expect(await storyLinkState(OWNER)).toEqual({ status: "none" });

    const first = await ensureStoryLink(OWNER, "en");
    expect(first.status).toBe("live");
    const second = await ensureStoryLink(OWNER, "en");
    expect(second).toEqual(first);

    const { listGroups } = await import("@/lib/contacts/groups");
    const groups = await listGroups(OWNER);
    expect(groups.filter((g) => g.name === "From my stories")).toHaveLength(1);
  });

  test("pause, then paused stays paused across a later ensure call", async () => {
    const { ensureStoryLink, pauseStoryLink, storyLinkState } = await import("@/lib/contacts/storyLink");
    const live = await ensureStoryLink(OWNER, "en");
    expect(live.status).toBe("live");
    await pauseStoryLink(OWNER);
    expect(await storyLinkState(OWNER)).toMatchObject({ status: "paused" });

    const again = await ensureStoryLink(OWNER, "en");
    expect(again.status).toBe("paused");
  });

  test("resume keeps the same /j/ code", async () => {
    const { ensureStoryLink, pauseStoryLink, resumeStoryLink, storyLinkState } = await import("@/lib/contacts/storyLink");
    const before = await ensureStoryLink(OWNER, "en");
    if (before.status !== "live") throw new Error("expected live");
    await pauseStoryLink(OWNER);
    const resumed = await resumeStoryLink(OWNER);
    expect(resumed).toMatchObject({ status: "live", url: before.url });
    expect(await storyLinkState(OWNER)).toEqual(resumed);
  });
});

describe("GET/POST /api/web/{user}/story-link", () => {
  beforeEach(resetStoryLink);

  test("refuses an Authorization header outright", async () => {
    const { GET } = await import("@/app/api/web/[user]/story-link/route");
    const res = await GET(get(`/api/web/${OWNER}/story-link`, { authorization: "Bearer x" }), {
      params: Promise.resolve({ user: OWNER }),
    });
    expect(res.status).toBe(403);
  });

  test("refuses a non-owner", async () => {
    // no sign-in: jar.cookies is empty from beforeEach.
    const res = await storyGet();
    expect(res.status).toBe(403);
  });

  test("start, pause and resume, as the owner", async () => {
    await signInOwner();
    expect((await storyGet()).body).toEqual({ status: "none" });

    const started = await storyPost("start");
    expect(started.status).toBe(200);
    expect(started.body.status).toBe("live");
    const url = started.body.url;
    expect(url).toBeTruthy();

    const paused = await storyPost("pause");
    expect(paused.body.status).toBe("paused");

    const resumed = await storyPost("resume");
    expect(resumed.body).toEqual({ status: "live", url, inviteId: started.body.inviteId });
  });
});

describe("storyShareLink draws the read-along link only once it is live", () => {
  beforeEach(resetStoryLink);

  test("none, then live, then paused again — on a readers-only trip's published day", async () => {
    const { storyShareLink } = await import("@/lib/storyCard");
    const { readDayFile, resolveDayStem } = await import("@/lib/api/v2/store");
    const { getTrip } = await import("@/lib/trips");
    const trip = getTrip(`${OWNER}/${GUEST_TRIP}`);
    const stem = resolveDayStem(OWNER, GUEST_TRIP, "arrival")!;
    const day = readDayFile(OWNER, GUEST_TRIP, stem);
    if (!day) throw new Error("fixture day missing");

    expect(await storyShareLink(OWNER, GUEST_TRIP, stem, trip, day, true)).toEqual({
      url: null,
      readAlong: false,
    });

    const { ensureStoryLink, pauseStoryLink } = await import("@/lib/contacts/storyLink");
    const live = await ensureStoryLink(OWNER, "en");
    if (live.status !== "live") throw new Error("expected live");

    expect(await storyShareLink(OWNER, GUEST_TRIP, stem, trip, day, true)).toEqual({
      url: live.url,
      readAlong: true,
    });
    // Asking without `readalong=1` never draws it, even while live.
    expect(await storyShareLink(OWNER, GUEST_TRIP, stem, trip, day, false)).toEqual({
      url: null,
      readAlong: false,
    });

    await pauseStoryLink(OWNER);
    expect(await storyShareLink(OWNER, GUEST_TRIP, stem, trip, day, true)).toEqual({
      url: null,
      readAlong: false,
    });
  });
});

describe("the per-link daily cap on new requests", () => {
  beforeEach(resetStoryLink);

  test("refuses the 31st brand-new request through one link in a day", async () => {
    await signInOwner();
    const started = await storyPost("start");
    const url = started.body.url as string;
    const code = url.split("/j/")[1];

    for (let i = 0; i < 30; i++) {
      const email = `reader${i}@example.test`;
      await joinStep(code, { action: "send", name: `Reader ${i}`, value: email, locale: "en" });
      const verified = await joinStep(code, { action: "verify", name: `Reader ${i}`, value: email, locale: "en", code: codeMailed(email) });
      expect(verified.status).toBe(200);
    }

    const email31 = "reader-over-the-cap@example.test";
    await joinStep(code, { action: "send", name: "Over", value: email31, locale: "en" });
    const capped = await joinStep(code, { action: "verify", name: "Over", value: email31, locale: "en", code: codeMailed(email31) });
    expect(capped.status).toBe(429);
    expect(capped.json).toMatchObject({ error: "rate_limited" });

    const { getContactByEmail } = await import("@/lib/contacts");
    expect(await getContactByEmail(OWNER, email31)).toBeNull();

    // The refusal came before the code was spent: once the window has
    // passed, the same code still works.
    const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
    resetRateLimitsForTests();
    const later = await joinStep(code, { action: "verify", name: "Over", value: email31, locale: "en", code: codeMailed(email31) });
    expect(later.status).toBe(200);
  }, 30_000);
});
