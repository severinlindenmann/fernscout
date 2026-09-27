import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import type { StoredSubscription } from "@/lib/repos/types";

/**
 * B2448 — the one place a push notification actually leaves the server.
 *
 * `lib/push/apns.ts` already has its own dry-run/mocked-http2 tests
 * (`test/push-apns.test.ts`); this file is `lib/push/send.ts`'s own —
 * `web-push` mocked the same way `test/push-apns.test.ts` mocks `node:http2`,
 * so no real push service is ever reached.
 */

let dir: string;

function fakeSub(overrides: Partial<StoredSubscription> = {}): StoredSubscription {
  return {
    username: "ana",
    endpoint: `https://push.example/${Math.random().toString(36).slice(2)}`,
    keys: { p256dh: "p", auth: "a" },
    created: "2026-08-01",
    ...overrides,
  };
}

function writeConfig(features: Record<string, unknown> = {}) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features,
    }),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-push-send-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-push-send-data-"));
  process.env.VAPID_PUBLIC_KEY = "pub";
  process.env.VAPID_PRIVATE_KEY = "priv";
  process.env.VAPID_SUBJECT = "mailto:test@example.test";
  writeConfig({ push: { enabled: true } });
});

afterEach(async () => {
  vi.doUnmock("web-push");
  vi.doUnmock("@/lib/push");
  vi.resetModules();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("sendPush — web subscriptions", () => {
  test("sends the rendered notice to every subscription and counts it", async () => {
    const sent: unknown[] = [];
    vi.doMock("web-push", () => ({
      default: {
        setVapidDetails: () => undefined,
        sendNotification: async (sub: unknown, payload: string) => {
          sent.push({ sub, payload });
        },
      },
      WebPushError: class WebPushError extends Error {
        statusCode?: number;
        body?: string;
      },
    }));
    const { sendPush } = await import("@/lib/push/send");
    const a = fakeSub();
    const b = fakeSub();

    const outcome = await sendPush({
      template: "news.push",
      subscriptions: [a, b],
      title: "Two Backpacks",
      body: "New day published: Hoi An",
      url: "https://t.test/ana/day/hoi-an",
      tag: "day-hoi-an",
      locale: "en",
    });

    expect(outcome).toEqual({ sent: 2, pruned: 0 });
    expect(sent).toHaveLength(2);
    const payload = JSON.parse((sent[0] as { payload: string }).payload);
    expect(payload).toEqual({
      title: "Two Backpacks",
      body: "New day published: Hoi An",
      url: "https://t.test/ana/day/hoi-an",
      tag: "day-hoi-an",
    });
  });

  test("a 410 prunes the subscription rather than counting as sent", async () => {
    vi.doMock("web-push", () => ({
      default: {
        setVapidDetails: () => undefined,
        sendNotification: async () => {
          const err = new Error("gone") as Error & { statusCode: number };
          err.statusCode = 410;
          throw err;
        },
      },
      WebPushError: class WebPushError extends Error {
        statusCode?: number;
        body?: string;
      },
    }));
    const removeSpy = vi.fn(async () => undefined);
    vi.doMock("@/lib/push", async () => {
      const actual = await vi.importActual<typeof import("@/lib/push")>("@/lib/push");
      return { ...actual, removeSubscriptions: removeSpy };
    });
    const { sendPush } = await import("@/lib/push/send");
    const sub = fakeSub();

    const outcome = await sendPush({
      template: "news.push",
      subscriptions: sub,
      title: "T",
      body: "B",
      url: "https://t.test/x",
      tag: "day-x",
      locale: "en",
    });

    expect(outcome).toEqual({ sent: 0, pruned: 1 });
    expect(removeSpy).toHaveBeenCalledWith("ana", [sub.endpoint]);
  });

  test("no VAPID environment: sends nothing and never throws", async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const sendNotification = vi.fn();
    vi.doMock("web-push", () => ({
      default: { setVapidDetails: () => undefined, sendNotification },
      WebPushError: class WebPushError extends Error {},
    }));
    const { sendPush } = await import("@/lib/push/send");

    const outcome = await sendPush({
      template: "news.push",
      subscriptions: fakeSub(),
      title: "T",
      body: "B",
      url: "https://t.test/x",
      tag: "day-x",
      locale: "en",
    });

    expect(outcome).toEqual({ sent: 0, pruned: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test("push switched off in config: sends nothing even with VAPID env set", async () => {
    writeConfig({ push: { enabled: false } });
    const sendNotification = vi.fn();
    vi.doMock("web-push", () => ({
      default: { setVapidDetails: () => undefined, sendNotification },
      WebPushError: class WebPushError extends Error {},
    }));
    const { sendPush } = await import("@/lib/push/send");

    const outcome = await sendPush({
      template: "news.push",
      subscriptions: fakeSub(),
      title: "T",
      body: "B",
      url: "https://t.test/x",
      tag: "day-x",
      locale: "en",
    });

    expect(outcome).toEqual({ sent: 0, pruned: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test("no subscriptions: a no-op, not an error", async () => {
    const { sendPush } = await import("@/lib/push/send");
    const outcome = await sendPush({
      template: "news.push",
      subscriptions: [],
      title: "T",
      body: "B",
      url: "https://t.test/x",
      tag: "day-x",
      locale: "en",
    });
    expect(outcome).toEqual({ sent: 0, pruned: 0 });
  });
});

describe("sendPush — apns subscriptions", () => {
  test("dry-run backend counts as sent and writes nothing to web-push", async () => {
    const sendNotification = vi.fn();
    vi.doMock("web-push", () => ({
      default: { setVapidDetails: () => undefined, sendNotification },
      WebPushError: class WebPushError extends Error {},
    }));
    const { sendPush } = await import("@/lib/push/send");
    const sub = fakeSub({ kind: "apns", endpoint: "device-token" });

    const outcome = await sendPush({
      template: "news.push",
      subscriptions: sub,
      title: "T",
      body: "B",
      url: "https://t.test/x",
      tag: "day-x",
      locale: "en",
    });

    expect(outcome).toEqual({ sent: 1, pruned: 0 });
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("localeForSubscriber", () => {
  test("an anonymous subscription (no contactId) is always en", async () => {
    const { localeForSubscriber } = await import("@/lib/push/send");
    expect(await localeForSubscriber("ana", fakeSub({ contactId: null }))).toBe("en");
  });

  test("no database: falls back to en rather than throwing", async () => {
    delete process.env.DATABASE_URL;
    const { localeForSubscriber } = await import("@/lib/push/send");
    expect(await localeForSubscriber("ana", fakeSub({ contactId: "some-id" }))).toBe("en");
  });
});
