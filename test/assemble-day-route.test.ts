import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { appendWords, writeDayReadiness } from "@/lib/dayReadiness";
import { dayInboxDir, moveInboxFileToDay, storeInboxFile } from "@/lib/inbox";
import { paintJpeg } from "./support/pictures";

/**
 * `POST /api/helper/<user>/assemble-day` — its "create it" press, Task 3 of
 * the SDD plan: inbox day-assembly Phase 3.
 *
 * Task 2 already built the "record an answer" branch this route carries
 * (`recordAnswer` below, unchanged); this file is the other half, which used
 * to always refuse `not_yet_available`. A press naming nothing but
 * `trip`/`date` is what `propose()` sends once nothing is missing, and it
 * should now create the real entry, attach its staged photographs, and
 * remove the day folder — never a second implementation of what `POST
 * .../day` already does, only reached from a date folder instead of a blank
 * screen.
 */

const OWNER_EMAIL = "alex@example.test";
const TRIP = "reise";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const { POST } = await import("@/app/api/helper/[user]/assemble-day/route");

let dir: string;

const params = { params: Promise.resolve({ user: "alex" }) };

function json(body: unknown) {
  return new Request("https://t.test/api/helper/alex/assemble-day", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-assemble-day-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "assemble-day-route-test-secret";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", TRIP, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", TRIP, "trip.md"),
    ["---", `id: ${TRIP}`, 'title: "Die Reise"', 'start: "2026-05-01"', 'end: "2026-05-10"', "---", "", "Intro.", ""].join(
      "\n",
    ),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("assemble-day: the create press", () => {
  test("creates the day from a ready date folder: words, photos, and readiness answers all land on the new entry", async () => {
    const date = "2026-05-04";

    const bytes = await paintJpeg(400, 300);
    const { entry } = storeInboxFile("alex", "media", "pass.jpg", bytes, { caption: "The pass" });
    moveInboxFileToDay("alex", entry.id, date);

    appendWords("alex", date, "We climbed over the pass and it was cold.");
    writeDayReadiness("alex", date, {
      without: ["costs"],
      location: { lat: 46.5, lon: 8.5, source: "browser" },
    });

    const made = await read(await POST(json({ trip: TRIP, date }), params));
    expect(made.status).toBe(201);
    const slug = String(made.body.slug);
    expect(made.body.attached).toBe(1);

    const day = getEntryBySlug(`alex/${TRIP}`, slug, AS_AUTHOR);
    expect(day).not.toBeNull();
    expect(day?.content).toContain("We climbed over the pass and it was cold.");
    expect(day?.gallery).toHaveLength(1);
    expect(day?.without).toEqual(["costs"]);
    expect(day?.lat).toBe(46.5);
    expect(day?.lng).toBe(8.5);
    expect(day?.draft).toBe(true);

    // The day folder's job was staging; a real entry now holds everything it
    // carried, so it is gone.
    expect(fs.existsSync(dayInboxDir("alex", date))).toBe(false);
  });

  test("refuses if something is still missing — the door asks again, same as POST .../day", async () => {
    const date = "2026-05-05";
    // Nothing staged: the trip tracks costs and coordinates by default, and
    // nobody has answered either.

    const refused = await read(await POST(json({ trip: TRIP, date }), params));
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("incomplete_day");
    expect(refused.body.missing).toEqual(["costs", "coordinates"]);

    // And nothing was written — the folder's own honesty about "nothing
    // decided yet" stands, and no entry appeared in the trip.
    const entries = fs.readdirSync(path.join(dir, "alex", "trips", TRIP, "entries"));
    expect(entries).toHaveLength(0);
  });
});
