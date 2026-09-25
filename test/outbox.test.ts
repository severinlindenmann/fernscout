import { describe, expect, it } from "vitest";
import { decideReplay, runOutbox, newIntent, pendingDayDates, type OutboxIntent, type OutboxStore } from "@/lib/outbox";

/** An in-memory `OutboxStore` — no IndexedDB in the Vitest node environment,
 *  and the whole point of splitting the module is that the runner never
 *  needs to know the difference. */
function memoryStore(seed: OutboxIntent[]): OutboxStore & { rows: OutboxIntent[] } {
  const rows = [...seed];
  return {
    rows,
    async list(user) {
      // A real IndexedDB read deserialises into fresh objects — structured
      // clone, not the stored reference — so a test that returned the same
      // object `runOutbox` mutates elsewhere (`remapMediaId`) would pass by
      // accident, on a form of sharing IndexedDB never gives it.
      return rows
        .filter((r) => r.user === user)
        .map((r) => structuredClone(r))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async add(intent) {
      rows.push(intent);
    },
    async remove(id) {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
    async setState(id, state) {
      const row = rows.find((r) => r.id === id);
      if (row) row.state = state;
    },
    async clear(user) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].user === user) rows.splice(i, 1);
    },
    async remapMediaId(user, placeholderId, realId) {
      for (const row of rows) {
        if (row.user !== user || !row.body || typeof row.body !== "object") continue;
        const ids = (row.body as { mediaInboxIds?: unknown }).mediaInboxIds;
        if (Array.isArray(ids) && ids.includes(placeholderId)) {
          row.body = { ...row.body, mediaInboxIds: ids.map((id) => (id === placeholderId ? realId : id)) };
        }
      }
    },
  };
}

function uploadIntent(over: Partial<OutboxIntent> = {}): OutboxIntent {
  return {
    ...newIntent({
      user: "severin",
      kind: "media.upload",
      method: "POST",
      url: "/api/helper/severin/inbox",
      body: { placeholderId: "pending-1", filename: "IMG_1.jpg" },
      blob: new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" }),
      ...over,
    }),
    ...(over.id ? { id: over.id } : {}),
    ...(over.createdAt ? { createdAt: over.createdAt } : {}),
  };
}

function dayIntent(over: Partial<OutboxIntent> = {}): OutboxIntent {
  return {
    ...newIntent({
      user: "severin",
      kind: "day.new",
      method: "POST",
      url: "/api/helper/severin/day/new",
      body: { trip: "japan-2026", date: "2026-04-02", title: "Kyoto" },
      ...over,
    }),
    ...(over.id ? { id: over.id } : {}),
    ...(over.createdAt ? { createdAt: over.createdAt } : {}),
  };
}

function scriptedFetch(responses: { status: number; body: unknown }[] | (() => never)) {
  let i = 0;
  return async (): Promise<Response> => {
    if (typeof responses === "function") responses();
    const r = (responses as { status: number; body: unknown }[])[i++];
    return {
      status: r.status,
      json: async () => r.body,
    } as Response;
  };
}

describe("decideReplay (pure core)", () => {
  const intent = dayIntent();

  it("2xx is done", () => {
    expect(decideReplay(201, { ok: true }, intent).action).toBe("done");
    expect(decideReplay(200, {}, intent).action).toBe("done");
  });

  it("409 with a matching existing day is done — a retried success", () => {
    const body = { error: "date_has_day", existing: { date: "2026-04-02", title: "Kyoto" } };
    expect(decideReplay(409, body, intent).action).toBe("done");
  });

  it("409 with a different existing day is a conflict", () => {
    const body = { error: "date_has_day", existing: { date: "2026-04-02", title: "Osaka" } };
    expect(decideReplay(409, body, intent).action).toBe("conflict");
  });

  it("401/403 pause the queue", () => {
    expect(decideReplay(401, {}, intent).action).toBe("pause");
    expect(decideReplay(403, {}, intent).action).toBe("pause");
  });

  it("network error (status 0) and 5xx are retried later", () => {
    expect(decideReplay(0, null, intent).action).toBe("retry");
    expect(decideReplay(503, {}, intent).action).toBe("retry");
  });
});

describe("runOutbox", () => {
  it("201 removes the intent and counts it done", async () => {
    const store = memoryStore([dayIntent()]);
    const outcome = await runOutbox(store, "severin", scriptedFetch([{ status: 201, body: { ok: true } }]));
    expect(outcome).toEqual({ done: 1, conflicts: 0, paused: false, stoppedForRetry: false });
    expect(store.rows).toHaveLength(0);
  });

  it("409-same removes the intent, same as a 2xx", async () => {
    const intent = dayIntent();
    const store = memoryStore([intent]);
    const fetchImpl = scriptedFetch([
      { status: 409, body: { error: "date_has_day", existing: { date: intent.body && (intent.body as { date: string }).date, title: "Kyoto" } } },
    ]);
    const outcome = await runOutbox(store, "severin", fetchImpl);
    expect(outcome.done).toBe(1);
    expect(outcome.conflicts).toBe(0);
    expect(store.rows).toHaveLength(0);
  });

  it("409-stale keeps the intent as a conflict, not dropped", async () => {
    const store = memoryStore([dayIntent()]);
    const fetchImpl = scriptedFetch([
      { status: 409, body: { error: "date_has_day", existing: { date: "2026-04-02", title: "Someone else's day" } } },
    ]);
    const outcome = await runOutbox(store, "severin", fetchImpl);
    expect(outcome.done).toBe(0);
    expect(outcome.conflicts).toBe(1);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].state).toBe("conflict");
  });

  it("401 pauses the whole queue and drops nothing, including later intents", async () => {
    const store = memoryStore([dayIntent(), dayIntent({ id: "second" })]);
    const fetchImpl = scriptedFetch([{ status: 401, body: {} }]);
    const outcome = await runOutbox(store, "severin", fetchImpl);
    expect(outcome.paused).toBe(true);
    expect(outcome.done).toBe(0);
    // Both intents are still pending — the second was never even attempted.
    expect(store.rows).toHaveLength(2);
    expect(store.rows.every((r) => r.state === "pending")).toBe(true);
  });

  it("a network error stops the pass, leaving the intent pending for the next run", async () => {
    const store = memoryStore([dayIntent()]);
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };
    const outcome = await runOutbox(store, "severin", fetchImpl);
    expect(outcome.stoppedForRetry).toBe(true);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].state).toBe("pending");
  });

  it("processes intents in order, one at a time, and only touches its own user", async () => {
    const mine = dayIntent({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" });
    const mineToo = dayIntent({ id: "b", createdAt: "2026-01-02T00:00:00.000Z" });
    const someoneElse = dayIntent({ id: "c", user: "viki" });
    const store = memoryStore([mineToo, mine, someoneElse]);
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request): Promise<Response> => {
      calls.push(String(url));
      return { status: 201, json: async () => ({ ok: true }) } as Response;
    };
    const outcome = await runOutbox(store, "severin", fetchImpl);
    expect(outcome.done).toBe(2);
    expect(store.rows).toEqual([someoneElse]);
    expect(calls).toHaveLength(2);
  });
});

/** B2330 — a day written offline alongside its own photographs: two
 *  `media.upload` intents queued first (one per photo, phone-chosen
 *  placeholder ids), then a `day.new` intent whose `mediaInboxIds` still
 *  names those placeholders. The whole point of `remapMediaId` is that the
 *  day intent never has to be re-created once the uploads land. */
describe("a day queued with its photographs (B2330)", () => {
  it("uploads replay before the day, and the day's placeholder ids are rewritten to the server's real ones", async () => {
    const photo1 = uploadIntent({
      id: "up1",
      createdAt: "2026-01-01T00:00:00.000Z",
      body: { placeholderId: "pending-1", filename: "a.jpg" },
    });
    const photo2 = uploadIntent({
      id: "up2",
      createdAt: "2026-01-01T00:00:01.000Z",
      body: { placeholderId: "pending-2", filename: "b.jpg" },
    });
    const day = dayIntent({
      id: "day1",
      createdAt: "2026-01-01T00:00:02.000Z",
      body: { trip: "japan-2026", date: "2026-04-02", title: "Kyoto", mediaInboxIds: ["pending-1", "pending-2"] },
    });
    const store = memoryStore([day, photo1, photo2]);
    const calls: { url: string; body: BodyInit | null | undefined }[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ?? null });
      if (u.endsWith("/inbox")) {
        const realId = calls.length === 1 ? "real-1" : "real-2";
        return { status: 201, json: async () => ({ ok: true, items: [{ id: realId }] }) } as Response;
      }
      return { status: 201, json: async () => ({ ok: true, slug: "2026-04-02-kyoto" }) } as Response;
    };
    const outcome = await runOutbox(store, "severin", fetchImpl);
    expect(outcome).toEqual({ done: 3, conflicts: 0, paused: false, stoppedForRetry: false });
    expect(store.rows).toHaveLength(0);
    // Order: both uploads (multipart, not JSON) before the day.
    expect(calls[0].url).toBe("/api/helper/severin/inbox");
    expect(calls[0].body).toBeInstanceOf(FormData);
    expect(calls[1].url).toBe("/api/helper/severin/inbox");
    expect(calls[2].url).toBe("/api/helper/severin/day/new");
    const dayBody = JSON.parse(calls[2].body as string);
    expect(dayBody.mediaInboxIds).toEqual(["real-1", "real-2"]);
  });

  it("a media upload stuck on retry stops the pass before the day it belongs to is ever sent", async () => {
    const photo = uploadIntent({ id: "up1", createdAt: "2026-01-01T00:00:00.000Z" });
    const day = dayIntent({
      id: "day1",
      createdAt: "2026-01-01T00:00:01.000Z",
      body: { trip: "japan-2026", date: "2026-04-02", mediaInboxIds: ["pending-1"] },
    });
    const store = memoryStore([photo, day]);
    const fetchImpl = async (): Promise<Response> => {
      throw new TypeError("Failed to fetch");
    };
    const outcome = await runOutbox(store, "severin", fetchImpl);
    expect(outcome.stoppedForRetry).toBe(true);
    expect(outcome.done).toBe(0);
    // Both still pending, in their original order — the day never jumped ahead.
    expect(store.rows.map((r) => r.id)).toEqual(["up1", "day1"]);
  });
});

describe("pendingDayDates", () => {
  it("lists the dates of pending day.new intents, ignoring other kinds and other owners", async () => {
    const store = memoryStore([
      dayIntent({ id: "a", body: { trip: "t", date: "2026-04-02" } }),
      dayIntent({ id: "b", body: { trip: "t", date: "2026-04-03" } }),
      uploadIntent({ id: "c" }),
      dayIntent({ id: "d", user: "viki", body: { trip: "t", date: "2026-04-04" } }),
    ]);
    const dates = await pendingDayDates(store, "severin");
    expect(dates).toEqual(new Set(["2026-04-02", "2026-04-03"]));
  });
});
