import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { createTrip } from "@/lib/tripWrite";
import { getTrip } from "@/lib/trips";

/**
 * D10 — a statement line whose date has no day in the trip is filed to the
 * trip's own `costs.items`, never skipped and never dropped —
 * `.claude/runs/2026-09-19-the-studio/spec.md` §7.7, §1.
 *
 * `test/helper-statement.test.ts` already covers the read half of this
 * route; this file is only the new D10 behaviour, kept separate so a
 * regression here names itself rather than getting lost among the twenty
 * pre-existing assertions next door.
 */

const OWNER_EMAIL = "owner@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { POST: applyRoute } = await import("@/app/api/helper/[user]/statement/apply/route");

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

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-statement-orphans-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-statement-orphans-secret-b1822";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.mkdirSync(path.join(dir, "owner"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "owner", "config.json"),
    JSON.stringify({
      title: "A journal",
      tagline: "t",
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
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a line dated outside every day in the trip", () => {
  test("lands on the trip's own costs.items, on a trip with no costs section yet", async () => {
    // Deliberately no `costsVisibility` — this is an ordinary trip, the
    // shape most trips actually have, and `trip.costsSection` starts
    // undefined for it (see `lib/tripWrite.ts`'s own note on that field).
    const created = createTrip("owner", {
      id: "the-islands",
      title: "The islands",
      start: "2026-03-01",
      end: "2026-03-10",
    });
    if (!created.ok) throw new Error(`trip fixture failed: ${created.message}`);
    expect(getTrip("owner/the-islands")?.costsSection).toBeUndefined();

    // No day exists anywhere in the trip, so every row is "no matching day".
    const written = await read(
      await applyRoute(
        json("/api/helper/owner/statement/apply", {
          trip: "the-islands",
          rows: [
            { date: "2026-03-02", label: "Ferry", amount: 24, currency: "EUR", category: "transport" },
            { date: "2026-03-03", label: "Kiosk", amount: 6.5, currency: "EUR", category: "food" },
          ],
        }),
        params,
      ),
    );

    expect(written.status).toBe(200);
    const result = written.body.written as { filedToTrip: { date: string; rows: number }[]; total: number };
    // B1844 — `applyCosts` itself now does this write (it used to only
    // report the dates and leave the trip write to this route), and counts
    // rows filed to the trip in `total` the same as a row written to a day.
    expect(result.filedToTrip).toEqual([
      { date: "2026-03-02", rows: 1 },
      { date: "2026-03-03", rows: 1 },
    ]);
    expect(result.total).toBe(2);

    // The done screen's own count.
    expect(written.body.filedToTrip).toBe(2);

    const trip = getTrip("owner/the-islands");
    expect(trip?.costsSection?.items).toEqual([
      { label: "Ferry", amount: 24, currency: "EUR", category: "transport" },
      { label: "Kiosk", amount: 6.5, currency: "EUR", category: "food" },
    ]);
  });

  test("is appended to whatever the trip's costs.items already held, not replaced", async () => {
    const created = createTrip("owner", {
      id: "the-hills",
      title: "The hills",
      start: "2026-04-01",
      end: "2026-04-05",
      costsVisibility: "guests",
    });
    if (!created.ok) throw new Error(`trip fixture failed: ${created.message}`);
    expect(getTrip("owner/the-hills")?.costsSection).toBeDefined();

    await applyRoute(
      json("/api/helper/owner/statement/apply", {
        trip: "the-hills",
        rows: [{ date: "2026-03-30", label: "Train ticket", amount: 40, currency: "EUR", category: "transport" }],
      }),
      params,
    );
    const first = await applyRoute(
      json("/api/helper/owner/statement/apply", {
        trip: "the-hills",
        rows: [{ date: "2026-04-20", label: "Parking", amount: 12, currency: "EUR", category: "transport" }],
      }),
      params,
    );
    expect((await first.json()).filedToTrip).toBe(1);

    const items = getTrip("owner/the-hills")?.costsSection?.items ?? [];
    expect(items.map((i) => i.label)).toEqual(["Train ticket", "Parking"]);
  });

  test("a row that does land on a day is not also filed to the trip", async () => {
    const created = createTrip("owner", {
      id: "day-exists",
      title: "Day exists",
      start: "2026-05-01",
      end: "2026-05-05",
    });
    if (!created.ok) throw new Error(`trip fixture failed: ${created.message}`);

    const { createDayTransactional } = await import("@/lib/studio/createDay");
    const day = await createDayTransactional("owner", {
      tripId: "day-exists",
      date: "2026-05-02",
      title: "Arrival",
      content: "We arrived.",
      declined: {},
    });
    if (!day.ok) throw new Error("day fixture failed");

    const written = await read(
      await applyRoute(
        json("/api/helper/owner/statement/apply", {
          trip: "day-exists",
          rows: [{ date: "2026-05-02", label: "Lunch", amount: 15, currency: "EUR", category: "food" }],
        }),
        params,
      ),
    );
    expect(written.body.filedToTrip).toBe(0);
    expect(getTrip("owner/day-exists")?.costsSection?.items ?? []).toEqual([]);
  });
});
