import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import {
  dayInboxDir,
  findDayInboxFile,
  findInboxFile,
  inboxDir,
  moveInboxFileToDay,
  storeInboxFile,
} from "@/lib/inbox";

/**
 * The move route B1990 adds, and the delete route's own `?day=` extension —
 * `lib/inbox.ts`'s `moveInboxFileToDay`/`moveInboxFileFromDay`/
 * `removeDayInboxFile` had no owner-cookie door before this.
 */

const OWNER_EMAIL = "alex@example.test";
const OTHER_EMAIL = "sam@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { POST: MOVE } = await import("@/app/api/helper/[user]/inbox/[id]/move/route");
const { DELETE } = await import("@/app/api/helper/[user]/inbox/[id]/route");

let dir: string;

function journalFor(username: string, email: string) {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: username,
      tagline: "t",
      owner: { name: "A B", nickname: "A", email },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
}

function move(user: string, id: string, body: unknown, sourceDay?: string) {
  const qs = sourceDay ? `?day=${encodeURIComponent(sourceDay)}` : "";
  return MOVE(
    new Request(`https://t.test/api/helper/${user}/inbox/${id}/move${qs}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user, id }) },
  );
}

/** A raw body — for the "not a plain object" case, where `JSON.stringify`
 *  of a plain value (`true`, an array, a string) is exactly what a caller
 *  sending malformed JSON might produce. */
function moveRaw(user: string, id: string, rawBody: string, sourceDay?: string) {
  const qs = sourceDay ? `?day=${encodeURIComponent(sourceDay)}` : "";
  return MOVE(
    new Request(`https://t.test/api/helper/${user}/inbox/${id}/move${qs}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
    }),
    { params: Promise.resolve({ user, id }) },
  );
}

function remove(user: string, id: string, day?: string) {
  const qs = day ? `?day=${encodeURIComponent(day)}` : "";
  return DELETE(new Request(`https://t.test/api/helper/${user}/inbox/${id}${qs}`, { method: "DELETE" }), {
    params: Promise.resolve({ user, id }),
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-inbox-move-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true }, helper: { enabled: true } },
    }),
  );
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  journalFor("alex", OWNER_EMAIL);
  journalFor("sam", OTHER_EMAIL);
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("moving a waiting file onto a day", () => {
  test("files it under inbox/days/<date>/<kind>/, sidecar included", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    const response = await move("alex", entry.id, { day: "2026-05-04" });
    expect(response.status).toBe(200);
    expect(findInboxFile("alex", entry.id)).toBeNull();
    expect(findDayInboxFile("alex", "2026-05-04", entry.id)?.entry.id).toBe(entry.id);
    expect(fs.existsSync(path.join(dayInboxDir("alex", "2026-05-04", "media"), `${entry.id}.meta.json`))).toBe(true);
  });

  test("and back to waiting, with ?day= naming the source", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    moveInboxFileToDay("alex", entry.id, "2026-05-04");
    const response = await move("alex", entry.id, { day: null }, "2026-05-04");
    expect(response.status).toBe(200);
    expect(findDayInboxFile("alex", "2026-05-04", entry.id)).toBeNull();
    expect(findInboxFile("alex", entry.id)?.entry.id).toBe(entry.id);
  });

  test("day to a different day composes the two moves", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    moveInboxFileToDay("alex", entry.id, "2026-05-04");
    const response = await move("alex", entry.id, { day: "2026-05-05" }, "2026-05-04");
    expect(response.status).toBe(200);
    expect(findDayInboxFile("alex", "2026-05-04", entry.id)).toBeNull();
    expect(findDayInboxFile("alex", "2026-05-05", entry.id)?.entry.id).toBe(entry.id);
  });

  test("an id naming nothing is 404", async () => {
    const response = await move("alex", "deadbeef-nothing.jpg", { day: "2026-05-04" });
    expect(response.status).toBe(404);
  });
});

describe("who may reach it", () => {
  test("a non-owner gets 404", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    resolveAccess.mockResolvedValue({ email: OTHER_EMAIL });
    const response = await move("alex", entry.id, { day: "2026-05-04" });
    expect(response.status).toBe(404);
  });

  test("no session at all is refused", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    resolveAccess.mockResolvedValue({ email: null });
    const response = await move("alex", entry.id, { day: "2026-05-04" });
    expect(response.status).not.toBe(200);
  });
});

describe("the day is validated strictly", () => {
  test("a malformed destination day is 400, nothing moved", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    const response = await move("alex", entry.id, { day: "05-04-2026" });
    expect(response.status).toBe(400);
    expect(findInboxFile("alex", entry.id)).not.toBeNull();
  });

  test("a path-traversal-shaped day is refused, not joined into a path", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    const response = await move("alex", entry.id, { day: "../../../etc" });
    expect(response.status).toBe(400);
  });

  test("a malformed ?day= source is 400", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    moveInboxFileToDay("alex", entry.id, "2026-05-04");
    const response = await move("alex", entry.id, { day: null }, "not-a-date");
    expect(response.status).toBe(400);
  });

  test("a missing `day` key in the body is 400", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    const response = await move("alex", entry.id, {});
    expect(response.status).toBe(400);
  });

  test("a body that is not a plain object (`true`) is 400, not a thrown 500 — the live bug", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    const response = await moveRaw("alex", entry.id, "true");
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("invalid_json");
    expect(findInboxFile("alex", entry.id)).not.toBeNull();
  });

  test("an array body is 400 too", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    const response = await moveRaw("alex", entry.id, "[]");
    expect(response.status).toBe(400);
  });
});

describe("neither a source nor a destination is a no-op, not a 404", () => {
  test("a waiting file, body {day:null}, no ?day= — the exact live shape — answers 200 with its current state", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    const response = await move("alex", entry.id, { day: null });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: boolean; id: string; day: string | null };
    expect(json).toEqual({ ok: true, id: entry.id, day: null });
    // Nothing actually moved.
    expect(findInboxFile("alex", entry.id)).not.toBeNull();
  });

  test("an id naming nothing at all is still 404, not a false no-op", async () => {
    const response = await move("alex", "deadbeef-nothing.jpg", { day: null });
    expect(response.status).toBe(404);
  });
});

describe("a failed compose restores the file to its source day", () => {
  test("a day-to-day move where the second step fails answers 409 and leaves the file on its source", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    moveInboxFileToDay("alex", entry.id, "2026-05-04");
    // The second step (`moveInboxFileToDay` onto the new destination) fails
    // because the destination's own `media` slot is not a directory it can
    // write into — a real fs error rather than a mock, so the rollback is
    // exercised against the same function the route calls for real.
    fs.mkdirSync(dayInboxDir("alex", "2026-05-05"), { recursive: true });
    fs.writeFileSync(path.join(dayInboxDir("alex", "2026-05-05"), "media"), "not a directory");

    const response = await move("alex", entry.id, { day: "2026-05-05" }, "2026-05-04");
    expect(response.status).toBe(409);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("move_failed");
    // Restored to the source day, not stranded in the flat bucket.
    expect(findDayInboxFile("alex", "2026-05-04", entry.id)?.entry.id).toBe(entry.id);
    expect(findInboxFile("alex", entry.id)).toBeNull();
  });
});

describe("path segments in the id cannot walk out of this journal's own inbox", () => {
  test("a traversal-shaped id resolves to the ordinary 404", async () => {
    storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    const response = await move("alex", "../../sam/inbox/media/beach.jpg", { day: "2026-05-04" });
    expect(response.status).toBe(404);
  });
});

describe("delete gains ?day=", () => {
  test("removes a file staged under a day folder, bytes and sidecar both", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    moveInboxFileToDay("alex", entry.id, "2026-05-04");
    const response = await remove("alex", entry.id, "2026-05-04");
    expect(response.status).toBe(200);
    expect(findDayInboxFile("alex", "2026-05-04", entry.id)).toBeNull();
  });

  test("the flat bucket is untouched by a day-scoped delete for an id sitting elsewhere", async () => {
    const { entry } = storeInboxFile("alex", "media", "still-waiting.jpg", Buffer.from("bytes"), {});
    const response = await remove("alex", entry.id, "2026-05-04");
    expect(response.status).toBe(404);
    expect(fs.existsSync(path.join(inboxDir("alex", "media"), entry.id))).toBe(true);
  });

  test("a malformed ?day= is 400", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    const response = await remove("alex", entry.id, "05-04-2026");
    expect(response.status).toBe(400);
  });

  test("a non-owner gets 404 for a day-scoped delete too", async () => {
    const { entry } = storeInboxFile("alex", "media", "beach.jpg", Buffer.from("bytes"), {});
    moveInboxFileToDay("alex", entry.id, "2026-05-04");
    resolveAccess.mockResolvedValue({ email: OTHER_EMAIL });
    const response = await remove("alex", entry.id, "2026-05-04");
    expect(response.status).toBe(404);
  });
});
