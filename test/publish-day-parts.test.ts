import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { flushAfterResponse } from "@/lib/afterResponse";
import { saveSubscription } from "@/lib/push";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2674 — "Publishing a day in parts" through the studio's own cookie door,
 * POST /api/web/{user}/trips/{trip}/days/{slug}/publish.
 *
 * Same fake `web-push` transport as test/publish-push.test.ts, so a push
 * claim can be counted without reaching a real push service.
 */

let isOwnerMock: ReturnType<typeof vi.fn>;
vi.mock("@/lib/contacts/session", () => ({ isOwner: vi.fn() }));

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TRIP = "reise";
const DATE = "2026-09-02";

let dir: string;
let sent: { endpoint: string }[];

function writeServerConfig() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true }, push: { enabled: true } },
    }),
  );
  clearConfigCache();
}

function writeUserConfig() {
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
}

/** A draft day — blank on every required-or-declined field this suite does
 *  not care about, so the server's own auto-decline is what gets exercised,
 *  not a fixture answering for it. `visibility` is the one field the studio
 *  never declines on the owner's behalf (B2674), so a day meant to publish
 *  cleanly here carries it already answered — as if B2677's Preview page
 *  had set it inline before publishing, same as the real flow will. Open to
 *  everyone the trip lets in, so a public trip's anonymous push subscribers
 *  are not narrowed away by a `visible: false` day. */
function writeDraft(slug: string, opts: { visible?: boolean } = {}) {
  writeDayFixture(dir, OWNER, TRIP, {
    slug,
    date: DATE,
    title: slug,
    content: "Something happened.",
    status: "draft",
    ...(opts.visible ? { declined: { visibility: "shown to everyone the trip lets in" } } : {}),
  });
}

function entryFile(slug: string): string {
  return path.join(dir, OWNER, "trips", TRIP, "entries", `${DATE}-${slug}.json`);
}

function onDisk(slug: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(entryFile(slug), "utf8"));
}

function req(url: string, body: Record<string, unknown>): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function paramsFor(slug: string) {
  return { params: Promise.resolve({ user: OWNER, trip: TRIP, slug }) };
}

beforeEach(async () => {
  sent = [];
  vi.doMock("web-push", () => ({
    default: {
      setVapidDetails: () => undefined,
      sendNotification: async (sub: { endpoint: string }) => {
        sent.push({ endpoint: sub.endpoint });
      },
    },
    WebPushError: class WebPushError extends Error {
      statusCode?: number;
      body?: string;
    },
  }));

  const mod = await import("@/lib/contacts/session");
  isOwnerMock = mod.isOwner as unknown as ReturnType<typeof vi.fn>;
  isOwnerMock.mockResolvedValue(true);

  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-publish-parts-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "publish-parts-test-secret";
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "mailto:test@example.test";

  writeServerConfig();
  writeUserConfig();
  writeTripFixture(OWNER, { id: TRIP, title: "Reise", start: "2026-09-01", end: "2026-09-10", status: "current", visibility: "public" });
  vi.spyOn(console, "log").mockImplementation(() => undefined);

  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  vi.doUnmock("web-push");
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "SESSION_SECRET", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
    delete process.env[key];
  }
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("B2674 — publishing a day of several parts in one call", () => {
  test("three parts, all fine: all published, told once, push claimed once", async () => {
    writeDraft("morning", { visible: true });
    writeDraft("lunch", { visible: true });
    writeDraft("evening", { visible: true });
    await saveSubscription({ username: OWNER, endpoint: "https://push.example/one", keys: { p256dh: "p", auth: "a" }, created: "2026-08-01" });
    await saveSubscription({ username: OWNER, endpoint: "https://push.example/two", keys: { p256dh: "p", auth: "a" }, created: "2026-08-01" });

    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${DATE}-morning/publish`, { parts: ["lunch", "evening"] }),
      paramsFor(`${DATE}-morning`),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { ok: boolean; published: string[]; told: { app: number; mail: number } };
    expect(body.ok).toBe(true);
    expect(body.published.sort()).toEqual([`${DATE}-evening`, `${DATE}-lunch`, `${DATE}-morning`].sort());
    expect(body.told.app).toBe(2);
    expect(body.told.mail).toBe(0);

    expect(onDisk("morning").status).toBe("published");
    expect(onDisk("lunch").status).toBe("published");
    expect(onDisk("evening").status).toBe("published");

    // Push claimed once for the whole day, not once per part — exactly one
    // notification per subscriber, never three.
    await flushAfterResponse();
    expect(sent).toHaveLength(2);
  });

  test("three parts, the second cannot actually publish: nothing published", async () => {
    writeDraft("morning", { visible: true });
    writeDraft("lunch"); // visibility left blank — the one field the studio never declines for itself
    writeDraft("evening", { visible: true });

    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${DATE}-morning/publish`, { parts: ["lunch", "evening"] }),
      paramsFor(`${DATE}-morning`),
    );
    expect(response.status).toBe(422);

    // All or nothing: nothing stays published, including the part(s) that
    // did briefly go up before the failing one was reached.
    expect(onDisk("morning").status).toBe("draft");
    expect(onDisk("lunch").status).toBe("draft");
    expect(onDisk("evening").status).toBe("draft");
  });

  test("declined reasons are per-field, never the old shared sentence", async () => {
    writeDraft("morning", { visible: true });
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${DATE}-morning/publish`, {}), paramsFor(`${DATE}-morning`));
    expect(response.status, await response.clone().text()).toBe(200);

    const day = onDisk("morning") as { declined: Record<string, string> };
    const shared = "left blank when the owner shared this day from the studio (not asked field by field)";
    expect(Object.values(day.declined)).not.toContain(shared);
    // Spot-check a couple of the honest, per-field reasons.
    expect(day.declined.tags).toBe("no tags chosen");
    expect(day.declined.media).toBe("no photographs");
    expect(day.declined.coordinates).toContain("not known");
  });

  test("a blank visibility, with nothing else blank, still answers 422 and writes nothing", async () => {
    writeDraft("morning"); // visibility blank, no parts
    const before = fs.readFileSync(entryFile("morning"), "utf8");
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${DATE}-morning/publish`, {}), paramsFor(`${DATE}-morning`));
    expect(response.status).toBe(422);
    expect(fs.readFileSync(entryFile("morning"), "utf8")).toBe(before);
  });

  test("a part on a different date is refused whole, before anything is written", async () => {
    writeDraft("morning", { visible: true });
    writeDayFixture(dir, OWNER, TRIP, {
      slug: "other-day",
      date: "2026-09-05",
      title: "other-day",
      content: "Something else happened.",
      status: "draft",
      visibility: "guest",
    });
    const before = fs.readFileSync(entryFile("morning"), "utf8");
    const { POST } = await import("@/app/api/web/[user]/trips/[trip]/days/[slug]/publish/route");
    const response = await POST(
      req(`https://t.test/api/web/${OWNER}/trips/${TRIP}/days/${DATE}-morning/publish`, { parts: ["other-day"] }),
      paramsFor(`${DATE}-morning`),
    );
    expect(response.status).toBe(400);
    expect(fs.readFileSync(entryFile("morning"), "utf8")).toBe(before);
    expect(fs.readFileSync(path.join(dir, OWNER, "trips", TRIP, "entries", "2026-09-05-other-day.json"), "utf8")).toContain('"status": "draft"');
  });
});
