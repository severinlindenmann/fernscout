import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode, verifyCode } from "@/lib/auth";
import { flushAfterResponse } from "@/lib/afterResponse";
import { saveSubscription } from "@/lib/push";
import { writeTripFixture, writeDayFixture } from "./fixtures/content";

/**
 * B2448 — a published day now pushes on its own, with a fake `web-push`
 * transport standing in for the real service (the same approach
 * `test/push-apns.test.ts` and `test/push-send.test.ts` already use for
 * `node:http2`/`web-push`), so no real push service is ever reached.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
const TRIP = "reise";

let dir: string;
let sent: { endpoint: string; payload: Record<string, unknown> }[];

function writeServerConfig(opts: { push?: boolean } = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        push: { enabled: opts.push ?? true },
      },
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

function writeTrip(visibility: "public" | "private" = "public") {
  writeTripFixture(OWNER, {
    id: TRIP,
    title: TRIP,
    start: "2026-09-01",
    end: "2026-09-10",
    status: "current",
    visibility,
  });
}

function writeEntry(): { slug: string } {
  const provided: Record<string, boolean> = {
    media: false,
    costs: false,
    coordinates: false,
    weather: false,
    time: false,
    timezone: false,
    location: true,
    country: true,
    countryCode: false,
    transportMode: false,
    tags: false,
    translations: false,
    visibility: false,
  };
  const declined: Record<string, string> = {};
  for (const [field, has] of Object.entries(provided)) {
    if (!has) declined[field] = "n/a for this fixture";
  }
  writeDayFixture(dir, OWNER, TRIP, {
    slug: "lanterns-of-hoi-an",
    date: "2026-09-02",
    title: "Lanterns of Hoi An",
    content: "The old town hangs with lanterns.",
    location: "Hoi An",
    country: "Vietnam",
    status: "draft",
    declined,
  });
  return { slug: "lanterns-of-hoi-an" };
}

function v2SlugFor(): string {
  const entriesDir = path.join(dir, OWNER, "trips", TRIP, "entries");
  const file = fs.readdirSync(entriesDir).find((f) => f.endsWith("-lanterns-of-hoi-an.json"));
  if (!file) throw new Error("no v2 mirror day for lanterns-of-hoi-an — did writeEntry() run?");
  return file.slice(0, -".json".length);
}

async function agentToken(): Promise<string> {
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const verified = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error(`could not mint a token: ${verified.reason}`);
  return verified.token;
}

async function publish(token: string, v2Slug: string) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route");
  const response = await POST(
    new Request(`https://t.test/api/v2/${OWNER}/trips/${TRIP}/days/${v2Slug}/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    { params: Promise.resolve({ user: OWNER, trip: TRIP, slug: v2Slug }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  sent = [];
  vi.doMock("web-push", () => ({
    default: {
      setVapidDetails: () => undefined,
      sendNotification: async (sub: { endpoint: string }, payload: string) => {
        sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      },
    },
    WebPushError: class WebPushError extends Error {
      statusCode?: number;
      body?: string;
    },
  }));

  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-publish-push-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "publish-push-test-secret-publish-push";
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "mailto:test@example.test";
  delete process.env.AUTH_DEV_CODE;

  writeServerConfig();
  writeUserConfig();
  vi.spyOn(console, "log").mockImplementation(() => undefined);

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  vi.doUnmock("web-push");
  // Deliberately no `vi.resetModules()` here: the route is reached through a
  // dynamic `import()` in `publish()` below, and resetting the registry would
  // give a later test's dynamic import a fresh `lib/afterResponse.ts`
  // instance — with its own, separate pending-task set — while this file's
  // statically-imported `flushAfterResponse` keeps pointing at the first
  // instance. They would then be watching two different sets, and a flush
  // would report nothing outstanding while a task was still in flight
  // against an already-closed database.
  for (const key of [
    "CONTENT_DIR",
    "DATA_DIR",
    "DATABASE_URL",
    "SESSION_SECRET",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ]) {
    delete process.env[key];
  }
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("publishing a public day", () => {
  test("sends one push per subscriber, once", async () => {
    writeTrip("public");
    writeEntry();
    await saveSubscription({
      username: OWNER,
      endpoint: "https://push.example/one",
      keys: { p256dh: "p", auth: "a" },
      created: "2026-08-01",
    });
    await saveSubscription({
      username: OWNER,
      endpoint: "https://push.example/two",
      keys: { p256dh: "p", auth: "a" },
      created: "2026-08-01",
    });

    const token = await agentToken();
    const v2Slug = v2SlugFor();
    const { status } = await publish(token, v2Slug);
    expect(status).toBe(200);

    await flushAfterResponse();
    expect(sent.map((s) => s.endpoint).sort()).toEqual([
      "https://push.example/one",
      "https://push.example/two",
    ]);
    expect(sent[0].payload).toEqual({
      title: "Two Backpacks",
      body: "New day published: Lanterns of Hoi An",
      url: `https://example.test/@${OWNER}/trips/${TRIP}/day/${v2Slug}`,
      tag: `day-${v2Slug}`,
    });
  });

  test("resending the same day does not push a second time", async () => {
    writeTrip("public");
    writeEntry();
    await saveSubscription({
      username: OWNER,
      endpoint: "https://push.example/one",
      keys: { p256dh: "p", auth: "a" },
      created: "2026-08-01",
    });

    const token = await agentToken();
    const v2Slug = v2SlugFor();
    await publish(token, v2Slug);
    await flushAfterResponse();
    expect(sent).toHaveLength(1);

    // Publishing again is refused (`already_published`), but the claim this
    // ticket cares about is exercised even by a call that never reaches
    // that check — the retried, concurrent request `dayNotify.ts` documents.
    // Simulate it directly: a second claim attempt on the same channel, keyed
    // by the same v1-style slug the route itself claims with.
    const { claimChannel } = await import("@/lib/digest/dayNotify");
    const { v1Slug } = await import("@/lib/api/v2/days");
    const claimedAgain = await claimChannel(OWNER, TRIP, v1Slug(v2Slug), "push");
    expect(claimedAgain).toBe(false);
  });

  test("without VAPID env, publish still succeeds and pushes nothing", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    writeTrip("public");
    writeEntry();
    await saveSubscription({
      username: OWNER,
      endpoint: "https://push.example/one",
      keys: { p256dh: "p", auth: "a" },
      created: "2026-08-01",
    });

    const token = await agentToken();
    const v2Slug = v2SlugFor();
    const { status } = await publish(token, v2Slug);
    expect(status).toBe(200);

    await flushAfterResponse();
    expect(sent).toHaveLength(0);
  });
});

describe("publishing a private day", () => {
  test("sends no push at all, even to a subscriber", async () => {
    writeTrip("private");
    writeEntry();
    await saveSubscription({
      username: OWNER,
      endpoint: "https://push.example/one",
      keys: { p256dh: "p", auth: "a" },
      created: "2026-08-01",
    });

    const token = await agentToken();
    const v2Slug = v2SlugFor();
    const { status } = await publish(token, v2Slug);
    expect(status).toBe(200);

    await flushAfterResponse();
    expect(sent).toHaveLength(0);
  });
});
