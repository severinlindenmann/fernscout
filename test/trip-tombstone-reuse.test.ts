import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import proxy from "@/proxy";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { createJournal } from "@/lib/journals";
import { createTrip } from "@/lib/tripWrite";
import { renameTrip } from "@/lib/tripRename";
import { tripTombstone } from "@/lib/tombstones";
import { requestDeletion, confirmDeletion } from "@/lib/deletions";
import { resetRateLimitsForTests } from "@/lib/rateLimit";

/**
 * B2672 — a trip made again under a deleted trip's own id must not keep
 * answering 410. Same harness as test/deletions.test.ts and
 * test/trip-rename.test.ts: a real temp content dir, a real sqlite db.
 */

let dir: string;
const OWNER = "owner@example.test";
const USER = "anna";
const DATES = { start: "2027-04-01", end: "2027-04-20" };

function serverConfig(): void {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://t.test" },
      users: { reserved: ["admin"] },
      features: { signup: { inviteOnly: false }, auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-tombstone-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "test-secret-for-trip-tombstone";
  serverConfig();
  clearConfigCache();
  clearUserCache();
  resetRateLimitsForTests();
  await migrateToLatest(await getDatabase());

  const created = createJournal({
    username: USER,
    title: "Anna's journal",
    ownerEmail: OWNER,
    ownerName: "Anna Traveller",
    ownerNickname: "Anna",
  });
  if (!created.ok) throw new Error(created.message);
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeTrip(id: string) {
  const made = createTrip(USER, { id, title: "Daily Updates", ...DATES });
  if (!made.ok) throw new Error(made.message);
  return id;
}

/** Same file-transport mail reading as test/deletions.test.ts's own
 * takeToken(), trimmed to what this file needs. */
function takeToken(): string {
  const mailDir = path.join(dir, "mail", USER);
  const files = fs.readdirSync(mailDir).filter((f) => f.endsWith(".eml")).sort();
  if (files.length !== 1) {
    throw new Error(`expected exactly one unread mail for ${USER}, found ${files.length}`);
  }
  const raw = fs.readFileSync(path.join(mailDir, files[0]), "utf8");
  const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
  if (!boundary) throw new Error("no MIME boundary in the message");
  let body: string | null = null;
  for (const part of raw.split(`--${boundary}`)) {
    if (!/Content-Type: text\/plain/i.test(part)) continue;
    const encoded = part.split(/\r?\n\r?\n/).slice(1).join("\n");
    body = Buffer.from(encoded.replace(/\s/g, ""), "base64").toString("utf8");
    break;
  }
  if (!body) throw new Error("no text/plain part in the message");
  const match = body.match(new RegExp(`/@${USER}/delete/([A-Za-z0-9_-]+)`));
  if (!match) throw new Error(`no deletion link in the mail:\n${body}`);
  fs.unlinkSync(path.join(mailDir, files[0]));
  return match[1];
}

describe("B2672 — a trip id made again clears its own tombstone", () => {
  test("create, delete, create again: no tombstone, and the page is not 410", async () => {
    const id = makeTrip("daily-updates-2026");
    await requestDeletion({ kind: "trip", username: USER, tripId: id });
    await confirmDeletion(USER, takeToken());
    expect(tripTombstone(USER, id)).toMatchObject({ kind: "trip" });

    // While the tombstone stands, the trip answers 410.
    const goneBefore = proxy(new NextRequest(new Request(`https://t.test/@${USER}/trips/${id}`)));
    expect(goneBefore?.status).toBe(410);

    const remade = createTrip(USER, { id, title: "Daily Updates (again)", ...DATES });
    expect(remade.ok).toBe(true);

    expect(tripTombstone(USER, id)).toBeNull();
    const after = proxy(new NextRequest(new Request(`https://t.test/@${USER}/trips/${id}`)));
    expect(after?.status).not.toBe(410);
  });

  test("renaming a trip onto a tombstoned id clears that tombstone", async () => {
    const dying = makeTrip("daily-updates-2026");
    await requestDeletion({ kind: "trip", username: USER, tripId: dying });
    await confirmDeletion(USER, takeToken());
    expect(tripTombstone(USER, dying)).toMatchObject({ kind: "trip" });

    const other = makeTrip("other-trip");
    const renamed = await renameTrip(USER, other, dying);
    expect(renamed).toMatchObject({ ok: true, id: dying });

    expect(tripTombstone(USER, dying)).toBeNull();
    const after = proxy(new NextRequest(new Request(`https://t.test/@${USER}/trips/${dying}`)));
    expect(after?.status).not.toBe(410);
  });
});
