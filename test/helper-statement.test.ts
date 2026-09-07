import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { balanceOf, grant } from "@/lib/credits";
import { clearIdempotencyStore } from "@/lib/idempotency";
import { buildStatementPrompt, STATEMENT_SYSTEM_PROMPT } from "@/lib/helper/model";
import { applyMapping, readTable, statementSample, type ColumnMapping } from "@/importers/costs/mapping";
import { storeInboxFile } from "@/lib/inbox";
import { issueCode, verifyCode } from "@/lib/auth";
import { POST as createTripRoute } from "@/app/api/v1/[user]/trips/route";

/**
 * Reading a file somebody handed over — B689.
 *
 * **Nothing here reaches a network**, and the shape of the assertions is the
 * point of the feature rather than incidental to it:
 *
 * - a location export makes **no model call at all** — the importers already
 *   read it, and a model asked about it would be a bill for an answer this
 *   repository already has;
 * - a statement's **header row and five sample rows** are the whole of what
 *   would leave, and row six of a two-thousand-row file appears in no prompt;
 * - **one call for the whole file**, whatever its length: the mapping comes
 *   back once and code applies it to every row;
 * - consent to send **words** is not consent to send a **bank statement**;
 * - the capability off is a 404, not a 500.
 */

const OWNER_EMAIL = "owner@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { mapStatementColumns } = vi.hoisted(() => ({ mapStatementColumns: vi.fn() }));
vi.mock("@/lib/helper/model", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/helper/model")>()),
  mapStatementColumns,
}));

const { POST } = await import("@/app/api/helper/[user]/statement/route");
const { POST: applyRoute } = await import("@/app/api/helper/[user]/statement/apply/route");
const { POST: importRoute } = await import("@/app/api/helper/[user]/import/route");
const { POST: consentRoute } = await import("@/app/api/helper/[user]/consent/route");

/** An invented bank. Two date columns, a European decimal comma and no minus
 *  sign on the way out — every ambiguity the mapping exists to settle. */
const HEADER = "Booking date,Value date,Text,Turnover,Cur.,Account";
const STATEMENT_ROWS = [
  "04.03.2026,05.03.2026,Kiosk am Hafen,12,40,EUR,Everyday",
  "04.03.2026,05.03.2026,Fährticket,6,00,EUR,Everyday",
  "05.03.2026,06.03.2026,Pension Seeblick,74,00,EUR,Everyday",
  "06.03.2026,07.03.2026,Bäckerei,4,20,EUR,Everyday",
  "07.03.2026,08.03.2026,Tankstelle,52,10,EUR,Everyday",
];

/** The commas inside the amounts would be read as delimiters, so the amount
 *  cell is quoted the way a real export quotes it. */
function line(row: string): string {
  const cells = row.split(",");
  return [cells[0], cells[1], cells[2], `"${cells[3]},${cells[4]}"`, cells[5], cells[6]].join(",");
}

const STATEMENT = [HEADER, ...STATEMENT_ROWS.map(line)].join("\n");

const MAPPING: ColumnMapping = {
  date: "Booking date",
  amount: "Turnover",
  description: "Text",
  currency: "Cur.",
  account: "Account",
  dateFormat: "DD.MM.YYYY",
  decimalComma: true,
  outgoingPositive: true,
};

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

function writeConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features }),
  );
  clearConfigCache();
  clearUserCache();
}

/** A file in the inbox, and the id it took. */
function stage(filename: string, contents: string): string {
  return storeInboxFile("owner", "files", filename, Buffer.from(contents), {}).entry.id;
}

async function consentTo(scope: string) {
  await consentRoute(json("/api/helper/owner/consent", { scope }), params);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-statement-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-statement-secret-b689";
  process.env.ANTHROPIC_API_KEY = "not-a-real-key";
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
  mapStatementColumns.mockReset();
  mapStatementColumns.mockResolvedValue({ mapping: MAPPING, notes: [] });
  clearIdempotencyStore();

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
  writeConfig({
    auth: { enabled: true },
    credits: { enabled: true },
    helper: { enabled: true },
  });
  await migrateToLatest(await getDatabase());
  await grant("owner", 10);

  const { code } = await issueCode("owner", OWNER_EMAIL, "agent");
  const verified = await verifyCode("owner", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no token");
  await createTripRoute(
    new Request("https://t.test/api/v1/owner/trips", {
      method: "POST",
      headers: { authorization: `Bearer ${verified.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        id: "the-islands",
        title: "The islands",
        start: "2026-03-01",
        end: "2026-03-31",
      }),
    }),
    params,
  );
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the mapping, applied by code", () => {
  test("the sample is the header and five rows, and nothing else", () => {
    const long = [HEADER, ...Array.from({ length: 2000 }, () => line(STATEMENT_ROWS[0]))].join("\n");
    const sample = statementSample(long, 5)!;
    expect(sample.header).toEqual(HEADER.split(","));
    expect(sample.rows).toHaveLength(5);
  });

  test("every row in the file is read, not only the sampled ones", () => {
    const long = [HEADER, ...Array.from({ length: 2000 }, () => line(STATEMENT_ROWS[0]))].join("\n");
    expect(readTable(long)!.rows).toHaveLength(2000);
    expect(applyMapping(long, MAPPING)).toHaveLength(2000);
  });

  test("the confirmed format decides the day, and the sign is flipped", () => {
    const rows = applyMapping(STATEMENT, MAPPING);
    expect(rows[0]).toMatchObject({
      date: "2026-03-04",
      amount: -12.4,
      currency: "EUR",
      description: "Kiosk am Hafen",
    });
    // Day-first was confirmed; month-first is a different day from the same
    // cell, which is why this is a field somebody agrees to.
    expect(applyMapping(STATEMENT, { ...MAPPING, dateFormat: "MM/DD/YYYY" })[0].date).toBe(
      "2026-04-03",
    );
  });

  test("a mapping naming a column the file does not have reads nothing", () => {
    expect(applyMapping(STATEMENT, { ...MAPPING, amount: "Betrag" })).toEqual([]);
  });
});

describe("what the model is told", () => {
  test("the prompt carries the header and the sample, and no other row", () => {
    const long = [HEADER, ...STATEMENT_ROWS.map(line), line("09.03.2026,,Row six,99,99,EUR,Everyday")].join("\n");
    const prompt = buildStatementPrompt(statementSample(long, 5)!);
    expect(prompt).toContain("Booking date");
    expect(prompt).toContain("Kiosk am Hafen");
    expect(prompt).not.toContain("Row six");
  });

  test("the system prompt still forbids categorising and inventing a column", () => {
    expect(STATEMENT_SYSTEM_PROMPT).toMatch(/never categorise anything/i);
    expect(STATEMENT_SYSTEM_PROMPT).toMatch(/never return a column name you cannot see/i);
  });

  test("one call for a two-thousand-row statement, and only the sample in it", async () => {
    await consentTo("statement");
    const long = [
      HEADER,
      ...STATEMENT_ROWS.map(line),
      ...Array.from({ length: 1995 }, (_, i) => line(`09.03.2026,,Row ${i + 6},1,00,EUR,Everyday`)),
    ].join("\n");
    const id = stage("export.csv", long);
    const answer = await read(await POST(json("/api/helper/owner/statement", { inbox: id }), params));

    expect(answer.status).toBe(200);
    expect(mapStatementColumns).toHaveBeenCalledTimes(1);
    const [sample] = mapStatementColumns.mock.calls[0];
    expect(sample.rows).toHaveLength(5);
    expect(JSON.stringify(sample)).not.toContain("Row 100");
  });
});

describe("consent is per scope", () => {
  test("having said yes to words is not having said yes to a statement", async () => {
    await consentTo("words");
    const id = stage("export.csv", STATEMENT);
    const refused = await read(await POST(json("/api/helper/owner/statement", { inbox: id }), params));
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("consent_required");
    expect(mapStatementColumns).not.toHaveBeenCalled();
    expect(await balanceOf("owner")).toBe(10);
  });
});

describe("what it costs", () => {
  test("one credit, once, and a retry under the same key is free", async () => {
    await consentTo("statement");
    const id = stage("export.csv", STATEMENT);
    await POST(json("/api/helper/owner/statement", { inbox: id, idempotency_key: "k" }), params);
    expect(await balanceOf("owner")).toBe(9);
    await POST(json("/api/helper/owner/statement", { inbox: id, idempotency_key: "k" }), params);
    expect(await balanceOf("owner")).toBe(9);
    expect(mapStatementColumns).toHaveBeenCalledTimes(1);
  });

  test("a model that fails gives the credit back", async () => {
    await consentTo("statement");
    mapStatementColumns.mockRejectedValue(new Error("no"));
    const id = stage("export.csv", STATEMENT);
    const failed = await read(await POST(json("/api/helper/owner/statement", { inbox: id }), params));
    expect(failed.status).toBe(502);
    expect(await balanceOf("owner")).toBe(10);
  });

  test("the capability off is a 404, not a fault", async () => {
    writeConfig({ auth: { enabled: true }, credits: { enabled: true } });
    const id = stage("export.csv", STATEMENT);
    const off = await read(await POST(json("/api/helper/owner/statement", { inbox: id }), params));
    expect(off.status).toBe(404);
    expect(off.body.error).toBe("helper_unavailable");
    expect(mapStatementColumns).not.toHaveBeenCalled();
  });
});

describe("a location export", () => {
  /** `[epochSeconds, lat, lon]`, the neutral format `importers/gps/fixes.ts`
   *  takes. Invented coordinates in the middle of an ocean. */
  const TRACK = Array.from({ length: 40 }, (_, i) =>
    JSON.stringify([Date.UTC(2026, 2, 4, 8, i * 3) / 1000, 40 + i * 0.01, -30 - i * 0.01]),
  ).join("\n");

  test("is read with no model call at all", async () => {
    const id = stage("history.jsonl", TRACK);
    const done = await read(await importRoute(json("/api/helper/owner/import", { inbox: id }), params));
    expect(done.status).toBe(200);
    expect(done.body.read).toBe(40);
    expect(mapStatementColumns).not.toHaveBeenCalled();
  });

  test("what comes back is counts and dates, never a position", async () => {
    const id = stage("history.jsonl", TRACK);
    const done = await read(await importRoute(json("/api/helper/owner/import", { inbox: id }), params));
    const said = JSON.stringify(done.body);
    expect(said).not.toContain("lat");
    expect(said).not.toContain("40.0");
    expect(said).not.toContain("-30.0");
  });

  test("it needs no model on the instance at all", async () => {
    writeConfig({ auth: { enabled: true }, credits: { enabled: true } });
    const id = stage("history.jsonl", TRACK);
    const done = await read(await importRoute(json("/api/helper/owner/import", { inbox: id }), params));
    expect(done.status).toBe(200);
    expect(await balanceOf("owner")).toBe(10);
  });
});

describe("costs reach the days", () => {
  test("the whole file is read for free, and only agreed rows are written", async () => {
    const id = stage("export.csv", STATEMENT);
    const dry = await read(
      await applyRoute(
        json("/api/helper/owner/statement/apply", {
          inbox: id,
          trip: "the-islands",
          mapping: MAPPING,
        }),
        params,
      ),
    );
    expect(dry.status).toBe(200);
    expect(dry.body.read).toBe(5);
    expect(mapStatementColumns).not.toHaveBeenCalled();
    expect(await balanceOf("owner")).toBe(10);

    // No day is written yet, so nothing lands and it says so rather than
    // attaching the money to the nearest day it can find.
    const written = await read(
      await applyRoute(
        json("/api/helper/owner/statement/apply", {
          trip: "the-islands",
          rows: [
            { date: "2026-03-04", label: "Kiosk am Hafen", amount: 12.4, currency: "EUR", category: "food" },
          ],
        }),
        params,
      ),
    );
    expect(written.status).toBe(200);
    expect((written.body.written as { orphaned: unknown[] }).orphaned).toHaveLength(1);
  });

  test("a row with no category is refused rather than filed under something", async () => {
    const refused = await read(
      await applyRoute(
        json("/api/helper/owner/statement/apply", {
          trip: "the-islands",
          rows: [{ date: "2026-03-04", label: "Kiosk am Hafen", amount: 12.4, currency: "EUR" }],
        }),
        params,
      ),
    );
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe("invalid_rows");
  });
});
