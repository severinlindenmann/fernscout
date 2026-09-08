import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * A statement, over the network, the way an agent does it — B677.
 *
 * The properties worth asserting are the ones that keep a person in the loop:
 * reading a statement writes **nothing**, the kind must be named, and the
 * second call is the only thing that puts money on a day.
 *
 * Every amount and merchant is invented.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP = "algarve-2026";

let dir: string;
let calls = 0;

const tripPath = () => path.join(dir, OWNER, "trips", TRIP);

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.9.0.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

const STATEMENT = [
  "Personal · CHF (CHF)",
  "Date,Description,Category,Money in/out,Money in/out,Balance",
  '"Jun 22, 2026",Padaria Central,Restaurants,-€12.40,-11.65 CHF,1000.00 CHF',
  '"Jun 23, 2026",Hotel Boa Vista,Travel,-240.00 CHF,-240.00 CHF,760.00 CHF',
  '"Jul 09, 2026",Rent,Housing,-1400.00 CHF,-1400.00 CHF,100.00 CHF',
  "Total,,,,,",
].join("\n");

async function importCall(token: string, body: unknown) {
  const { POST } = await import("@/app/api/v1/[user]/import/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/import`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

async function applyCall(token: string, body: unknown, trip = TRIP) {
  const { POST } = await import("@/app/api/v1/[user]/trips/[trip]/costs/import/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/trips/${trip}/costs/import`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip }) },
  );
  return { status: response.status, body: await response.json() };
}

function writeDay(date: string, slug: string, time?: string) {
  fs.writeFileSync(
    path.join(tripPath(), "entries", `${date}-${slug}.md`),
    [
      "---",
      `title: "${slug}"`,
      `date: "${date}"`,
      ...(time ? [`time: "${time}"`] : []),
      'location: "Lagos"',
      'country: "Portugal"',
      "status: draft",
      "---",
      "",
      "Words.",
      "",
    ].join("\n"),
  );
}

function dayText(date: string, slug: string): string {
  return fs.readFileSync(path.join(tripPath(), "entries", `${date}-${slug}.md`), "utf8");
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-costs-import-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "66".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, costs: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(tripPath(), "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true }, costs: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(tripPath(), "trip.md"),
    [
      "---",
      `id: "${TRIP}"`,
      'title: "The Algarve"',
      'start: "2026-06-22"',
      'end: "2026-06-24"',
      'status: "past"',
      'visibility: "private"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
  writeDay("2026-06-22", "arriving", "18:00");
  writeDay("2026-06-22", "the-flight", "07:00");
  writeDay("2026-06-23", "the-cliffs");

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the whole file, kept in written order", { shuffle: false }, () => {
  describe("reading a statement", () => {
    test("the kind must be named, now that there are two", async () => {
      // Reading somebody's bank statement as positions is not a mistake to make
      // quietly, and it was one word away while `gps` was the only kind.
      const token = await ownerToken();
      const { status, body } = await importCall(token, { text: STATEMENT });
      expect(status).toBe(400);
      expect(body.error).toBe("unknown_kind");
      expect(body.message).toMatch(/gps, costs/);
    });

    test("reads the statement and writes nothing", async () => {
      const token = await ownerToken();
      const before = fs.readdirSync(path.join(tripPath(), "entries")).map(dayOf);
      const { status, body } = await importCall(token, { kind: "costs", text: STATEMENT });
      expect(status).toBe(200);
      expect(body.format).toBe("revolut");
      expect(body.spending.payments).toBe(3);
      // Nothing on disk moved: no day gained a cost, and no costs.md appeared.
      expect(fs.readdirSync(path.join(tripPath(), "entries")).map(dayOf)).toEqual(before);
      expect(fs.existsSync(path.join(tripPath(), "costs.md"))).toBe(false);
    });

    test("the trip's own window drops the rent a fortnight later", async () => {
      const token = await ownerToken();
      const { body } = await importCall(token, {
        kind: "costs",
        text: STATEMENT,
        from: "2026-06-22",
        to: "2026-06-24",
      });
      expect(body.spending.days.map((d: { date: string }) => d.date)).toEqual([
        "2026-06-22",
        "2026-06-23",
      ]);
      expect(JSON.stringify(body)).not.toContain("Rent");
    });

    test("no category comes back, and the answer says why", async () => {
      const token = await ownerToken();
      const { body } = await importCall(token, { kind: "costs", text: STATEMENT });
      expect(JSON.stringify(body.spending)).not.toContain("category");
      expect(body.next).toMatch(/never what it was for/i);
    });

    test("a dryRun is answered rather than silently ignored", async () => {
      // B690. The route's own comment said saying so was more honest than
      // accepting it silently, and then the answer said nothing at all: a
      // caller who sent the flag got an ordinary 200 and could read their whole
      // statement as a no-op. Found by a subagent reviewing the route.
      const token = await ownerToken();
      const { status, body } = await importCall(token, {
        kind: "costs",
        text: STATEMENT,
        dryRun: true,
      });
      expect(status).toBe(200);
      expect(body.dryRun).toBe(false);
      expect(body.note).toMatch(/never writes/);
      // And it is a full read, not a shortened one.
      expect(body.spending.payments).toBe(3);
    });

    test("a costs import with no dryRun says nothing about it", async () => {
      const token = await ownerToken();
      const { body } = await importCall(token, { kind: "costs", text: STATEMENT });
      expect(body.note).toBeUndefined();
      expect(body.dryRun).toBeUndefined();
    });
  });

  describe("putting the agreed rows on the days", () => {
    test("writes each cost on its day, and picks the earliest when a date has two", async () => {
      const token = await ownerToken();
      const { status, body } = await applyCall(token, {
        rows: [
          { date: "2026-06-22", label: "Padaria Central", amount: 11.65, currency: "CHF", category: "food" },
          { date: "2026-06-23", label: "Hotel Boa Vista", amount: 240, currency: "CHF", category: "accommodation" },
        ],
      });
      expect(status).toBe(200);
      expect(body.total).toBe(2);
      // 07:00 rather than the alphabetically-first "arriving" at 18:00.
      expect(body.written.map((w: { slug: string }) => w.slug)).toEqual(["the-flight", "the-cliffs"]);
      expect(dayText("2026-06-22", "the-flight")).toContain("Padaria Central");
      expect(dayText("2026-06-22", "arriving")).not.toContain("Padaria Central");
    });

    test("costs already on the day are kept", async () => {
      const token = await ownerToken();
      const before = dayText("2026-06-23", "the-cliffs");
      expect(before).toContain("Hotel Boa Vista");
      const { body } = await applyCall(token, {
        rows: [{ date: "2026-06-23", label: "Ferry", amount: 9, currency: "CHF", category: "transport" }],
      });
      expect(body.written[0].kept).toBe(1);
      const after = dayText("2026-06-23", "the-cliffs");
      expect(after).toContain("Hotel Boa Vista");
      expect(after).toContain("Ferry");
    });

    test("a date with no day is reported, not attached to the nearest one", async () => {
      const token = await ownerToken();
      const { body } = await applyCall(token, {
        rows: [{ date: "2026-06-24", label: "Petrol", amount: 40, currency: "CHF", category: "transport" }],
      });
      expect(body.total).toBe(0);
      expect(body.orphaned).toEqual([{ date: "2026-06-24", rows: 1 }]);
      expect(body.next).toMatch(/no day written/);
    });

    test("every bad field comes back at once", async () => {
      const token = await ownerToken();
      const { status, body } = await applyCall(token, {
        rows: [
          { date: "Jun 22, 2026", label: "", amount: -5, currency: "€", category: "dinner" },
        ],
      });
      expect(status).toBe(400);
      expect(body.error).toBe("invalid_costs");
      expect(body.problems.map((p: { field: string }) => p.field).sort()).toEqual([
        "amount",
        "category",
        "currency",
        "date",
        "label",
      ]);
    });

    test("a negative amount is refused rather than written as a negative cost", async () => {
      const token = await ownerToken();
      const { body } = await applyCall(token, {
        rows: [{ date: "2026-06-22", label: "Refund", amount: -12, currency: "CHF", category: "food" }],
      });
      expect(body.problems[0]).toMatchObject({ field: "amount" });
    });

    test("an unknown trip is a 404", async () => {
      const token = await ownerToken();
      const { status } = await applyCall(
        token,
        { rows: [{ date: "2026-06-22", label: "x", amount: 1, currency: "CHF", category: "other" }] },
        "never-happened",
      );
      expect(status).toBe(404);
    });
  });

  /** The date part of an entry filename, for comparing the folder before and
   * after a call that should not have touched it. */
  function dayOf(file: string): string {
    return file;
  }
});
