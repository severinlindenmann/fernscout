import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * A statement, over the network, the way an agent does it — B677, moved to
 * v2 in B1624 (docs/plans/2026-09-12-api-v2/content.md §3).
 *
 * The properties worth asserting are the ones that keep a person in the loop:
 * reading a statement writes **nothing**, and the second call
 * (`costs/apply`) is the only thing that puts money on a day. Staging is now
 * the shared media door (`POST /api/v2/{user}/media`,
 * `intent.kind: "bank_export"`) rather than a door of its own — that half is
 * covered by `test/api-v2-print-inbox.test.ts`; this file keeps the deeper
 * cases the statement importer and `applyCosts` themselves have always had.
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

/** Stage a statement through the v2 media door and answer with the `src` it
 * was filed under. `format` left undeclared so the real importer detects it
 * from the bytes, the same as before this moved off `/import`. */
async function stageStatement(token: string, text = STATEMENT) {
  const { POST } = await import("@/app/api/v2/[user]/media/route");
  const form = new FormData();
  form.append("file", new File([text], "statement.csv", { type: "text/csv" }));
  form.append("intent", JSON.stringify({ kind: "bank_export", trip: TRIP, declined: { format: "let the server detect it" } }));
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/media`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: form,
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const body = await response.json();
  if (response.status !== 201) throw new Error(`stage refused: ${JSON.stringify(body)}`);
  return body.src as string;
}

async function readStatementCall(token: string, src: string) {
  const { GET } = await import("@/app/api/v2/[user]/statements/[src]/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}/statements/${encodeURIComponent(src)}`, {
      headers: headers({ authorization: `Bearer ${token}` }),
    }),
    { params: Promise.resolve({ user: OWNER, src }) },
  );
  return { status: response.status, body: await response.json() };
}

async function applyCall(token: string, body: unknown, trip = TRIP) {
  const { POST } = await import("@/app/api/v2/[user]/trips/[trip]/costs/apply/route");
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/trips/${trip}/costs/apply`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER, trip }) },
  );
  return { status: response.status, body: await response.json() };
}

function writeDay(date: string, slug: string, time?: string) {
  writeDayFixture(dir, OWNER, TRIP, {
    slug,
    date,
    title: slug,
    ...(time ? { time } : {}),
    location: "Lagos",
    country: "Portugal",
    status: "draft",
    content: "Words.",
  });
}

function dayText(date: string, slug: string): string {
  return fs.readFileSync(path.join(tripPath(), "entries", `${date}-${slug}.json`), "utf8");
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
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
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
  writeTripFixture(OWNER, {
    id: TRIP,
    title: "The Algarve",
    start: "2026-06-22",
    end: "2026-06-24",
    status: "past",
    visibility: "private",
    intro: "Intro.",
  });
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
    test("reads the statement and writes nothing", async () => {
      const token = await ownerToken();
      const before = fs.readdirSync(path.join(tripPath(), "entries"));
      const src = await stageStatement(token);
      const { status, body } = await readStatementCall(token, src);
      expect(status).toBe(200);
      expect(body.payments).toHaveLength(3);
      expect(body.src).toBe(src);
      expect(body.trip).toBe(TRIP);
      // Nothing on disk moved: no day gained a cost, and no costs.md appeared.
      expect(fs.readdirSync(path.join(tripPath(), "entries"))).toEqual(before);
      expect(fs.existsSync(path.join(tripPath(), "costs.md"))).toBe(false);
    });

    test("merchants are sorted biggest first, and carry no category", async () => {
      const token = await ownerToken();
      const src = await stageStatement(token);
      const { body } = await readStatementCall(token, src);
      const totals = body.merchants.map((m: { total: number }) => m.total);
      expect(totals).toEqual([...totals].sort((a, b) => b - a));
      expect(JSON.stringify(body.merchants)).not.toContain("category");
    });

    test("an unknown src is refused", async () => {
      const token = await ownerToken();
      const { status, body } = await readStatementCall(token, "inbox:nothing-here.csv");
      expect(status).toBe(404);
      expect(body.error).toBe("unknown_statement");
    });

    test("a trip-scoped token cannot read the journal's statement", async () => {
      const token = await ownerToken();
      const src = await stageStatement(token);
      const { issueCode, verifyCode } = await import("@/lib/auth");
      const { tripWriteScope } = await import("@/lib/tripPeople");
      const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: TRIP });
      const scoped = await verifyCode(OWNER, OWNER_EMAIL, code, "agent", tripWriteScope(TRIP));
      if (!scoped.ok) throw new Error("no scoped token");
      const { status } = await readStatementCall(scoped.token, src);
      expect(status).toBe(403);
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
        rows: [{ date: "Jun 22, 2026", label: "", amount: -5, currency: "€", category: "dinner" }],
      });
      expect(status).toBe(400);
      expect(body.error).toBe("invalid_costs");
      expect(body.details.map((p: { field: string }) => p.field).sort()).toEqual([
        "rows.0.amount",
        "rows.0.category",
        "rows.0.currency",
        "rows.0.date",
        "rows.0.label",
      ]);
    });

    test("a negative amount is refused rather than written as a negative cost", async () => {
      const token = await ownerToken();
      const { body } = await applyCall(token, {
        rows: [{ date: "2026-06-22", label: "Refund", amount: -12, currency: "CHF", category: "food" }],
      });
      expect(body.details[0]).toMatchObject({ field: "rows.0.amount" });
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
});
