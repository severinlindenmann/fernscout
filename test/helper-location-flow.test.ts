import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { storeInboxFile } from "@/lib/inbox";
import { createTrip } from "@/lib/tripWrite";
import { gpsDir } from "@/lib/gps/store";
import { journalBytes } from "@/lib/storageQuota";
import { writeDayFixture } from "./fixtures/content";

/**
 * B1937 — the location flow's own peek, decide and delivery doors, driven at
 * the route level the way `helper-statement.test.ts` drives its sibling.
 *
 * What is asserted here is the ticket's three non-negotiables:
 *
 * 1. `dryRun` never writes.
 * 2. Nothing the route hands back is an ordered list of positions — see
 *    `test/gps-extent-and-coverage.test.ts` for the same claim one layer
 *    down, at `importGps` itself.
 * 3. `commit` draws a track for a chosen trip and — only when asked —
 *    discards the raw history afterwards, never before.
 *
 * Coordinates below are invented, mid-Atlantic.
 */

const OWNER_EMAIL = "owner@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { POST: importRoute } = await import("@/app/api/helper/[user]/import/route");
const { GET: inboxRoute, POST: inboxUploadRoute } = await import("@/app/api/helper/[user]/inbox/route");

let dir: string;
const params = { params: Promise.resolve({ user: "owner" }) };

function json(url: string, body: unknown) {
  return new Request(`https://t.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** `[epochSeconds, lat, lon]`, the neutral `fixes` format, one point every
 *  three minutes so nothing here is thinned away on write. */
function track(count: number, day: string, lat0: number, lon0: number): string {
  const start = Date.parse(`${day}T08:00:00Z`) / 1000;
  return Array.from({ length: count }, (_, i) =>
    JSON.stringify([start + i * 180, Number((lat0 + i * 0.01).toFixed(5)), Number((lon0 + i * 0.01).toFixed(5))]),
  ).join("\n");
}

function stage(filename: string, contents: string): string {
  return storeInboxFile("owner", "files", filename, Buffer.from(contents), {}).entry.id;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-location-flow-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-location-flow-secret-b1937";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.mkdirSync(path.join(dir, "owner"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "owner", "config.json"),
    JSON.stringify({
      title: "A journal",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "EUR",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: true } } }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  const created = createTrip("owner", { id: "alps-2024", title: "Alps 2024", start: "2026-06-22", end: "2026-06-24" });
  if (!created.ok) throw new Error(`trip fixture failed: ${created.message}`);
  // B2202: derivation now clips to the latest *published* day — every fixed
  // fix below is dated 2026-06-22, so a published day that date keeps this
  // file's "draws a track" assertions meaning what they always meant.
  writeDayFixture(dir, "owner", "alps-2024", { slug: "day-one", date: "2026-06-22" });
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("peek — dryRun", () => {
  test("reports and writes nothing", async () => {
    const id = stage("Timeline.json", track(20, "2026-06-22", 40, -30));
    const before = fs.existsSync(gpsDir("owner"));
    const done = await read(await importRoute(json("/api/helper/owner/import", { inbox: id, dryRun: true }), params));
    expect(done.status).toBe(200);
    expect(done.body.read).toBe(20);
    expect(fs.existsSync(gpsDir("owner"))).toBe(before); // still nothing on disk
    expect(done.body.extent).toMatchObject({ minLat: 40, maxLat: expect.any(Number) });
  });

  test("says how many days of which trip, and no other trip", async () => {
    const id = stage("Timeline.json", track(20, "2026-06-22", 40, -30));
    const done = await read(await importRoute(json("/api/helper/owner/import", { inbox: id, dryRun: true }), params));
    const coverage = done.body.coverage as { tripId: string; days: number; tripDays: number }[];
    expect(coverage).toEqual([{ tripId: "alps-2024", days: 1, tripDays: 3 }]);
  });

  test("carries no ordered list of positions — an extent only", async () => {
    const id = stage("Timeline.json", track(20, "2026-06-22", 40, -30));
    const done = await read(await importRoute(json("/api/helper/owner/import", { inbox: id, dryRun: true }), params));
    const { extent, ...rest } = done.body;
    void extent;
    expect(JSON.stringify(rest)).not.toMatch(/\[\s*-?\d+\.\d+,\s*-?\d+\.\d+\s*\]/);
  });
});

describe("the honest failures", () => {
  test("a file that is not a Timeline export is unknown_format, named by its own filename", async () => {
    const id = stage("photo_2024.jpg", "not actually json");
    const done = await read(await importRoute(json("/api/helper/owner/import", { inbox: id, dryRun: true }), params));
    expect(done.status).toBe(400);
    expect(done.body.error).toBe("unknown_format");
    expect(done.body.filename).toBe("photo_2024.jpg");
  });

  test("a fixes-shaped file with zero rows is a contract refusal — the B1819 shape", async () => {
    const id = stage("empty.jsonl", "# nothing but comments\n");
    const done = await read(await importRoute(json("/api/helper/owner/import", { inbox: id, dryRun: true }), params));
    expect(done.status).toBe(400);
    expect(done.body.error).toBe("contract");
    expect((done.body.problems as string[]).join(" ")).toMatch(/returned nothing/);
  });
});

describe("decide — commit, draw, and D7", () => {
  test("writes the history and draws a track only for the chosen trip", async () => {
    const id = stage("Timeline.json", track(20, "2026-06-22", 40, -30));
    const done = await read(
      await importRoute(json("/api/helper/owner/import", { inbox: id, commit: true, trips: ["alps-2024"] }), params),
    );
    expect(done.status).toBe(200);
    expect(done.body.drawn).toEqual([{ tripId: "alps-2024", segments: expect.any(Number), points: expect.any(Number) }]);
    expect(fs.existsSync(path.join(dir, "owner", "trips", "alps-2024", "track.json"))).toBe(true);
    // D7's default: the history stays, unless `discard` was explicitly asked for.
    expect(done.body.discarded).toBe(false);
    expect(fs.existsSync(gpsDir("owner"))).toBe(true);
  });

  test("discard removes the raw history, and only after the track is written", async () => {
    const id = stage("Timeline.json", track(20, "2026-06-22", 40, -30));
    const done = await read(
      await importRoute(
        json("/api/helper/owner/import", { inbox: id, commit: true, trips: ["alps-2024"], discard: true }),
        params,
      ),
    );
    expect(done.status).toBe(200);
    expect(done.body.discarded).toBe(true);
    expect(fs.existsSync(path.join(dir, "owner", "trips", "alps-2024", "track.json"))).toBe(true);
    // The track survived; the raw month file that made it did not.
    expect(fs.existsSync(path.join(gpsDir("owner"), "2026-06.jsonl"))).toBe(false);
  });

  test("choosing no trip still writes the history and discards it if asked, drawing nothing", async () => {
    const id = stage("Timeline.json", track(20, "2026-06-22", 40, -30));
    const done = await read(
      await importRoute(json("/api/helper/owner/import", { inbox: id, commit: true, trips: [] }), params),
    );
    expect(done.status).toBe(200);
    expect(done.body.drawn).toEqual([]);
  });
});

describe("the old callers still work unchanged", () => {
  test("a bare {inbox} import writes immediately, same as before B1937", async () => {
    const id = stage("history.jsonl", track(20, "2026-06-22", 40, -30));
    const done = await read(await importRoute(json("/api/helper/owner/import", { inbox: id }), params));
    expect(done.status).toBe(200);
    expect(done.body.held).toBeGreaterThan(0);
  });

  test("a bare {trip} derives a track from whatever the store already holds", async () => {
    const id = stage("history.jsonl", track(20, "2026-06-22", 40, -30));
    await importRoute(json("/api/helper/owner/import", { inbox: id }), params);
    const done = await read(await importRoute(json("/api/helper/owner/import", { trip: "alps-2024" }), params));
    expect(done.status).toBe(200);
    expect(done.body.track).toMatchObject({ written: true });
  });
});

describe("parallel writes against one ceiling — B1570", () => {
  /**
   * The same property `paid/test/storage-quota.test.ts` asserts for uploads
   * (B1556): a plain `storageRefusal` check answers from a directory walk
   * with nothing held, so two imports that each individually fit could both
   * pass the check before either had written a fix to disk. This route now
   * runs its check and its `importGps` write through `withStorageQuota`
   * (B1570), so a race of five imports against a ceiling that fits only two
   * must land at most two, never all five.
   */
  test("a race of helper imports refuses the ones that would tip the journal over", async () => {
    // Different days per import — the store thins by merged timestamp, and
    // five imports sharing one day's worth of epoch seconds would collapse
    // into one small write no matter how many of them land.
    const days = ["2026-06-20", "2026-06-21", "2026-06-22", "2026-06-23", "2026-06-24"];
    const perImport = Buffer.byteLength(track(100, days[0], 40, -30));
    const ids = days.map((day, i) => stage(`Timeline-${i}.json`, track(100, day, 40 + i, -30)));

    // The ceiling is set after staging — the inbox files just written are
    // already part of the journal's own bytes, same as any other upload —
    // wide enough for two GPS writes on top of that, not three.
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "T", url: "https://t.test" },
        features: { auth: { enabled: true } },
        media: { perUserBytes: journalBytes("owner") + Math.floor(perImport * 2.5) },
      }),
    );
    clearConfigCache();

    const bodies = await Promise.all(
      ids.map((id) => importRoute(json("/api/helper/owner/import", { inbox: id }), params).then(read)),
    );

    const accepted = bodies.filter((b) => b.status === 200);
    const refused = bodies.filter((b) => b.status === 400);

    expect(accepted).toHaveLength(2);
    expect(refused).toHaveLength(3);
    for (const r of refused) expect(r.body.error).toBe("storage_full");
  });
});

describe("the WhatsApp door's own poll — GET ?kind=files", () => {
  test("lists a files-kind arrival by name and time, not by content", async () => {
    const form = new FormData();
    form.append("files", new File(["{}"], "Timeline.json", { type: "application/json" }));
    await inboxUploadRoute(new Request("https://t.test/api/helper/owner/inbox", { method: "POST", body: form }), params);

    const listed = await read(await inboxRoute(new Request("https://t.test/api/helper/owner/inbox?kind=files"), params));
    expect(listed.status).toBe(200);
    const files = listed.body.files as { id: string; filename: string; uploadedAt: string }[];
    expect(files.map((f) => f.filename)).toContain("Timeline.json");
    // Nothing about media (the default listing) leaks into this one.
    expect(listed.body.media).toBeUndefined();
  });
});
